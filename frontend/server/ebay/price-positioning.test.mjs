import assert from "node:assert/strict";
import test from "node:test";
import { deliveredPricePosition, fulfillmentBuyerShippingCents, fulfillmentShippingService } from "./price-positioning.mjs";

const listing = (overrides = {}) => ({
  itemId: "competitor-1",
  title: "Exact card",
  itemWebUrl: "https://www.ebay.com/itm/competitor-1",
  itemPriceCents: 195,
  shippingCostCents: 125,
  totalPriceCents: 320,
  currency: "USD",
  confirmedReference: false,
  visualMatchStatus: "matched",
  ...overrides,
});

test("delivered positioning undercuts the competitor after accounting for buyer shipping", () => {
  const result = deliveredPricePosition({
    snapshot: { groups: [{ matchTier: "exact", classification: "raw", label: "Raw / ungraded", confidence: "low", listings: [listing()] }] },
    grading: { isGraded: false },
    ownListingId: "mine",
    currentItemPriceCents: 350,
    ownShippingCostCents: 75,
    minimumPriceCents: 99,
    undercutCents: 5,
  });
  assert.equal(result.currentDeliveredPriceCents, 425);
  assert.equal(result.proposedItemPriceCents, 240);
  assert.equal(result.proposedDeliveredPriceCents, 315);
  assert.equal(result.safeToReprice, true);
});

test("price positioning excludes the seller's own listing and respects the account floor", () => {
  const result = deliveredPricePosition({
    snapshot: { groups: [{ matchTier: "exact", classification: "raw", label: "Raw / ungraded", confidence: "medium", listings: [
      listing({ itemId: "v1|mine|0", totalPriceCents: 100 }),
      listing({ itemId: "other", totalPriceCents: 150 }),
    ] }] },
    grading: { isGraded: false },
    ownListingId: "mine",
    currentItemPriceCents: 300,
    ownShippingCostCents: 0,
    minimumPriceCents: 199,
    undercutCents: 5,
  });
  assert.equal(result.lowestCompetitor.itemId, "other");
  assert.equal(result.proposedItemPriceCents, 199);
  assert.equal(result.limitedByMinimum, true);
});

test("shipping policies expose the amount paid by the buyer", () => {
  assert.equal(fulfillmentBuyerShippingCents({ shippingOptions: [{ optionType: "DOMESTIC", shippingServices: [{ shippingCost: { value: "1.25" } }] }] }), 125);
  assert.equal(fulfillmentBuyerShippingCents({ shippingOptions: [{ optionType: "DOMESTIC", shippingServices: [{ freeShipping: true, shippingCost: { value: "9.99" } }] }] }), 0);
});

test("shipping policies expose a supported shipping method for safe replacement", () => {
  const policy = (shippingServiceCode) => ({ shippingOptions: [{ optionType: "DOMESTIC", shippingServices: [{ shippingServiceCode }] }] });
  assert.equal(fulfillmentShippingService(policy("USPSStandardEnvelope")), "STANDARD_ENVELOPE");
  assert.equal(fulfillmentShippingService(policy("USPSPriorityMail")), "PRIORITY");
  assert.equal(fulfillmentShippingService(policy("USPSGroundAdvantage")), "GROUND");
});
