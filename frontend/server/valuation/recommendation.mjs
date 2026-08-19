const confidenceRank = Object.freeze({ low: 1, medium: 2, high: 3 });
const activeMarketWeight = 0.6;
const completedSalesWeight = 0.4;

export function roundRecommendedValueCents(amountCents) {
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    throw new TypeError("Recommended value must be a non-negative cent amount.");
  }
  if (amountCents === 0) return 0;

  const wholeDollars = Math.floor(amountCents / 100);
  const cents = amountCents % 100;
  if (cents <= 25) return wholeDollars * 100 + 25;
  if (cents <= 50) return wholeDollars * 100 + 50;
  if (cents <= 95) return wholeDollars * 100 + 95;
  return (wholeDollars + 1) * 100 + 25;
}

export const valuationMethods = Object.freeze([
  "blended_exact_market",
  "blended_broader_market",
  "blended_variant_market",
  "exact_sold",
  "broader_sold",
  "variant_sold",
  "exact_active",
  "broader_active",
  "variant_active",
  "manual",
]);

export const valuationMethodLabels = Object.freeze({
  blended_exact_market: "Blended exact market evidence",
  blended_broader_market: "Blended broader market evidence",
  blended_variant_market: "Blended variant-adjusted market evidence",
  exact_sold: "Exact completed sales",
  broader_sold: "Broader completed sales",
  variant_sold: "Variant-adjusted completed sales",
  exact_active: "Exact active asking prices",
  broader_active: "Broader active asking prices",
  variant_active: "Variant-adjusted active asking prices",
  manual: "Collector-entered value",
});

function activeGroupMatchesGrading(group, grading) {
  if (!grading?.isGraded) return group.classification === "raw";
  const expected = `${grading.company ?? ""} ${grading.grade ?? ""}`
    .trim()
    .toLowerCase();
  return (
    group.classification === "graded" &&
    group.label.trim().toLowerCase() === expected
  );
}

function preferredGroup(groups, matchTier, countKey, grading = null) {
  return (
    groups
      .filter(
        (group) =>
          group.matchTier === matchTier &&
          (!grading || activeGroupMatchesGrading(group, grading)),
      )
      .sort((left, right) => {
        const currencyDifference =
          Number(right.currency === "USD") - Number(left.currency === "USD");
        if (currencyDifference !== 0) return currencyDifference;
        const confidenceDifference =
          confidenceRank[right.confidence] - confidenceRank[left.confidence];
        if (confidenceDifference !== 0) return confidenceDifference;
        return right[countKey] - left[countKey];
      })[0] ?? null
  );
}

function preferredVariant(estimates) {
  return (
    [...estimates].sort((left, right) => {
      const currencyDifference =
        Number(right.currency === "USD") - Number(left.currency === "USD");
      if (currencyDifference !== 0) return currencyDifference;
      const confidenceDifference =
        confidenceRank[right.confidence] - confidenceRank[left.confidence];
      if (confidenceDifference !== 0) return confidenceDifference;
      return right.sourceCount - left.sourceCount;
    })[0] ?? null
  );
}

function lowerActiveConfidence(confidence) {
  return confidence === "high" ? "medium" : "low";
}

function recommendationFromSoldGroup(group, method) {
  return {
    amountCents: group.medianSalePriceCents,
    currency: group.currency,
    typicalRange: group.typicalRange,
    confidence: method === "exact_sold" ? group.confidence : "low",
    method,
    methodLabel: valuationMethodLabels[method],
    sampleCount: group.saleCount,
    warnings: [],
    blend: null,
    rationale:
      method === "exact_sold"
        ? `Based on ${group.saleCount} exact completed sale${group.saleCount === 1 ? "" : "s"}. Active asking prices are supporting context only.`
        : `Exact completed sales were scarce, so CardPilot used ${group.saleCount} broader completed comparison${group.saleCount === 1 ? "" : "s"}.`,
  };
}

