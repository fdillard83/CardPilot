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
  assert.equal(calls[1].query, "Nolan Ryan 2026");

  now += 11 * 60 * 1000;
  await service.snapshot(fields, raw);
  assert.equal(calls.length, 4);
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
