import { createHash } from "node:crypto";
import {
  buildVariantAdjustedEstimates,
  buildVariantDiscoveryQuery,
  deriveValuationProfile,
} from "./variant-adjustment.mjs";
import {
  cardIdentity,
  isPokemonCard,
} from "../card-category.mjs";
import { isVisualMismatch } from "../identification/visual-image-matcher.mjs";

const activeMarketDisclaimer =
  "Active Buy It Now asking prices are not completed sales, appraisals, or guaranteed sale values. Shipping is included only when eBay provides it in search results.";

const commonWords = new Set([
  "the",
  "and",
  "card",
  "cards",
  "baseball",
  "basketball",
  "football",
  "hockey",
  "soccer",
  "series",
]);

const parallelWords = new Set([
  "aqua",
  "atomic",
  "black",
  "blue",
  "crackle",
  "foil",
  "gold",
  "green",
  "holo",
  "lava",
  "mosaic",
  "negative",
  "orange",
  "pink",
  "prizm",
  "purple",
  "rainbow",
  "raywave",
  "red",
  "refractor",
  "reverse",
  "sapphire",
  "sepia",
  "shimmer",
  "silver",
  "speckle",
  "superfractor",
  "teal",
  "wave",
]);

const genericParallelWords = new Set(["foil", "holo", "prizm", "refractor"]);
const productVariantWords = new Set([
  "bowman",
  "chrome",
  "cosmic",
  "donruss",
  "finest",
  "heritage",
  "museum",
  "optic",
  "platinum",
  "prizm",
  "sapphire",
  "select",
  "sterling",
  "tribute",
  "update",
]);

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function sourceImageCacheKey(sourceImageDataUrl) {
  return sourceImageDataUrl
    ? createHash("sha256").update(sourceImageDataUrl).digest("base64url").slice(0, 20)
    : "none";
}

