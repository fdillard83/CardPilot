import test from "node:test";
import assert from "node:assert/strict";
import { fieldKeys } from "./contracts.mjs";
import { CatalogCandidateGenerator, RemoteCatalogCandidateGenerator } from "./candidate-generator.mjs";

function field(value) {
  return {
    value,
    confidence: value === null ? 0 : 0.95,
    evidenceIds: [],
    inferenceSource: value === null ? "unknown" : "visible",
    missingEvidence: [],
  };
}

function extraction(player = "Nolan Ryan") {
  const values = {
    player,
    sport: "Baseball",
    team: "Angels",
    year: null,
    manufacturer: "Topps",
    product: null,
    brand: "Topps",
    setOrInsert: null,
    cardNumber: null,
    rookieStatus: null,
    parallel: null,
    serialNumber: null,
    autograph: false,
    memorabilia: false,
    imageVariation: null,
  };
  return {
    fields: Object.fromEntries(fieldKeys.map((key) => [key, field(values[key])])),
    visibleMarks: [{ text: "75 Years of Baseball", kind: "anniversary_mark" }],
    visualFeatures: [
      { description: "reflective green foil outer border" },
      { description: "stylized Angels wordmark" },
    ],
    candidateSuggestions: [],
  };
}

test("Nolan Ryan evidence returns independent 2026 catalog candidates", async () => {
  const candidates = await new CatalogCandidateGenerator().generate(extraction());

  assert.ok(candidates.length >= 2);
  assert.equal(candidates[0].source, "catalog");
  assert.equal(candidates[0].values.year, "2026");
  assert.match(candidates[0].label, /Series 2/i);
  assert.ok(candidates.every((candidate) => candidate.catalogRecordId));
});

test("unrelated players do not receive the Nolan catalog records", async () => {
  const candidates = await new CatalogCandidateGenerator().generate(
    extraction("Shohei Ohtani"),
  );
  assert.deepEqual(candidates, []);
});

test("remote catalog candidates preserve permanent IDs and print runs", async () => {
  const observed = extraction("Edgar Martinez");
  observed.fields.year = field("2025");
  observed.fields.product = field("Topps Tribute");
  observed.fields.cardNumber = field("TA-EM");
  observed.fields.autograph = field(true);
  const generator = new RemoteCatalogCandidateGenerator({
    client: { searchCards: async () => ({ cards: [{ ucid: "UC-EDGAR-1", subject: "Edgar Martinez", sport: "Baseball", year: 2025, manufacturer: "Topps", setName: "2025 Topps Tribute Autographs", parentSetName: "2025 Topps Tribute", cardNumber: "TA-EM", parallel: "Orange", isRookie: false, isAuto: true, isRelic: false, printRun: 25 }] }) },
  });
  const candidates = await generator.generate(observed);
  assert.equal(candidates[0].catalogRecordId, "UC-EDGAR-1");
  assert.equal(candidates[0].values.parallel, "Orange");
  assert.equal(candidates[0].values.serialNumber, "/25");
});

test("remote catalog retries without an uncertain year before falling back", async () => {
  const observed = extraction("Edgar Martinez");
  observed.fields.year = field("2026");
  observed.fields.manufacturer = field("Topps");
  observed.fields.product = field("Tribute");
  const searches = [];
  const generator = new RemoteCatalogCandidateGenerator({
    client: {
      searchCards: async (search) => {
        searches.push(search);
        return search.year === null
          ? { cards: [{ ucid: "UC-EDGAR-BROAD", subject: "Edgar Martinez", sport: "Baseball", year: 2025, manufacturer: "Topps", setName: "Topps Tribute", parentSetName: null, cardNumber: "TA-EM", parallel: "Orange", isRookie: false, isAuto: true, isRelic: false, printRun: 25 }] }
          : { cards: [] };
      },
    },
  });
  const candidates = await generator.generate(observed);
  assert.equal(searches.length, 2);
  assert.equal(searches[0].year, 2026);
  assert.equal(searches[1].year, null);
  assert.equal(candidates[0].catalogRecordId, "UC-EDGAR-BROAD");
});
