import { z } from "zod";

export const DEFAULT_ACCOUNT_PREFERENCES = Object.freeze({
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
});

export const AccountPreferencesSchema = z
  .object({
    automationMode: z.enum(["preview", "autopilot"]),
    autopilotMinConfidence: z.number().min(0.8).max(1),
    autopilotApprovalAboveCents: z.number().int().min(1).max(100_000_000).nullable(),
    autopilotMinimumPriceCents: z.number().int().min(1).max(100_000_000),
    autoRepriceEnabled: z.boolean(),
    autoRepriceAfterDays: z.number().int().min(1).max(365),
    autoRepriceFloorPercent: z.number().int().min(50).max(100),
    autoListingOptimizationEnabled: z.boolean(),
    exactPriceUndercutCents: z.number().int().min(1).max(500),
    listingLowImpressionDays: z.number().int().min(1).max(90),
    listingLowImpressionCount: z.number().int().min(0).max(100_000),
    listingCtrMinimumImpressions: z.number().int().min(1).max(100_000),
    listingLowCtrPercent: z.number().min(0.1).max(25),
    listingViewsWithoutWatchers: z.number().int().min(1).max(100_000),
    autoValueEnabled: z.boolean(),
    autoValueMaxCents: z.number().int().min(1).max(100_000_000).nullable(),
    ebayConnectPromptDismissed: z.boolean(),
    ebaySellingDefaults: z.object({
      merchantLocationKey: z.string().max(50),
      fulfillmentPolicyId: z.string().max(64),
      paymentPolicyId: z.string().max(64),
      returnPolicyId: z.string().max(64),
      pricingStrategy: z.enum(["sell_faster", "balanced", "maximize_value"]),
      sellFasterBelowCents: z.number().int().min(1).max(100_000_000).nullable(),
      promoteListings: z.boolean(),
      promotionAdRatePercent: z.number().int().min(1).max(50),
    }).strict(),
  })
  .strict()
  .refine(
    (value) => !value.autoValueEnabled || value.autoValueMaxCents !== null,
    { message: "An automatic-value limit is required when the rule is enabled." },
  );

function databaseError(operation, error) {
  const wrapped = new Error(`Supabase ${operation} failed.`);
  wrapped.cause = error;
  return wrapped;
}

function sellingDefaultsFromData(data) {
  const {
    automationMode: _automationMode,
    autopilotMinConfidence: _autopilotMinConfidence,
    autopilotApprovalAboveCents: _autopilotApprovalAboveCents,
    autopilotMinimumPriceCents: _autopilotMinimumPriceCents,
    autoRepriceEnabled: _autoRepriceEnabled,
    autoRepriceAfterDays: _autoRepriceAfterDays,
    autoRepriceFloorPercent: _autoRepriceFloorPercent,
    autoListingOptimizationEnabled: _autoListingOptimizationEnabled,
    exactPriceUndercutCents: _exactPriceUndercutCents,
    listingLowImpressionDays: _listingLowImpressionDays,
    listingLowImpressionCount: _listingLowImpressionCount,
    listingCtrMinimumImpressions: _listingCtrMinimumImpressions,
    listingLowCtrPercent: _listingLowCtrPercent,
    listingViewsWithoutWatchers: _listingViewsWithoutWatchers,
    ...sellingDefaults
  } = data ?? {};
  return { ...DEFAULT_ACCOUNT_PREFERENCES.ebaySellingDefaults, ...sellingDefaults };
}

export class SupabaseAccountPreferencesRepository {
  constructor({ client }) {
    this.client = client;
  }

