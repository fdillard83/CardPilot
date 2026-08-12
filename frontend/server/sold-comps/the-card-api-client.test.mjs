import test from "node:test";
import assert from "node:assert/strict";
import {
  TheCardApiClient,
  TheCardApiError,
} from "./the-card-api-client.mjs";

test("The Card API client keeps its key in the server-side header", async () => {
  let request;
  const client = new TheCardApiClient({
    apiKey: "private-test-key",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            data: [
              {
                id: "sale-1",
                platform: "eBay",
                listing_type: "best_offer",
                title: "2025 Topps Example Card",
                price: "42.50",
                original_price: "50.00",
                currency: "USD",
                price_confirmed: true,
                image_url: "https://example.com/card.jpg",
                listing_url: "https://example.com/sale",
              },
            ],
            pagination: { total: 1, has_more: false, next_cursor: null },
            meta: {
              coverage_date_from: "2026-07-01",
              coverage_date_to: "2026-08-12",
              platforms_covered: ["eBay"],
            },
          };
        },
      };
    },
  });

  const result = await client.searchSales({
    query: "2025 Topps Example",
    graded: false,
    limit: 25,
  });

  assert.equal(request.options.headers["x-market-api-key"], "private-test-key");
  assert.doesNotMatch(request.url.toString(), /private-test-key/);
  assert.equal(request.url.searchParams.get("graded"), "false");
  assert.equal(request.url.searchParams.get("limit"), "25");
  assert.equal(result.sales[0].listingType, "best_offer");
  assert.equal(result.sales[0].price, 42.5);
  assert.equal(result.sales[0].priceConfirmed, true);
  assert.deepEqual(result.coverage.platforms, ["eBay"]);
});

test("The Card API client reports provider errors without revealing the key", async () => {
  const client = new TheCardApiClient({
    apiKey: "never-log-this-key",
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      async json() {
        return { error: "invalid_api_key" };
      },
    }),
  });

  await assert.rejects(
    () => client.searchSales({ query: "Nolan Ryan" }),
    (error) => {
      assert.ok(error instanceof TheCardApiError);
      assert.equal(error.status, 401);
      assert.equal(error.code, "invalid_api_key");
      assert.doesNotMatch(error.message, /never-log-this-key/);
      return true;
    },
  );
});
