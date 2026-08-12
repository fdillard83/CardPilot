import test from "node:test";
import assert from "node:assert/strict";
import {
  EBAY_BUY_SCOPE,
  EbayApiError,
  EbayOAuthClient,
} from "./oauth-client.mjs";

function jsonResponse(payload, init = {}) {
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

test("OAuth tokens are cached and refreshed before expiry", async () => {
  let nowMs = 1_000;
  const requests = [];
  const client = new EbayOAuthClient({
    clientId: "client-id",
    clientSecret: "client-secret",
    now: () => nowMs,
    refreshSkewMs: 10_000,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return jsonResponse({
        access_token: `token-${requests.length}`,
        expires_in: 120,
      });
    },
  });

  assert.equal(await client.getAccessToken(), "token-1");
  assert.equal(await client.getAccessToken(), "token-1");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.method, "POST");
  assert.match(requests[0].options.headers.Authorization, /^Basic /);
  assert.equal(
    requests[0].options.body.get("grant_type"),
    "client_credentials",
  );
  assert.equal(requests[0].options.body.get("scope"), EBAY_BUY_SCOPE);

  nowMs = 112_000;
  assert.equal(await client.getAccessToken(), "token-2");
  assert.equal(requests.length, 2);
});

test("concurrent callers share one token request", async () => {
  let tokenRequests = 0;
  const client = new EbayOAuthClient({
    clientId: "client-id",
    clientSecret: "client-secret",
    fetchImpl: async () => {
      tokenRequests += 1;
      await Promise.resolve();
      return jsonResponse({ access_token: "shared-token", expires_in: 7_200 });
    },
  });

  const tokens = await Promise.all([
    client.getAccessToken(),
    client.getAccessToken(),
    client.getAccessToken(),
  ]);

  assert.deepEqual(tokens, ["shared-token", "shared-token", "shared-token"]);
  assert.equal(tokenRequests, 1);
});

test("OAuth failures are typed and do not expose credentials", async () => {
  const client = new EbayOAuthClient({
    clientId: "client-id",
    clientSecret: "top-secret",
    fetchImpl: async () =>
      jsonResponse(
        { error: "invalid_client", error_description: "bad credentials" },
        { status: 401 },
      ),
  });

  await assert.rejects(client.getAccessToken(), (error) => {
    assert.equal(error instanceof EbayApiError, true);
    assert.equal(error.service, "oauth");
    assert.equal(error.status, 401);
    assert.equal(error.code, "invalid_client");
    assert.equal(error.message.includes("top-secret"), false);
    return true;
  });
});
