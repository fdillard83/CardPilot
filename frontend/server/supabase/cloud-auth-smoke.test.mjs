import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

test("cloud mode protects application APIs before provider calls", async () => {
  process.env.COLLECTION_STORAGE_MODE = "supabase";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "publishable-test-key";
  process.env.SUPABASE_SECRET_KEY = "secret-test-key";
  const { app } = await import(`../index.mjs?cloud-auth-test=${Date.now()}`);
  const server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const healthResponse = await fetch(`${baseUrl}/api/health`);
    assert.equal(healthResponse.status, 200);
    const sessionResponse = await fetch(`${baseUrl}/api/auth/session`);
    assert.equal(sessionResponse.status, 200);
    assert.deepEqual(await sessionResponse.json(), {
      mode: "supabase",
      user: null,
    });
    const identifyResponse = await fetch(`${baseUrl}/api/identify-card`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(identifyResponse.status, 401);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
