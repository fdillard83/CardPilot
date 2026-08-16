import assert from "node:assert/strict";
import test from "node:test";
import {
  EbayListingDraftSchema,
  EbaySandboxSetupSchema,
  EbaySellingClient,
  decryptSellerToken,
  editableEbayDraft,
  ebaySandboxSetupResources,
  ebaySellerSetupResources,
  encryptSellerToken,
} from "./selling.mjs";

test("seller refresh tokens are encrypted and authenticated", () => {
  const encrypted = encryptSellerToken("private-refresh-token", "test-only-secret");
  assert.notEqual(encrypted, "private-refresh-token");
  assert.equal(decryptSellerToken(encrypted, "test-only-secret"), "private-refresh-token");
  assert.throws(() => decryptSellerToken(encrypted, "wrong-secret"));
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
  assert.equal(resources.paymentPolicy.immediatePay, true);
  assert.equal(resources.returnPolicy.returnPeriod.value, 30);
});

test("Production seller setup uses distinct real-account resource names", () => {
  const resources = ebaySellerSetupResources({ postalCode: "27514", shippingCostCents: 499 }, "EBAY_US", "production");
  assert.equal(resources.merchantLocationKey, "cardpilot-primary");
  assert.equal(resources.location.name, "CardPilot Inventory");
  assert.equal(resources.fulfillmentPolicy.name, "CardPilot Shipping");
  assert.equal(resources.returnPolicy.name, "CardPilot Returns");
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
    /shipping service is not valid.*shippingServiceCode: Example/,
  );
  assert.equal(requestHeaders.Accept, "application/json");
  assert.equal(requestHeaders["Accept-Language"], "en-US");
  assert.equal(requestHeaders["Content-Language"], "en-US");
});
