import assert from "node:assert/strict";
import test from "node:test";
import { estimateListingEconomics, listingProfitabilityAtTargets } from "./listing-economics.mjs";

test("listing safety includes shipping, tax fee basis, promotion, and mailing", () => {
  const result = estimateListingEconomics({ itemPriceCents: 95, buyerShippingCents: 125, transactionFeePercent: 13.25,
    transactionFixedFeeCents: 30, promotionAdRatePercent: 2, mailingCostCents: 78, estimatedBuyerSalesTaxPercent: 7 });
  assert.equal(result.feeBasisCents, 235); assert.equal(result.transactionFeeCents, 61);
  assert.equal(result.promotionFeeCents, 5); assert.equal(result.netProceedsCents, 76); assert.equal(result.safe, true);
});

test("listing safety detects a below-cost sale", () => {
  assert.equal(estimateListingEconomics({ itemPriceCents: 95, buyerShippingCents: 0 }).safe, false);
});
test("market minimum profitability includes promotion and identifies unsafe strategies", () => {
  const result = listingProfitabilityAtTargets({
    draft: {
      listingFormat: "FIXED_PRICE",
      priceCents: 500,
      promoteListing: true,
      promotionAdRatePercent: 2,
    },
    preferences: {
      listingTransactionFeePercent: 13.25,
      listingTransactionFixedFeeCents: 30,
      listingMailingCostCents: 78,
      estimatedBuyerSalesTaxPercent: 7,
    },
    buyerShippingCents: 25,
    marketMinimumBuyerTotalCents: 100,
    saleStrategyOptions: {
      sell_faster: { amountCents: 100 },
      balanced: { amountCents: 200 },
      maximize_value: { amountCents: 300 },
    },
  });
  assert.equal(result.marketMinimum.itemPriceCents, 75);
  assert.equal(result.marketMinimum.promotionFeeCents, 2);
  assert.equal(result.marketMinimum.netProceedsCents, -24);
  assert.equal(result.unprofitable, true);
  assert.equal(result.strategies.sell_faster.safe, false);
  assert.equal(result.strategies.balanced.safe, true);
  assert.equal(result.strategies.maximize_value.safe, true);
});

test("buyer-paid shipping cannot reduce Sell Faster below the card floor", () => {
  const result = listingProfitabilityAtTargets({
    draft: { listingFormat: "FIXED_PRICE", priceCents: 300, promoteListing: false },
    preferences: {
      listingTransactionFeePercent: 13.25,
      listingTransactionFixedFeeCents: 30,
      listingMailingCostCents: 78,
      estimatedBuyerSalesTaxPercent: 7,
    },
    buyerShippingCents: 100,
    marketMinimumBuyerTotalCents: 250,
    saleStrategyOptions: {
      sell_faster: { amountCents: 205, minimumListingPriceCents: 195 },
      balanced: { amountCents: 250 },
      maximize_value: { amountCents: 300 },
    },
  });

  assert.equal(result.strategies.sell_faster.itemPriceCents, 195);
});
