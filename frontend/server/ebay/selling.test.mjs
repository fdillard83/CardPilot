import assert from "node:assert/strict";
import test from "node:test";
import {
  EbayListingDraftSchema,
  EbaySandboxSetupSchema,
  EbaySellingClient,
  decryptSellerToken,
  ebaySandboxSetupResources,
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

test("selling requests preserve useful eBay validation details", async () => {
  const client = new EbaySellingClient({
    clientId: "sandbox-id",
    clientSecret: "sandbox-secret",
    redirectUriName: "sandbox-runame",
    fetchImpl: async () => new Response(JSON.stringify({ errors: [{
      errorId: 20403,
      message: "Invalid request.",
      longMessage: "The shipping service is not valid.",
      parameters: [{ name: "shippingServiceCode", value: "Example" }],
    }] }), { status: 400, headers: { "Content-Type": "application/json" } }),
  });
  await assert.rejects(
    client.request("access-token", "/sell/account/v1/fulfillment_policy"),
    /shipping service is not valid.*shippingServiceCode: Example/,
  );
});
