import assert from "node:assert/strict";
import test from "node:test";
import { CachedEvidenceEngine } from "./evidence-cache.mjs";

const intake = { frontImage: "data:image/jpeg;base64,Y2FyZA==", backImage: null, frontDetailImages: [], backDetailImages: [] };

test("evidence cache reuses identical image extraction without retaining images as keys", async () => {
  let calls = 0;
  const cache = new CachedEvidenceEngine({
    engine: { modelFor: () => "fast", extract: async () => ({ call: ++calls }) },
  });
  assert.deepEqual(await cache.extract(intake), { call: 1 });
  assert.deepEqual(await cache.extract(intake), { call: 1 });
  assert.equal(calls, 1);
  assert.equal([...cache.cache.keys()][0].includes("data:image"), false);
});

test("evidence cache coalesces simultaneous identical requests", async () => {
  let calls = 0;
  const cache = new CachedEvidenceEngine({
    engine: { modelFor: () => "fast", extract: async () => { calls += 1; return { ok: true }; } },
  });
  await Promise.all([cache.extract(intake), cache.extract(intake)]);
  assert.equal(calls, 1);
});

test("evidence cache treats a different back detail crop as new evidence", async () => {
  let calls = 0;
  const cache = new CachedEvidenceEngine({
    engine: { modelFor: () => "accurate", extract: async () => ({ call: ++calls }) },
  });
  const withBack = {
    ...intake,
    backImage: "data:image/jpeg;base64,YmFjaw==",
    backDetailImages: [{ label: "lower detail band", image: "data:image/jpeg;base64,eWVhcg==" }],
  };
  assert.deepEqual(await cache.extract(withBack), { call: 1 });
  assert.deepEqual(await cache.extract({
    ...withBack,
    backDetailImages: [{ label: "lower detail band", image: "data:image/jpeg;base64,bmV3LXllYXI=" }],
  }), { call: 2 });
});
