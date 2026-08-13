import test from "node:test";
import assert from "node:assert/strict";
import { fieldKeys } from "./contracts.mjs";
import {
  isPlausibleCardNumber,
  isPlausibleIssueYear,
  normalizeCardSemantics,
} from "./semantic-normalizer.mjs";

function field(value = null, confidence = value === null ? 0 : 0.9) {
  return {
    value,
    confidence,
    evidenceIds: [],
    inferenceSource: value === null ? "unknown" : "visible",
    missingEvidence: [],
  };
}

function extraction(overrides = {}) {
  const fields = Object.fromEntries(fieldKeys.map((key) => [key, field()]));
  Object.assign(fields, overrides);
  return {
    status: "partial",
    fields,
    evidence: [],
    missingEvidence: [],
    numericReadings: [],
    visibleMarks: [
      {
        text: "75 Years of Baseball",
        kind: "anniversary_mark",
        imageSide: "front",
        location: "upper left",
        confidence: 0.99,
      },
    ],
    visualFeatures: [],
    candidateSuggestions: [],
    summary: "75 Years of Baseball Nolan Ryan",
  };
}

test("a two-digit anniversary number can never become the issue year", () => {
  const normalized = normalizeCardSemantics(
    extraction({ year: field("75", 0.99) }),
    2026,
  );

  assert.equal(normalized.fields.year.value, null);
  assert.equal(normalized.fields.year.confidence, 0);
  assert.match(normalized.missingEvidence[0].description, /anniversary/i);
});

test("anniversary branding cannot become the product or set", () => {
  const normalized = normalizeCardSemantics(
    extraction({
      product: field("75 Years of Baseball", 0.99),
      setOrInsert: field("75 Years of Baseball", 0.98),
    }),
    2026,
  );

  assert.equal(normalized.fields.product.value, null);
  assert.equal(normalized.fields.setOrInsert.value, null);
  assert.equal(normalized.visibleMarks[0].text, "75 Years of Baseball");
});

test("generic autograph certification wording cannot become an insert name", () => {
  const input = extraction({
    setOrInsert: field("Topps Certified Autograph Issue", 0.98),
  });
  input.visibleMarks.push({
    text: "TOPPS CERTIFIED AUTOGRAPH ISSUE",
    kind: "insert_title",
    imageSide: "front",
    location: "top",
    confidence: 0.98,
  });
  const normalized = normalizeCardSemantics(input, 2026);

  assert.equal(normalized.fields.setOrInsert.value, null);
  assert.match(
    normalized.missingEvidence.find((item) => item.field === "setOrInsert")
      .description,
    /certification wording/i,
  );
});

test("a plausible four-digit year remains valid", () => {
  assert.equal(isPlausibleIssueYear("2026", 2026), true);
  assert.equal(isPlausibleIssueYear("2025-26", 2026), true);
  assert.equal(isPlausibleIssueYear("75", 2026), false);
});

test("a four-digit year inferred from an anniversary mark is still rejected", () => {
  const normalized = normalizeCardSemantics(
    extraction({ year: field("1975", 0.61) }),
    2026,
  );
  assert.equal(normalized.fields.year.value, null);
});

test("a visibly printed copyright year remains available", () => {
  const input = extraction({ year: field("2026", 0.96) });
  input.visibleMarks.push({
    text: "© 2026 THE TOPPS COMPANY",
    kind: "copyright_year",
    imageSide: "back",
    location: "lower back",
    confidence: 0.98,
  });
  const normalized = normalizeCardSemantics(input, 2026);
  assert.equal(normalized.fields.year.value, "2026");
});

test("a stray single letter cannot become a card number", () => {
  const normalized = normalizeCardSemantics(
    extraction({ cardNumber: field("P", 0.84) }),
    2026,
  );
  assert.equal(normalized.fields.cardNumber.value, null);
  assert.equal(isPlausibleCardNumber("CN-14"), true);
  assert.equal(isPlausibleCardNumber("173"), true);
  assert.equal(isPlausibleCardNumber("P"), false);
});
