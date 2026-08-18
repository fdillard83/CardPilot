import assert from "node:assert/strict";
import test from "node:test";
import { aggregateFieldFeedback } from "./identification-feedback.mjs";

test("field feedback reports kept, changed, rate, and original confidence", () => {
  const summary = aggregateFieldFeedback([
    { field_name: "year", was_changed: false, original_confidence: 0.9 },
    { field_name: "year", was_changed: true, original_confidence: 0.6 },
    { field_name: "parallel", was_changed: true, original_confidence: 0.4 },
  ]);
  assert.deepEqual(summary[0], {
    field: "parallel",
    reviewed: 1,
    kept: 0,
    changed: 1,
    changeRate: 1,
    averageOriginalConfidence: 0.4,
  });
  assert.deepEqual(summary[1], {
    field: "year",
    reviewed: 2,
    kept: 1,
    changed: 1,
    changeRate: 0.5,
    averageOriginalConfidence: 0.75,
  });
});
