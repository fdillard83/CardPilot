import assert from "node:assert/strict";
import test from "node:test";
import { identificationInternals } from "./identification-engine.mjs";

function fields(values) {
  return Object.fromEntries(Object.entries(values).map(([field, value]) => [
    field,
    { value, confidence: value === null ? 0 : 0.5 },
  ]));
}

test("candidate-supported identity changes trigger one backward refinement pass", () => {
  const before = fields({
    player: "Nolan Ryan",
    year: null,
    product: "Topps",
    cardNumber: null,
  });
  const after = fields({
    player: "Nolan Ryan",
    year: "2026",
    product: "Topps",
    cardNumber: "CN-14",
  });

  assert.equal(
    identificationInternals.retrievalEvidenceChanged(before, after),
    true,
  );
  assert.equal(
    identificationInternals.retrievalEvidenceChanged(after, structuredClone(after)),
    false,
  );
});

test("refined candidates take precedence while preserving unique first-pass leads", () => {
  const merged = identificationInternals.mergeCandidates(
    [{ id: "same", label: "refined" }, { id: "new", label: "new" }],
    [{ id: "same", label: "initial" }, { id: "old", label: "old" }],
  );

  assert.deepEqual(merged.map((candidate) => candidate.label), [
    "refined",
    "new",
    "old",
  ]);
});