  async get(userId) {
    const { data, error } = await this.client
      .from("account_preferences")
      .select("auto_value_enabled, auto_value_max_cents, ebay_connect_prompt_dismissed, ebay_selling_defaults")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw databaseError("account preferences read", error);
    if (!data) return { ...DEFAULT_ACCOUNT_PREFERENCES };
    return {
      automationMode: data.ebay_selling_defaults?.automationMode ?? DEFAULT_ACCOUNT_PREFERENCES.automationMode,
      autopilotMinConfidence: Number(data.ebay_selling_defaults?.autopilotMinConfidence ?? DEFAULT_ACCOUNT_PREFERENCES.autopilotMinConfidence),
      autopilotApprovalAboveCents: data.ebay_selling_defaults?.autopilotApprovalAboveCents ?? DEFAULT_ACCOUNT_PREFERENCES.autopilotApprovalAboveCents,
      autopilotMinimumPriceCents: Number(data.ebay_selling_defaults?.autopilotMinimumPriceCents ?? DEFAULT_ACCOUNT_PREFERENCES.autopilotMinimumPriceCents),
      autoRepriceEnabled: data.ebay_selling_defaults?.autoRepriceEnabled ?? DEFAULT_ACCOUNT_PREFERENCES.autoRepriceEnabled,
      autoRepriceAfterDays: Number(data.ebay_selling_defaults?.autoRepriceAfterDays ?? DEFAULT_ACCOUNT_PREFERENCES.autoRepriceAfterDays),
      autoRepriceFloorPercent: Number(data.ebay_selling_defaults?.autoRepriceFloorPercent ?? DEFAULT_ACCOUNT_PREFERENCES.autoRepriceFloorPercent),
      autoListingOptimizationEnabled: data.ebay_selling_defaults?.autoListingOptimizationEnabled ?? DEFAULT_ACCOUNT_PREFERENCES.autoListingOptimizationEnabled,
      exactPriceUndercutCents: Number(data.ebay_selling_defaults?.exactPriceUndercutCents ?? DEFAULT_ACCOUNT_PREFERENCES.exactPriceUndercutCents),
      listingLowImpressionDays: Number(data.ebay_selling_defaults?.listingLowImpressionDays ?? DEFAULT_ACCOUNT_PREFERENCES.listingLowImpressionDays),
      listingLowImpressionCount: Number(data.ebay_selling_defaults?.listingLowImpressionCount ?? DEFAULT_ACCOUNT_PREFERENCES.listingLowImpressionCount),
      listingCtrMinimumImpressions: Number(data.ebay_selling_defaults?.listingCtrMinimumImpressions ?? DEFAULT_ACCOUNT_PREFERENCES.listingCtrMinimumImpressions),
      listingLowCtrPercent: Number(data.ebay_selling_defaults?.listingLowCtrPercent ?? DEFAULT_ACCOUNT_PREFERENCES.listingLowCtrPercent),
      listingViewsWithoutWatchers: Number(data.ebay_selling_defaults?.listingViewsWithoutWatchers ?? DEFAULT_ACCOUNT_PREFERENCES.listingViewsWithoutWatchers),
      autoValueEnabled: data.auto_value_enabled === true,
      autoValueMaxCents:
        data.auto_value_max_cents === null
          ? null
          : Number(data.auto_value_max_cents),
      ebayConnectPromptDismissed: data.ebay_connect_prompt_dismissed === true,
      ebaySellingDefaults: sellingDefaultsFromData(data.ebay_selling_defaults),
    };
  }

