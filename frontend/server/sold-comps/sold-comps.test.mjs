import test from "node:test";
import assert from "node:assert/strict";
import {
  SoldCompsService,
  buildSoldCompsSnapshot,
} from "./sold-comps.mjs";

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
const raw = {
  isGraded: false,
  company: null,
  grade: null,
  certificationNumber: null,
};
const exactTitle =
  "2026 Topps Series 2 Nolan Ryan Crooked Numbers #CN-14 Green Foil /85";

function result(sales) {
  return {
    sales,
    pagination: { total: sales.length, hasMore: false, nextCursor: null },
    coverage: {
      from: "2026-07-01",
      to: "2026-08-12",
      platforms: ["eBay", "Goldin"],
      generatedAt: "2026-08-12T20:00:00.000Z",
    },
  };
}

function sale(id, price, overrides = {}) {
  return {
    id,
    platform: "eBay",
    listingType: "auction",
    title: exactTitle,
    saleDate: "2026-08-01",
    soldAt: "2026-08-01T12:00:00.000Z",
    price,
    originalPrice: null,
    currency: "USD",
    priceConfirmed: true,
    bids: 8,
    imageUrl: `https://example.com/${id}.jpg`,
    listingUrl: `https://example.com/${id}`,
    cert: null,
    condition: "Ungraded",
    grade: null,
    grader: null,
    player: null,
    manufacturer: null,
    cardSet: null,
    cardNumber: null,
    year: null,
    season: null,
    league: null,
    sport: null,
    team: null,
    features: [],
    printRun: null,
    shippingPrice: null,
    category: "sports",
    ...overrides,
  };
}

test("sold snapshots use only confirmed prices and trim outliers", () => {
  const snapshot = buildSoldCompsSnapshot({
    fields,
    grading: raw,
    query: "Nolan Ryan",
    results: [
      result([
        sale("1", 40),
        sale("2", 42),
        sale("3", 45),
        sale("4", 48),
        sale("5", 200),
        sale("6", 10, { priceConfirmed: false }),
      ]),
    ],
    searchedAt: "2026-08-12T20:00:00.000Z",
  });

  assert.equal(snapshot.kind, "sold_comparables");
  assert.equal(snapshot.candidateCount, 6);
  assert.equal(snapshot.confirmedPriceCount, 5);
  assert.equal(snapshot.exactMatchedCount, 5);
  assert.equal(snapshot.excludedCount, 1);
  assert.equal(snapshot.groups.length, 1);
  assert.equal(snapshot.groups[0].platform, "eBay");
  assert.equal(snapshot.groups[0].saleCount, 4);
  assert.equal(snapshot.groups[0].outlierCount, 1);
  assert.equal(snapshot.groups[0].medianSalePriceCents, 4350);
  assert.deepEqual(snapshot.groups[0].typicalRange, {
    lowAmountCents: 4150,
    highAmountCents: 4575,
  });
  assert.deepEqual(snapshot.groups[0].sales[0].suggestions, {
    character: null,
    setOrInsert: null,
    year: "2026",
    cardNumber: "CN-14",
    parallel: "Green Foil",
    serialNumber: "/85",
    language: null,
    rarity: null,
    finish: null,
    promo: null,
  });
});

test("broader sold comparisons stay separate and reject known conflicts", () => {
  const snapshot = buildSoldCompsSnapshot({
    fields,
    grading: raw,
    query: exactTitle,
    results: [
      result([
        sale("exact", 40),
        sale("broader", 44, {
          title: "Topps Series 2 Nolan Ryan Crooked Numbers #CN-14 Green Foil /85",
        }),
        sale("wrong-run", 20, {
          title: "Topps Series 2 Nolan Ryan Crooked Numbers #CN-14 Green Foil /50",
        }),
      ]),
    ],
  });

  assert.equal(snapshot.exactMatchedCount, 1);
  assert.equal(snapshot.broaderMatchedCount, 1);
  assert.equal(snapshot.groups.length, 2);
  assert.equal(snapshot.groups[0].matchTier, "exact");
  assert.equal(snapshot.groups[1].matchTier, "broader");
  assert.equal(snapshot.groups[1].confidence, "low");
});

