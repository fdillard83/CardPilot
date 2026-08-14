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
  });
});

test("an enabled automatic-value rule requires a positive dollar limit", () => {
  assert.equal(
    AccountPreferencesSchema.safeParse({
      autoValueEnabled: true,
      autoValueMaxCents: null,
    }).success,
    false,
  );
  assert.deepEqual(
    AccountPreferencesSchema.parse({
      autoValueEnabled: true,
      autoValueMaxCents: 2500,
    }),
    { autoValueEnabled: true, autoValueMaxCents: 2500 },
  );
});
