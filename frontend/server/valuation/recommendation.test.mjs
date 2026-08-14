import test from "node:test";
import assert from "node:assert/strict";
import {
  ValuationRecommendationService,
  buildValuationRecommendation,
  roundRecommendedValueCents,
} from "./recommendation.mjs";

const raw = {
  isGraded: false,
  company: null,
  grade: null,
  certificationNumber: null,
};

function soldSnapshot(groups = [], variantEstimates = []) {
  return {
    exactMatchedCount: groups
      .filter((group) => group.matchTier === "exact")
      .reduce((total, group) => total + group.saleCount, 0),
    broaderMatchedCount: groups
      .filter((group) => group.matchTier === "broader")
      .reduce((total, group) => total + group.saleCount, 0),
    groups,
    variantEstimates,
  };
}

function activeSnapshot(groups = [], variantEstimates = []) {
  return {
    exactMatchedCount: groups
      .filter((group) => group.matchTier === "exact")
      .reduce((total, group) => total + group.listingCount, 0),
    broaderMatchedCount: groups
      .filter((group) => group.matchTier === "broader")
      .reduce((total, group) => total + group.listingCount, 0),
    groups,
    variantEstimates,
  };
}

test("recommended values round up to CardPilot price points", () => {
  assert.equal(roundRecommendedValueCents(630), 650);
  assert.equal(roundRecommendedValueCents(1454), 1495);
  assert.equal(roundRecommendedValueCents(903), 925);
  assert.equal(roundRecommendedValueCents(625), 625);
  assert.equal(roundRecommendedValueCents(650), 650);
  assert.equal(roundRecommendedValueCents(695), 695);
  assert.equal(roundRecommendedValueCents(696), 725);
  assert.equal(roundRecommendedValueCents(0), 0);
});

test("exact sold and active evidence are blended with more weight on active listings", () => {
  const snapshot = buildValuationRecommendation({
    grading: raw,
    soldSnapshot: soldSnapshot([
      {
        matchTier: "exact",
        platform: "eBay",
        currency: "USD",
        saleCount: 4,
        medianSalePriceCents: 4200,
        typicalRange: { lowAmountCents: 3800, highAmountCents: 4600 },
        confidence: "medium",
      },
      {
        matchTier: "broader",
        platform: "eBay",
        currency: "USD",
        saleCount: 8,
        medianSalePriceCents: 5000,
        typicalRange: { lowAmountCents: 4500, highAmountCents: 5500 },
        confidence: "low",
      },
    ]),
    activeSnapshot: activeSnapshot([
      {
        matchTier: "exact",
        classification: "raw",
        label: "Raw / ungraded",
        currency: "USD",
        listingCount: 10,
        medianAmountCents: 6000,
        typicalRange: { lowAmountCents: 5500, highAmountCents: 6500 },
        confidence: "high",
      },
    ]),
  });

  assert.equal(snapshot.recommendation.method, "blended_exact_market");
  assert.equal(snapshot.recommendation.amountCents, 5295);
  assert.deepEqual(snapshot.recommendation.pricePointAdjustment, {
    originalAmountCents: 5280,
    roundedAmountCents: 5295,
    applied: true,
    rule: "next_25_50_95",
  });
  assert.equal(snapshot.recommendation.confidence, "medium");
  assert.deepEqual(snapshot.recommendation.blend, {
    activeWeight: 0.6,
    completedSalesWeight: 0.4,
    activeAmountCents: 6000,
    completedSalesAmountCents: 4200,
    activeCount: 10,
    completedSalesCount: 4,
  });
  assert.equal(snapshot.activeAskingReference.amountCents, 6000);
});

test("active asking evidence is a low-confidence fallback when sales are absent", () => {
  const snapshot = buildValuationRecommendation({
    grading: raw,
    soldSnapshot: soldSnapshot(),
    activeSnapshot: activeSnapshot([
      {
        matchTier: "exact",
        classification: "raw",
        label: "Raw / ungraded",
        currency: "USD",
        listingCount: 2,
        medianAmountCents: 2750,
        typicalRange: { lowAmountCents: 2400, highAmountCents: 3100 },
        confidence: "medium",
      },
    ]),
  });

  assert.equal(snapshot.recommendation.method, "exact_active");
  assert.equal(snapshot.recommendation.amountCents, 2750);
  assert.equal(snapshot.recommendation.pricePointAdjustment.applied, false);
  assert.equal(snapshot.recommendation.confidence, "low");
  assert.equal(snapshot.recommendation.blend, null);
  assert.match(snapshot.recommendation.rationale, /not confirmed sales/i);
});

test("completed sales remain available when no active listing evidence exists", () => {
  const snapshot = buildValuationRecommendation({
    grading: raw,
    soldSnapshot: soldSnapshot([
      {
        matchTier: "exact",
        platform: "eBay",
        currency: "USD",
        saleCount: 3,
        medianSalePriceCents: 4500,
        typicalRange: { lowAmountCents: 4000, highAmountCents: 5000 },
        confidence: "medium",
      },
    ]),
    activeSnapshot: activeSnapshot(),
  });

  assert.equal(snapshot.recommendation.method, "exact_sold");
  assert.equal(snapshot.recommendation.amountCents, 4525);
  assert.equal(snapshot.recommendation.blend, null);
});

