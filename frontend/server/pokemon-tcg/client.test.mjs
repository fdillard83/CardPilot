import assert from "node:assert/strict";
import test from "node:test";
import { PokemonTcgApiError, PokemonTcgClient } from "./client.mjs";

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("Pokémon TCG client keeps the optional key server-side and caches results", async () => {
  const calls = [];
  const client = new PokemonTcgClient({
    apiKey: "private-pokemon-key",
    fetchImpl: async (url, options) => {
      calls.push({ url: url.toString(), options });
      return jsonResponse({ data: [{ id: "base1-4" }], totalCount: 1 });
    },
  });

  const first = await client.searchCards({ query: 'name:"Charizard"' });
  const second = await client.searchCards({ query: 'name:"Charizard"' });

  assert.equal(first.cards[0].id, "base1-4");
  assert.equal(first.cacheStatus, "miss");
  assert.equal(second.cacheStatus, "fresh");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers["X-Api-Key"], "private-pokemon-key");
  assert.doesNotMatch(calls[0].url, /private-pokemon-key/);
});

test("Pokémon TCG client works without a key and retries a provider outage", async () => {
  let callCount = 0;
  const client = new PokemonTcgClient({
    maxRetries: 1,
    sleep: async () => undefined,
    fetchImpl: async (_url, options) => {
      callCount += 1;
      assert.equal(options.headers["X-Api-Key"], undefined);
      return callCount === 1
        ? jsonResponse({ error: { code: 502 } }, 502)
        : jsonResponse({ data: [{ id: "sv3pt5-4" }], totalCount: 1 });
    },
  });

  const result = await client.searchCards({ query: 'name:"Charmander"' });
  assert.equal(callCount, 2);
  assert.equal(result.cards[0].id, "sv3pt5-4");
});

test("Pokémon TCG client serves a stale successful result during an outage", async () => {
  let now = 0;
  let available = true;
  const client = new PokemonTcgClient({
    cacheTtlMs: 100,
    staleTtlMs: 1_000,
    maxRetries: 0,
    now: () => now,
    fetchImpl: async () =>
      available
        ? jsonResponse({ data: [{ id: "base1-4" }], totalCount: 1 })
        : jsonResponse({ error: { code: 502 } }, 502),
  });

  await client.searchCards({ query: 'name:"Charizard"' });
  now = 200;
  available = false;
  const result = await client.searchCards({ query: 'name:"Charizard"' });

  assert.equal(result.cacheStatus, "stale");
  assert.equal(result.cards[0].id, "base1-4");
});

test("Pokémon TCG client reports provider errors without exposing the key", async () => {
  const client = new PokemonTcgClient({
    apiKey: "do-not-reveal-this",
    maxRetries: 0,
    fetchImpl: async () => jsonResponse({ error: { code: "upstream" } }, 502),
  });

  await assert.rejects(
    () => client.searchCards({ query: 'name:"Pikachu"' }),
    (error) => {
      assert.ok(error instanceof PokemonTcgApiError);
      assert.equal(error.status, 502);
      assert.doesNotMatch(error.message, /do-not-reveal-this/);
      return true;
    },
  );
});
