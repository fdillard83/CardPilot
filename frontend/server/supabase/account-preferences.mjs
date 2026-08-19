import { z } from "zod";

export const DEFAULT_ACCOUNT_PREFERENCES = Object.freeze({
  automationMode: "preview",
  autopilotMinConfidence: 0.95,
  autopilotApprovalAboveCents: null,
  autopilotMinimumPriceCents: 99,
  autoRepriceEnabled: false,
  autoRepriceAfterDays: 14,
  autoRepriceFloorPercent: 90,
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
      promotionAdRatePercent: z.number().min(1).max(100),
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
