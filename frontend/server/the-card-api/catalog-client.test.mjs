import assert from "node:assert/strict";
import test from "node:test";
import { TheCardCatalogClient } from "./catalog-client.mjs";

test("catalog search uses the catalog header and narrow identity filters", async () => {
  let request;
  const client = new TheCardCatalogClient({
    apiKey: "private-key",
    fetchImpl: async (url, options) => {
      request = { url: new URL(url), options };
      return new Response(JSON.stringify({ data: [{ ucid: "UC-TEST-1", subject: "Edgar Martinez", set_name: "2025 Tribute", card_number: "TA-EM", print_run: 25 }], pagination: { total: 1 } }), { status: 200, headers: { "Content-Type": "application/json", "X-RateLimit-Remaining": "499" } });
    },
  });
  const result = await client.searchCards({ query: "Edgar Martinez Tribute", sport: "Baseball", year: 2025, cardNumber: "TA-EM", isAuto: true });
  assert.equal(request.options.headers["x-api-key"], "private-key");
  assert.equal(request.url.searchParams.get("card_number"), "TA-EM");
  assert.equal(request.url.searchParams.get("is_auto"), "true");
  assert.equal(result.cards[0].printRun, 25);
  assert.equal(result.rateLimit.remaining, 499);
});
