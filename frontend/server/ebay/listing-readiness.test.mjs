import assert from "node:assert/strict";
import test from "node:test";
import { listingReadiness, mappedEbayAspects, sanitizeEbayAspects } from "./listing-readiness.mjs";

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

test("basketball seasons become a valid four-digit eBay manufactured year", () => {
  const basketball = {
    ...card,
    fields: { ...card.fields, sport: "Basketball", year: "2024-25" },
  };
  const yearDefinitions = [
    { name: "Year Manufactured", required: true, multiValue: false, values: [], selectionOnly: false },
    { name: "Season", required: false, multiValue: false, values: ["2024-25", "2023-24"], selectionOnly: true },
  ];
  assert.deepEqual(mappedEbayAspects(basketball, yearDefinitions), {
    "Year Manufactured": ["2024"],
    Season: ["2024-25"],
  });
  assert.deepEqual(sanitizeEbayAspects({
    "Year Manufactured": ["2024-25"],
    Season: ["2024/25"],
  }, yearDefinitions), {
    "Year Manufactured": ["2024"],
    Season: ["2024-25"],
  });
});

test("unsupported selection-only eBay seasons are removed before publishing", () => {
  const definitions = [
    { name: "Season", required: true, multiValue: false, values: ["2024-25"], selectionOnly: true },
  ];
  const result = listingReadiness({ fields: {} }, {
    title: "Card", description: "Card", priceCents: 100,
    categoryId: "261328", aspects: { Season: ["2025-26"] },
    merchantLocationKey: "home", fulfillmentPolicyId: "ship", paymentPolicyId: "pay", returnPolicyId: "return",
  }, definitions);
  assert.deepEqual(result.aspects, {});
  assert.deepEqual(result.missingAspects, ["Season"]);
});
