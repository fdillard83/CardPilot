import assert from "node:assert/strict";
import test from "node:test";
import { estimateListingEconomics } from "./listing-economics.mjs";

test("listing safety includes shipping, tax fee basis, promotion, and mailing", () => {
  const result = estimateListingEconomics({ itemPriceCents: 95, buyerShippingCents: 125, transactionFeePercent: 13.25,
    transactionFixedFeeCents: 30, promotionAdRatePercent: 2, mailingCostCents: 78, estimatedBuyerSalesTaxPercent: 7 });
  assert.equal(result.feeBasisCents, 235); assert.equal(result.transactionFeeCents, 61);
  assert.equal(result.promotionFeeCents, 5); assert.equal(result.netProceedsCents, 76); assert.equal(result.safe, true);
});

test("listing safety detects a below-cost sale", () => {
  assert.equal(estimateListingEconomics({ itemPriceCents: 95, buyerShippingCents: 0 }).safe, false);
});