test("compatible broader evidence is blended but remains low confidence", () => {
  const snapshot = buildValuationRecommendation({
    grading: raw,
    soldSnapshot: soldSnapshot([
      {
        matchTier: "broader",
        platform: "eBay",
        currency: "USD",
        saleCount: 5,
        medianSalePriceCents: 3000,
        typicalRange: { lowAmountCents: 2500, highAmountCents: 3500 },
        confidence: "low",
      },
    ]),
    activeSnapshot: activeSnapshot([
      {
        matchTier: "broader",
        classification: "raw",
        label: "Raw / ungraded",
        currency: "USD",
        listingCount: 6,
        medianAmountCents: 5000,
        typicalRange: { lowAmountCents: 4500, highAmountCents: 5500 },
        confidence: "low",
      },
    ]),
  });

  assert.equal(snapshot.recommendation.method, "blended_broader_market");
  assert.equal(snapshot.recommendation.amountCents, 4225);
  assert.deepEqual(snapshot.recommendation.typicalRange, {
    lowAmountCents: 3700,
    highAmountCents: 4700,
  });
  assert.equal(snapshot.recommendation.confidence, "low");
});

test("direct exact active evidence outranks a modeled sold variant", () => {
  const snapshot = buildValuationRecommendation({
    grading: raw,
    soldSnapshot: soldSnapshot([], [
      {
        currency: "USD",
        confidence: "low",
        sourceCount: 1,
        estimatedAmountCents: 2913,
        estimatedRange: { lowAmountCents: 2300, highAmountCents: 3700 },
      },
    ]),
    activeSnapshot: activeSnapshot([
      {
        matchTier: "exact",
        classification: "raw",
        label: "Raw / ungraded",
        currency: "USD",
        listingCount: 1,
        medianAmountCents: 5517,
        typicalRange: { lowAmountCents: 5517, highAmountCents: 5517 },
        confidence: "low",
      },
    ]),
  });

  assert.equal(snapshot.recommendation.method, "exact_active");
  assert.equal(snapshot.recommendation.amountCents, 5525);
});

test("a one-sale variant estimate warns when active variant evidence materially disagrees", () => {
  const baseVariant = {
    currency: "USD",
    confidence: "low",
    sourceProfile: { printRun: 50 },
    targetProfile: { printRun: 25 },
    estimatedRange: { lowAmountCents: 2160, highAmountCents: 8438 },
  };
  const snapshot = buildValuationRecommendation({
    grading: raw,
    soldSnapshot: soldSnapshot([], [
      {
        ...baseVariant,
        sourceCount: 1,
        estimatedAmountCents: 4269,
      },
    ]),
    activeSnapshot: activeSnapshot([], [
      {
        ...baseVariant,
        sourceCount: 2,
        estimatedAmountCents: 10668,
      },
    ]),
  });

  assert.equal(snapshot.recommendation.method, "blended_variant_market");
  assert.equal(snapshot.recommendation.amountCents, 8125);
  assert.deepEqual(snapshot.recommendation.blend, {
    activeWeight: 0.6,
    completedSalesWeight: 0.4,
    activeAmountCents: 10668,
    completedSalesAmountCents: 4269,
    activeCount: 2,
    completedSalesCount: 1,
  });
  assert.deepEqual(snapshot.recommendation.warnings, [
    {
      code: "single_sale_active_disagreement",
      activeAmountCents: 10668,
      activeCurrency: "USD",
      activeListingCount: 2,
      direction: "higher",
    },
  ]);
});

test("the recommendation service returns partial evidence when one provider fails", async () => {
  const card = {
    fields: { player: "Nolan Ryan" },
    grading: raw,
    valuationProfile: { featureType: "ordinary", source: "derived" },
    ebayReference: null,
  };
  const service = new ValuationRecommendationService({
    now: () => Date.parse("2026-08-13T12:00:00.000Z"),
    soldComps: {
      async snapshot() {
        const error = new Error("limited");
        error.status = 429;
        throw error;
      },
    },
    activeMarket: {
      async snapshot() {
        return activeSnapshot([
          {
            matchTier: "exact",
            classification: "raw",
            label: "Raw / ungraded",
            currency: "USD",
            listingCount: 3,
            medianAmountCents: 3000,
            typicalRange: { lowAmountCents: 2500, highAmountCents: 3500 },
            confidence: "medium",
          },
        ]);
      },
    },
  });

  const snapshot = await service.snapshot(card);
  assert.equal(snapshot.evidence.sold.status, "rate_limited");
  assert.equal(snapshot.evidence.active.status, "available");
  assert.equal(snapshot.recommendation.method, "exact_active");
});

test("the recommendation service forwards active and sold exclusions", async () => {
  let soldOptions = null;
  let activeOptions = null;
  const card = {
    fields: { player: "Nolan Ryan" },
    grading: raw,
    valuationProfile: { featureType: "ordinary", source: "derived" },
    ebayReference: { itemId: "v1|confirmed|0" },
  };
  const service = new ValuationRecommendationService({
    soldComps: {
      async snapshot(_fields, _grading, _profile, options) {
        soldOptions = options;
        return soldSnapshot();
      },
    },
    activeMarket: {
      async snapshot(_fields, options) {
        activeOptions = options;
        return activeSnapshot();
      },
    },
  });

  await service.snapshot(card, {
    soldExcludedObservationIds: ["sold-1"],
    activeExcludedObservationIds: ["active-1"],
  });

  assert.deepEqual(soldOptions, { excludedObservationIds: ["sold-1"] });
  assert.deepEqual(activeOptions, {
    confirmedReferenceItemId: "v1|confirmed|0",
    grading: raw,
    valuationProfile: card.valuationProfile,
    excludedObservationIds: ["active-1"],
  });
});