test("sold comps reject known visual mismatches but retain exact text fallbacks", () => {
  const snapshot = buildSoldCompsSnapshot({
    fields,
    grading: raw,
    query: exactTitle,
    results: [result([
      sale("matching-image", 40, {
        visualMatchStatus: "matched",
        visualMatch: { score: 0.94, structureScore: 0.91 },
      }),
      sale("different-pose", 42, {
        visualMatchStatus: "matched",
        visualMatch: { score: 0.48, structureScore: 0.22 },
      }),
      sale("not-inspected", 44, { visualMatchStatus: "not_evaluated" }),
      sale("image-unavailable", 46, { visualMatchStatus: "unavailable" }),
      sale("wrong-variant-anchor", 120, {
        title: "2026 Topps Series 2 Nolan Ryan Crooked Numbers #CN-14 On-Card Auto /50",
        printRun: 50,
        visualMatchStatus: "matched",
        visualMatch: { score: 0.51, structureScore: 0.2 },
      }),
    ])],
  });

  assert.equal(snapshot.candidateCount, 5);
  assert.equal(snapshot.confirmedPriceCount, 3);
  assert.equal(snapshot.exactMatchedCount, 3);
  assert.equal(snapshot.broaderMatchedCount, 0);
  assert.equal(snapshot.variantEstimates.length, 0);
  assert.equal(snapshot.groups[0].sales[0].id, "matching-image");
  assert.equal(snapshot.groups[0].sales[0].visualMatchStatus, "matched");
  assert.deepEqual(
    new Set(snapshot.groups[0].sales.map((candidate) => candidate.id)),
    new Set(["matching-image", "not-inspected", "image-unavailable"]),
  );
});

test("sold comps use strong card-number text when a broader image is unavailable", () => {
  const snapshot = buildSoldCompsSnapshot({
    fields,
    grading: raw,
    query: exactTitle,
    results: [result([sale("unverified-broader", 44, {
      title: "Topps Series 2 Nolan Ryan Crooked Numbers #CN-14 Green Foil /85",
      visualMatchStatus: "unavailable",
    })])],
  });
  assert.equal(snapshot.exactMatchedCount, 0);
  assert.equal(snapshot.broaderMatchedCount, 1);
});

test("an unavailable sold image needs a card-design identifier in the title", () => {
  const sparseFields = {
    ...fields,
    product: null,
    setOrInsert: null,
    cardNumber: null,
    parallel: null,
    serialNumber: null,
  };
  const snapshot = buildSoldCompsSnapshot({
    fields: sparseFields,
    grading: raw,
    query: "2026 Nolan Ryan Topps",
    results: [result([sale("generic", 20, {
      title: "2026 Topps Nolan Ryan Baseball Card",
      visualMatchStatus: "unavailable",
    })])],
  });
  assert.equal(snapshot.exactMatchedCount, 0);
});

test("sold exclusions remove exact and broader comparisons from summaries", () => {
  const results = [
    result([
      sale("exact", 40),
      sale("broader", 44, {
        title: "Topps Series 2 Nolan Ryan Crooked Numbers #CN-14 Green Foil /85",
      }),
    ]),
  ];

  const withoutExact = buildSoldCompsSnapshot({
    fields,
    grading: raw,
    query: exactTitle,
    results,
    excludedObservationIds: ["exact"],
  });
  const withoutBroader = buildSoldCompsSnapshot({
    fields,
    grading: raw,
    query: exactTitle,
    results,
    excludedObservationIds: ["broader"],
  });

  assert.equal(withoutExact.exactMatchedCount, 0);
  assert.equal(withoutExact.broaderMatchedCount, 1);
  assert.equal(withoutExact.groups[0].sales[0].id, "broader");
  assert.equal(withoutBroader.exactMatchedCount, 1);
  assert.equal(withoutBroader.broaderMatchedCount, 0);
  assert.equal(withoutBroader.groups[0].sales[0].id, "exact");
});

test("sold snapshots expose a downward estimate from a numbered autograph to base", () => {
  const baseFields = {
    ...fields,
    parallel: null,
    serialNumber: null,
    autograph: false,
  };
  const snapshot = buildSoldCompsSnapshot({
    fields: baseFields,
    grading: raw,
    valuationProfile: {
      featureType: "ordinary",
      source: "user_confirmed",
    },
    query: "Nolan Ryan",
    results: [
      result([
        sale("numbered-auto", 120, {
          title:
            "2026 Topps Series 2 Nolan Ryan Crooked Numbers #CN-14 On-Card Auto /50",
          printRun: 50,
        }),
      ]),
    ],
  });

  assert.equal(snapshot.exactMatchedCount, 0);
  assert.equal(snapshot.variantEstimates.length, 1);
  assert.equal(snapshot.variantEstimates[0].direction, "down");
  assert.equal(snapshot.variantEstimates[0].estimatedAmountCents, 224);
});