function recommendationFromActiveGroup(group, method) {
  return {
    amountCents: group.medianAmountCents,
    currency: group.currency,
    typicalRange: group.typicalRange,
    confidence:
      method === "exact_active" ? lowerActiveConfidence(group.confidence) : "low",
    method,
    methodLabel: valuationMethodLabels[method],
    sampleCount: group.listingCount,
    warnings: [],
    blend: null,
    rationale:
      method === "exact_active"
        ? `No compatible exact completed-sale estimate was available, so this uses ${group.listingCount} exact active asking price${group.listingCount === 1 ? "" : "s"}. Asking prices are not confirmed sales.`
        : `Compatible completed sales and exact active matches were scarce, so this uses ${group.listingCount} broader active asking comparison${group.listingCount === 1 ? "" : "s"}.`,
  };
}

function recommendationFromVariant(estimate, method, warnings = []) {
  return {
    amountCents: estimate.estimatedAmountCents,
    currency: estimate.currency,
    typicalRange: estimate.estimatedRange,
    confidence: method === "variant_sold" ? estimate.confidence : "low",
    method,
    methodLabel: valuationMethodLabels[method],
    sampleCount: estimate.sourceCount,
    warnings,
    blend: null,
    rationale:
      method === "variant_sold"
        ? `Exact pricing was scarce, so CardPilot adjusted ${estimate.sourceCount} completed sale${estimate.sourceCount === 1 ? "" : "s"} from another version of the same card family.`
        : `No qualifying completed-sale estimate was available, so CardPilot adjusted ${estimate.sourceCount} active asking price${estimate.sourceCount === 1 ? "" : "s"} from another version of the same card family.`,
  };
}

function weightedCents(activeAmountCents, soldAmountCents) {
  return Math.round(
    activeAmountCents * activeMarketWeight +
      soldAmountCents * completedSalesWeight,
  );
}

function blendedConfidence(method, soldEvidence, activeEvidence) {
  if (method !== "blended_exact_market") return "low";
  return soldEvidence.confidence !== "low" &&
    activeEvidence.confidence !== "low" &&
    soldEvidence.count >= 3 &&
    activeEvidence.count >= 3
    ? "medium"
    : "low";
}

function recommendationFromBlend({
  method,
  soldEvidence,
  activeEvidence,
  warnings = [],
}) {
  return {
    amountCents: weightedCents(
      activeEvidence.amountCents,
      soldEvidence.amountCents,
    ),
    currency: activeEvidence.currency,
    typicalRange: {
      lowAmountCents: weightedCents(
        activeEvidence.typicalRange.lowAmountCents,
        soldEvidence.typicalRange.lowAmountCents,
      ),
      highAmountCents: weightedCents(
        activeEvidence.typicalRange.highAmountCents,
        soldEvidence.typicalRange.highAmountCents,
      ),
    },
    confidence: blendedConfidence(method, soldEvidence, activeEvidence),
    method,
    methodLabel: valuationMethodLabels[method],
    sampleCount: soldEvidence.count + activeEvidence.count,
    warnings,
    blend: {
      activeWeight: activeMarketWeight,
      completedSalesWeight,
      activeAmountCents: activeEvidence.amountCents,
      completedSalesAmountCents: soldEvidence.amountCents,
      activeCount: activeEvidence.count,
      completedSalesCount: soldEvidence.count,
    },
    rationale: `CardPilot combined current active asking evidence at ${activeMarketWeight * 100}% with completed-sale evidence at ${completedSalesWeight * 100}%. Active listings receive more weight because they reflect the current market, while completed sales keep the recommendation grounded in observed transactions.`,
  };
}

function soldGroupEvidence(group) {
  return group
    ? {
        amountCents: group.medianSalePriceCents,
        currency: group.currency,
        typicalRange: group.typicalRange,
        count: group.saleCount,
        confidence: group.confidence,
      }
    : null;
}

function activeGroupEvidence(group) {
  return group
    ? {
        amountCents: group.medianAmountCents,
        currency: group.currency,
        typicalRange: group.typicalRange,
        count: group.listingCount,
        confidence: group.confidence,
      }
    : null;
}

