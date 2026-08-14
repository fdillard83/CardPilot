import { createClient } from "@supabase/supabase-js";
import { SupabaseAuthService } from "./auth.mjs";
import { SupabaseCollectionRepository } from "./collection-store.mjs";

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
  const authClient = createClient(
    configuration.url,
    configuration.publishableKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    },
  );
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
  return {
    auth: new SupabaseAuthService({
      client: authClient,
      secureCookies: configuration.secureCookies,
      emailRedirectTo: configuration.appOrigin,
    }),
    collection: new SupabaseCollectionRepository({
      client: adminClient,
      bucket: configuration.bucket,
    }),
  };
}
