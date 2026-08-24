function nonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

export function estimateListingEconomics({ itemPriceCents, buyerShippingCents = 0,
  transactionFeePercent = 13.25, transactionFixedFeeCents = 30,
  promotionAdRatePercent = 0, mailingCostCents = 78,
  estimatedBuyerSalesTaxPercent = 7 }) {
  const item = Math.round(nonNegative(itemPriceCents));
  const shipping = Math.round(nonNegative(buyerShippingCents));
  const subtotal = item + shipping;
  const estimatedBuyerSalesTaxCents = Math.round(subtotal * nonNegative(estimatedBuyerSalesTaxPercent) / 100);
  const feeBasisCents = subtotal + estimatedBuyerSalesTaxCents;
  const transactionFeeCents = Math.round(feeBasisCents * nonNegative(transactionFeePercent) / 100) + Math.round(nonNegative(transactionFixedFeeCents));
  const promotionFeeCents = Math.round(feeBasisCents * nonNegative(promotionAdRatePercent) / 100);
  const fulfillmentCostCents = Math.round(nonNegative(mailingCostCents));
  const netProceedsCents = subtotal - transactionFeeCents - promotionFeeCents - fulfillmentCostCents;
  return { itemPriceCents: item, buyerShippingCents: shipping, subtotalCents: subtotal,
    estimatedBuyerSalesTaxCents, feeBasisCents, transactionFeeCents, promotionFeeCents,
    mailingCostCents: fulfillmentCostCents, netProceedsCents, safe: netProceedsCents >= 0 };
}

export function listingEconomicsFromPreferences(draft, preferences, buyerShippingCents = 0) {
  return estimateListingEconomics({ itemPriceCents: draft.listingFormat === "AUCTION" ? draft.auctionStartPriceCents : draft.priceCents,
    buyerShippingCents, transactionFeePercent: preferences.listingTransactionFeePercent,
    transactionFixedFeeCents: preferences.listingTransactionFixedFeeCents,
    promotionAdRatePercent: draft.promoteListing ? draft.promotionAdRatePercent : 0,
    mailingCostCents: preferences.listingMailingCostCents,
    estimatedBuyerSalesTaxPercent: preferences.estimatedBuyerSalesTaxPercent });
}