function variantEvidence(estimate) {
  return estimate
    ? {
        amountCents: estimate.estimatedAmountCents,
        currency: estimate.currency,
        typicalRange: estimate.estimatedRange,
        count: estimate.sourceCount,
        confidence: estimate.confidence,
      }
    : null;
}

function canBlend(soldEvidence, activeEvidence) {
  return Boolean(
    soldEvidence &&
      activeEvidence &&
      soldEvidence.currency === activeEvidence.currency,
  );
}

function variantDisagreementWarnings(soldEstimate, activeEstimate) {
  if (
    !soldEstimate ||
    !activeEstimate ||
    soldEstimate.sourceCount !== 1 ||
    soldEstimate.currency !== activeEstimate.currency ||
    soldEstimate.estimatedAmountCents <= 0 ||
    activeEstimate.estimatedAmountCents <= 0
  ) {
    return [];
  }
  const differenceRatio =
    Math.max(
      soldEstimate.estimatedAmountCents,
      activeEstimate.estimatedAmountCents,
    ) /
    Math.min(
      soldEstimate.estimatedAmountCents,
      activeEstimate.estimatedAmountCents,
    );
  if (differenceRatio < 1.5) return [];
  return [
    {
      code: "single_sale_active_disagreement",
      activeAmountCents: activeEstimate.estimatedAmountCents,
      activeCurrency: activeEstimate.currency,
      activeListingCount: activeEstimate.sourceCount,
      direction:
        activeEstimate.estimatedAmountCents > soldEstimate.estimatedAmountCents
          ? "higher"
          : "lower",
    },
  ];
}

function comparableActiveVariant(soldEstimate, activeSnapshot) {
  if (!soldEstimate || !activeSnapshot) return null;
  return (
    activeSnapshot.variantEstimates.find(
      (estimate) =>
        estimate.currency === soldEstimate.currency &&
        estimate.sourceProfile.printRun ===
          soldEstimate.sourceProfile.printRun &&
        estimate.sourceProfile.featureType ===
          soldEstimate.sourceProfile.featureType &&
        estimate.targetProfile.printRun ===
          soldEstimate.targetProfile.printRun &&
        estimate.targetProfile.featureType ===
          soldEstimate.targetProfile.featureType,
    ) ?? null
  );
}

function activeReference(snapshot, grading) {
  if (!snapshot) return null;
  const exact = preferredGroup(snapshot.groups, "exact", "listingCount", grading);
  const broader = preferredGroup(
    snapshot.groups,
    "broader",
    "listingCount",
    grading,
  );
  const variant = preferredVariant(snapshot.variantEstimates);
  const selected = exact ?? broader;
  if (selected) {
    return {
      amountCents: selected.medianAmountCents,
      currency: selected.currency,
      label:
        selected.matchTier === "exact"
          ? "Exact active asking median"
          : "Broader active asking median",
      listingCount: selected.listingCount,
    };
  }
  return variant
    ? {
        amountCents: variant.estimatedAmountCents,
        currency: variant.currency,
        label: "Variant-adjusted active asking estimate",
        listingCount: variant.sourceCount,
      }
    : null;
}

function applyRecommendedPricePoint(recommendation) {
  if (!recommendation) return null;

  const originalAmountCents = recommendation.amountCents;
  const roundedAmountCents = roundRecommendedValueCents(originalAmountCents);
  return {
    ...recommendation,
    amountCents: roundedAmountCents,
    pricePointAdjustment: {
      originalAmountCents,
      roundedAmountCents,
      applied: roundedAmountCents !== originalAmountCents,
      rule: "next_25_50_95",
    },
  };
}

function floorPricePointCents(amountCents) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) return 1;
  if (amountCents <= 95) return amountCents;
  const candidate = Math.floor(amountCents / 100) * 100 + 95;
  return candidate <= amountCents ? candidate : Math.max(95, candidate - 100);
}

