import assert from "node:assert/strict";
import test from "node:test";
import { listingReadiness, mappedEbayAspects } from "./listing-readiness.mjs";

const card = {
  fields: { player: "Edgar Martinez", sport: "Baseball", year: "2025", cardNumber: "12", serialNumber: "7/25", autograph: true },
  grading: { isGraded: false },
  images: { frontUrl: "/front", backUrl: null },
};
const definitions = [
  { name: "Player/Athlete", required: true },
  { name: "Sport", required: true },
  { name: "Features", required: false },
  { name: "Brand", required: true },
];

test("maps confirmed CardPilot details to eBay aspect names", () => {
  assert.deepEqual(mappedEbayAspects(card, definitions), {
    "Player/Athlete": ["Edgar Martinez"], Sport: ["Baseball"], Features: ["Serial Numbered, Autograph"],
  });
});

test("reports only required missing aspects and seller prerequisites", () => {
  const result = listingReadiness(card, {
    title: "2025 Edgar Martinez Autograph /25", description: "Exact card pictured", priceCents: 5000,
    categoryId: "261328", aspects: {}, merchantLocationKey: "", fulfillmentPolicyId: "", paymentPolicyId: "", returnPolicyId: "",
  }, definitions);
  assert.deepEqual(result.missingAspects, ["Brand"]);
  assert.equal(result.checks.find((check) => check.key === "specifics").ready, false);
  assert.equal(result.checks.find((check) => check.key === "seller").ready, false);
});
