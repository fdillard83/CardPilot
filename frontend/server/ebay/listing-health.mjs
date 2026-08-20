import { mappedEbayAspects } from "./listing-readiness.mjs";

function text(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function normalized(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function distinctPhrases(values) {
  const phrases = [];
  for (const raw of values) {
    const value = text(raw);
    const key = normalized(value);
    if (!key) continue;
    if (phrases.some((existing) => normalized(existing) === key)) continue;
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
  if (!phrase) return;
  const candidate = [...parts, phrase].join(" ");
  if (candidate.length <= limit) parts.push(phrase);
}

export function optimizedListingTitle(card) {
  const fields = card?.fields ?? {};
  const pokemon = Boolean(text(fields.character));
  const identity = text(fields.player ?? fields.character) || text(card?.title);
  const serial = text(fields.serialNumber);
  const set = text(fields.setOrInsert);
  const product = productPhrase(fields);
  const setPhrase = set && !normalized(product).includes(normalized(set)) ? set : "";
  const candidates = pokemon
    ? [
        fields.year,
        identity,
        product,
        setPhrase,
        fields.cardNumber ? `#${text(fields.cardNumber)}` : "",
        fields.parallel ?? fields.finish,
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
        serial,
        fields.rookieStatus ? "Rookie RC" : "",
        fields.autograph ? "Auto" : "",
        fields.memorabilia ? "Relic" : "",
        card?.grading?.isGraded
          ? `${text(card.grading.company) || "Graded"} ${text(card.grading.grade)}`.trim()
          : "",
      ];
  const parts = [];
  for (const phrase of distinctPhrases(candidates)) addWithinLimit(parts, phrase);
  if (!parts.length) return text(card?.title).slice(0, 80);
  return parts.join(" ");
}

function equalValues(left, right) {
  return JSON.stringify((left ?? []).map(normalized).sort()) ===
    JSON.stringify((right ?? []).map(normalized).sort());
}

export function optimizedListingDetails(card, draft, definitions = [], { backAvailable = false } = {}) {
  const mapped = mappedEbayAspects(card, definitions);
  const aspects = { ...(draft.aspects ?? {}), ...mapped };
  const listingImages = [
    "front",
    ...(backAvailable ? ["back"] : []),
  ];
  const title = optimizedListingTitle(card);
  const aspectChanges = Object.entries(mapped)
    .filter(([name, values]) => !equalValues(draft.aspects?.[name], values))
    .map(([name]) => name);
  return {
    title,
    aspects,
    listingImages,
    changes: {
      title: title !== draft.title ? { from: draft.title, to: title } : null,
      aspects: aspectChanges,
      addBackImage: backAvailable && !draft.listingImages?.includes("back"),
    },
  };
}

export function listingHealth({ card, draft, definitions = [], engagement = {}, backAvailable = false, now = Date.now() }) {
  const optimized = optimizedListingDetails(card, draft, definitions, { backAvailable });
  const requiredAndRecommended = definitions.filter((definition) => definition.required || definition.recommended);
  const completedImportantAspects = requiredAndRecommended.filter((definition) =>
    draft.aspects?.[definition.name]?.some((value) => text(value)),
  ).length;
  const aspectCompleteness = requiredAndRecommended.length
    ? completedImportantAspects / requiredAndRecommended.length
    : null;
  const impressions = Number.isFinite(Number(engagement.impressionCount))
    ? Number(engagement.impressionCount)
    : null;
  const views = Number.isFinite(Number(engagement.viewCount))
    ? Number(engagement.viewCount)
    : null;
  const watchers = Number.isFinite(Number(engagement.watcherCount))
    ? Number(engagement.watcherCount)
    : null;
  const clickThroughRate = impressions && views !== null ? views / impressions : null;
  const ageDays = draft.publishedAt
    ? Math.max(0, (now - Date.parse(draft.publishedAt)) / 86_400_000)
    : 0;
  const referenceValueCents = Number.isFinite(Number(card?.confirmedValuation?.amountCents))
    ? Number(card.confirmedValuation.amountCents)
    : null;
  const priceDifferencePercent = referenceValueCents && Number.isFinite(Number(draft.priceCents))
    ? (Number(draft.priceCents) - referenceValueCents) / referenceValueCents
    : null;
  const issues = [];
  let score = 100;
  if (optimized.changes.title) {
    issues.push("The title is missing or de-prioritizing confirmed search terms.");
    score -= 22;
  }
  if (optimized.changes.aspects.length) {
    issues.push(`${optimized.changes.aspects.length} applicable item specific${optimized.changes.aspects.length === 1 ? "" : "s"} can be corrected or completed.`);
    score -= Math.min(22, optimized.changes.aspects.length * 4);
  }
  if (optimized.changes.addBackImage) {
    issues.push("A saved back photo is available but is not included in the listing.");
    score -= 8;
  }
  if (priceDifferencePercent !== null && priceDifferencePercent > 0.1) {
    issues.push(`The listing price is ${Math.round(priceDifferencePercent * 100)}% above CardPilot's saved value.`);
    score -= 10;
  }
  let diagnosis = ageDays < 1 ? "Collecting initial traffic" : "Traffic is developing";
  if (ageDays >= 1 && impressions === 0) {
    diagnosis = "Not being shown";
    issues.push("eBay has reported no search impressions for this listing.");
    score -= 28;
  } else if (impressions !== null && impressions >= 20 && clickThroughRate !== null && clickThroughRate < 0.01) {
    diagnosis = "Shown but rarely opened";
    issues.push("The listing is appearing, but fewer than 1% of impressions become views.");
    score -= 20;
  } else if (views !== null && views >= 5 && (watchers ?? 0) === 0) {
    diagnosis = "Viewed but not gaining interest";
    issues.push("Buyers are opening the listing but have not watched it.");
    score -= 12;
  }
  const hasChanges = Boolean(
    optimized.changes.title ||
    optimized.changes.aspects.length ||
    optimized.changes.addBackImage,
  );
  const needsAttention = hasChanges || new Set([
    "Not being shown",
    "Shown but rarely opened",
    "Viewed but not gaining interest",
  ]).has(diagnosis);
  return {
    score: Math.max(0, Math.round(score)),
    diagnosis,
    issues,
    ageDays: Math.round(ageDays * 10) / 10,
    clickThroughRate,
    aspectCompleteness,
    referenceValueCents,
    priceDifferencePercent,
    hasChanges,
    needsAttention,
    optimized,
  };
}
