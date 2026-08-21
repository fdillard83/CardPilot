import assert from "node:assert/strict";
import test from "node:test";
import {
  AccountPreferencesSchema,
  DEFAULT_ACCOUNT_PREFERENCES,
} from "./account-preferences.mjs";

test("automatic card values are off by default", () => {
  assert.deepEqual(DEFAULT_ACCOUNT_PREFERENCES, {
    automationMode: "preview",
    autopilotMinConfidence: 0.95,
    autopilotApprovalAboveCents: null,
    autopilotMinimumPriceCents: 99,
    autoRepriceEnabled: false,
    autoRepriceAfterDays: 14,
    autoRepriceFloorPercent: 90,
    autoListingOptimizationEnabled: false,
    exactPriceUndercutCents: 5,
    listingLowImpressionDays: 7,
    listingLowImpressionCount: 25,
    listingCtrMinimumImpressions: 100,
    listingLowCtrPercent: 1,
    listingViewsWithoutWatchers: 10,
    autoValueEnabled: false,
    autoValueMaxCents: null,
    ebayConnectPromptDismissed: false,
    ebaySellingDefaults: {
      merchantLocationKey: "",
      fulfillmentPolicyId: "",
      paymentPolicyId: "",
      returnPolicyId: "",
      pricingStrategy: "balanced",
      sellFasterBelowCents: null,
      promoteListings: false,
      promotionAdRatePercent: 2,
    },
  });
});

test("an enabled automatic-value rule requires a positive dollar limit", () => {
  assert.equal(
    AccountPreferencesSchema.safeParse({
      ...DEFAULT_ACCOUNT_PREFERENCES,
      autoValueEnabled: true,
      autoValueMaxCents: null,
    }).success,
    false,
  );
  assert.deepEqual(
    AccountPreferencesSchema.parse({
      ...DEFAULT_ACCOUNT_PREFERENCES,
      autoValueEnabled: true,
      autoValueMaxCents: 2500,
    }),
    { ...DEFAULT_ACCOUNT_PREFERENCES, autoValueEnabled: true, autoValueMaxCents: 2500 },
  );
});
