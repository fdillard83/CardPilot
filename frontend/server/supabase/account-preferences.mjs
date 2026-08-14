import { z } from "zod";

export const DEFAULT_ACCOUNT_PREFERENCES = Object.freeze({
  autoValueEnabled: false,
  autoValueMaxCents: null,
});

export const AccountPreferencesSchema = z
  .object({
    autoValueEnabled: z.boolean(),
    autoValueMaxCents: z.number().int().min(1).max(100_000_000).nullable(),
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

export class SupabaseAccountPreferencesRepository {
  constructor({ client }) {
    this.client = client;
  }

  async get(userId) {
    const { data, error } = await this.client
      .from("account_preferences")
      .select("auto_value_enabled, auto_value_max_cents")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw databaseError("account preferences read", error);
    if (!data) return { ...DEFAULT_ACCOUNT_PREFERENCES };
    return {
      autoValueEnabled: data.auto_value_enabled === true,
      autoValueMaxCents:
        data.auto_value_max_cents === null
          ? null
          : Number(data.auto_value_max_cents),
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
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      )
      .select("auto_value_enabled, auto_value_max_cents")
      .single();
    if (error) throw databaseError("account preferences update", error);
    return {
      autoValueEnabled: data.auto_value_enabled === true,
      autoValueMaxCents:
        data.auto_value_max_cents === null
          ? null
          : Number(data.auto_value_max_cents),
    };
  }
}
