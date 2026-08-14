import test from "node:test";
import assert from "node:assert/strict";
import { calculateOverallConfidence } from "./confidence-engine.mjs";

function field(value, confidence = 0.98, inferenceSource = "visible") {
  return {
    value,
    confidence,
    evidenceIds: [],
    inferenceSource,
    missingEvidence: [],
  };
}

function completeFields() {
  return {
    player: field("Nick Kurtz"),
    sport: field("Baseball"),
    team: field("Athletics"),
    year: field("2026"),
    manufacturer: field("Topps"),
    product: field("Topps Chrome"),
    brand: field("Topps"),
    setOrInsert: field("Wrecking Crew"),
    cardNumber: field("WC-12"),
    rookieStatus: field(true),
    parallel: field("Base"),
    serialNumber: field(null, 0),
    autograph: field(false),
    memorabilia: field(false),
    imageVariation: field(false),
  };
}

test("complete front evidence can earn high confidence without a back photo", () => {
  const overall = calculateOverallConfidence({
    status: "identified",
    fields: completeFields(),
    missingEvidence: [],
    candidateMatches: [{ conflictingFields: [] }],
  });

  assert.ok(overall >= 0.95);
});
test("material missing evidence caps confidence below auto-accept", () => {
  const fields = completeFields();
  fields.cardNumber = field(null, 0);
  const overall = calculateOverallConfidence({
    status: "partial",
    fields,
    missingEvidence: [
      {
        field: "cardNumber",
        description: "Card number is not visible.",
        suggestedSource: "back_image",
        expectedConfidenceGain: 0.12,
      },
    ],
    candidateMatches: [],
  });

  assert.ok(overall <= 0.94);
});

test("a core candidate conflict caps confidence in the review range", () => {
  const overall = calculateOverallConfidence({
    status: "identified",
    fields: completeFields(),
    missingEvidence: [],
    candidateMatches: [{ conflictingFields: ["year"] }],
  });

  assert.ok(overall <= 0.79);
});

test("Pokémon confidence uses character and collector fields instead of player", () => {
  const fields = completeFields();
  Object.assign(fields, {
    category: field("Pokémon"),
    player: field(null, 0),
    character: field("Charmander"),
    sport: field(null, 0),
    team: field(null, 0),
    setOrInsert: field("MEP Promo"),
    cardNumber: field("038"),
    rarity: field("Promo"),
    finish: field("Holo"),
  });
  const overall = calculateOverallConfidence({
    status: "identified",
    fields,
    missingEvidence: [],
    candidateMatches: [{ conflictingFields: [] }],
  });

  assert.ok(overall >= 0.95);
});
