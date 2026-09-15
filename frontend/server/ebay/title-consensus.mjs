import {
  suggestedCardNumberFromTitle,
  suggestedParallelFromTitle,
} from "./image-search.mjs";

function text(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function normalized(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function words(value) {
  return text(value).match(/[A-Za-z0-9]+(?:[/-][A-Za-z0-9]+)*/g) ?? [];
}

function distinctPhrases(values) {
  const phrases = [];
  for (const raw of values) {
    const value = text(raw);
    const key = normalized(value);
    if (!key || phrases.some((existing) => normalized(existing) === key)) continue;
    phrases.push(value);
  }
  return phrases;
}

function productPhrase(fields) {
  const manufacturer = text(fields.manufacturer ?? fields.brand);
  const product = text(fields.product);
  if (!product) return manufacturer;
  if (!manufacturer || normalized(product).includes(normalized(manufacturer))) return product;
  return `${manufacturer} ${product}`;
}

function addWithinLimit(parts, phrase, limit = 80) {
  const clean = text(phrase);
  if (!clean) return;
  const cleanKey = normalized(clean);
  if (parts.some((part) => normalized(part) === cleanKey)) return;
  const candidate = [...parts, clean].join(" ");
  if (candidate.length <= limit) parts.push(clean);
}

export function composeListingTitle(card, consensusTerms = []) {
  const fields = card?.fields ?? {};
  const pokemon = Boolean(text(fields.character));
  const identity = text(fields.player ?? fields.character) || text(card?.title);
  const product = productPhrase(fields);
  const set = text(fields.setOrInsert);
  const setPhrase = set && !normalized(product).includes(normalized(set)) ? set : "";
  const candidates = pokemon
    ? [
        fields.year,
        identity,
        product,
        setPhrase,
        fields.cardNumber ? `#${text(fields.cardNumber)}` : "",
        fields.parallel ?? fields.finish,
        ...consensusTerms,
        fields.rarity,
        fields.promo ? "Promo" : "",
        fields.language && !/^english$/i.test(text(fields.language)) ? fields.language : "",
      ]
    : [
        fields.year,
        product,
        setPhrase,
        identity,
        fields.cardNumber ? `#${text(fields.cardNumber)}` : "",
        fields.parallel,
        ...consensusTerms,
        fields.serialNumber,
        fields.rookieStatus ? "Rookie RC" : "",
        fields.autograph ? "Auto" : "",
        fields.memorabilia ? "Relic" : "",
        card?.grading?.isGraded
          ? `${text(card.grading.company) || "Graded"} ${text(card.grading.grade)}`.trim()
          : "",
      ];
  const parts = [];
  for (const phrase of distinctPhrases(candidates)) addWithinLimit(parts, phrase);
  return parts.join(" ") || text(card?.title).slice(0, 80);
}

const ignoredConsensusWords = new Set([
  "card", "cards", "trading", "sports", "baseball", "basketball", "football",
  "hockey", "pokemon", "tcg", "ccg", "raw", "ungraded", "graded", "mint",
  "near", "condition", "new", "rare", "invest", "investment", "hot", "fire",
  "look", "read", "description", "ships", "fast", "free", "shipping", "lot",
  "psa", "bgs", "sgc", "cgc", "ready", "case", "hit", "ssp", "sp", "pop",
  "ebay", "one", "of", "the", "and", "with", "for", "in", "a", "an",
  "rookie", "rc", "auto", "autograph", "relic", "patch", "numbered",
]);

function identityMatches(title, identity) {
  const titleKeys = new Set(words(title).map(normalized));
  const identityWords = words(identity)
    .map(normalized)
    .filter((word) => word.length > 1 && !new Set(["jr", "sr", "ii", "iii", "iv"]).has(word));
  if (!identityWords.length) return false;
  if (identityWords.length === 1) return titleKeys.has(identityWords[0]);
  return titleKeys.has(identityWords[0]) && titleKeys.has(identityWords.at(-1));
}

function hasIdentityConflict(title, fields) {
  const expectedYear = text(fields.year).match(/(?:19|20)\d{2}/)?.[0];
  const titleYears = words(title).flatMap((word) => word.match(/(?:19|20)\d{2}/g) ?? []);
  if (expectedYear && titleYears.length && titleYears.every((year) => year !== expectedYear)) return true;
  const expectedNumber = normalized(fields.cardNumber);
  const explicitNumbers = [...text(title).matchAll(/(?:#|no\.?\s*)([a-z0-9-]+)/gi)].map((match) => normalized(match[1]));
  return Boolean(expectedNumber && explicitNumbers.length && explicitNumbers.every((number) => number !== expectedNumber));
}

function visualWeight(candidate) {
  if (candidate?.visualMatchStatus !== "matched") return 0;
  const score = Number(candidate.visualMatch?.score);
  const structure = Number(candidate.visualMatch?.structureScore);
  const pose = Number(candidate.visualMatch?.poseScore);
  const pattern = Number(candidate.visualMatch?.patternScore);
  if (!Number.isFinite(score) || score < 0.62) return 0;
  if (Number.isFinite(structure) && structure < 0.42) return 0;
  if (Number.isFinite(pose) && pose < 0.38) return 0;
  const structureValue = Number.isFinite(structure) ? structure : score;
  const poseValue = Number.isFinite(pose) ? pose : structureValue;
  const patternValue = Number.isFinite(pattern) ? pattern : score;
  return (
    score * 0.45 + structureValue * 0.2 + poseValue * 0.2 + patternValue * 0.15
  ) ** 2;
}

function designWeight(candidate) {
  if (candidate?.visualMatchStatus !== "matched") return 0;
  const design = Number(candidate.visualMatch?.designScore);
  const pattern = Number(candidate.visualMatch?.patternScore);
  const border = Number(candidate.visualMatch?.borderScore);
  const layout = Number(candidate.visualMatch?.layoutScore);
  if (!Number.isFinite(design) || design < 0.64) return 0;
  if (Number.isFinite(pattern) && pattern < 0.48) return 0;
  const patternValue = Number.isFinite(pattern) ? pattern : design;
  const borderValue = Number.isFinite(border) ? border : design;
  const layoutValue = Number.isFinite(layout) ? layout : design;
  return (design * 0.55 + patternValue * 0.25 + borderValue * 0.1 + layoutValue * 0.1) ** 2;
}

function hasDesignContext(title, fields) {
  const expectedYear = text(fields.year).match(/(?:19|20)\d{2}/)?.[0];
  const titleYears = words(title).flatMap((word) => word.match(/(?:19|20)\d{2}/g) ?? []);
  if (expectedYear && titleYears.length && titleYears.every((year) => year !== expectedYear)) return false;
  const productWords = words(productPhrase(fields)).map(normalized).filter((word) => word.length > 2);
  if (!productWords.length) return false;
  const titleWords = new Set(words(title).map(normalized));
  return productWords.every((word) => titleWords.has(word));
}

function consensusParallel(eligible, totalWeight) {
  const support = new Map();
  for (const { candidate, weight } of eligible) {
    const value = suggestedParallelFromTitle(candidate.title);
    const key = normalized(value);
    if (!key) continue;
    const current = support.get(key) ?? { value, count: 0, weight: 0 };
    current.count += 1;
    current.weight += weight;
    support.set(key, current);
  }
  const best = [...support.values()].sort((left, right) => right.weight - left.weight)[0];
  return best && best.count >= 2 && best.weight / totalWeight >= 0.55 ? best.value : null;
}

function consensusInsert(fields, eligible, totalWeight, parallel) {
  const ignored = new Set([
    ...ignoredConsensusWords,
    ...words([
      fields.year, fields.player, fields.character, fields.manufacturer,
      fields.brand, fields.product, fields.cardNumber, fields.parallel,
      fields.finish, parallel,
    ].filter(Boolean).join(" ")).map(normalized),
  ]);
  const support = new Map();
  for (const { candidate, weight } of eligible) {
    const titleWords = words(candidate.title);
    const phrases = new Map();
    for (let start = 0; start < titleWords.length; start += 1) {
      if (ignored.has(normalized(titleWords[start])) || /^#?\d/.test(titleWords[start])) continue;
      const phraseWords = [];
      for (let end = start; end < Math.min(titleWords.length, start + 3); end += 1) {
        const key = normalized(titleWords[end]);
        if (ignored.has(key) || /^#?\d/.test(titleWords[end])) break;
        phraseWords.push(titleWords[end]);
        const phrase = phraseWords.join(" ");
        phrases.set(normalized(phrase), phrase);
      }
    }
    for (const [key, value] of phrases) {
      const current = support.get(key) ?? { value, count: 0, weight: 0, wordCount: words(value).length };
      current.count += 1;
      current.weight += weight;
      support.set(key, current);
    }
  }
  const best = [...support.values()]
    .filter((entry) => entry.count >= 2 && entry.weight / totalWeight >= 0.58)
    .sort((left, right) =>
      right.weight / totalWeight - left.weight / totalWeight ||
      right.wordCount - left.wordCount ||
      right.weight - left.weight,
    )[0];
  return best?.value ?? null;
}

export function buildCrossPlayerDesignConsensus(fields, candidates) {
  const identity = text(fields?.player ?? fields?.character);
  if (!identity) return null;
  let eligible = (Array.isArray(candidates) ? candidates : [])
    .map((candidate) => ({ candidate, weight: designWeight(candidate) }))
    .filter(({ candidate, weight }) =>
      weight > 0 &&
      !identityMatches(candidate.title, identity) &&
      hasDesignContext(candidate.title, fields),
    );
  const numbered = eligible.filter(({ candidate }) => suggestedCardNumberFromTitle(candidate.title));
  if (numbered.length >= 2) {
    const uniqueNumbers = new Map();
    for (const entry of numbered) {
      const key = normalized(suggestedCardNumberFromTitle(entry.candidate.title));
      const existing = uniqueNumbers.get(key);
      if (!existing || entry.weight > existing.weight) uniqueNumbers.set(key, entry);
    }
    eligible = [...uniqueNumbers.values()];
    if (eligible.length < 2) return null;
  } else if (eligible.length < 3) {
    return null;
  }
  const totalWeight = eligible.reduce((sum, entry) => sum + entry.weight, 0);
  const parallel = consensusParallel(eligible, totalWeight);
  const setOrInsert = consensusInsert(fields, eligible, totalWeight, parallel);
  if (!parallel && !setOrInsert) return null;
  const averageDesignScore = eligible.reduce(
    (sum, { candidate }) => sum + candidate.visualMatch.designScore,
    0,
  ) / eligible.length;
  const confidence = Math.min(
    0.84,
    0.66 + Math.min(0.1, eligible.length * 0.025) + Math.max(0, averageDesignScore - 0.64) * 0.35,
  );
  return {
    setOrInsert,
    parallel,
    confidence: Number(confidence.toFixed(3)),
    supportingItemIds: eligible.slice(0, 12).map(({ candidate }) => candidate.itemId),
    averageDesignScore: Number(averageDesignScore.toFixed(3)),
  };
}

export function buildVisualTitleConsensus(fields, candidates, { generatedAt = new Date().toISOString() } = {}) {
  const identity = text(fields?.player ?? fields?.character);
  const eligible = (Array.isArray(candidates) ? candidates : [])
    .map((candidate) => ({ candidate, weight: visualWeight(candidate) }))
    .filter(({ candidate, weight }) => weight > 0 && identityMatches(candidate.title, identity) && !hasIdentityConflict(candidate.title, fields));
  if (eligible.length < 2) return null;

  const knownWords = new Set(words([
    fields.year, identity, fields.manufacturer, fields.brand, fields.product,
    fields.setOrInsert, fields.cardNumber, fields.parallel, fields.finish,
    fields.serialNumber, fields.rarity,
  ].filter(Boolean).join(" ")).map(normalized));
  const support = new Map();
  let totalWeight = 0;
  for (const { candidate, weight } of eligible) {
    totalWeight += weight;
    const candidateWords = new Map();
    for (const word of words(candidate.title)) {
      const key = normalized(word);
      if (key.length < 3 || /^\d+$/.test(key) || knownWords.has(key) || ignoredConsensusWords.has(key)) continue;
      if (!candidateWords.has(key)) candidateWords.set(key, word);
    }
    for (const [key, display] of candidateWords) {
      const current = support.get(key) ?? { display, weight: 0, count: 0, bestWeight: 0 };
      current.weight += weight;
      current.count += 1;
      if (weight > current.bestWeight) {
        current.display = display;
        current.bestWeight = weight;
      }
      support.set(key, current);
    }
  }
  const terms = [...support.values()]
    .filter((entry) => entry.count >= 2 && entry.weight / totalWeight >= 0.58)
    .sort((left, right) => right.weight - left.weight || right.count - left.count)
    .slice(0, 4)
    .map((entry) => entry.display);
  const averageVisualScore = eligible.reduce((sum, { candidate }) => sum + candidate.visualMatch.score, 0) / eligible.length;
  const card = { fields, grading: { isGraded: false }, title: identity };
  return {
    title: composeListingTitle(card, terms),
    confidence: eligible.length >= 3 && averageVisualScore >= 0.72 ? "high" : "medium",
    supportingItemIds: eligible.map(({ candidate }) => candidate.itemId).slice(0, 12),
    terms,
    averageVisualScore: Number(averageVisualScore.toFixed(3)),
    generatedAt,
  };
}
