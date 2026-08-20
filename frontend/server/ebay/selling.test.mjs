import assert from "node:assert/strict";
import test from "node:test";
import {
  EbayListingDraftSchema,
  EbaySandboxSetupSchema,
  EbaySellingClient,
  decryptSellerToken,
  duplicateOfferId,
  editableEbayDraft,
  ebaySandboxSetupResources,
  ebaySellerSetupResources,
  ebayShippingPolicyResource,
  encryptSellerToken,
  inventoryConditionForCard,
  resolvedEbaySellingScopes,
} from "./selling.mjs";

test("seller refresh tokens are encrypted and authenticated", () => {
  const encrypted = encryptSellerToken("private-refresh-token", "test-only-secret");
  assert.notEqual(encrypted, "private-refresh-token");
  assert.equal(decryptSellerToken(encrypted, "test-only-secret"), "private-refresh-token");
  assert.throws(() => decryptSellerToken(encrypted, "wrong-secret"));
  const imageReference = JSON.stringify({
    userId: "11111111-1111-4111-8111-111111111111",
    collectionId: "22222222-2222-4222-8222-222222222222",
    side: "front",
  });
  const imageToken = encryptSellerToken(imageReference, "test-only-secret");
  const imageUrl = `https://cardpilot-aizd.onrender.com/api/ebay/listing-image/${imageToken}`;
  assert.ok(imageUrl.length < 500);
  assert.equal(decryptSellerToken(imageToken, "test-only-secret"), imageReference);
});

test("sandbox seller authorization uses the configured RuName and CSRF state", () => {
  const client = new EbaySellingClient({
    clientId: "sandbox-id",
    clientSecret: "sandbox-secret",
    redirectUriName: "CardPilot-Sandbox-RuName",
  });
  const url = new URL(client.authorizationUrl("csrf-state"));
  assert.equal(url.origin, "https://auth.sandbox.ebay.com");
  assert.equal(url.searchParams.get("redirect_uri"), "CardPilot-Sandbox-RuName");
  assert.equal(url.searchParams.get("state"), "csrf-state");
  assert.match(url.searchParams.get("scope"), /sell\.inventory/);
  assert.match(url.searchParams.get("scope"), /sell\.marketing/);
  assert.match(url.searchParams.get("scope"), /sell\.analytics\.readonly/);
});

test("seller permissions survive an OAuth response that omits its scope field", () => {
  const expected = resolvedEbaySellingScopes(undefined);
  assert.match(expected, /sell\.inventory/);
  assert.match(expected, /sell\.marketing/);
  assert.match(expected, /sell\.analytics\.readonly/);
  assert.equal(resolvedEbaySellingScopes(" custom.scope "), "custom.scope");
});

test("listing drafts require an editable title and positive price", () => {
  const base = {
    title: "2025 Example Card",
    description: "Example",
    priceCents: 2500,
    currency: "USD",
    condition: "USED_EXCELLENT",
    conditionDescription: "See photos.",
    categoryId: "261328",
    aspects: {},
    merchantLocationKey: "home",
    fulfillmentPolicyId: "shipping",
    paymentPolicyId: "payment",
    returnPolicyId: "returns",
    listingFormat: "FIXED_PRICE",
  };
  assert.equal(EbayListingDraftSchema.safeParse(base).success, true);
  const promoted = EbayListingDraftSchema.parse({ ...base, promoteListing: true, promotionAdRatePercent: 3.5, pricingStrategy: "sell_faster" });
  assert.equal(promoted.promoteListing, true);
  assert.equal(promoted.promotionAdRatePercent, 3.5);
  const promotionRecorded = EbayListingDraftSchema.parse({
    ...base,
    promotion: { status: "promoted", campaignId: "campaign-1", adId: "ad-1", adRatePercent: 3.5 },
  });
  assert.equal(promotionRecorded.promotion.status, "promoted");
  assert.equal(EbayListingDraftSchema.safeParse({ ...base, priceCents: 0 }).success, false);
  const auction = EbayListingDraftSchema.parse({ ...base, listingFormat: "AUCTION", auctionStartPriceCents: 500, auctionReservePriceCents: 1000 });
  assert.deepEqual(auction.listingImages, ["front"]);
  assert.equal(auction.auctionDurationDays, 7);
  assert.equal(EbayListingDraftSchema.safeParse({ ...base, listingFormat: "AUCTION", auctionStartPriceCents: 1000, auctionReservePriceCents: 500 }).success, false);
  assert.equal(editableEbayDraft({
    ...base,
    draftId: "draft-1",
    collectionId: "card-1",
    status: "draft",
    scheduledPublishAt: null,
    desiredEndAt: null,
    scheduleStatus: "unscheduled",
    scheduleError: null,
  }).title, base.title);
});

test("Sandbox setup validates a US ZIP code and builds safe test defaults", () => {
  assert.equal(EbaySandboxSetupSchema.safeParse({ postalCode: "27514", shippingCostCents: 499 }).success, true);
  assert.equal(EbaySandboxSetupSchema.safeParse({ postalCode: "invalid", shippingCostCents: 499 }).success, false);
  const resources = ebaySandboxSetupResources({ postalCode: "27514", shippingCostCents: 499 });
  assert.equal(resources.location.location.address.postalCode, "27514");
  assert.equal(resources.fulfillmentPolicy.shippingOptions[0].shippingServices[0].shippingCost.value, "4.99");
  assert.equal(resources.fulfillmentPolicy.shippingOptions[0].shippingServices[0].shippingServiceCode, "USPSGround");
  assert.equal(resources.fulfillmentPolicy.localPickup, false);
  assert.equal(resources.paymentPolicy.immediatePay, true);
  assert.equal(resources.returnPolicy.returnPeriod.value, 30);
});

