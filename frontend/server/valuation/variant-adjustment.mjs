const ordinaryFeature = "ordinary";

export const serialPremiumTiers = Object.freeze([
  { printRun: null, label: "Base", low: 1, high: 1, priorIncreasePercent: null },
  { printRun: 2000, label: "/2000", low: 1.2, high: 1.5, priorIncreasePercent: null },
  { printRun: 1000, label: "/1000", low: 1.4, high: 2, priorIncreasePercent: [20, 40] },
  { printRun: 500, label: "/500", low: 2, high: 3, priorIncreasePercent: [30, 60] },
  { printRun: 250, label: "/250", low: 3, high: 5, priorIncreasePercent: [40, 70] },
  { printRun: 100, label: "/100", low: 5, high: 9, priorIncreasePercent: [60, 100] },
  { printRun: 75, label: "/75", low: 6, high: 11, priorIncreasePercent: [15, 35] },
  { printRun: 50, label: "/50", low: 8, high: 15, priorIncreasePercent: [25, 60] },
  { printRun: 25, label: "/25", low: 12, high: 25, priorIncreasePercent: [50, 100] },
  { printRun: 10, label: "/10", low: 25, high: 60, priorIncreasePercent: [100, 200] },
  { printRun: 5, label: "/5", low: 45, high: 100, priorIncreasePercent: [60, 150] },
  { printRun: 1, label: "1/1", low: 100, high: 500, priorIncreasePercent: [150, 500] },
]);

export const featurePremiums = Object.freeze({
  ordinary: {
    label: "Ordinary non-auto / non-relic",
    low: 1,
    high: 1,
    confidence: "high",
  },
  player_worn_relic: {
    label: "Player-worn relic / jersey swatch",
    low: 1.3,
    high: 2,
    confidence: "medium",
  },
  game_used_relic: {
    label: "Game-used single-color relic",
    low: 1.5,
    high: 3,
    confidence: "medium",
  },
  multi_color_patch: {
    label: "Multi-color patch",
    low: 2,
    high: 5,
    confidence: "medium",
  },
  premium_game_used_patch: {
    label: "Premium game-used patch",
    low: 3,
    high: 8,
    confidence: "medium",
  },
  sticker_autograph: {
    label: "Sticker autograph",
    low: 2,
    high: 5,
    confidence: "medium",
  },
  on_card_autograph: {
    label: "On-card autograph",
    low: 3,
    high: 8,
    confidence: "medium",
  },
  rookie_autograph: {
    label: "Rookie autograph",
    low: 4,
    high: 10,
    confidence: "medium",
  },
  patch_autograph: {
    label: "Patch + autograph",
    low: 4,
    high: 12,
    confidence: "medium",
  },
  rookie_patch_autograph: {
    label: "Rookie Patch Auto (RPA)",
    low: 5,
    high: 20,
    confidence: "low",
  },
  logo_shield_tag_autograph: {
    label: "Logo / shield / tag + autograph",
    low: 10,
    high: 50,
    confidence: "low",
  },
  relic_unspecified: {
    label: "Relic / patch type not confirmed",
    low: 1.3,
    high: 8,
    confidence: "low",
  },
  autograph_unspecified: {
    label: "Autograph type not confirmed",
    low: 2,
    high: 8,
    confidence: "low",
  },
  autograph_relic_unspecified: {
    label: "Autograph + memorabilia type not confirmed",
    low: 4,
    high: 12,
    confidence: "low",
  },
});

export const valuationFeatureTypes = Object.freeze(Object.keys(featurePremiums));

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
  "rookie",
  "rc",
  "auto",
  "autograph",
  "autographs",
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
  "sapphire",
  "sepia",
  "shimmer",
  "silver",
  "speckle",
  "superfractor",
  "teal",
  "wave",
  "xfractor",
]);

