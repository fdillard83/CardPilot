import test from "node:test";
import assert from "node:assert/strict";
import {
  buildVariantAdjustedEstimates,
  deriveValuationProfile,
  featurePremiums,
  serialPremiumForPrintRun,
  serialPremiumTiers,
} from "./variant-adjustment.mjs";

const ordinaryBase = {
  player: "Example Player",
  sport: "Baseball",
  team: "Example Team",
  year: "2025",
  manufacturer: "Topps",
  product: "Chrome",
  brand: "Topps",
  setOrInsert: "Rookie Cards",
  cardNumber: "101",
  rookieStatus: true,
  parallel: null,
  serialNumber: null,
  autograph: false,
  memorabilia: false,
  imageVariation: false,
};

function observation({
  id = "sale-1",
  title,
  amountCents,
  printRun = null,
  features = [],
}) {
  return {
    id,
    title,
    amountCents,
    currency: "USD",
    platform: "eBay",
    imageUrl: null,
    url: `https://example.com/${id}`,
    date: "2026-08-12",
    printRun,
    features,
  };
}

test("serial premium data preserves the supplied tiers and interpolates /85", () => {
  assert.equal(serialPremiumTiers.find((tier) => tier.printRun === 50).low, 8);
  assert.equal(serialPremiumTiers.find((tier) => tier.printRun === 50).high, 15);
  const eightyFive = serialPremiumForPrintRun(85);
  assert.equal(eightyFive.label, "/85");
  assert.equal(eightyFive.interpolated, true);
  assert.ok(eightyFive.low > 5 && eightyFive.low < 6);
  assert.ok(eightyFive.high > 9 && eightyFive.high < 11);
});

test("feature premium data keeps composite categories mutually exclusive", () => {
  assert.deepEqual(
    {
      low: featurePremiums.rookie_patch_autograph.low,
      high: featurePremiums.rookie_patch_autograph.high,
    },
    { low: 5, high: 20 },
  );
  assert.deepEqual(deriveValuationProfile(ordinaryBase), {
    featureType: "ordinary",
    source: "derived",
  });
});

test("a /50 on-card autograph can scale down to an ordinary base card", () => {
  const estimates = buildVariantAdjustedEstimates({
    fields: ordinaryBase,
    valuationProfile: {
      featureType: "ordinary",
      source: "user_confirmed",
    },
    observationType: "completed_sale",
    observations: [
      observation({
        title:
          "2025 Topps Chrome Example Player #101 On-Card Auto /50",
        amountCents: 12000,
        printRun: 50,
      }),
    ],
  });

  assert.equal(estimates.length, 1);
  assert.equal(estimates[0].direction, "down");
  assert.equal(estimates[0].estimatedAmountCents, 224);
  assert.deepEqual(estimates[0].estimatedRange, {
    lowAmountCents: 100,
    highAmountCents: 500,
  });
  assert.deepEqual(
    estimates[0].appliedAdjustments.map((adjustment) => adjustment.dimension),
    ["serial", "feature"],
  );
});

test("an ordinary base sale can scale up to a /50 on-card autograph", () => {
  const estimates = buildVariantAdjustedEstimates({
    fields: {
      ...ordinaryBase,
      parallel: "Gold Refractor",
      serialNumber: "12/50",
      autograph: true,
    },
    valuationProfile: {
      featureType: "on_card_autograph",
      source: "user_confirmed",
    },
    observationType: "completed_sale",
    observations: [
      observation({
        title: "2025 Topps Chrome Example Player Rookie Cards #101 Base",
        amountCents: 200,
      }),
    ],
  });

  assert.equal(estimates.length, 1);
  assert.equal(estimates[0].direction, "up");
  assert.equal(estimates[0].estimatedAmountCents, 10733);
  assert.deepEqual(estimates[0].estimatedRange, {
    lowAmountCents: 4800,
    highAmountCents: 24000,
  });
});

test("RPA uses one composite feature factor instead of multiplying its parts", () => {
  const estimates = buildVariantAdjustedEstimates({
    fields: {
      ...ordinaryBase,
      parallel: "Gold",
      serialNumber: "8/50",
      autograph: true,
      memorabilia: true,
    },
    valuationProfile: {
      featureType: "rookie_patch_autograph",
      source: "user_confirmed",
    },
    observationType: "completed_sale",
    observations: [
      observation({
        title: "2025 Topps Chrome Example Player Rookie Cards #101 Base",
        amountCents: 200,
      }),
    ],
  });

  assert.equal(estimates[0].combinedFactor.low, 40);
  assert.equal(estimates[0].combinedFactor.high, 300);
  assert.equal(
    estimates[0].appliedAdjustments.filter(
      (adjustment) => adjustment.dimension === "feature",
    ).length,
    1,
  );
});

