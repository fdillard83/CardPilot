import assert from "node:assert/strict";
import test from "node:test";
import { assessAutopilot, autopilotRepriceCents, shouldAutomaticallySaveValuation } from "./decision.mjs";

const card = {
  decision: "auto_accept",
  overallConfidence: 0.98,
  fields: { year: "2024", player: "Example Player", setOrInsert: "Topps", cardNumber: "25" },
};
const preferences = {
  automationMode: "autopilot",
  autopilotMinConfidence: 0.95,
  autopilotApprovalAboveCents: 10_000,
  autopilotMinimumPriceCents: 99,
};
const recommendation = { amountCents: 225, confidence: "medium" };
const draft = { priceCents: 195, categoryId: "261328", merchantLocationKey: "primary", fulfillmentPolicyId: "f", paymentPolicyId: "p", returnPolicyId: "r" };

test("Autopilot prepares a verified card but requires publication confirmation", () => {
  assert.deepEqual(assessAutopilot({ card, preferences, recommendation, connection: {}, draft }), {
    status: "ready",
    publish: false,
    reason: "The listing is ready. User confirmation is required before publishing to eBay during Autopilot testing.",
  });
});

test("Autopilot sends low-confidence and impossible-to-price cards to attention", () => {
  assert.equal(assessAutopilot({ card: { ...card, overallConfidence: 0.9 }, preferences, recommendation, connection: {}, draft }).status, "needs_attention");
  assert.equal(assessAutopilot({ card, preferences, recommendation: { ...recommendation, confidence: "low" }, connection: {}, draft }).status, "needs_attention");
  assert.equal(assessAutopilot({ card: { ...card, fields: { ...card.fields, year: null } }, preferences, recommendation, connection: {}, draft }).status, "needs_attention");
});

test("Preview mode never publishes", () => {
  assert.deepEqual(assessAutopilot({ card, preferences: { ...preferences, automationMode: "preview" }, recommendation, connection: {}, draft }), {
    status: "preview", publish: false, reason: "Preview mode is enabled for this account.",
  });
});

test("automatic repricing follows the market without crossing owner floors", () => {
  assert.equal(autopilotRepriceCents({ currentPriceCents: 225, originalPriceCents: 225, marketFloorCents: 195, accountMinimumCents: 99, floorPercent: 90 }), 203);
  assert.equal(autopilotRepriceCents({ currentPriceCents: 195, originalPriceCents: 225, marketFloorCents: 250, accountMinimumCents: 99, floorPercent: 90 }), null);
  assert.equal(autopilotRepriceCents({ currentPriceCents: 225, originalPriceCents: 225, marketFloorCents: 150, accountMinimumCents: 210, floorPercent: 80 }), 210);
});

test("automatic value limits never overwrite a collector-adjusted value", () => {
  const automaticPreferences = { autoValueEnabled: true, autoValueMaxCents: 500 };
  assert.equal(shouldAutomaticallySaveValuation({ card, preferences: automaticPreferences, recommendation: { amountCents: 225 } }), true);
  assert.equal(shouldAutomaticallySaveValuation({ card: { ...card, confirmedValuation: { userAdjusted: true } }, preferences: automaticPreferences, recommendation: { amountCents: 225 } }), false);
  assert.equal(shouldAutomaticallySaveValuation({ card, preferences: automaticPreferences, recommendation: { amountCents: 600 } }), false);
});