function searchKey(value) {
  return cleanText(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function pokemonProductTerm(value) {
  const key = searchKey(value).replace(/[^a-z0-9]+/g, " ").trim();
  return new Set([
    "pokemon",
    "pokemon tcg",
    "pokemon trading card game",
    "the pokemon company",
    "nintendo",
  ]).has(key)
    ? ""
    : value;
}

function normalizedWords(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function compact(value) {
  return normalizedWords(value).join("");
}

function significantWords(value) {
  return normalizedWords(value).filter(
    (word) => word.length > 1 && !commonWords.has(word),
  );
}

function titleHasWords(title, value) {
  const titleWords = new Set(normalizedWords(title));
  const expected = significantWords(value);
  return expected.length > 0 && expected.every((word) => titleWords.has(word));
}

function titleHasPromo(title) {
  return /\bpromo(?:tional)?\b/i.test(cleanText(title));
}

function variantText(fields) {
  return [fields.parallel, fields.finish].map(cleanText).filter(Boolean).join(" ");
}

function titleHasCardNumber(title, cardNumber) {
  const expected = compact(cardNumber).replace(/^0+/, "");
  if (!expected) return false;
  return normalizedWords(title).some(
    (word) => word.replace(/^0+/, "") === expected,
  ) || compact(title).includes(expected);
}

function printRunFromSerial(serialNumber) {
  const match = cleanText(serialNumber).match(
    /(?:^|\s)(?:\d+\s*)?\/\s*(\d+)(?:\s|$)/,
  );
  return match?.[1] ?? null;
}

function titleHasPrintRun(title, printRun) {
  if (!printRun) return false;
  const escaped = printRun.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(?:/\\s*${escaped}\\b|\\b(?:out\\s+of|numbered\\s+(?:to|out\\s+of))\\s+${escaped}\\b)`,
    "i",
  ).test(title);
}

function titleYears(title) {
  return [...cleanText(title).matchAll(/\b(?:19|20)\d{2}\b/g)].map(
    (match) => match[0],
  );
}

function titlePrintRuns(title) {
  const runs = [
    ...cleanText(title).matchAll(
      /(?:^|[^\d])(?:\d{1,3}\s*)?\/\s*(\d{1,4})\b/g,
    ),
    ...cleanText(title).matchAll(
      /\b(?:out\s+of|numbered\s+(?:to|out\s+of))\s+(\d{1,4})\b/gi,
    ),
  ].map((match) => match[1].replace(/^0+/, "") || "0");
  return [...new Set(runs)];
}

function normalizedCardNumber(value) {
  return compact(value).replace(/^0+/, "");
}

function titleCardNumbers(title) {
  return [...cleanText(title).matchAll(/(?:#|\bno\.?)\s*([a-z0-9][a-z0-9-]*)/gi)]
    .map((match) => normalizedCardNumber(match[1]))
    .filter(Boolean);
}

function hasBroaderMatchConflict(title, fields) {
  const expectedYear = cleanText(fields.year);
  const years = titleYears(title);
  if (expectedYear && years.length > 0 && !years.includes(expectedYear)) {
    return true;
  }

  const expectedPrintRun = printRunFromSerial(fields.serialNumber)?.replace(
    /^0+/,
    "",
  );
  const printRuns = titlePrintRuns(title);
  if (
    expectedPrintRun &&
    printRuns.length > 0 &&
    !printRuns.includes(expectedPrintRun)
  ) {
    return true;
  }

  const expectedCardNumber = normalizedCardNumber(fields.cardNumber);
  const cardNumbers = titleCardNumbers(title);
  if (
    expectedCardNumber &&
    cardNumbers.length > 0 &&
    !cardNumbers.includes(expectedCardNumber)
  ) {
    return true;
  }

  const expectedParallelWords = new Set(
    normalizedWords(variantText(fields)).filter((word) => parallelWords.has(word)),
  );
  if (expectedParallelWords.size > 0) {
    const conflictingParallel = normalizedWords(title)
      .filter((word) => parallelWords.has(word))
      .some(
        (word) =>
          !expectedParallelWords.has(word) && !genericParallelWords.has(word),
      );
    if (conflictingParallel) return true;
  }

  const expectedProductWords = new Set(
    normalizedWords(
      [fields.manufacturer, fields.product, fields.setOrInsert]
        .map(cleanText)
        .filter(Boolean)
        .join(" "),
    ),
  );
  return normalizedWords(title).some(
    (word) =>
      productVariantWords.has(word) && !expectedProductWords.has(word),
  );
}

function uniqueParts(parts) {
  return parts.filter(
    (part, index) =>
      part &&
      parts.findIndex(
        (candidate) => searchKey(candidate) === searchKey(part),
      ) === index,
  );
}

export function buildActiveMarketQuery(fields) {
  const printRun = printRunFromSerial(fields.serialNumber);
  const pokemon = isPokemonCard(fields);
  return uniqueParts(
    [
      pokemon ? "Pokemon" : "",
      pokemon ? "" : fields.sport,
      fields.year,
      cardIdentity(fields),
      pokemon ? "" : fields.manufacturer,
      pokemon ? pokemonProductTerm(fields.product) : fields.product,
      fields.setOrInsert,
      fields.cardNumber
        ? `#${cleanText(fields.cardNumber).replace(/^#/, "")}`
        : "",
      fields.parallel,
      pokemon ? fields.finish : "",
      pokemon ? fields.rarity : "",
      pokemon && fields.promo === true ? "Promo" : "",
      pokemon ? fields.language : "",
      printRun ? `/${printRun}` : "",
      fields.autograph === true ? "autograph" : "",
      fields.memorabilia === true ? "patch relic" : "",
    ]
      .map(cleanText)
      .filter(Boolean),
  )
    .join(" ")
    .slice(0, 500);
}

export function buildPokemonDiscoveryQueries(fields) {
  if (!isPokemonCard(fields)) return [];

  const identity = cardIdentity(fields);
  if (!identity) return [];
  const cardNumber = cleanText(fields.cardNumber).replace(/^#/, "");
  const promo = fields.promo === true ? "Promo" : "";
  const variant = cleanText(fields.parallel) || cleanText(fields.finish);
  const set = cleanText(fields.setOrInsert);
  const queries = [
    cardNumber ? ["Pokemon", identity, cardNumber, promo || variant] : null,
    cardNumber ? ["Pokemon", identity, cardNumber] : null,
    set ? ["Pokemon", identity, set, promo || variant] : null,
    !cardNumber && !set
      ? ["Pokemon", identity, promo || variant]
      : null,
  ]
    .filter(Boolean)
    .map((parts) => uniqueParts(parts.map(cleanText).filter(Boolean)).join(" "))
    .filter(Boolean);

  return [...new Set(queries)].filter(
    (query) => query.toLowerCase() !== buildActiveMarketQuery(fields).toLowerCase(),
  );
}

function obviousMismatch(title, fields) {
  const normalized = ` ${normalizedWords(title).join(" ")} `;
  if (
    /\b(lot|break|reprint|replica|facsimile|proxy|digital|custom)\b/i.test(
      normalized,
    ) ||
    /\b(complete|team)\s+set\b/i.test(normalized) ||
    /\b(sealed|unopened|hobby|blaster)\s+(box|pack|case)\b/i.test(
      normalized,
    )
  ) {
    return true;
  }

  const autographTitle = /\b(auto|autograph|autographed|signed)\b/i.test(
    normalized,
  );
  if (fields.autograph === true && !autographTitle) return true;
  if (fields.autograph === false && autographTitle) return true;

  const memorabiliaTitle = /\b(patch|relic|swatch|memorabilia)\b/i.test(
    normalized,
  );
  if (fields.memorabilia === true && !memorabiliaTitle) return true;
  if (fields.memorabilia === false && memorabiliaTitle) return true;

  if (!cleanText(variantText(fields))) {
    const titleWords = normalizedWords(title);
    if (titleWords.some((word) => parallelWords.has(word))) return true;
  }
  return false;
}

const matchSignalFields = {
  player: "player",
  character: "character",
  year: "year",
  card_number: "cardNumber",
  parallel: "parallel",
  finish: "finish",
  rarity: "rarity",
  promo: "promo",
  language: "language",
  print_run: "serialNumber",
  product: "product",
  set: "setOrInsert",
};

function consensusAdjustedScore(score, matchedSignals, identityConsensus, visualMatch) {
  const consensusStrengths = matchedSignals
    .map((signal) => identityConsensus?.[matchSignalFields[signal]]?.strength)
    .filter(Number.isFinite);
  const consensusStrength = consensusStrengths.length
    ? consensusStrengths.reduce((sum, strength) => sum + strength, 0) / consensusStrengths.length
    : 0;
  const visualStrength = Number.isFinite(visualMatch?.score) ? visualMatch.score : 0;
  const bonus = consensusStrength * 0.07 + Math.max(0, visualStrength - 0.6) * 0.18;
  return Math.min(1, score + bonus);
}

function evaluateMatch(candidate, fields, identityConsensus = {}) {
  const title = candidate.title;
  if (
    obviousMismatch(title, fields) ||
    isVisualMismatch(candidate.visualMatch, candidate.visualMatchStatus)
  ) return null;

  const pokemon = isPokemonCard(fields);
  const identity = cardIdentity(fields);
  const identitySignal = pokemon ? "character" : "player";

  const checks = [
    {
      id: identitySignal,
      weight: 5,
      required: Boolean(identity),
      matched: titleHasWords(title, identity),
    },
    {
      id: "year",
      weight: 3,
      required: Boolean(cleanText(fields.year)),
      matched: titleHasWords(title, fields.year),
    },
    {
      id: "card_number",
      weight: 4,
      required: Boolean(cleanText(fields.cardNumber)),
      matched: titleHasCardNumber(title, fields.cardNumber),
    },
    {
      id: "parallel",
      weight: 4,
      required: Boolean(cleanText(fields.parallel)),
      matched: titleHasWords(title, fields.parallel),
    },
    {
      id: "finish",
      weight: 3,
      required: pokemon && Boolean(cleanText(fields.finish)),
      matched: titleHasWords(title, fields.finish),
    },
    {
      id: "rarity",
      weight: 2,
      required: false,
      matched: titleHasWords(title, fields.rarity),
    },
    {
      id: "promo",
      weight: 3,
      required: pokemon && fields.promo === true,
      matched: titleHasPromo(title),
    },
    {
      id: "language",
      weight: 1,
      required: false,
      matched: titleHasWords(title, fields.language),
    },
    {
      id: "print_run",
      weight: 4,
      required: Boolean(printRunFromSerial(fields.serialNumber)),
      matched: titleHasPrintRun(
        title,
        printRunFromSerial(fields.serialNumber),
      ),
    },
    {
      id: "product",
      weight: 2,
      required: false,
      matched: titleHasWords(title, fields.product),
    },
    {
      id: "set",
      weight: 2,
      required: false,
      matched: titleHasWords(title, fields.setOrInsert),
    },
  ].filter(
    (check) =>
      check.required ||
      (check.id === "product" && cleanText(fields.product)) ||
      (check.id === "set" && cleanText(fields.setOrInsert)) ||
      (check.id === "rarity" && cleanText(fields.rarity)) ||
      (check.id === "language" && cleanText(fields.language)),
  );

  if (checks.some((check) => check.required && !check.matched)) return null;
  const possibleWeight = checks.reduce((sum, check) => sum + check.weight, 0);
  const matchedWeight = checks
    .filter((check) => check.matched)
    .reduce((sum, check) => sum + check.weight, 0);
  const baseScore = possibleWeight > 0 ? matchedWeight / possibleWeight : 0;
  const matchedSignals = checks
    .filter((check) => check.matched)
    .map((check) => check.id);
  const score = consensusAdjustedScore(
    baseScore,
    matchedSignals,
    identityConsensus,
    candidate.visualMatch,
  );
  if (score < 0.65) return null;
  return {
    score: Math.round(score * 100) / 100,
    matchedSignals: [
      ...matchedSignals,
      ...(candidate.visualMatch?.score >= 0.7 ? ["visual_design"] : []),
      ...(Object.keys(identityConsensus).length ? ["web_consensus"] : []),
    ],
  };
}

function evaluateBroaderMatch(candidate, fields, identityConsensus = {}) {
  const title = candidate.title;
  const pokemon = isPokemonCard(fields);
  const identity = cardIdentity(fields);
  const identitySignal = pokemon ? "character" : "player";
  if (
    obviousMismatch(title, fields) ||
    isVisualMismatch(candidate.visualMatch, candidate.visualMatchStatus) ||
    !identity ||
    !titleHasWords(title, identity) ||
    hasBroaderMatchConflict(title, fields)
  ) {
    return null;
  }

  const checks = [
    { id: identitySignal, weight: 5, matched: true },
    { id: "year", weight: 3, matched: titleHasWords(title, fields.year) },
    {
      id: "card_number",
      weight: 4,
      matched: titleHasCardNumber(title, fields.cardNumber),
    },
    {
      id: "parallel",
      weight: 4,
      matched: titleHasWords(title, fields.parallel),
    },
    {
      id: "finish",
      weight: 3,
      matched: titleHasWords(title, fields.finish),
    },
    {
      id: "rarity",
      weight: 2,
      matched: titleHasWords(title, fields.rarity),
    },
    {
      id: "promo",
      weight: 3,
      matched: titleHasPromo(title),
    },
    {
      id: "print_run",
      weight: 4,
      matched: titleHasPrintRun(
        title,
        printRunFromSerial(fields.serialNumber),
      ),
    },
    { id: "product", weight: 2, matched: titleHasWords(title, fields.product) },
    { id: "set", weight: 2, matched: titleHasWords(title, fields.setOrInsert) },
  ].filter(
    (check) =>
      check.id === identitySignal ||
      (check.id === "year" && cleanText(fields.year)) ||
      (check.id === "card_number" && cleanText(fields.cardNumber)) ||
      (check.id === "parallel" && cleanText(fields.parallel)) ||
      (check.id === "finish" && cleanText(fields.finish)) ||
      (check.id === "rarity" && cleanText(fields.rarity)) ||
      (check.id === "promo" && pokemon && fields.promo === true) ||
      (check.id === "print_run" && printRunFromSerial(fields.serialNumber)) ||
      (check.id === "product" && cleanText(fields.product)) ||
      (check.id === "set" && cleanText(fields.setOrInsert)),
  );
  const matchedSignals = checks
    .filter((check) => check.matched)
    .map((check) => check.id);
  if (matchedSignals.every((signal) => signal === identitySignal)) return null;
  const expectedDiscriminators = checks
    .filter((check) =>
      ["card_number", "parallel", "finish", "promo", "print_run"].includes(check.id),
    )
    .map((check) => check.id);
  if (
    expectedDiscriminators.length > 0 &&
    !expectedDiscriminators.some((signal) => matchedSignals.includes(signal))
  ) {
    return null;
  }

  const possibleWeight = checks.reduce((sum, check) => sum + check.weight, 0);
  const matchedWeight = checks
    .filter((check) => check.matched)
    .reduce((sum, check) => sum + check.weight, 0);
  const baseScore = possibleWeight > 0 ? matchedWeight / possibleWeight : 0;
  const score = consensusAdjustedScore(
    baseScore,
    matchedSignals,
    identityConsensus,
    candidate.visualMatch,
  );
  if (score < 0.5) return null;
  return {
    score: Math.round(score * 100) / 100,
    matchedSignals,
  };
}

export function evaluateCardTitleMatch(
  title,
  fields,
  { broader = false, identityConsensus = {}, visualMatch = null, visualMatchStatus = null } = {},
) {
  const candidate = { title: cleanText(title), visualMatch, visualMatchStatus };
  if (!candidate.title) return null;
  return broader
    ? evaluateBroaderMatch(candidate, fields, identityConsensus)
    : evaluateMatch(candidate, fields, identityConsensus);
}

function parseCents(price) {
  const value = Number(price?.value);
  return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : null;
}

function detectedGrade(title, condition) {
  const text = `${title} ${condition ?? ""}`;
  const match = text.match(
    /\b(PSA|BGS|SGC|CGC|CSG|TAG|HGA|GMA|ISA|KSA)\s*(10|9\.5|9|8\.5|8|7\.5|7|6\.5|6|5\.5|5|4\.5|4|3\.5|3|2\.5|2|1\.5|1)\b/i,
  );
  if (match) {
    const company = match[1].toUpperCase();
    const grade = match[2];
    return {
      id: `${company.toLowerCase()}_${grade.replace(".", "_")}`,
      label: `${company} ${grade}`,
      classification: "graded",
    };
  }
  if (/\bgraded\b/i.test(text)) {
    return { id: "graded_other", label: "Other graded", classification: "graded" };
  }
  return { id: "raw", label: "Raw / ungraded", classification: "raw" };
}

function quantile(sorted, percentile) {
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * percentile;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return Math.round(
    sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower),
  );
}

function groupStatistics(listings) {
  const sorted = [...listings].sort(
    (left, right) => left.totalPriceCents - right.totalPriceCents,
  );
  let included = sorted;
  if (sorted.length >= 5) {
    const prices = sorted.map((listing) => listing.totalPriceCents);
    const firstQuartile = quantile(prices, 0.25);
    const thirdQuartile = quantile(prices, 0.75);
    const interquartileRange = thirdQuartile - firstQuartile;
    const lowerFence = Math.max(0, firstQuartile - interquartileRange * 1.5);
    const upperFence = thirdQuartile + interquartileRange * 1.5;
    included = sorted.filter(
      (listing) =>
        listing.totalPriceCents >= lowerFence &&
        listing.totalPriceCents <= upperFence,
    );
  }
  const prices = included.map((listing) => listing.totalPriceCents);
  const medianAmountCents = quantile(prices, 0.5);
  return {
    included,
    medianAmountCents,
    typicalRange: {
      lowAmountCents: quantile(prices, included.length >= 4 ? 0.25 : 0),
      highAmountCents: quantile(prices, included.length >= 4 ? 0.75 : 1),
    },
    outlierCount: sorted.length - included.length,
    confidence:
      included.length >= 5
        ? "high"
        : included.length >= 3
          ? "medium"
          : "low",
  };
}

export function buildActiveMarketSnapshot({
  fields,
  grading = {
    isGraded: false,
    company: null,
    grade: null,
    certificationNumber: null,
  },
  valuationProfile = deriveValuationProfile(fields),
  marketplaceId,
  candidates,
  queriesUsed = [buildActiveMarketQuery(fields)],
  confirmedReferenceItemId = null,
  excludedObservationIds = [],
  searchedAt = new Date().toISOString(),
  identityConsensus = {},
}) {
  const query = buildActiveMarketQuery(fields);
  const excludedObservationIdSet = new Set(excludedObservationIds);
  const eligibleCandidates = candidates.filter((candidate) => {
    if (excludedObservationIdSet.has(candidate.itemId)) return false;
    if (!candidate.buyingOptions.includes("FIXED_PRICE")) return false;
    const itemPriceCents = parseCents(candidate.price);
    const currency = candidate.price?.currency;
    return itemPriceCents !== null && Boolean(currency);
  });

  function listingFromMatch(candidate, match, matchTier) {
    const itemPriceCents = parseCents(candidate.price);
    const currency = candidate.price.currency;
    const shippingCostCents =
      candidate.shippingCost?.currency === currency
        ? parseCents(candidate.shippingCost)
        : null;
    return {
      itemId: candidate.itemId,
      title: candidate.title,
      itemWebUrl: candidate.itemWebUrl,
      imageUrl: candidate.imageUrl,
      condition: candidate.condition,
      itemPriceCents,
      shippingCostCents,
      totalPriceCents: itemPriceCents + (shippingCostCents ?? 0),
      currency,
      matchScore: match.score,
      matchedSignals: match.matchedSignals,
      matchTier,
      confirmedReference: matchTier === "confirmed",
      grade: detectedGrade(candidate.title, candidate.condition),
    };
  }

  const exactListings = eligibleCandidates.flatMap((candidate) => {
    const isConfirmedReference =
      Boolean(confirmedReferenceItemId) &&
      candidate.itemId === confirmedReferenceItemId;
    const confirmedReferenceRejected = isConfirmedReference &&
      isVisualMismatch(candidate.visualMatch, candidate.visualMatchStatus);
    const match = isConfirmedReference && !confirmedReferenceRejected
      ? { score: 1, matchedSignals: ["confirmed_reference"] }
      : isConfirmedReference
        ? null
        : evaluateMatch(candidate, fields, identityConsensus);
    if (!match) return [];
    return [
      listingFromMatch(
        candidate,
        match,
        isConfirmedReference ? "confirmed" : "strict",
      ),
    ];
  });
  const exactItemIds = new Set(exactListings.map((listing) => listing.itemId));
  const broaderListings =
    exactListings.length < 3
      ? eligibleCandidates.flatMap((candidate) => {
          if (exactItemIds.has(candidate.itemId)) return [];
          const match = evaluateBroaderMatch(candidate, fields, identityConsensus);
          return match
            ? [listingFromMatch(candidate, match, "broader")]
            : [];
        })
      : [];
  const matchedListings = [...exactListings, ...broaderListings];

  const buckets = new Map();
  for (const listing of matchedListings) {
    const groupMatchTier =
      listing.matchTier === "broader" ? "broader" : "exact";
    const key = `${groupMatchTier}:${listing.grade.id}:${listing.currency}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(listing);
  }
  const groups = [...buckets.values()]
    .map((listings) => {
      const statistics = groupStatistics(listings);
      const { grade, currency } = listings[0];
      const matchTier =
        listings[0].matchTier === "broader" ? "broader" : "exact";
      return {
        id: matchTier === "broader" ? `broader_${grade.id}` : grade.id,
        label: grade.label,
        classification: grade.classification,
        matchTier,
        currency,
        listingCount: statistics.included.length,
        medianAmountCents: statistics.medianAmountCents,
        typicalRange: statistics.typicalRange,
        outlierCount: statistics.outlierCount,
        confidence:
          matchTier === "broader" ? "low" : statistics.confidence,
        listings: statistics.included
          .sort((left, right) => right.matchScore - left.matchScore)
          .slice(0, 10)
          .map(({ grade: _grade, ...listing }) => listing),
      };
    })
    .sort((left, right) => {
      if (left.matchTier !== right.matchTier) {
        return left.matchTier === "exact" ? -1 : 1;
      }
      if (left.classification !== right.classification) {
        return left.classification === "raw" ? -1 : 1;
      }
      return right.listingCount - left.listingCount;
    });

  const matchedItemIds = new Set(
    matchedListings.map((listing) => listing.itemId),
  );
  const expectedGrade = grading.isGraded
    ? `${grading.company ?? ""} ${grading.grade ?? ""}`.trim().toLowerCase()
    : null;
  const variantEstimates =
    exactListings.length < 3 && !isPokemonCard(fields)
      ? buildVariantAdjustedEstimates({
          fields,
          valuationProfile,
          observationType: "active_asking",
          observations: eligibleCandidates.flatMap((candidate) => {
            const grade = detectedGrade(candidate.title, candidate.condition);
            const sameCondition = grading.isGraded
              ? grade.classification === "graded" &&
                grade.label.toLowerCase() === expectedGrade
              : grade.classification === "raw";
            if (!sameCondition) return [];
            const itemPriceCents = parseCents(candidate.price);
            const shippingCostCents =
              candidate.shippingCost?.currency === candidate.price.currency
                ? parseCents(candidate.shippingCost)
                : null;
            return [
              {
                id: candidate.itemId,
                title: candidate.title,
                amountCents: itemPriceCents + (shippingCostCents ?? 0),
                currency: candidate.price.currency,
                platform: "eBay",
                imageUrl: candidate.imageUrl,
                url: candidate.itemWebUrl,
                date: null,
                printRun: null,
                features: [],
              },
            ];
          }),
          excludedObservationIds: [
            ...matchedItemIds,
            ...excludedObservationIds,
          ],
        })
      : [];

  return {
    schemaVersion: "1.0",
    kind: "active_asking_snapshot",
    source: {
      provider: "ebay_browse",
      displayName: "eBay Buy It Now",
      supportsSoldHistory: false,
    },
    marketplaceId,
    query,
    queriesUsed,
    searchedAt,
    candidateCount: candidates.length,
    matchedCount: matchedListings.length,
    exactMatchedCount: exactListings.length,
    broaderMatchedCount: broaderListings.length,
    excludedCount: candidates.length - matchedListings.length,
    groups,
    valuationProfile,
    variantEstimates,
    identityConsensusFields: Object.keys(identityConsensus),
    disclaimer: activeMarketDisclaimer,
  };
}

export class ActiveMarketService {
  constructor({ ebayClient, visualMatcher = null, now = () => Date.now(), cacheDurationMs = 10 * 60 * 1000 }) {
    if (!ebayClient) throw new TypeError("An eBay Browse client is required.");
    this.ebayClient = ebayClient;
    this.visualMatcher = visualMatcher;
    this.now = now;
    this.cacheDurationMs = cacheDurationMs;
    this.cache = new Map();
  }

  async snapshot(
    fields,
    {
      confirmedReferenceItemId = null,
      grading = {
        isGraded: false,
        company: null,
        grade: null,
        certificationNumber: null,
      },
      valuationProfile = deriveValuationProfile(fields),
      excludedObservationIds = [],
      identityConsensus = {},
      identityConsensusPromise = null,
      sourceImageDataUrl = null,
    } = {},
  ) {
    const query = buildActiveMarketQuery(fields);
    if (!query) {
      throw new TypeError(
        "Add a player or Pokémon name, year, set, or card number before checking the active market.",
      );
    }
    const gradeProfile = grading.isGraded
      ? `${grading.company ?? ""}:${grading.grade ?? ""}`
      : "raw";
    const cacheKey = `${query.toLowerCase()}|reference:${confirmedReferenceItemId ?? "none"}|${gradeProfile}|${valuationProfile.featureType}:${valuationProfile.source}|image:${sourceImageCacheKey(sourceImageDataUrl)}`;
    const cached = this.cache.get(cacheKey);
    const hasFreshCache = Boolean(cached && cached.expiresAt > this.now());
    const marketRequest = hasFreshCache
      ? null
      : this.ebayClient.searchByKeywords({ query, limit: 50 });
    const resolvedIdentityConsensus = identityConsensusPromise
      ? await identityConsensusPromise
      : identityConsensus;
    const snapshotFrom = ({
      marketplaceId,
      candidates,
      searchedAt,
      queriesUsed = [query],
    }) =>
      buildActiveMarketSnapshot({
        fields,
        grading,
        valuationProfile,
        marketplaceId,
        candidates,
        queriesUsed,
        confirmedReferenceItemId,
        excludedObservationIds,
        searchedAt,
        identityConsensus: resolvedIdentityConsensus,
      });
    if (hasFreshCache) return snapshotFrom(cached);

    const result = await marketRequest;
    let candidates = sourceImageDataUrl && this.visualMatcher
      ? await this.visualMatcher.rank({ sourceImageDataUrl, candidates: result.candidates, limit: 20 })
      : result.candidates;
    const queriesUsed = [query];
    const searchedAt = new Date(this.now()).toISOString();
    let snapshot = buildActiveMarketSnapshot({
      fields,
      grading,
      valuationProfile,
      marketplaceId: result.marketplaceId,
      candidates,
      queriesUsed,
      confirmedReferenceItemId,
      excludedObservationIds,
      searchedAt,
      identityConsensus: resolvedIdentityConsensus,
    });
    const discoveryQueries = isPokemonCard(fields)
      ? buildPokemonDiscoveryQueries(fields)
      : [buildVariantDiscoveryQuery(fields)].filter(Boolean);
    for (const discoveryQuery of discoveryQueries) {
      if (snapshot.matchedCount >= 3 || discoveryQuery === query) break;
      const discovery = await this.ebayClient.searchByKeywords({
        query: discoveryQuery,
        limit: 50,
      });
      const unique = new Map(
        [...candidates, ...discovery.candidates].map((candidate) => [
          candidate.itemId,
          candidate,
        ]),
      );
      candidates = [...unique.values()];
      if (sourceImageDataUrl && this.visualMatcher) {
        candidates = await this.visualMatcher.rank({ sourceImageDataUrl, candidates, limit: 20 });
      }
      queriesUsed.push(discoveryQuery);
      snapshot = buildActiveMarketSnapshot({
        fields,
        grading,
        valuationProfile,
        marketplaceId: result.marketplaceId,
        candidates,
        queriesUsed,
        confirmedReferenceItemId,
        excludedObservationIds,
        searchedAt,
        identityConsensus: resolvedIdentityConsensus,
      });
    }
    this.cache.set(cacheKey, {
      marketplaceId: result.marketplaceId,
      candidates,
      queriesUsed,
      searchedAt,
      expiresAt: this.now() + this.cacheDurationMs,
    });
    return snapshotFrom({
      marketplaceId: result.marketplaceId,
      candidates,
      queriesUsed,
      searchedAt,
    });
  }
}

export { activeMarketDisclaimer };