test("different products and ambiguous unnumbered parallels are not anchors", () => {
  const target = {
    ...ordinaryBase,
    parallel: "Gold Refractor",
    serialNumber: "12/50",
  };
  const estimates = buildVariantAdjustedEstimates({
    fields: target,
    valuationProfile: {
      featureType: "ordinary",
      source: "user_confirmed",
    },
    observationType: "completed_sale",
    observations: [
      observation({
        id: "wrong-product",
        title: "2025 Topps Chrome Platinum Example Player Rookie Cards #101 Base",
        amountCents: 500,
      }),
      observation({
        id: "unnumbered-parallel",
        title: "2025 Topps Chrome Example Player Rookie Cards #101 Blue Refractor",
        amountCents: 500,
      }),
    ],
  });
  assert.deepEqual(estimates, []);
});

test("a different player can never become a variant anchor", () => {
  const estimates = buildVariantAdjustedEstimates({
    fields: {
      ...ordinaryBase,
      parallel: "Orange Refractor",
      serialNumber: "4/25",
    },
    valuationProfile: {
      featureType: "ordinary",
      source: "user_confirmed",
    },
    observationType: "completed_sale",
    observations: [
      observation({
        title: "2025 Topps Chrome Different Player Rookie Cards #101 /50",
        amountCents: 10000,
        printRun: 50,
      }),
    ],
  });

  assert.deepEqual(estimates, []);
});

test("generic autograph wording cannot stand in for a matching insert", () => {
  const estimates = buildVariantAdjustedEstimates({
    fields: {
      ...ordinaryBase,
      player: "Edgar Martinez",
      product: "Topps Tribute",
      setOrInsert: "Topps Certified Autograph Issue",
      cardNumber: null,
      parallel: "Orange",
      serialNumber: "4/25",
      autograph: true,
      rookieStatus: false,
    },
    valuationProfile: {
      featureType: "autograph_unspecified",
      source: "user_confirmed",
    },
    observationType: "completed_sale",
    observations: [
      observation({
        title:
          "2025 Topps Tribute Edgar Martinez Crest Calligraphy Autograph Gold /50",
        amountCents: 2700,
        printRun: 50,
      }),
    ],
  });

  assert.deepEqual(estimates, []);
});

test("variant anchors require the same insert, card number, or confirmed design", () => {
  const target = {
    ...ordinaryBase,
    player: "Edgar Martinez",
    product: "Topps Tribute",
    setOrInsert: "Crest Calligraphy",
    cardNumber: null,
    parallel: "Orange",
    serialNumber: "4/25",
    autograph: true,
    rookieStatus: false,
  };
  const matchingInsert = buildVariantAdjustedEstimates({
    fields: target,
    valuationProfile: {
      featureType: "autograph_unspecified",
      source: "user_confirmed",
    },
    observationType: "completed_sale",
    observations: [
      observation({
        title:
          "2025 Topps Tribute Edgar Martinez Crest Calligraphy Autograph Gold /50",
        amountCents: 2700,
        printRun: 50,
      }),
    ],
  });
  const wrongInsert = buildVariantAdjustedEstimates({
    fields: target,
    valuationProfile: {
      featureType: "autograph_unspecified",
      source: "user_confirmed",
    },
    observationType: "completed_sale",
    observations: [
      observation({
        title: "2025 Topps Tribute Edgar Martinez Signature Swatches Auto /50",
        amountCents: 2700,
        printRun: 50,
      }),
    ],
  });

  assert.equal(matchingInsert.length, 1);
  assert.equal(matchingInsert[0].direction, "up");
  assert.equal(matchingInsert[0].estimatedAmountCents, 4269);
  assert.deepEqual(matchingInsert[0].lineageEvidence, {
    player: "Edgar Martinez",
    familyMatchType: "set_or_insert",
    familyLabel: "Crest Calligraphy",
  });
  assert.deepEqual(wrongInsert, []);
});