test("sold-comps exclusions recalculate from cached provider results", async () => {
  const calls = [];
  const baseFields = {
    ...fields,
    parallel: null,
    serialNumber: null,
    autograph: false,
  };
  const service = new SoldCompsService({
    cardApiClient: {
      async searchSales(options) {
        calls.push(options);
        return result([
          sale("numbered-auto", 120, {
            title:
              "2026 Topps Series 2 Nolan Ryan Crooked Numbers #CN-14 On-Card Auto /50",
            printRun: 50,
          }),
        ]);
      },
    },
  });
  const valuationProfile = {
    featureType: "ordinary",
    source: "user_confirmed",
  };

  const initial = await service.snapshot(baseFields, raw, valuationProfile);
  const withoutAnchor = await service.snapshot(
    baseFields,
    raw,
    valuationProfile,
    { excludedObservationIds: ["numbered-auto"] },
  );

  assert.equal(initial.variantEstimates.length, 1);
  assert.equal(withoutAnchor.variantEstimates.length, 0);
  assert.equal(calls.length, 2);
});

test("sold-comps service retries a broad discovery query and caches in memory", async () => {
  const calls = [];
  let now = Date.parse("2026-08-12T20:00:00.000Z");
  const service = new SoldCompsService({
    now: () => now,
    cardApiClient: {
      async searchSales(options) {
        calls.push(options);
        return result([]);
      },
    },
  });

  const first = await service.snapshot(fields, raw);
  const second = await service.snapshot(fields, raw);
  assert.deepEqual(second, first);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].graded, false);
  assert.match(calls[0].query, /\/85/);
  assert.match(calls[1].query, /^Nolan Ryan 2026 Topps/);

  now += 11 * 60 * 1000;
  await service.snapshot(fields, raw);
  assert.equal(calls.length, 4);
});

test("sold-comps visual cache stays isolated to the submitted card image", async () => {
  let providerCalls = 0;
  let visualCalls = 0;
  const service = new SoldCompsService({
    cardApiClient: {
      async searchSales() {
        providerCalls += 1;
        return result([sale("1", 40), sale("2", 42), sale("3", 44)]);
      },
    },
    visualMatcher: {
      async rank({ candidates }) {
        visualCalls += 1;
        return candidates.map((candidate) => ({
          ...candidate,
          visualMatchStatus: "matched",
          visualMatch: { score: 0.95, structureScore: 0.9 },
        }));
      },
    },
  });

  await service.snapshot(fields, raw, undefined, { sourceImageDataUrl: "data:image/png;base64,AAAA" });
  await service.snapshot(fields, raw, undefined, { sourceImageDataUrl: "data:image/png;base64,AAAA" });
  await service.snapshot(fields, raw, undefined, { sourceImageDataUrl: "data:image/png;base64,BBBB" });

  assert.equal(providerCalls, 2);
  assert.equal(visualCalls, 2);
});

test("sold-comps service retries a focused Pokémon discovery query", async () => {
  const pokemonFields = {
    category: "Pokémon",
    player: null,
    character: "Charmander",
    sport: null,
    team: null,
    year: null,
    manufacturer: "Nintendo",
    product: "Pokémon",
    brand: "Pokémon",
    setOrInsert: null,
    cardNumber: "038",
    language: null,
    rarity: null,
    raritySymbol: "Star",
    finish: null,
    promo: true,
    rookieStatus: null,
    parallel: null,
    serialNumber: null,
    autograph: false,
    memorabilia: false,
    imageVariation: null,
  };
  const calls = [];
  const service = new SoldCompsService({
    cardApiClient: {
      async searchSales(options) {
        calls.push(options.query);
        return result(
          options.query === "Pokemon Charmander 038 Promo"
            ? [
                sale("pokemon-1", 7, { title: "Pokemon Charmander 038 Mega Evolution Promo", category: "pokemon" }),
                sale("pokemon-2", 9, { title: "Pokemon Charmander 038 Mega Evolution Promo", category: "pokemon" }),
                sale("pokemon-3", 11, { title: "Pokemon Charmander 038 Mega Evolution Promo", category: "pokemon" }),
              ]
            : [],
        );
      },
    },
  });

  const snapshot = await service.snapshot(pokemonFields, raw);
  assert.equal(calls.length, 2);
  assert.equal(calls[1], "Pokemon Charmander 038 Promo");
  assert.equal(snapshot.exactMatchedCount, 3);
  assert.equal(snapshot.groups[0].medianSalePriceCents, 900);
});

test("graded sold searches pass the saved company and grade", async () => {
  let options;
  const service = new SoldCompsService({
    cardApiClient: {
      async searchSales(input) {
        options = input;
        return result([sale("1", 100), sale("2", 110), sale("3", 120)]);
      },
    },
  });
  await service.snapshot(fields, {
    isGraded: true,
    company: "PSA",
    grade: "10",
    certificationNumber: null,
  });
  assert.equal(options.graded, true);
  assert.equal(options.grader, "PSA");
  assert.equal(options.grade, "10");
});
