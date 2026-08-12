import test from "node:test";
import assert from "node:assert/strict";
import {
  EbayImageSearchClient,
  suggestedCardNumberFromTitle,
  suggestedParallelFromTitle,
  suggestedSerialNumberFromTitle,
  suggestedYearFromTitle,
} from "./image-search.mjs";

function jsonResponse(payload, init = {}) {
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

test("image search sends only Base64 image data and normalizes candidates", async () => {
  let request;
  const oauthClient = {
    async getAccessToken() {
      return "application-token";
    },
    invalidate() {
      throw new Error("The successful request should not invalidate its token.");
    },
  };
  const client = new EbayImageSearchClient({
    oauthClient,
    marketplaceId: "EBAY_US",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return jsonResponse({
        total: 1,
        itemSummaries: [
          {
            itemId: "v1|123|0",
            title: "2026 Topps Baseball Card",
            itemWebUrl: "https://www.ebay.com/itm/123",
            image: { imageUrl: "https://i.ebayimg.com/example.jpg" },
            price: { value: "9.99", currency: "USD" },
            condition: "Ungraded",
            conditionId: "4000",
            buyingOptions: ["FIXED_PRICE"],
            categories: [
              { categoryId: "212", categoryName: "Sports Trading Cards" },
            ],
          },
        ],
      });
    },
  });

  const result = await client.searchByImage({
    imageDataUrl: "data:image/jpeg;base64,Zm9v\r\n",
    limit: 5,
  });

  assert.equal(request.url.searchParams.get("limit"), "5");
  assert.equal(request.options.headers.Authorization, "Bearer application-token");
  assert.equal(request.options.headers["X-EBAY-C-MARKETPLACE-ID"], "EBAY_US");
  assert.deepEqual(JSON.parse(request.options.body), { image: "Zm9v" });
  assert.equal(result.marketplaceId, "EBAY_US");
  assert.equal(result.total, 1);
  assert.deepEqual(result.candidates[0], {
    id: "ebay-v1|123|0",
    source: "ebay_browse",
    rank: 1,
    itemId: "v1|123|0",
    title: "2026 Topps Baseball Card",
    itemWebUrl: "https://www.ebay.com/itm/123",
    imageUrl: "https://i.ebayimg.com/example.jpg",
    price: { value: "9.99", currency: "USD" },
    shippingCost: null,
    condition: "Ungraded",
    conditionId: "4000",
    buyingOptions: ["FIXED_PRICE"],
    categories: [
      { categoryId: "212", categoryName: "Sports Trading Cards" },
    ],
  });
});

test("keyword search requests fixed-price sports cards and keeps shipping separate", async () => {
  let request;
  const client = new EbayImageSearchClient({
    oauthClient: {
      async getAccessToken() {
        return "application-token";
      },
      invalidate() {},
    },
    marketplaceId: "EBAY_US",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return jsonResponse({
        total: 2,
        itemSummaries: [
          {
            itemId: "v1|123|0",
            title: "2026 Topps Nolan Ryan Green Foil #CN-14 /85",
            itemWebUrl: "https://www.ebay.com/itm/123",
            image: { imageUrl: "https://i.ebayimg.com/123.jpg" },
            price: { value: "40.00", currency: "USD" },
            shippingOptions: [
              { shippingCost: { value: "4.50", currency: "USD" } },
            ],
            buyingOptions: ["FIXED_PRICE"],
          },
          {
            itemId: "v1|456|0",
            title: "Auction result must be ignored",
            price: { value: "1.00", currency: "USD" },
            buyingOptions: ["AUCTION"],
          },
        ],
      });
    },
  });

  const result = await client.searchByKeywords({
    query: "2026 Nolan Ryan CN-14 Green Foil /85",
  });

  assert.equal(request.options.method, "GET");
  assert.equal(
    request.url.searchParams.get("q"),
    "2026 Nolan Ryan CN-14 Green Foil /85",
  );
  assert.equal(request.url.searchParams.get("category_ids"), "212");
  assert.equal(
    request.url.searchParams.get("filter"),
    "buyingOptions:{FIXED_PRICE}",
  );
  assert.equal(result.candidates.length, 1);
  assert.deepEqual(result.candidates[0].shippingCost, {
    value: "4.50",
    currency: "USD",
  });
});

