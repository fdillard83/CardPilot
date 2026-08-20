import { createClient } from "@supabase/supabase-js";
import { SupabaseAuthService } from "./auth.mjs";
import { SupabaseCollectionRepository } from "./collection-store.mjs";
import { SupabaseAccountPreferencesRepository } from "./account-preferences.mjs";
import { SupabaseEbaySellingStore } from "./ebay-selling-store.mjs";
import { SupabaseAdminOverview } from "./admin-overview.mjs";
import { SupabaseIdentificationFeedback } from "./identification-feedback.mjs";
import { SupabaseProviderUsage } from "./provider-usage.mjs";
import { SupabaseMarketFeedback } from "./market-feedback.mjs";

export function supabaseConfiguration(env = process.env) {
  const requested = env.COLLECTION_STORAGE_MODE?.trim().toLowerCase() === "supabase";
  const url = env.SUPABASE_URL?.trim();
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY?.trim();
  const secretKey =
    env.SUPABASE_SECRET_KEY?.trim() ||
    env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const configured = Boolean(url && publishableKey && secretKey);
  if (requested && !configured) {
    throw new Error(
      "COLLECTION_STORAGE_MODE=supabase requires SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, and SUPABASE_SECRET_KEY.",
    );
  }
  return {
    requested,
    configured,
    url,
    publishableKey,
    secretKey,
    bucket: env.SUPABASE_CARD_IMAGES_BUCKET?.trim() || "card-images",
    appOrigin: env.APP_ORIGIN?.trim() || null,
    secureCookies:
      env.SECURE_COOKIES === "true" || env.NODE_ENV === "production",
  };
}

export function createSupabaseServices(configuration) {
  if (!configuration.requested || !configuration.configured) return null;
  const authClientOptions = {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
        flowType: "implicit",
      },
    };
  const createAuthClient = () =>
    createClient(
      configuration.url,
      configuration.publishableKey,
      authClientOptions,
    );
  const authClient = createAuthClient();
  const adminClient = createClient(
    configuration.url,
    configuration.secretKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    },
  );
  const identificationFeedback = new SupabaseIdentificationFeedback({ client: adminClient });
  const marketFeedback = new SupabaseMarketFeedback({ client: adminClient });
  const providerUsage = new SupabaseProviderUsage({
    client: adminClient,
    monthlyCosts: {
      openai: Number(process.env.OPENAI_MONTHLY_COST_CENTS) || 0,
      google_vision: Number(process.env.GOOGLE_VISION_MONTHLY_COST_CENTS) || 0,
      the_card_api: Number(process.env.THE_CARD_API_MONTHLY_COST_CENTS) || 0,
      ebay: Number(process.env.EBAY_API_MONTHLY_COST_CENTS) || 0,
      pokemon_tcg: Number(process.env.POKEMON_TCG_MONTHLY_COST_CENTS) || 0,
      render: Number(process.env.RENDER_MONTHLY_COST_CENTS) || 0,
      supabase: Number(process.env.SUPABASE_MONTHLY_COST_CENTS) || 0,
    },
  });
  return {
    auth: new SupabaseAuthService({
      client: authClient,
      clientFactory: createAuthClient,
      adminClient,
      secureCookies: configuration.secureCookies,
      emailRedirectTo: configuration.appOrigin,
    }),
    collection: new SupabaseCollectionRepository({
      client: adminClient,
      bucket: configuration.bucket,
    }),
    preferences: new SupabaseAccountPreferencesRepository({ client: adminClient }),
    ebaySelling: new SupabaseEbaySellingStore({ client: adminClient }),
    identificationFeedback,
    marketFeedback,
    providerUsage,
    adminOverview: new SupabaseAdminOverview({
      client: adminClient,
      identificationFeedback,
      marketFeedback,
      providerUsage,
    }),
  };
}