  async update(userId, input) {
    const preferences = AccountPreferencesSchema.parse(input);
    const { data, error } = await this.client
      .from("account_preferences")
      .upsert(
        {
          user_id: userId,
          auto_value_enabled: preferences.autoValueEnabled,
          auto_value_max_cents: preferences.autoValueMaxCents,
          ebay_connect_prompt_dismissed: preferences.ebayConnectPromptDismissed,
          ebay_selling_defaults: {
            ...preferences.ebaySellingDefaults,
            automationMode: preferences.automationMode,
            autopilotMinConfidence: preferences.autopilotMinConfidence,
            autopilotApprovalAboveCents: preferences.autopilotApprovalAboveCents,
            autopilotMinimumPriceCents: preferences.autopilotMinimumPriceCents,
            autoRepriceEnabled: preferences.autoRepriceEnabled,
            autoRepriceAfterDays: preferences.autoRepriceAfterDays,
            autoRepriceFloorPercent: preferences.autoRepriceFloorPercent,
            autoListingOptimizationEnabled: preferences.autoListingOptimizationEnabled,
            exactPriceUndercutCents: preferences.exactPriceUndercutCents,
            listingLowImpressionDays: preferences.listingLowImpressionDays,
            listingLowImpressionCount: preferences.listingLowImpressionCount,
            listingCtrMinimumImpressions: preferences.listingCtrMinimumImpressions,
            listingLowCtrPercent: preferences.listingLowCtrPercent,
            listingViewsWithoutWatchers: preferences.listingViewsWithoutWatchers,
          },
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      )
      .select("auto_value_enabled, auto_value_max_cents, ebay_connect_prompt_dismissed, ebay_selling_defaults")
      .single();
    if (error) throw databaseError("account preferences update", error);
    return {
      automationMode: data.ebay_selling_defaults?.automationMode ?? DEFAULT_ACCOUNT_PREFERENCES.automationMode,
      autopilotMinConfidence: Number(data.ebay_selling_defaults?.autopilotMinConfidence ?? DEFAULT_ACCOUNT_PREFERENCES.autopilotMinConfidence),
      autopilotApprovalAboveCents: data.ebay_selling_defaults?.autopilotApprovalAboveCents ?? DEFAULT_ACCOUNT_PREFERENCES.autopilotApprovalAboveCents,
      autopilotMinimumPriceCents: Number(data.ebay_selling_defaults?.autopilotMinimumPriceCents ?? DEFAULT_ACCOUNT_PREFERENCES.autopilotMinimumPriceCents),
      autoRepriceEnabled: data.ebay_selling_defaults?.autoRepriceEnabled ?? DEFAULT_ACCOUNT_PREFERENCES.autoRepriceEnabled,
      autoRepriceAfterDays: Number(data.ebay_selling_defaults?.autoRepriceAfterDays ?? DEFAULT_ACCOUNT_PREFERENCES.autoRepriceAfterDays),
      autoRepriceFloorPercent: Number(data.ebay_selling_defaults?.autoRepriceFloorPercent ?? DEFAULT_ACCOUNT_PREFERENCES.autoRepriceFloorPercent),
      autoListingOptimizationEnabled: data.ebay_selling_defaults?.autoListingOptimizationEnabled ?? DEFAULT_ACCOUNT_PREFERENCES.autoListingOptimizationEnabled,
      exactPriceUndercutCents: Number(data.ebay_selling_defaults?.exactPriceUndercutCents ?? DEFAULT_ACCOUNT_PREFERENCES.exactPriceUndercutCents),
      listingLowImpressionDays: Number(data.ebay_selling_defaults?.listingLowImpressionDays ?? DEFAULT_ACCOUNT_PREFERENCES.listingLowImpressionDays),
      listingLowImpressionCount: Number(data.ebay_selling_defaults?.listingLowImpressionCount ?? DEFAULT_ACCOUNT_PREFERENCES.listingLowImpressionCount),
      listingCtrMinimumImpressions: Number(data.ebay_selling_defaults?.listingCtrMinimumImpressions ?? DEFAULT_ACCOUNT_PREFERENCES.listingCtrMinimumImpressions),
      listingLowCtrPercent: Number(data.ebay_selling_defaults?.listingLowCtrPercent ?? DEFAULT_ACCOUNT_PREFERENCES.listingLowCtrPercent),
      listingViewsWithoutWatchers: Number(data.ebay_selling_defaults?.listingViewsWithoutWatchers ?? DEFAULT_ACCOUNT_PREFERENCES.listingViewsWithoutWatchers),
      autoValueEnabled: data.auto_value_enabled === true,
      autoValueMaxCents:
        data.auto_value_max_cents === null
          ? null
          : Number(data.auto_value_max_cents),
      ebayConnectPromptDismissed: data.ebay_connect_prompt_dismissed === true,
      ebaySellingDefaults: sellingDefaultsFromData(data.ebay_selling_defaults),
    };
  }
}
