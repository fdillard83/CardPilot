import test from "node:test";
import assert from "node:assert/strict";
import { fieldKeys } from "./contracts.mjs";
import {
  normalizeEvidence,
  normalizeNumericReading,
} from "./evidence-engine.mjs";

const booleanFields = new Set([
  "rookieStatus",
  "autograph",
  "memorabilia",
  "imageVariation",
]);

function emptyModelField(field) {
  return {
    value: booleanFields.has(field) ? null : null,
    confidence: 0,
    observations: [],
  };
}

function candidateValues(overrides = {}) {
  return {
    player: null,
    sport: null,
    team: null,
    year: null,
    manufacturer: null,
    product: null,
    brand: null,
    setOrInsert: null,
    cardNumber: null,
    rookieStatus: null,
    parallel: null,
    serialNumber: null,
    autograph: null,
    memorabilia: null,
    imageVariation: null,
    ...overrides,
  };
}

test("character readings outrank a conflicting aggregate 70 reading", () => {
  const normalized = normalizeNumericReading({
    field: "setOrInsert",
    imageSide: "front",
    location: "top-left anniversary badge",
    value: "70",
    confidence: 0.91,
    characters: [
      { position: 0, character: "7", confidence: 0.99, alternatives: [] },
      { position: 1, character: "5", confidence: 0.96, alternatives: ["0"] },
    ],
  });

  assert.equal(normalized.reportedValue, "70");
  assert.equal(normalized.value, "75");
  assert.equal(normalized.confidence, 0.91);
});

test("the Nolan Ryan 75 regression is reconciled before verification", () => {
  const fields = Object.fromEntries(
    fieldKeys.map((field) => [field, emptyModelField(field)]),
  );
  fields.player = {
    value: "Nolan Ryan",
    confidence: 0.99,
    observations: [
      {
        imageSide: "front",
        observation: "NOLAN RYAN",
        location: "bottom border",
        strength: 0.99,
      },
    ],
  };
  fields.setOrInsert = {
    value: "70 YEARS OF BASEBALL",
    confidence: 0.91,
    observations: [
      {
        imageSide: "front",
        observation: "70 YEARS OF BASEBALL",
        location: "top-left badge",
        strength: 0.91,
      },
    ],
  };

  const extraction = normalizeEvidence({
    status: "partial",
    fields,
    numericReadings: [
      {
        field: "setOrInsert",
        imageSide: "front",
        location: "top-left badge",
        value: "70",
        confidence: 0.91,
        characters: [
          { position: 0, character: "7", confidence: 0.99, alternatives: [] },
          { position: 1, character: "5", confidence: 0.96, alternatives: ["0"] },
        ],
      },
    ],
    visibleMarks: [
      {
        text: "75 YEARS OF BASEBALL",
        kind: "anniversary_mark",
        imageSide: "front",
        location: "top-left badge",
        confidence: 0.91,
      },
    ],
    visualFeatures: [],
    candidateSuggestions: [
      {
        label: "Topps 70 Years Nolan Ryan candidate",
        values: candidateValues({
          player: "Nolan Ryan",
          year: "2021",
          setOrInsert: "70 Years of Baseball",
        }),
        plausibility: 0.94,
        basis: "The visible 70 anniversary badge suggested this issue.",
        catalogRecordId: null,
      },
    ],
    missingEvidence: [],
    summary: "Nolan Ryan with a 70 anniversary badge.",
  });

  assert.equal(extraction.fields.setOrInsert.value, "75 YEARS OF BASEBALL");
  assert.ok(
    extraction.evidence.some((item) => item.observation.includes("75")),
  );
  assert.match(extraction.candidateSuggestions[0].label, /75 Years/);
  assert.equal(extraction.candidateSuggestions[0].plausibility, 0.55);
  assert.match(extraction.summary, /75 anniversary/);
});
