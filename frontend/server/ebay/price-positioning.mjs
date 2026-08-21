function cents(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.max(0, Math.round(amount)) : null;
}

export function fulfillmentBuyerShippingCents(policy) {
  const domestic = (policy?.shippingOptions ?? []).find((option) =>
    option?.optionType === "DOMESTIC" || option?.costType,
  );
  const service = domestic?.shippingServices?.[0];
  if (!service) return null;
  if (service.freeShipping === true) return 0;
  const value = Number(service.shippingCost?.value);
  return Number.isFinite(value) ? Math.max(0, Math.round(value * 100)) : null;
}

function matchingExactGroups(snapshot, grading) {
  const expectedGrade = `${grading?.company ?? ""} ${grading?.grade ?? ""}`.trim().toLowerCase();
  return (snapshot?.groups ?? []).filter((group) => {
    if (group.matchTier !== "exact") return false;
    if (!grading?.isGraded) return group.classification === "raw";
    return group.classification === "graded" && group.label.trim().toLowerCase() === expectedGrade;
  });
}

function sameEbayListing(left, right) {
  const expected = String(right ?? "");
  const candidate = String(left ?? "");
  return Boolean(expected) && (candidate === expected || candidate.split("|").includes(expected));
}

export function deliveredPricePosition({
  snapshot,
  grading,
  ownListingId,
  currentItemPriceCents,
  ownShippingCostCents,
  minimumPriceCents = 1,
  undercutCents = 5,
  currency = "USD",
}) {
  const groups = matchingExactGroups(snapshot, grading);
  const candidates = groups
    .flatMap((group) => group.listings.map((listing) => ({ ...listing, groupConfidence: group.confidence })))
    .filter((listing) => !sameEbayListing(listing.itemId, ownListingId))
    .filter((listing) => listing.currency === currency && Number.isInteger(listing.totalPriceCents))
    .sort((left, right) => left.totalPriceCents - right.totalPriceCents);
  if (!candidates.length) return null;

  const lowest = candidates[0];
  const currentPrice = cents(currentItemPriceCents) ?? 0;
  const ownShipping = cents(ownShippingCostCents) ?? 0;
  const floor = Math.max(1, cents(minimumPriceCents) ?? 1);
  const undercut = Math.max(0, cents(undercutCents) ?? 5);
  const targetItemPrice = Math.max(floor, lowest.totalPriceCents - ownShipping - undercut);
  const visuallyConfirmed = lowest.visualMatchStatus === "matched" || lowest.confirmedReference === true;
  const safeToReprice = lowest.groupConfidence !== "low" || visuallyConfirmed;
  return {
    currency,
    currentItemPriceCents: currentPrice,
    ownShippingCostCents: ownShipping,
    currentDeliveredPriceCents: currentPrice + ownShipping,
    lowestCompetitorDeliveredPriceCents: lowest.totalPriceCents,
    differenceCents: currentPrice + ownShipping - lowest.totalPriceCents,
    proposedItemPriceCents: targetItemPrice,
    proposedDeliveredPriceCents: targetItemPrice + ownShipping,
    undercutCents: undercut,
    minimumPriceCents: floor,
    limitedByMinimum: targetItemPrice === floor && floor > lowest.totalPriceCents - ownShipping - undercut,
    shouldLower: targetItemPrice < currentPrice,
    safeToReprice,
    exactMatchCount: candidates.length,
    confidence: groups.some((group) => group.confidence === "high")
      ? "high"
      : groups.some((group) => group.confidence === "medium")
        ? "medium"
        : visuallyConfirmed
          ? "medium"
          : "low",
    lowestCompetitor: {
      itemId: lowest.itemId,
      title: lowest.title,
      itemWebUrl: lowest.itemWebUrl ?? null,
      itemPriceCents: lowest.itemPriceCents,
      shippingCostCents: lowest.shippingCostCents,
      totalPriceCents: lowest.totalPriceCents,
      visualMatchStatus: lowest.visualMatchStatus ?? null,
    },
  };
}
