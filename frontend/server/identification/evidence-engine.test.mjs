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

test("front-only extraction uses low reasoning and a larger evidence budget", async () => {
  let request;
  const engine = new OpenAIEvidenceEngine({
    openai: {
      responses: {
        parse: async (options) => {
          request = options;
          return { output_parsed: null };
        },
      },
    },
    model: "accuracy-model",
    fastModel: "accuracy-model",
  });

  await assert.rejects(
    engine.extract({
      frontImage: "data:image/jpeg;base64,front",
      backImage: null,
      frontDetailImages: [],
      backDetailImages: [],
    }),
    /could not be read/i,
  );
  assert.deepEqual(request.reasoning, { effort: "low" });
  assert.equal(request.max_output_tokens, 4_000);
});
