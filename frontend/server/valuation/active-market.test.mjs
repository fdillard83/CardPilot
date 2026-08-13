import test from "node:test";
import assert from "node:assert/strict";
import {
  ActiveMarketService,
  buildActiveMarketQuery,
  buildActiveMarketSnapshot,
  evaluateCardTitleMatch,
} from "./active-market.mjs";

const fields = {
  player: "Nolan Ryan",
  sport: "Baseball",
  team: "California Angels",
  year: "2026",
  manufacturer: "Topps",
  product: "Topps Series 2",
  brand: "Topps",
  setOrInsert: "Crooked Numbers",
  cardNumber: "CN-14",
  rookieStatus: false,
  parallel: "Green Foil",
  serialNumber: "63/85",
  autograph: false,
  memorabilia: false,
  imageVariation: false,
};

function candidate({
  id,
  title,
  price,
  shipping = null,
  buyingOptions = ["FIXED_PRICE"],
  condition = "Ungraded",
}) {
  return {
    id: `ebay-${id}`,
    source: "ebay_browse",
    rank: Number(id),
    itemId: `v1|${id}|0`,
    title,
    itemWebUrl: `https://www.ebay.com/itm/${id}`,
    imageUrl: `https://i.ebayimg.com/${id}.jpg`,
    price: { value: price.toFixed(2), currency: "USD" },
    shippingCost:
      shipping === null
        ? null
        : { value: shipping.toFixed(2), currency: "USD" },
    condition,
    conditionId: null,
    buyingOptions,
    categories: [{ categoryId: "212", categoryName: "Sports Trading Cards" }],
  };
}

