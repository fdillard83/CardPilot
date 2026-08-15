import assert from "node:assert/strict";
import test from "node:test";
import {
  AccountPreferencesSchema,
  DEFAULT_ACCOUNT_PREFERENCES,
} from "./account-preferences.mjs";

test("automatic card values are off by default", () => {
  assert.deepEqual(DEFAULT_ACCOUNT_PREFERENCES, {
    autoValueEnabled: false,
    autoValueMaxCents: null,
    ebaySellingDefaults: {
      merchantLocationKey: "",
      fulfillmentPolicyId: "",
      paymentPolicyId: "",
      returnPolicyId: "",
    },
  });
});

test("an enabled automatic-value rule requires a positive dollar limit", () => {
  assert.equal(
    AccountPreferencesSchema.safeParse({
      autoValueEnabled: true,
      autoValueMaxCents: null,
      ebaySellingDefaults: DEFAULT_ACCOUNT_PREFERENCES.ebaySellingDefaults,
    }).success,
    false,
  );
  assert.deepEqual(
    AccountPreferencesSchema.parse({
      autoValueEnabled: true,
      autoValueMaxCents: 2500,
      ebaySellingDefaults: DEFAULT_ACCOUNT_PREFERENCES.ebaySellingDefaults,
    }),
    { autoValueEnabled: true, autoValueMaxCents: 2500, ebaySellingDefaults: DEFAULT_ACCOUNT_PREFERENCES.ebaySellingDefaults },
  );
});
