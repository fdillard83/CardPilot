import assert from "node:assert/strict";
import test from "node:test";

import { supabaseConfiguration } from "./configuration.mjs";

test("Supabase collection storage remains opt-in", () => {
  assert.deepEqual(
    supabaseConfiguration({}),
    {
      requested: false,
      configured: false,
      url: undefined,
      publishableKey: undefined,
      secretKey: undefined,
      bucket: "card-images",
      appOrigin: null,
      secureCookies: false,
    },
  );
});

test("Supabase mode refuses to start with incomplete secrets", () => {
  assert.throws(
    () => supabaseConfiguration({ COLLECTION_STORAGE_MODE: "supabase" }),
    /requires SUPABASE_URL/,
  );
});

test("Supabase mode accepts complete server-side configuration", () => {
  const configuration = supabaseConfiguration({
    COLLECTION_STORAGE_MODE: "supabase",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "publishable",
    SUPABASE_SECRET_KEY: "secret",
    APP_ORIGIN: "https://cardpilot.example",
    NODE_ENV: "production",
  });
  assert.equal(configuration.requested, true);
  assert.equal(configuration.configured, true);
  assert.equal(configuration.secureCookies, true);
});

test("legacy service-role keys remain supported during Supabase's transition", () => {
  const configuration = supabaseConfiguration({
    COLLECTION_STORAGE_MODE: "supabase",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "publishable",
    SUPABASE_SERVICE_ROLE_KEY: "legacy-secret",
  });
  assert.equal(configuration.secretKey, "legacy-secret");
});