test("Production seller setup uses distinct real-account resource names", () => {
  const resources = ebaySellerSetupResources({ postalCode: "27514", shippingCostCents: 499 }, "EBAY_US", "production");
  assert.equal(resources.merchantLocationKey, "cardpilot-primary");
  assert.equal(resources.location.name, "CardPilot Inventory");
  assert.equal(resources.fulfillmentPolicy.name, "CardPilot USPS Ground Advantage");
  assert.equal(resources.returnPolicy.name, "CardPilot Returns");
});

test("custom shipping charges create clearly named reusable policies", () => {
  const paid = ebayShippingPolicyResource(399, "GROUND", "EBAY_US", "production");
  const free = ebayShippingPolicyResource(0, "GROUND", "EBAY_US", "production");
  assert.equal(paid.name, "CardPilot USPS Ground Advantage - Buyer Pays $3.99");
  assert.equal(paid.shippingOptions[0].shippingServices[0].shippingCost.value, "3.99");
  assert.equal(free.name, "CardPilot USPS Ground Advantage - Free Shipping");
  assert.equal(free.shippingOptions[0].shippingServices[0].freeShipping, true);
  const envelope = ebayShippingPolicyResource(125, "STANDARD_ENVELOPE", "EBAY_US", "production");
  assert.equal(envelope.shippingOptions[0].shippingServices[0].shippingServiceCode, "US_eBayStandardEnvelope");
  assert.equal(envelope.localPickup, false);
});

test("raw sports cards use eBay's required structured condition", () => {
  assert.deepEqual(inventoryConditionForCard({
    categoryId: "261328", isGraded: false, condition: "USED_VERY_GOOD",
  }), {
    condition: "USED_VERY_GOOD",
    conditionDescriptors: [{ name: "40001", values: ["400012"] }],
  });
  assert.throws(() => inventoryConditionForCard({
    categoryId: "261328", isGraded: true, condition: "LIKE_NEW",
  }), /grader and grade descriptors/);
});

test("raw CCG cards use the category-specific eBay condition descriptor", () => {
  const expected = {
    LIKE_NEW: "400010",
    USED_EXCELLENT: "400015",
    USED_VERY_GOOD: "400016",
    USED_ACCEPTABLE: "400017",
  };
  for (const [condition, descriptor] of Object.entries(expected)) {
    assert.deepEqual(inventoryConditionForCard({
      categoryId: "183454", isGraded: false, condition,
    }), {
      condition: "USED_VERY_GOOD",
      conditionDescriptors: [{ name: "40001", values: [descriptor] }],
    });
  }
});

test("raw sports cards map every displayed condition to eBay metadata", () => {
  const expected = {
    LIKE_NEW: "400010",
    USED_EXCELLENT: "400011",
    USED_VERY_GOOD: "400012",
    USED_ACCEPTABLE: "400013",
  };
  for (const [condition, descriptor] of Object.entries(expected)) {
    assert.deepEqual(inventoryConditionForCard({
      categoryId: "261328", isGraded: false, condition,
    }), {
      condition: "USED_VERY_GOOD",
      conditionDescriptors: [{ name: "40001", values: [descriptor] }],
    });
  }
});

test("duplicate unpublished eBay offers can be recovered by ID", () => {
  assert.equal(duplicateOfferId({ code: "25002", message: "Offer entity already exists. offerId: 237115979011" }), "237115979011");
  assert.equal(duplicateOfferId({ code: "other", message: "offerId: 237115979011" }), null);
});

test("selling requests preserve useful eBay validation details", async () => {
  let requestHeaders;
  const client = new EbaySellingClient({
    clientId: "sandbox-id",
    clientSecret: "sandbox-secret",
    redirectUriName: "sandbox-runame",
    fetchImpl: async (_url, options) => {
      requestHeaders = options.headers;
      return new Response(JSON.stringify({ errors: [{
      errorId: 20403,
      message: "Invalid request.",
      longMessage: "The shipping service is not valid.",
      parameters: [{ name: "shippingServiceCode", value: "Example" }],
      }] }), { status: 400, headers: { "Content-Type": "application/json" } });
    },
  });
  await assert.rejects(
    client.request("access-token", "/sell/account/v1/fulfillment_policy"),
    /shipping service is not valid.*shippingServiceCode: Example.*eBay error 20403/,
  );
  assert.equal(requestHeaders.Accept, "application/json");
  assert.equal(requestHeaders["Accept-Language"], "en-US");
  assert.equal(requestHeaders["Content-Language"], "en-US");
});

test("traditional seller requests use the OAuth seller token", async () => {
  let captured;
  const client = new EbaySellingClient({
    clientId: "sandbox-id",
    clientSecret: "sandbox-secret",
    redirectUriName: "sandbox-runame",
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return new Response("<GetMyeBaySellingResponse><Ack>Success</Ack></GetMyeBaySellingResponse>");
    },
  });
  await client.tradingRequest("seller-token", "GetMyeBaySelling", "<request />");
  assert.match(captured.url, /\/ws\/api\.dll$/);
  assert.equal(captured.options.headers["X-EBAY-API-IAF-TOKEN"], "seller-token");
  assert.equal(captured.options.headers["X-EBAY-API-CALL-NAME"], "GetMyeBaySelling");
});
