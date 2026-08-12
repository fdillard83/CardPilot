import test from "node:test";
import assert from "node:assert/strict";
import { fieldKeys } from "./contracts.mjs";
import { verifyCandidates } from "./verification-engine.mjs";

function field(value) {
  return {
    value,
    confidence: value === null ? 0 : 0.95,
    evidenceIds: [],
    inferenceSource: value === null ? "unknown" : "visible",
    missingEvidence: [],
  };
}

function candidate(
  id,
  product,
  setOrInsert,
  cardNumber,
  plausibility,
  parallel = null,
) {
  const values = Object.fromEntries(fieldKeys.map((key) => [key, null]));
  Object.assign(values, {
    player: "Nolan Ryan",
    team: "California Angels",
    year: "2026",
    manufacturer: "Topps",
    brand: "Topps",
    product,
    setOrInsert,
    cardNumber,
    parallel,
  });
  return {
    id,
    label: id,
    source: "catalog",
    catalogRecordId: id,
    values,
    plausibility,
    basis: "test catalog record",
  };
}

test("ambiguous catalog records fill only their shared identity", () => {
  const fields = Object.fromEntries(fieldKeys.map((key) => [key, field(null)]));
  fields.player = field("Nolan Ryan");
  fields.team = field("Angels");
  fields.manufacturer = field("Topps");
  fields.brand = field("Topps");

  const verified = verifyCandidates(
    { fields },
    [
      candidate(
        "series-2",
        "Topps Series 2",
        "Crooked Numbers",
        "CN-14",
        0.86,
        "Green Foil /99",
      ),
      candidate("series-1", "Topps Series 1", "Golden Mirror", "173", 0.68),
    ],
  );

  assert.equal(verified.fields.year.value, "2026");
  assert.equal(verified.fields.year.inferenceSource, "catalog");
  assert.equal(verified.fields.product.value, null);
  assert.equal(verified.fields.setOrInsert.value, null);
  assert.equal(verified.fields.cardNumber.value, null);
  assert.equal(verified.fields.parallel.value, null);
});
