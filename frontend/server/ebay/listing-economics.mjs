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
export function listingProfitabilityAtTargets({
  draft,
  preferences,
  buyerShippingCents = 0,
  marketMinimumBuyerTotalCents,
  saleStrategyOptions = null,
}) {
  const shipping = Math.max(0, Math.round(Number(buyerShippingCents) || 0));
  const economicsAtItemPrice = (itemPriceCents) => listingEconomicsFromPreferences(
    { ...draft, priceCents: Math.max(1, Math.round(Number(itemPriceCents) || 0)) },
    preferences,
    shipping,
  );
  const marketBuyerTotal = Math.max(1, Math.round(Number(marketMinimumBuyerTotalCents) || 0));
  const marketMinimum = economicsAtItemPrice(Math.max(1, marketBuyerTotal - shipping));
  const strategies = saleStrategyOptions
    ? Object.fromEntries(Object.entries(saleStrategyOptions).map(([key, option]) => {
        const amountCents = Math.max(1, Math.round(Number(option?.amountCents) || 0));
        const itemPriceCents = key === "sell_faster"
          ? Math.max(1, amountCents - shipping)
          : amountCents;
        return [key, economicsAtItemPrice(itemPriceCents)];
      }))
    : null;
  return {
    marketMinimum: {
      ...marketMinimum,
      targetBuyerTotalCents: marketBuyerTotal,
    },
    strategies,
    unprofitable: !marketMinimum.safe,
  };
}
