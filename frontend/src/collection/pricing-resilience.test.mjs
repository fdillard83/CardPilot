import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchJsonWithTransientRetry,
  pricingCacheContext,
  readPricingSnapshot,
  writePricingSnapshot,
} from "./pricing-resilience.ts";

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

test("pricing requests retry one transient provider failure", async () => {
  let calls = 0;
  const result = await fetchJsonWithTransientRetry(
    "/api/example",
    undefined,
    {
      retryDelayMs: 0,
      fetchImpl: async () => {
        calls += 1;
        return calls === 1
          ? jsonResponse({ error: "temporary" }, 502)
          : jsonResponse({ kind: "active_asking_snapshot" });
      },
    },
  );

  assert.equal(calls, 2);
  assert.equal(result.response.status, 200);
  assert.equal(result.attemptCount, 2);
});

test("pricing requests retry one interrupted local connection", async () => {
  let calls = 0;
  const result = await fetchJsonWithTransientRetry(
    "/api/example",
    undefined,
    {
      retryDelayMs: 0,
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) throw new TypeError("fetch failed");
        return jsonResponse({ kind: "sold_comparables" });
      },
    },
  );

  assert.equal(calls, 2);
  assert.equal(result.response.status, 200);
});

test("pricing requests do not repeat a usage-limit response", async () => {
  let calls = 0;
  const result = await fetchJsonWithTransientRetry(
    "/api/example",
    undefined,
    {
      retryDelayMs: 0,
      fetchImpl: async () => {
        calls += 1;
        return jsonResponse({ error: "limit" }, 429);
      },
    },
  );

  assert.equal(calls, 1);
  assert.equal(result.response.status, 429);
});

test("the Charmander pricing snapshot survives a page refresh in session storage", () => {
  const storage = memoryStorage();
  const context = pricingCacheContext([], []);
  const snapshot = {
    schemaVersion: "1.0",
    kind: "card_valuation_recommendation",
    generatedAt: "2026-08-14T15:52:31.259Z",
    recommendation: { amountCents: 4695, currency: "USD" },
  };

  writePricingSnapshot(
    "valuation",
    "charmander-038",
    context,
    snapshot,
    storage,
  );
  const cached = readPricingSnapshot(
    "valuation",
    "charmander-038",
    context,
    storage,
  );

  assert.deepEqual(cached?.snapshot, snapshot);
});

test("pricing cache contexts are stable regardless of exclusion order", () => {
  assert.equal(
    pricingCacheContext(["b", "a"], ["d", "c"]),
    pricingCacheContext(["a", "b"], ["c", "d"]),
  );
});