function activeMarketFloor(activeSnapshot, grading) {
  if (!activeSnapshot) return null;
  const group = preferredGroup(activeSnapshot.groups, "exact", "listingCount", grading) ??
    preferredGroup(activeSnapshot.groups, "broader", "listingCount", grading);
  const prices = group?.listings
    ?.map((listing) => listing.itemPriceCents ?? listing.totalPriceCents)
    .filter(Number.isInteger) ?? [];
  return prices.length ? Math.min(...prices) : group?.typicalRange?.lowAmountCents ?? null;
}

export function buildSaleStrategyOptions(recommendation, activeSnapshot = null, grading = null) {
  if (!recommendation) return null;
  const floor = activeMarketFloor(activeSnapshot, grading) ?? recommendation.typicalRange.lowAmountCents;
  const fasterAmount = floorPricePointCents(Math.min(recommendation.amountCents, floor));
  const maximizeAmount = roundRecommendedValueCents(
    Math.max(recommendation.amountCents, recommendation.typicalRange.highAmountCents),
  );
  return {
    sell_faster: {
      amountCents: fasterAmount,
      label: "Sell faster",
      rationale: "Meets or slightly undercuts the lowest compatible current-market price point.",
    },
    balanced: {
      amountCents: recommendation.amountCents,
      label: "Balanced",
      rationale: "Uses CardPilot's market midpoint recommendation.",
    },
    maximize_value: {
      amountCents: maximizeAmount,
      label: "Maximize value",
      rationale: "Prices near the upper compatible market range and may take longer to sell.",
    },
  };
}

export function buildValuationRecommendation({
  soldSnapshot = null,
  activeSnapshot = null,
  grading,
  soldStatus = soldSnapshot ? "available" : "not_configured",
  activeStatus = activeSnapshot ? "available" : "not_configured",
  generatedAt = new Date().toISOString(),
}) {
  const exactSold = soldSnapshot
    ? preferredGroup(soldSnapshot.groups, "exact", "saleCount")
    : null;
  const broaderSold = soldSnapshot
    ? preferredGroup(soldSnapshot.groups, "broader", "saleCount")
    : null;
  const variantSold = soldSnapshot
    ? preferredVariant(soldSnapshot.variantEstimates)
    : null;
  const exactActive = activeSnapshot
    ? preferredGroup(activeSnapshot.groups, "exact", "listingCount", grading)
    : null;
  const broaderActive = activeSnapshot
    ? preferredGroup(activeSnapshot.groups, "broader", "listingCount", grading)
    : null;
  const variantActive = activeSnapshot
    ? preferredVariant(activeSnapshot.variantEstimates)
    : null;
  const matchingVariantActive = comparableActiveVariant(
    variantSold,
    activeSnapshot,
  );
  const exactSoldEvidence = soldGroupEvidence(exactSold);
  const exactActiveEvidence = activeGroupEvidence(exactActive);
  const broaderSoldEvidence = soldGroupEvidence(broaderSold);
  const broaderActiveEvidence = activeGroupEvidence(broaderActive);
  const variantSoldEvidence = variantEvidence(variantSold);
  const variantActiveEvidence = variantEvidence(matchingVariantActive);

  let recommendation = null;
  if (canBlend(exactSoldEvidence, exactActiveEvidence)) {
    recommendation = recommendationFromBlend({
      method: "blended_exact_market",
      soldEvidence: exactSoldEvidence,
      activeEvidence: exactActiveEvidence,
    });
  } else if (exactActive) {
    recommendation = recommendationFromActiveGroup(exactActive, "exact_active");
  } else if (exactSold) {
    recommendation = recommendationFromSoldGroup(exactSold, "exact_sold");
  } else if (canBlend(broaderSoldEvidence, broaderActiveEvidence)) {
    recommendation = recommendationFromBlend({
      method: "blended_broader_market",
      soldEvidence: broaderSoldEvidence,
      activeEvidence: broaderActiveEvidence,
    });
  } else if (broaderActive) {
    recommendation = recommendationFromActiveGroup(
      broaderActive,
      "broader_active",
    );
  } else if (broaderSold) {
    recommendation = recommendationFromSoldGroup(broaderSold, "broader_sold");
  } else if (canBlend(variantSoldEvidence, variantActiveEvidence)) {
    recommendation = recommendationFromBlend({
      method: "blended_variant_market",
      soldEvidence: variantSoldEvidence,
      activeEvidence: variantActiveEvidence,
      warnings: variantDisagreementWarnings(
        variantSold,
        matchingVariantActive,
      ),
    });
  } else if (variantActive) {
    recommendation = recommendationFromVariant(variantActive, "variant_active");
  } else if (variantSold) {
    recommendation = recommendationFromVariant(
      variantSold,
      "variant_sold",
      variantDisagreementWarnings(
        variantSold,
        comparableActiveVariant(variantSold, activeSnapshot),
      ),
    );
  }

  recommendation = applyRecommendedPricePoint(recommendation);
  const saleStrategyOptions = buildSaleStrategyOptions(
    recommendation,
    activeSnapshot,
    grading,
  );

  return {
    schemaVersion: "1.0",
    kind: "card_valuation_recommendation",
    generatedAt,
    recommendation,
    saleStrategyOptions,
    evidence: {
      sold: {
        status: soldStatus,
        exactCount: soldSnapshot?.exactMatchedCount ?? 0,
        broaderCount: soldSnapshot?.broaderMatchedCount ?? 0,
        variantEstimateCount: soldSnapshot?.variantEstimates.length ?? 0,
      },
      active: {
        status: activeStatus,
        exactCount: activeSnapshot?.exactMatchedCount ?? 0,
        broaderCount: activeSnapshot?.broaderMatchedCount ?? 0,
        variantEstimateCount: activeSnapshot?.variantEstimates.length ?? 0,
      },
    },
    activeAskingReference: activeReference(activeSnapshot, grading),
    disclaimer:
      "CardPilot estimates are decision support, not appraisals or guaranteed sale prices. Condition, eye appeal, collector demand, fees, and market timing can materially change value.",
  };
}

