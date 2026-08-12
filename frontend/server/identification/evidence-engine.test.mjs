import test from "node:test";
import assert from "node:assert/strict";
import { OpenAIEvidenceEngine } from "./evidence-engine.mjs";

test("front-only scans use the configured fast model", () => {
  const engine = new OpenAIEvidenceEngine({
    openai: {},
    model: "accuracy-model",
    fastModel: "fast-model",
  });

  assert.equal(engine.modelFor({ backImage: null }), "fast-model");
});

test("an optional back photo selects the accuracy model", () => {
  const engine = new OpenAIEvidenceEngine({
    openai: {},
    model: "accuracy-model",
    fastModel: "fast-model",
  });

  assert.equal(
    engine.modelFor({ backImage: "data:image/jpeg;base64,back" }),
    "accuracy-model",
  );
});