const productVariantWords = new Set([
  "bowman",
  "chrome",
  "cosmic",
  "donruss",
  "finest",
  "heritage",
  "logofractor",
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

const genericSetWords = new Set([
  "autograph",
  "autographs",
  "card",
  "cards",
  "certified",
  "issue",
  "official",
  "the",
  "topps",
  "trading",
]);

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
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

function meaningfulSetOrInsert(value) {
  const words = normalizedWords(value);
  if (words.length === 0) return "";
  return words.some((word) => !genericSetWords.has(word)) ? cleanText(value) : "";
}

function titleYears(title) {
  return [...cleanText(title).matchAll(/\b(?:19|20)\d{2}\b/g)].map(
    (match) => match[0],
  );
}

function titleCardNumbers(title) {
  return [...cleanText(title).matchAll(/(?:#|\bno\.?)\s*([a-z0-9][a-z0-9-]*)/gi)]
    .map((match) => compact(match[1]).replace(/^0+/, ""))
    .filter(Boolean);
}

function obviousNonCardMatch(title) {
  return (
    /\b(lot|break|reprint|replica|facsimile|proxy|digital|custom)\b/i.test(
      title,
    ) ||
    /\b(complete|team)\s+set\b/i.test(title) ||
    /\b(sealed|unopened|hobby|blaster)\s+(box|pack|case)\b/i.test(title)
  );
}

function evaluateLineage(observation, fields) {
  const title = observation.title;
  if (!cleanText(title) || obviousNonCardMatch(title)) return null;
  if (!cleanText(fields.player) || !titleHasWords(title, fields.player)) {
    return null;
  }

  const expectedYear = cleanText(fields.year);
  const years = titleYears(title);
  if (expectedYear && years.length > 0 && !years.includes(expectedYear)) {
    return null;
  }

  const expectedCardNumber = compact(fields.cardNumber).replace(/^0+/, "");
  const cardNumbers = titleCardNumbers(title);
  if (
    expectedCardNumber &&
    cardNumbers.length > 0 &&
    !cardNumbers.includes(expectedCardNumber)
  ) {
    return null;
  }

  const expectedSetOrInsert = meaningfulSetOrInsert(fields.setOrInsert);
  const setMatched = Boolean(
    expectedSetOrInsert && titleHasWords(title, expectedSetOrInsert),
  );
  const cardNumberMatched = Boolean(
    expectedCardNumber &&
      (cardNumbers.includes(expectedCardNumber) ||
        normalizedWords(title).some(
          (word) => word.replace(/^0+/, "") === expectedCardNumber,
        )),
  );
  const designConfirmed = observation.designConfirmed === true;
  if (!setMatched && !cardNumberMatched && !designConfirmed) return null;

  const expectedProductWords = new Set(
    normalizedWords(
      [fields.manufacturer, fields.product, fields.setOrInsert]
        .map(cleanText)
        .filter(Boolean)
        .join(" "),
    ),
  );
  if (
    normalizedWords(title).some(
      (word) =>
        productVariantWords.has(word) && !expectedProductWords.has(word),
    )
  ) {
    return null;
  }

  const checks = [
    { id: "player", weight: 5, matched: true },
    {
      id: "year",
      weight: 3,
      available: Boolean(expectedYear),
      matched: titleHasWords(title, expectedYear),
    },
    {
      id: "manufacturer",
      weight: 1,
      available: Boolean(cleanText(fields.manufacturer)),
      matched: titleHasWords(title, fields.manufacturer),
    },
    {
      id: "product",
      weight: 3,
      available: Boolean(cleanText(fields.product)),
      matched: titleHasWords(title, fields.product),
    },
    {
      id: "set",
      weight: 2,
      available: Boolean(expectedSetOrInsert),
      matched: setMatched,
    },
    {
      id: "card_number",
      weight: 4,
      available: Boolean(expectedCardNumber),
      matched: cardNumberMatched,
    },
  ].filter((check) => check.id === "player" || check.available);

  const identitySignals = checks
    .filter((check) => check.matched)
    .map((check) => check.id);
  const possible = checks.reduce((sum, check) => sum + check.weight, 0);
  const matched = checks
    .filter((check) => check.matched)
    .reduce((sum, check) => sum + check.weight, 0);
  const score = possible > 0 ? matched / possible : 0;
  if (score < 0.55) return null;
  return {
    score: Math.round(score * 100) / 100,
    matchedSignals: [
      ...identitySignals,
      ...(designConfirmed ? ["confirmed_visual_design"] : []),
    ],
    player: cleanText(fields.player),
    familyMatchType: designConfirmed
      ? "confirmed_visual_design"
      : cardNumberMatched
        ? "card_number"
        : "set_or_insert",
    familyLabel: designConfirmed
      ? "Collector-confirmed visual design"
      : cardNumberMatched
        ? `Card #${cleanText(fields.cardNumber)}`
        : expectedSetOrInsert,
  };
}

export function deriveValuationProfile(fields) {
  if (fields.autograph === true && fields.memorabilia === true) {
    return {
      featureType: "autograph_relic_unspecified",
      source: "derived",
    };
  }
  if (fields.autograph === true && fields.rookieStatus === true) {
    return { featureType: "rookie_autograph", source: "derived" };
  }
  if (fields.autograph === true) {
    return { featureType: "autograph_unspecified", source: "derived" };
  }
  if (fields.memorabilia === true) {
    return { featureType: "relic_unspecified", source: "derived" };
  }
  if (fields.autograph === false && fields.memorabilia === false) {
    return { featureType: ordinaryFeature, source: "derived" };
  }
  return { featureType: ordinaryFeature, source: "derived" };
}

function printRunFromSerial(value) {
  const match = cleanText(value).match(/(?:^|\s)(?:\d+\s*)?\/\s*(\d+)(?:\s|$)/);
  return match ? Number(match[1]) : null;
}

function printRunFromObservation(observation) {
  const structured = Number(observation.printRun);
  if (Number.isInteger(structured) && structured > 0) return structured;
  if (/\b1\s*\/\s*1\b/i.test(observation.title)) return 1;
  const matches = [
    ...cleanText(observation.title).matchAll(
      /(?:^|[^\d])(?:\d{1,4}\s*)?\/\s*(\d{1,5})\b/g,
    ),
    ...cleanText(observation.title).matchAll(
      /\b(?:out\s+of|numbered\s+(?:to|out\s+of))\s+(\d{1,5})\b/gi,
    ),
  ];
  const values = matches
    .map((match) => Number(match[1]))
    .filter((value) => Number.isInteger(value) && value > 0);
  return values.length > 0 ? Math.min(...values) : null;
}

export function serialPremiumForPrintRun(printRun) {
  if (printRun === null) return { ...serialPremiumTiers[0], interpolated: false };
  const exact = serialPremiumTiers.find((tier) => tier.printRun === printRun);
  if (exact) return { ...exact, interpolated: false };

  const numbered = serialPremiumTiers.slice(1);
  if (printRun > numbered[0].printRun) {
    return {
      ...numbered[0],
      printRun,
      label: `/${printRun}`,
      interpolated: true,
    };
  }
  for (let index = 0; index < numbered.length - 1; index += 1) {
    const upper = numbered[index];
    const lower = numbered[index + 1];
    if (printRun < upper.printRun && printRun > lower.printRun) {
      const position =
        (Math.log(upper.printRun) - Math.log(printRun)) /
        (Math.log(upper.printRun) - Math.log(lower.printRun));
      return {
        printRun,
        label: `/${printRun}`,
        low: Math.exp(
          Math.log(upper.low) + (Math.log(lower.low) - Math.log(upper.low)) * position,
        ),
        high: Math.exp(
          Math.log(upper.high) +
            (Math.log(lower.high) - Math.log(upper.high)) * position,
        ),
        interpolated: true,
      };
    }
  }
  return null;
}

function targetSerialPremium(fields) {
  const printRun = printRunFromSerial(fields.serialNumber);
  if (printRun) return serialPremiumForPrintRun(printRun);
  const parallel = cleanText(fields.parallel).toLowerCase();
  if (!parallel || parallel === "base" || parallel === "ordinary base") {
    return serialPremiumForPrintRun(null);
  }
  return null;
}

function observationSerialPremium(observation) {
  const printRun = printRunFromObservation(observation);
  if (printRun) return serialPremiumForPrintRun(printRun);
  const words = normalizedWords(observation.title);
  if (words.some((word) => parallelWords.has(word))) return null;
  return serialPremiumForPrintRun(null);
}

function detectFeatureType(observation) {
  const text = [observation.title, ...(observation.features ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const autograph = /\b(auto|autograph|autographed|signed)\b/i.test(text);
  const relic = /\b(patch|relic|jersey|swatch|memorabilia)\b/i.test(text);
  const rookie = /\b(rookie|rc)\b/i.test(text);

  if (/\b(rpa|rookie\s+patch\s+(?:auto|autograph))\b/i.test(text)) {
    return "rookie_patch_autograph";
  }
  if (
    autograph &&
    /\b(shield|logoman|logo\s+patch|laundry\s+tag|nameplate|brand\s+logo)\b/i.test(
      text,
    )
  ) {
    return "logo_shield_tag_autograph";
  }
  if (autograph && relic) return "patch_autograph";
  if (autograph && rookie) return "rookie_autograph";
  if (autograph && /\bon[ -]?card\b/i.test(text)) return "on_card_autograph";
  if (autograph && /\bsticker\b/i.test(text)) return "sticker_autograph";
  if (autograph) return "autograph_unspecified";
  if (
    /\b(game[ -]?used|game[ -]?worn)\b/i.test(text) &&
    /\b(premium|logo|patch|multicolor|multi[ -]?color|three[ -]?color|two[ -]?color)\b/i.test(
      text,
    )
  ) {
    return "premium_game_used_patch";
  }
  if (/\b(multi[ -]?color|multicolor|three[ -]?color|two[ -]?color)\s+patch\b/i.test(text)) {
    return "multi_color_patch";
  }
  if (/\b(game[ -]?used|game[ -]?worn)\b/i.test(text) && relic) {
    return "game_used_relic";
  }
  if (/\b(player[ -]?worn|event[ -]?worn)\b/i.test(text) && relic) {
    return "player_worn_relic";
  }
  if (relic) return "relic_unspecified";
  return ordinaryFeature;
}

function geometricMidpoint(range) {
  return Math.sqrt(range.low * range.high);
}

function ratio(target, source) {
  return {
    low: target.low / source.high,
    midpoint: geometricMidpoint(target) / geometricMidpoint(source),
    high: target.high / source.low,
  };
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

function observationStatistics(observations) {
  const sorted = [...observations].sort(
    (left, right) => left.amountCents - right.amountCents,
  );
  let included = sorted;
  if (sorted.length >= 5) {
    const amounts = sorted.map((observation) => observation.amountCents);
    const firstQuartile = quantile(amounts, 0.25);
    const thirdQuartile = quantile(amounts, 0.75);
    const interquartileRange = thirdQuartile - firstQuartile;
    included = sorted.filter(
      (observation) =>
        observation.amountCents >=
          Math.max(0, firstQuartile - interquartileRange * 1.5) &&
        observation.amountCents <=
          thirdQuartile + interquartileRange * 1.5,
    );
  }
  const amounts = included.map((observation) => observation.amountCents);
  return {
    included,
    median: quantile(amounts, 0.5),
    low: quantile(amounts, included.length >= 4 ? 0.25 : 0),
    high: quantile(amounts, included.length >= 4 ? 0.75 : 1),
    outlierCount: sorted.length - included.length,
  };
}

export function buildVariantDiscoveryQuery(fields) {
  const parts = [
    fields.player,
    fields.year,
    fields.manufacturer,
    fields.product,
  ]
    .map(cleanText)
    .filter(Boolean);
  const uniqueParts = parts
    .filter(
      (part, index) =>
        parts.findIndex(
          (candidate) => candidate.toLowerCase() === part.toLowerCase(),
        ) === index,
    );
  return uniqueParts
    .filter(
      (part) =>
        !uniqueParts.some(
          (candidate) =>
            candidate.length > part.length &&
            normalizedWords(candidate).join(" ").includes(
              normalizedWords(part).join(" "),
            ),
        ),
    )
    .join(" ")
    .slice(0, 500);
}

export function buildVariantAdjustedEstimates({
  fields,
  valuationProfile = deriveValuationProfile(fields),
  observations,
  observationType,
  excludedObservationIds = [],
}) {
  const targetSerial = targetSerialPremium(fields);
  const targetFeature = featurePremiums[valuationProfile.featureType];
  if (!targetSerial || !targetFeature) return [];

  const excluded = new Set(excludedObservationIds);
  const candidates = observations.flatMap((observation) => {
    if (
      excluded.has(observation.id) ||
      !Number.isInteger(observation.amountCents) ||
      observation.amountCents <= 0 ||
      !cleanText(observation.currency)
    ) {
      return [];
    }
    const lineage = evaluateLineage(observation, fields);
    if (!lineage) return [];
    const sourceSerial = observationSerialPremium(observation);
    const sourceFeatureType = detectFeatureType(observation);
    const sourceFeature = featurePremiums[sourceFeatureType];
    if (!sourceSerial || !sourceFeature) return [];

    const serialChanged = sourceSerial.printRun !== targetSerial.printRun;
    const featureChanged = sourceFeatureType !== valuationProfile.featureType;
    if (!serialChanged && !featureChanged) return [];

    const serialRatio = serialChanged
      ? ratio(targetSerial, sourceSerial)
      : { low: 1, midpoint: 1, high: 1 };
    const featureRatio = featureChanged
      ? ratio(targetFeature, sourceFeature)
      : { low: 1, midpoint: 1, high: 1 };
    const combinedRatio = {
      low: serialRatio.low * featureRatio.low,
      midpoint: serialRatio.midpoint * featureRatio.midpoint,
      high: serialRatio.high * featureRatio.high,
    };
    const adjustmentDimensions = [
      ...(serialChanged ? ["serial"] : []),
      ...(featureChanged ? ["feature"] : []),
    ];
    return [
      {
        ...observation,
        lineage,
        sourceSerial,
        sourceFeatureType,
        sourceFeature,
        serialRatio,
        featureRatio,
        adjustmentDimensions,
        combinedRatio,
      },
    ];
  });

  const buckets = new Map();
  for (const candidate of candidates) {
    const key = [
      candidate.platform,
      candidate.currency,
      candidate.sourceSerial.printRun ?? "base",
      candidate.sourceFeatureType,
    ].join(":");
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(candidate);
  }

  return [...buckets.values()]
    .map((bucket) => {
      const statistics = observationStatistics(bucket);
      const first = bucket[0];
      const serialChanged = first.adjustmentDimensions.includes("serial");
      const featureChanged = first.adjustmentDimensions.includes("feature");
      const appliedAdjustments = [
        ...(serialChanged
          ? [
              {
                dimension: "serial",
                sourceLabel: first.sourceSerial.label,
                targetLabel: targetSerial.label,
                lowFactor: first.serialRatio.low,
                midpointFactor: first.serialRatio.midpoint,
                highFactor: first.serialRatio.high,
              },
            ]
          : []),
        ...(featureChanged
          ? [
              {
                dimension: "feature",
                sourceLabel: first.sourceFeature.label,
                targetLabel: targetFeature.label,
                lowFactor: first.featureRatio.low,
                midpointFactor: first.featureRatio.midpoint,
                highFactor: first.featureRatio.high,
              },
            ]
          : []),
      ];
      const estimateRange = {
        lowAmountCents: Math.max(
          1,
          Math.round(statistics.low * first.combinedRatio.low),
        ),
        highAmountCents: Math.max(
          1,
          Math.round(statistics.high * first.combinedRatio.high),
        ),
      };
      const direction =
        first.combinedRatio.midpoint > 1.05
          ? "up"
          : first.combinedRatio.midpoint < 0.95
            ? "down"
            : "similar";
      const lowConfidenceProfile =
        valuationProfile.source !== "user_confirmed" ||
        targetFeature.confidence === "low" ||
        first.sourceFeature.confidence === "low" ||
        targetSerial.interpolated ||
        first.sourceSerial.interpolated ||
        targetSerial.printRun === 1 ||
        first.sourceSerial.printRun === 1;
      const confidence =
        first.adjustmentDimensions.length > 1 || lowConfidenceProfile
          ? "low"
          : statistics.included.length >= 3
            ? "medium"
            : "low";
      const distance = Math.abs(Math.log(first.combinedRatio.midpoint));
      return {
        id: `${observationType}_${first.platform.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_${first.currency.toLowerCase()}_${first.sourceSerial.printRun ?? "base"}_${first.sourceFeatureType}`,
        kind: "variant_adjusted_estimate",
        observationType,
        platform: first.platform,
        currency: first.currency,
        sourceProfile: {
          serialLabel: first.sourceSerial.label,
          printRun: first.sourceSerial.printRun,
          featureType: first.sourceFeatureType,
          featureLabel: first.sourceFeature.label,
        },
        targetProfile: {
          serialLabel: targetSerial.label,
          printRun: targetSerial.printRun,
          featureType: valuationProfile.featureType,
          featureLabel: targetFeature.label,
          featureSource: valuationProfile.source,
        },
        lineageEvidence: {
          player: first.lineage.player,
          familyMatchType: first.lineage.familyMatchType,
          familyLabel: first.lineage.familyLabel,
        },
        sourceCount: statistics.included.length,
        sourceMedianAmountCents: statistics.median,
        estimatedAmountCents: Math.max(
          1,
          Math.round(statistics.median * first.combinedRatio.midpoint),
        ),
        estimatedRange: estimateRange,
        combinedFactor: first.combinedRatio,
        direction,
        confidence,
        appliedAdjustments,
        outlierCount: statistics.outlierCount,
        methodologyVersion: "1.1",
        sourceObservations: statistics.included
          .sort((left, right) => right.lineage.score - left.lineage.score)
          .slice(0, 5)
          .map((observation) => ({
            id: observation.id,
            title: observation.title,
            amountCents: observation.amountCents,
            currency: observation.currency,
            platform: observation.platform,
            imageUrl: observation.imageUrl ?? null,
            url: observation.url ?? null,
            date: observation.date ?? null,
          })),
        _rank: {
          dimensions: first.adjustmentDimensions.length,
          distance,
          sourceCount: statistics.included.length,
          lineageScore:
            bucket.reduce((sum, item) => sum + item.lineage.score, 0) /
            bucket.length,
        },
      };
    })
    .sort((left, right) => {
      if (left._rank.dimensions !== right._rank.dimensions) {
        return left._rank.dimensions - right._rank.dimensions;
      }
      if (left._rank.distance !== right._rank.distance) {
        return left._rank.distance - right._rank.distance;
      }
      if (left._rank.sourceCount !== right._rank.sourceCount) {
        return right._rank.sourceCount - left._rank.sourceCount;
      }
      return right._rank.lineageScore - left._rank.lineageScore;
    })
    .slice(0, 3)
    .map(({ _rank, ...estimate }) => estimate);
}
