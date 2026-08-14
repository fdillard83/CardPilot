import { once } from "node:events";
import { app } from "./index.mjs";

const server = app.listen(0);
await once(server, "listening");

const address = server.address();
if (!address || typeof address === "string") {
  throw new Error("The smoke-test server did not bind to a TCP port.");
}

const baseUrl = `http://127.0.0.1:${address.port}`;

try {
  const healthResponse = await fetch(`${baseUrl}/api/health`);
  const health = await healthResponse.json();

  if (!healthResponse.ok || health.ok !== true) {
    throw new Error("The health endpoint did not return a healthy response.");
  }
  if (typeof health.services?.activeMarketConfigured !== "boolean") {
    throw new Error("The health endpoint did not report active-market readiness.");
  }
  if (typeof health.services?.soldCompsConfigured !== "boolean") {
    throw new Error("The health endpoint did not report sold-comps readiness.");
  }
  if (health.services?.pokemonCatalogAvailable !== true) {
    throw new Error("The health endpoint did not report Pokémon catalog readiness.");
  }
  if (typeof health.services?.pokemonTcgApiKeyConfigured !== "boolean") {
    throw new Error("The health endpoint did not report Pokémon API-key readiness.");
  }
  if (health.services?.collectionStorage !== "local") {
    throw new Error("The smoke test expected safe local collection storage.");
  }

  const sessionResponse = await fetch(`${baseUrl}/api/auth/session`);
  const session = await sessionResponse.json();
  if (!sessionResponse.ok || session.mode !== "local" || session.user !== null) {
    throw new Error("The local account-session endpoint was not available.");
  }

  const homeResponse = await fetch(baseUrl);
  const home = await homeResponse.text();

  if (!homeResponse.ok || !home.includes("CardPilot")) {
    throw new Error("The production server did not serve the CardPilot build.");
  }

  const identifyResponse = await fetch(`${baseUrl}/api/identify-card`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

  const expectedStatus = process.env.OPENAI_API_KEY ? 400 : 503;
  if (identifyResponse.status !== expectedStatus) {
    throw new Error(`The identification endpoint returned ${identifyResponse.status}; expected ${expectedStatus}.`);
  }

  const ebayResponse = await fetch(`${baseUrl}/api/ebay/image-search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const ebayConfigured = Boolean(
    process.env.EBAY_CLIENT_ID?.trim() &&
      process.env.EBAY_CLIENT_SECRET?.trim(),
  );
  const expectedEbayStatus = ebayConfigured ? 400 : 503;
  if (ebayResponse.status !== expectedEbayStatus) {
    throw new Error(
      `The eBay image-search endpoint returned ${ebayResponse.status}; expected ${expectedEbayStatus}.`,
    );
  }

  const pokemonCatalogResponse = await fetch(
    `${baseUrl}/api/pokemon/catalog-search`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    },
  );
  if (pokemonCatalogResponse.status !== 400) {
    throw new Error(
      `The Pokémon catalog endpoint returned ${pokemonCatalogResponse.status}; expected 400 for invalid data.`,
    );
  }

  const correctionResponse = await fetch(`${baseUrl}/api/corrections`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

  if (correctionResponse.status !== 400) {
    throw new Error(
      `The correction endpoint returned ${correctionResponse.status}; expected 400.`,
    );
  }

  const collectionResponse = await fetch(`${baseUrl}/api/collection`);
  const collection = await collectionResponse.json();
  if (!collectionResponse.ok || !Array.isArray(collection.cards)) {
    throw new Error("The collection endpoint did not return a card list.");
  }

  const missingActiveMarketResponse = await fetch(
    `${baseUrl}/api/collection/not-a-card/active-market`,
  );
  if (missingActiveMarketResponse.status !== 404) {
    throw new Error(
      `The active-market endpoint returned ${missingActiveMarketResponse.status}; expected 404 for a missing card.`,
    );
  }

  const missingSoldCompsResponse = await fetch(
    `${baseUrl}/api/collection/not-a-card/sold-comps`,
  );
  if (missingSoldCompsResponse.status !== 404) {
    throw new Error(
      `The sold-comps endpoint returned ${missingSoldCompsResponse.status}; expected 404 for a missing card.`,
    );
  }

  const missingValuationResponse = await fetch(
    `${baseUrl}/api/collection/not-a-card/valuation`,
  );
  if (missingValuationResponse.status !== 404) {
    throw new Error(
      `The valuation endpoint returned ${missingValuationResponse.status}; expected 404 for a missing card.`,
    );
  }

  const invalidCollectionResponse = await fetch(`${baseUrl}/api/collection`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (invalidCollectionResponse.status !== 400) {
    throw new Error(
      `The collection endpoint returned ${invalidCollectionResponse.status}; expected 400 for invalid data.`,
    );
  }

  console.log("CardPilot server smoke test passed.");
} finally {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
