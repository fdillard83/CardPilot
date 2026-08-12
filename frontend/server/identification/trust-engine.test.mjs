import test from "node:test";
import assert from "node:assert/strict";
import { evaluateTrust, getBackPhotoGuidance } from "./trust-engine.mjs";

function field(value, confidence = 0.98) {
  return {
    value,
    confidence,
    evidenceIds: [],
    inferenceSource: "visible",
    missingEvidence: [],
  };
}

function fields(overrides = {}) {
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
    ...overrides,
  };
}

test("high-confidence ordinary cards auto-accept without a back image", () => {
  const decision = evaluateTrust({
    status: "identified",
    fields: fields(),
    missingEvidence: [],
    overallConfidence: 0.97,
  });

  assert.equal(decision.action, "auto_accept");
  assert.equal(decision.reviewRequired, false);

  const guidance = getBackPhotoGuidance({
    provided: false,
    decision,
    missingEvidence: [
      {
        field: "cardNumber",
        description: "The card back may show another identifier.",
        suggestedSource: "back_image",
        expectedConfidenceGain: 0.2,
      },
    ],
  });
  assert.equal(guidance.suggested, false);
});

test("medium confidence requests one-tap confirmation", () => {
  const decision = evaluateTrust({
    status: "identified",
    fields: fields(),
    missingEvidence: [],
    overallConfidence: 0.86,
  });

  assert.equal(decision.action, "confirm");
  assert.equal(decision.reviewRequirement, "confirmation");
});

test("low confidence requests a full review", () => {
  const decision = evaluateTrust({
    status: "partial",
    fields: fields(),
    missingEvidence: [],
    overallConfidence: 0.62,
  });

  assert.equal(decision.action, "review");
  assert.equal(decision.reviewRequirement, "full_review");
});

test("an uncertain named parallel forces review", () => {
  const decision = evaluateTrust({
    status: "identified",
    fields: fields({ parallel: field("RayWave", 0.72) }),
    missingEvidence: [],
    overallConfidence: 0.97,
  });

  assert.equal(decision.action, "review");
  assert.match(decision.blockers.join(" "), /parallel/i);
});

test("verified special cards still receive one-tap confirmation", () => {
  const decision = evaluateTrust({
    status: "identified",
    fields: fields({ serialNumber: field("12/25", 0.98) }),
    missingEvidence: [],
    overallConfidence: 0.98,
  });

  assert.equal(decision.action, "confirm");
});

test("uncertain special-card evidence forces full review", () => {
  const decision = evaluateTrust({
    status: "identified",
    fields: fields({ autograph: field(true, 0.73) }),
    missingEvidence: [],
    overallConfidence: 0.97,
  });

  assert.equal(decision.action, "review");
  assert.match(decision.blockers.join(" "), /autograph/i);
});

test("a plausible but unresolved special feature forces review", () => {
  const decision = evaluateTrust({
    status: "identified",
    fields: fields(),
    missingEvidence: [
      {
        field: "imageVariation",
        description: "The alternate image could not be verified.",
        suggestedSource: "catalog",
        expectedConfidenceGain: 0.08,
      },
    ],
    overallConfidence: 0.97,
  });

  assert.equal(decision.action, "review");
  assert.match(decision.blockers.join(" "), /imageVariation/i);
});

test("a back photo is suggested only for a material expected gain", () => {
  const reviewDecision = {
    action: "review",
    reviewRequired: true,
    reviewRequirement: "full_review",
    reasons: [],
    blockers: [],
  };
  const material = getBackPhotoGuidance({
    provided: false,
    decision: reviewDecision,
    missingEvidence: [
      {
        field: "cardNumber",
        description: "The back may show the exact card number.",
        suggestedSource: "back_image",
        expectedConfidenceGain: 0.12,
      },
    ],
  });
  const immaterial = getBackPhotoGuidance({
    provided: false,
    decision: reviewDecision,
    missingEvidence: [
      {
        field: "brand",
        description: "The back may repeat the logo.",
        suggestedSource: "back_image",
        expectedConfidenceGain: 0.04,
      },
    ],
  });

  assert.equal(material.suggested, true);
  assert.equal(immaterial.suggested, false);
});

test("back-photo gain cannot exceed remaining confidence headroom", () => {
  const guidance = getBackPhotoGuidance({
    provided: false,
    decision: {
      action: "review",
      reviewRequired: true,
      reviewRequirement: "full_review",
      reasons: [],
      blockers: [],
    },
    overallConfidence: 0.82,
    missingEvidence: [
      {
        field: "cardNumber",
        description: "The back may reveal the card number.",
        suggestedSource: "back_image",
        expectedConfidenceGain: 0.85,
      },
    ],
  });

  assert.equal(guidance.expectedConfidenceGain, 0.18);
});

test("missing rookie status alone does not prompt for the back", () => {
  const guidance = getBackPhotoGuidance({
    provided: false,
    decision: {
      action: "review",
      reviewRequired: true,
      reviewRequirement: "full_review",
      reasons: [],
      blockers: [],
    },
    overallConfidence: 0.74,
    missingEvidence: [
      {
        field: "rookieStatus",
        description: "No rookie designation is visible.",
        suggestedSource: "back_image",
        expectedConfidenceGain: 0.15,
      },
    ],
  });

  assert.equal(guidance.suggested, false);
  assert.equal(guidance.reason, null);
});
