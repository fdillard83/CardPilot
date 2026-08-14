import test from "node:test";
import assert from "node:assert/strict";
import {
  CardIdentificationResultSchema,
  CorrectionSubmissionSchema,
  fieldKeys,
} from "./contracts.mjs";

const booleanFields = new Set([
  "promo",
  "rookieStatus",
  "autograph",
  "memorabilia",
  "imageVariation",
]);

function validField(field) {
  return {
    value: booleanFields.has(field) ? false : "Known value",
    confidence: 0.96,
    evidenceIds: [`ev-${field}-1`],
    inferenceSource: "visible",
    missingEvidence: [],
  };
}

function validResult() {
  return {
    schemaVersion: "1.0",
    identificationId: "id-1",
    status: "identified",
    fields: Object.fromEntries(fieldKeys.map((field) => [field, validField(field)])),
    evidence: fieldKeys.map((field) => ({
      id: `ev-${field}-1`,
      field,
      source: "front_image",
      observation: `Visible ${field}`,
      location: null,
      strength: 0.96,
    })),
    missingEvidence: [],
    candidateMatches: [],
    overallConfidence: 0.96,
    decision: {
      action: "auto_accept",
      reviewRequired: false,
      reviewRequirement: "none",
      reasons: ["Strong evidence"],
      blockers: [],
    },
    backPhoto: {
      provided: false,
      suggested: false,
      expectedConfidenceGain: 0,
      reason: null,
    },
    summary: "Identified from visible evidence.",
    pipeline: {
      model: "test-model",
      totalDurationMs: 6,
      stages: [
        "image_intake",
        "evidence_extraction",
        "semantic_normalization",
        "candidate_generation",
        "verification",
        "confidence_scoring",
        "overall_decision",
      ].map((name) => ({ name, status: "completed", durationMs: 1 })),
    },
    createdAt: "2026-08-01T12:00:00.000Z",
  };
}

test("the versioned identification result validates", () => {
  assert.equal(CardIdentificationResultSchema.safeParse(validResult()).success, true);
});

test("pipeline metadata includes total elapsed time", () => {
  const parsed = CardIdentificationResultSchema.parse(validResult());
  assert.equal(parsed.pipeline.totalDurationMs, 6);
});

test("result validation rejects missing fields and invalid confidence", () => {
  const missingField = validResult();
  delete missingField.fields.parallel;
  assert.equal(CardIdentificationResultSchema.safeParse(missingField).success, false);

  const invalidConfidence = validResult();
  invalidConfidence.overallConfidence = 1.01;
  assert.equal(
    CardIdentificationResultSchema.safeParse(invalidConfidence).success,
    false,
  );
});

test("result validation rejects unknown top-level properties", () => {
  const result = { ...validResult(), unexpected: true };
  assert.equal(CardIdentificationResultSchema.safeParse(result).success, false);
});

test("correction submissions retain original values and confidence", () => {
  const submission = {
    identificationId: "id-1",
    schemaVersion: "1.0",
    corrections: [
      {
        field: "parallel",
        originalValue: "Base",
        originalConfidence: 0.62,
        correctedValue: "RayWave",
      },
    ],
    metadata: {
      overallConfidence: 0.84,
      decision: "confirm",
      backPhotoProvided: false,
      source: "editable_confirmation",
    },
  };

  assert.equal(CorrectionSubmissionSchema.safeParse(submission).success, true);
  assert.equal(
    CorrectionSubmissionSchema.safeParse({ ...submission, corrections: [] }).success,
    false,
  );
  assert.equal(
    CorrectionSubmissionSchema.safeParse({
      ...submission,
      corrections: [
        {
          field: "autograph",
          originalValue: false,
          originalConfidence: 0.8,
          correctedValue: "yes",
        },
      ],
    }).success,
    false,
  );
});