test("a rejected Browse token is refreshed and retried once", async () => {
  const tokenOptions = [];
  const invalidatedTokens = [];
  const authorizationHeaders = [];
  const oauthClient = {
    async getAccessToken(options = {}) {
      tokenOptions.push(options);
      return tokenOptions.length === 1 ? "expired-token" : "refreshed-token";
    },
    invalidate(token) {
      invalidatedTokens.push(token);
    },
  };
  const client = new EbayImageSearchClient({
    oauthClient,
    fetchImpl: async (_url, options) => {
      authorizationHeaders.push(options.headers.Authorization);
      return authorizationHeaders.length === 1
        ? jsonResponse({ errors: [{ errorId: 1001 }] }, { status: 401 })
        : jsonResponse({ total: 0, itemSummaries: [] });
    },
  });

  const result = await client.searchByImage({
    imageDataUrl: "data:image/png;base64,Zm9v",
  });

  assert.deepEqual(authorizationHeaders, [
    "Bearer expired-token",
    "Bearer refreshed-token",
  ]);
  assert.deepEqual(invalidatedTokens, ["expired-token"]);
  assert.deepEqual(tokenOptions, [{}, {}]);
  assert.deepEqual(result.candidates, []);
});

test("selected listing details expose seller aspects as optional suggestions", async () => {
  let requestUrl;
  const client = new EbayImageSearchClient({
    oauthClient: {
      async getAccessToken() {
        return "application-token";
      },
      invalidate() {},
    },
    fetchImpl: async (url) => {
      requestUrl = url;
      return jsonResponse({
        itemId: "v1|123|0",
        title: "2026 Topps Nolan Ryan Green Crackle Foil #91B2-36",
        itemWebUrl: "https://www.ebay.com/itm/123",
        image: { imageUrl: "https://i.ebayimg.com/example.jpg" },
        localizedAspects: [
          { localizedName: "Card Number", localizedValues: ["91B2-36"] },
          {
            localizedName: "Parallel/Variety",
            localizedValues: ["Green Crackle Foil"],
          },
          { localizedName: "Print Run", localizedValues: ["99"] },
          { localizedName: "Player/Athlete", localizedValues: ["Nolan Ryan"] },
        ],
      });
    },
  });

  const item = await client.getItemDetails("v1|123|0");

  assert.match(String(requestUrl), /v1%7C123%7C0$/);
  assert.deepEqual(item.suggestions, {
    year: "2026",
    cardNumber: "91B2-36",
    parallel: "Green Crackle Foil",
    serialNumber: "/99",
  });
  assert.deepEqual(item.aspects[3], {
    name: "Player/Athlete",
    values: ["Nolan Ryan"],
  });
});

test("conservative title parsing suggests reviewable card details", () => {
  assert.equal(
    suggestedCardNumberFromTitle(
      "Topps 75 Years Nolan Ryan Crackle Foil Insert 91B2-36",
    ),
    "91B2-36",
  );
  assert.equal(
    suggestedCardNumberFromTitle("2026 Topps Nolan Ryan #91B2-36"),
    "91B2-36",
  );
  assert.equal(
    suggestedParallelFromTitle(
      "2026 Topps Nolan Ryan Green Crackle Foil /99",
    ),
    "Green Crackle Foil",
  );
  assert.equal(
    suggestedYearFromTitle("2026 Topps Nolan Ryan 1991 Design"),
    "2026",
  );
  assert.equal(
    suggestedSerialNumberFromTitle(
      "2026 Topps Nolan Ryan Green Crackle Foil /99",
    ),
    "/99",
  );
  assert.equal(
    suggestedSerialNumberFromTitle("2026 Topps Nolan Ryan Gold 05/25"),
    "/25",
  );
  assert.equal(
    suggestedSerialNumberFromTitle("2025/26 Topps Basketball Base Card"),
    null,
  );
  assert.equal(suggestedCardNumberFromTitle("2026 Topps Nolan Ryan"), null);
  assert.equal(suggestedParallelFromTitle("2026 Topps Nolan Ryan Base"), null);
  assert.equal(suggestedSerialNumberFromTitle("2026 Topps #91B2-36"), null);
});
