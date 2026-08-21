export type AccountPreferences = {
  automationMode: "preview" | "autopilot";
  autopilotMinConfidence: number;
  autopilotApprovalAboveCents: number | null;
  autopilotMinimumPriceCents: number;
  autoRepriceEnabled: boolean;
  autoRepriceAfterDays: number;
  autoRepriceFloorPercent: number;
  autoListingOptimizationEnabled: boolean;
  exactPriceUndercutCents: number;
  listingLowImpressionDays: number;
  listingLowImpressionCount: number;
  listingCtrMinimumImpressions: number;
  listingLowCtrPercent: number;
  listingViewsWithoutWatchers: number;
  autoValueEnabled: boolean;
  autoValueMaxCents: number | null;
  ebayConnectPromptDismissed: boolean;
  ebaySellingDefaults: {
    merchantLocationKey: string;
    fulfillmentPolicyId: string;
    paymentPolicyId: string;
    returnPolicyId: string;
    pricingStrategy: "sell_faster" | "balanced" | "maximize_value";
    sellFasterBelowCents: number | null;
    promoteListings: boolean;
    promotionAdRatePercent: number;
  };
};

export const defaultAccountPreferences: AccountPreferences = {
  automationMode: "preview",
  autopilotMinConfidence: 0.95,
  autopilotApprovalAboveCents: null,
  autopilotMinimumPriceCents: 99,
  autoRepriceEnabled: false,
  autoRepriceAfterDays: 14,
  autoRepriceFloorPercent: 90,
  autoListingOptimizationEnabled: false,
  exactPriceUndercutCents: 5,
  listingLowImpressionDays: 7,
  listingLowImpressionCount: 25,
  listingCtrMinimumImpressions: 100,
  listingLowCtrPercent: 1,
  listingViewsWithoutWatchers: 10,
  autoValueEnabled: false,
  autoValueMaxCents: null,
  ebayConnectPromptDismissed: false,
  ebaySellingDefaults: {
    merchantLocationKey: "",
    fulfillmentPolicyId: "",
    paymentPolicyId: "",
    returnPolicyId: "",
    pricingStrategy: "balanced",
    sellFasterBelowCents: null,
    promoteListings: false,
    promotionAdRatePercent: 2,
  },
};