function resultStatus(result, configured) {
  if (!configured) return "not_configured";
  if (result.status === "fulfilled") return "available";
  return result.reason?.status === 429 ? "rate_limited" : "unavailable";
}

export class ValuationRecommendationService {
  constructor({ soldComps = null, activeMarket = null, now = () => Date.now() }) {
    this.soldComps = soldComps;
    this.activeMarket = activeMarket;
    this.now = now;
  }

  async snapshot(
    card,
    {
      soldExcludedObservationIds = [],
      activeExcludedObservationIds = [],
    } = {},
  ) {
    const soldPromise = this.soldComps
      ? this.soldComps.snapshot(
          card.fields,
          card.grading,
          card.valuationProfile,
          { excludedObservationIds: soldExcludedObservationIds },
        )
      : Promise.resolve(null);
    const activePromise = this.activeMarket
      ? this.activeMarket.snapshot(card.fields, {
          confirmedReferenceItemId: card.ebayReference?.itemId ?? null,
          grading: card.grading,
          valuationProfile: card.valuationProfile,
          excludedObservationIds: activeExcludedObservationIds,
        })
      : Promise.resolve(null);
    const [soldResult, activeResult] = await Promise.allSettled([
      soldPromise,
      activePromise,
    ]);

    return buildValuationRecommendation({
      soldSnapshot:
        soldResult.status === "fulfilled" ? soldResult.value : null,
      activeSnapshot:
        activeResult.status === "fulfilled" ? activeResult.value : null,
      grading: card.grading,
      soldStatus: resultStatus(soldResult, Boolean(this.soldComps)),
      activeStatus: resultStatus(activeResult, Boolean(this.activeMarket)),
      generatedAt: new Date(this.now()).toISOString(),
    });
  }
}