test("active-market queries keep the print run but not the physical copy number", () => {
  const query = buildActiveMarketQuery(fields);
  assert.match(query, /2026 Nolan Ryan/);
  assert.match(query, /#CN-14/);
  assert.match(query, /Green Foil/);
  assert.match(query, /\/85/);
  assert.doesNotMatch(query, /63\/85/);
});

test("active snapshots reject mismatches, separate grades, and trim outliers", () => {
  const matchingTitle =
    "2026 Topps Series 2 Nolan Ryan Crooked Numbers #CN-14 Green Foil /85";
  const candidates = [
    candidate({ id: "1", title: matchingTitle, price: 36, shipping: 4 }),
    candidate({ id: "2", title: matchingTitle, price: 42 }),
    candidate({ id: "3", title: matchingTitle, price: 45 }),
    candidate({ id: "4", title: matchingTitle, price: 48 }),
    candidate({ id: "5", title: matchingTitle, price: 200 }),
    candidate({
      id: "6",
      title: `${matchingTitle} PSA 10`,
      price: 100,
      condition: "Graded",
    }),
    candidate({
      id: "7",
      title: `${matchingTitle} PSA 10`,
      price: 110,
      condition: "Graded",
    }),
    candidate({
      id: "8",
      title: matchingTitle.replace("Green Foil", "Blue Foil"),
      price: 5,
    }),
    candidate({ id: "9", title: `${matchingTitle} lot`, price: 6 }),
    candidate({
      id: "10",
      title: matchingTitle,
      price: 1,
      buyingOptions: ["AUCTION"],
    }),
  ];

  const snapshot = buildActiveMarketSnapshot({
    fields,
    marketplaceId: "EBAY_US",
    candidates,
    searchedAt: "2026-08-12T20:00:00.000Z",
  });

  assert.equal(snapshot.kind, "active_asking_snapshot");
  assert.equal(snapshot.source.supportsSoldHistory, false);
  assert.equal(snapshot.matchedCount, 7);
  assert.equal(snapshot.exactMatchedCount, 7);
  assert.equal(snapshot.broaderMatchedCount, 0);
  assert.equal(snapshot.excludedCount, 3);
  assert.equal(snapshot.groups.length, 2);

  const raw = snapshot.groups[0];
  assert.equal(raw.id, "raw");
  assert.equal(raw.listingCount, 4);
  assert.equal(raw.outlierCount, 1);
  assert.equal(raw.medianAmountCents, 4350);
  assert.deepEqual(raw.typicalRange, {
    lowAmountCents: 4150,
    highAmountCents: 4575,
  });
  assert.equal(raw.confidence, "medium");
  assert.equal(raw.listings[0].shippingCostCents, 400);
  assert.equal(raw.listings[0].totalPriceCents, 4000);

  const psa10 = snapshot.groups[1];
  assert.equal(psa10.id, "psa_10");
  assert.equal(psa10.medianAmountCents, 10500);
  assert.equal(psa10.confidence, "low");
});

test("a collector-confirmed eBay reference survives an incomplete seller title", () => {
  const confirmedReference = candidate({
    id: "406976477651",
    title:
      "Nolan Ryan Green Foil Crooked Numbers Autograph #/85 - California Angels",
    price: 50,
  });

  const withoutReference = buildActiveMarketSnapshot({
    fields: { ...fields, autograph: true },
    marketplaceId: "EBAY_US",
    candidates: [confirmedReference],
  });
  assert.equal(withoutReference.matchedCount, 0);

  const withReference = buildActiveMarketSnapshot({
    fields: { ...fields, autograph: true },
    marketplaceId: "EBAY_US",
    candidates: [confirmedReference],
    confirmedReferenceItemId: confirmedReference.itemId,
  });
  assert.equal(withReference.matchedCount, 1);
  assert.equal(withReference.groups[0].listings[0].confirmedReference, true);
  assert.deepEqual(withReference.groups[0].listings[0].matchedSignals, [
    "confirmed_reference",
  ]);
});

test("broader comparisons activate only when exact results are scarce", () => {
  const strictTitle =
    "2026 Topps Series 2 Nolan Ryan Crooked Numbers #CN-14 Green Foil /85";
  const missingYear =
    "Topps Series 2 Nolan Ryan Crooked Numbers #CN-14 Green Foil /85";
  const candidates = [
    candidate({ id: "1", title: strictTitle, price: 40 }),
    candidate({ id: "2", title: missingYear, price: 44 }),
    candidate({ id: "3", title: missingYear.replace("Green", "Blue"), price: 20 }),
    candidate({ id: "4", title: missingYear.replace("/85", "/50"), price: 25 }),
    candidate({ id: "5", title: `2025 ${missingYear}`, price: 30 }),
    candidate({ id: "6", title: "2026 Topps Nolan Ryan Crackle Foil", price: 15 }),
  ];

  const snapshot = buildActiveMarketSnapshot({
    fields,
    marketplaceId: "EBAY_US",
    candidates,
  });

  assert.equal(snapshot.exactMatchedCount, 1);
  assert.equal(snapshot.broaderMatchedCount, 1);
  assert.equal(snapshot.matchedCount, 2);
  assert.equal(snapshot.excludedCount, 4);
  assert.equal(snapshot.groups.length, 2);
  assert.equal(snapshot.groups[0].matchTier, "exact");
  assert.equal(snapshot.groups[1].matchTier, "broader");
  assert.equal(snapshot.groups[1].confidence, "low");
  assert.equal(snapshot.groups[1].listings[0].matchTier, "broader");
});

test("broader matching rejects conflicting products when saved product details are sparse", () => {
  const sparseFields = {
    ...fields,
    product: null,
    setOrInsert: null,
    cardNumber: null,
    parallel: "Green Crackle Foil",
    serialNumber: "/99",
  };

  assert.equal(
    evaluateCardTitleMatch(
      "2026 Topps Chrome Nolan Ryan Chrome Rivals Insert #RVH-11 /99 Rangers",
      sparseFields,
      { broader: true },
    ),
    null,
  );
  assert.equal(
    evaluateCardTitleMatch(
      "2026 Topps Tribute Nolan Ryan Green Parallel /99 Angels",
      sparseFields,
      { broader: true },
    ),
    null,
  );
  assert.ok(
    evaluateCardTitleMatch(
      "2026 Topps Series 2 Nolan Ryan Green Crackle Foil /99 California Angels",
      sparseFields,
      { broader: true },
    ),
  );
});

test("active exclusions remove exact and broader comparisons from summaries", () => {
  const candidates = [
    candidate({
      id: "exact",
      title:
        "2026 Topps Series 2 Nolan Ryan Crooked Numbers #CN-14 Green Foil /85",
      price: 40,
    }),
    candidate({
      id: "broader",
      title:
        "Topps Series 2 Nolan Ryan Crooked Numbers #CN-14 Green Foil /85",
      price: 44,
    }),
  ];

  const withoutExact = buildActiveMarketSnapshot({
    fields,
    marketplaceId: "EBAY_US",
    candidates,
    excludedObservationIds: ["v1|exact|0"],
  });
  const withoutBroader = buildActiveMarketSnapshot({
    fields,
    marketplaceId: "EBAY_US",
    candidates,
    excludedObservationIds: ["v1|broader|0"],
  });

  assert.equal(withoutExact.exactMatchedCount, 0);
  assert.equal(withoutExact.broaderMatchedCount, 1);
  assert.equal(withoutExact.groups[0].listings[0].itemId, "v1|broader|0");
  assert.equal(withoutBroader.exactMatchedCount, 1);
  assert.equal(withoutBroader.broaderMatchedCount, 0);
  assert.equal(withoutBroader.groups[0].listings[0].itemId, "v1|exact|0");
});

test("active snapshots keep variant-adjusted asking estimates separate", () => {
  const snapshot = buildActiveMarketSnapshot({
    fields: {
      ...fields,
      parallel: null,
      serialNumber: null,
      autograph: false,
    },
    grading: {
      isGraded: false,
      company: null,
      grade: null,
      certificationNumber: null,
    },
    valuationProfile: {
      featureType: "ordinary",
      source: "user_confirmed",
    },
    marketplaceId: "EBAY_US",
    candidates: [
      candidate({
        id: "variant",
        title:
          "2026 Topps Series 2 Nolan Ryan Crooked Numbers #CN-14 On-Card Auto /50",
        price: 120,
      }),
    ],
  });

  assert.equal(snapshot.matchedCount, 0);
  assert.equal(snapshot.variantEstimates.length, 1);
  assert.equal(snapshot.variantEstimates[0].observationType, "active_asking");
  assert.equal(snapshot.variantEstimates[0].estimatedAmountCents, 224);
});

test("active-market exclusions recalculate from cached provider results", async () => {
  let requests = 0;
  const baseFields = {
    ...fields,
    parallel: null,
    serialNumber: null,
    autograph: false,
  };
  const service = new ActiveMarketService({
    ebayClient: {
      async searchByKeywords() {
        requests += 1;
        return {
          marketplaceId: "EBAY_US",
          candidates: [
            candidate({
              id: "variant",
              title:
                "2026 Topps Series 2 Nolan Ryan Crooked Numbers #CN-14 On-Card Auto /50",
              price: 120,
            }),
          ],
        };
      },
    },
  });
  const options = {
    valuationProfile: {
      featureType: "ordinary",
      source: "user_confirmed",
    },
  };

  const initial = await service.snapshot(baseFields, options);
  const withoutAnchor = await service.snapshot(baseFields, {
    ...options,
    excludedObservationIds: ["v1|variant|0"],
  });

  assert.equal(initial.variantEstimates.length, 1);
  assert.equal(withoutAnchor.variantEstimates.length, 0);
  assert.equal(requests, 2);
});

test("active-market service caches short-lived eBay snapshots", async () => {
  let requests = 0;
  let now = Date.parse("2026-08-12T20:00:00.000Z");
  const service = new ActiveMarketService({
    now: () => now,
    cacheDurationMs: 10 * 60 * 1000,
    ebayClient: {
      async searchByKeywords() {
        requests += 1;
        return { marketplaceId: "EBAY_US", candidates: [] };
      },
    },
  });

  const first = await service.snapshot(fields);
  const second = await service.snapshot(fields);
  assert.deepEqual(second, first);
  assert.equal(requests, 2);

  now += 11 * 60 * 1000;
  await service.snapshot(fields);
  assert.equal(requests, 4);
});

test("active-market cache keeps different confirmed references separate", async () => {
  let requests = 0;
  const service = new ActiveMarketService({
    ebayClient: {
      async searchByKeywords() {
        requests += 1;
        return { marketplaceId: "EBAY_US", candidates: [] };
      },
    },
  });

  await service.snapshot(fields, { confirmedReferenceItemId: "v1|1|0" });
  await service.snapshot(fields, { confirmedReferenceItemId: "v1|2|0" });
  assert.equal(requests, 4);
});
