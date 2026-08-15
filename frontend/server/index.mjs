import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import dotenv from "dotenv";
import express from "express";
import OpenAI from "openai";
import { z, ZodError } from "zod";
import { EbayImageSearchClient } from "./ebay/image-search.mjs";
import { EbayApiError, EbayOAuthClient } from "./ebay/oauth-client.mjs";
import {
  EbayListingDraftSchema,
  EbaySandboxSetupSchema,
  EbaySellingClient,
  decryptSellerToken,
  ebaySandboxSetupResources,
  encryptSellerToken,
} from "./ebay/selling.mjs";
import { CatalogCandidateGenerator } from "./identification/candidate-generator.mjs";
import { OpenAIEvidenceEngine } from "./identification/evidence-engine.mjs";
import { IdentificationEngine } from "./identification/identification-engine.mjs";
import {
  ImageIntakeError,
  parseImageIntake,
} from "./identification/image-intake.mjs";
import { createCorrectionLogger } from "./correction-log.mjs";
import { CollectionStore } from "./collection-store.mjs";
import { LocalCollectionRepository } from "./collection-repository.mjs";
import { ActiveMarketService } from "./valuation/active-market.mjs";
import { ValuationRecommendationService } from "./valuation/recommendation.mjs";
import {
  TheCardApiClient,
  TheCardApiError,
} from "./sold-comps/the-card-api-client.mjs";
import { SoldCompsService } from "./sold-comps/sold-comps.mjs";
import {
  PokemonTcgApiError,
  PokemonTcgClient,
} from "./pokemon-tcg/client.mjs";
import { PokemonCatalogSearchService } from "./pokemon-tcg/catalog-search.mjs";
import { CandidateValuesSchema } from "./identification/contracts.mjs";
import {
  createSupabaseServices,
  supabaseConfiguration,
} from "./supabase/configuration.mjs";
import { requireCloudUser } from "./supabase/auth.mjs";
import {
  importLocalCollection,
  localImportStatus,
} from "./supabase/local-import.mjs";

const serverFile = fileURLToPath(import.meta.url);
const currentDirectory = path.dirname(serverFile);
dotenv.config({ path: path.resolve(currentDirectory, "../.env") });

const app = express();
const port = Number(process.env.PORT) || 8787;
const accuracyModel = process.env.OPENAI_MODEL || "gpt-5.6-sol";
const fastModel = process.env.OPENAI_FAST_MODEL || "gpt-5.4-mini";
const ebayClientId = process.env.EBAY_CLIENT_ID?.trim();
const ebayClientSecret = process.env.EBAY_CLIENT_SECRET?.trim();
const ebayConfigured = Boolean(ebayClientId && ebayClientSecret);
const ebayMarketplaceId =
  process.env.EBAY_MARKETPLACE_ID?.trim() || "EBAY_US";
const ebaySellEnvironment = process.env.EBAY_SELL_ENVIRONMENT?.trim() === "production"
  ? "production"
  : "sandbox";
const ebaySellConfigured = Boolean(
  process.env.EBAY_SELL_CLIENT_ID?.trim() &&
  process.env.EBAY_SELL_CLIENT_SECRET?.trim() &&
  process.env.EBAY_REDIRECT_URI_NAME?.trim() &&
  process.env.EBAY_TOKEN_ENCRYPTION_KEY?.trim(),
);
const ebaySelling = ebaySellConfigured
  ? new EbaySellingClient({
      clientId: process.env.EBAY_SELL_CLIENT_ID.trim(),
      clientSecret: process.env.EBAY_SELL_CLIENT_SECRET.trim(),
      redirectUriName: process.env.EBAY_REDIRECT_URI_NAME.trim(),
      environment: ebaySellEnvironment,
    })
  : null;
const ebayImageSearch = ebayConfigured
  ? new EbayImageSearchClient({
      oauthClient: new EbayOAuthClient({
        clientId: ebayClientId,
        clientSecret: ebayClientSecret,
      }),
      marketplaceId: ebayMarketplaceId,
    })
  : null;
const activeMarket = ebayImageSearch
  ? new ActiveMarketService({ ebayClient: ebayImageSearch })
  : null;
const theCardApiKey = process.env.THE_CARD_API_KEY?.trim();
const soldComps = theCardApiKey
  ? new SoldCompsService({
      cardApiClient: new TheCardApiClient({ apiKey: theCardApiKey }),
    })
  : null;
const pokemonTcgApiKey = process.env.POKEMON_TCG_API_KEY?.trim() || null;
const pokemonCatalog = new PokemonCatalogSearchService({
  client: new PokemonTcgClient({ apiKey: pokemonTcgApiKey }),
});
const valuationRecommendations = new ValuationRecommendationService({
  soldComps,
  activeMarket,
});
const correctionLogger = createCorrectionLogger({
  filePath: path.resolve(currentDirectory, "../.data/corrections.jsonl"),
});
const localCollectionStore = new CollectionStore({
  recordsFile: path.resolve(currentDirectory, "../.data/collection.json"),
  imagesDirectory: path.resolve(currentDirectory, "../.data/collection-images"),
});
const cloudConfiguration = supabaseConfiguration();
const cloudServices = createSupabaseServices(cloudConfiguration);
const localCollectionImportEnabled =
  process.env.LOCAL_COLLECTION_IMPORT_ENABLED === "true";
const collectionStore =
  cloudServices?.collection ??
  new LocalCollectionRepository({ store: localCollectionStore });

app.disable("x-powered-by");
app.use(express.json({ limit: "30mb" }));

function collectionUserId(request) {
  return request.cardPilotUser?.id ?? null;
}

function excludedObservationIds(request, queryName = "exclude") {
  const raw = request.query[queryName];
  if (raw === undefined) return [];
  const values = Array.isArray(raw) ? raw : [raw];
  if (
    values.length > 50 ||
    values.some(
      (value) =>
        typeof value !== "string" || value.length < 1 || value.length > 500,
    )
  ) {
    throw new TypeError("The removed pricing anchors are invalid.");
  }
  return [...new Set(values)];
}

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    configured: Boolean(process.env.OPENAI_API_KEY),
    services: {
      openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
      ebayConfigured,
      ebaySellingConfigured: ebaySellConfigured,
      ebaySellingEnvironment: ebaySellEnvironment,
      activeMarketConfigured: ebayConfigured,
      soldCompsConfigured: Boolean(soldComps),
      pokemonCatalogAvailable: true,
      pokemonTcgApiKeyConfigured: Boolean(pokemonTcgApiKey),
      accountsConfigured: Boolean(cloudServices),
      collectionStorage: collectionStore.mode,
    },
  });
});

app.get("/api/auth/session", async (request, response) => {
  response.set("Cache-Control", "no-store");
  if (!cloudServices) {
    response.json({ mode: "local", user: null });
    return;
  }
  try {
    const user = await cloudServices.auth.userFromRequest(request, response);
    response.json({ mode: "supabase", user });
  } catch (error) {
    console.error("CardPilot account session failed", error);
    response.status(503).json({
      error: "CardPilot could not check your account session. Please try again.",
    });
  }
});

app.post("/api/auth/signup", async (request, response) => {
  response.set("Cache-Control", "no-store");
  if (!cloudServices) {
    response.status(503).json({
      error: "Cloud accounts have not been configured for CardPilot yet.",
    });
    return;
  }
  try {
    const result = await cloudServices.auth.signUp(request.body);
    if (result.session) {
      cloudServices.auth.setSessionCookies(response, result.session);
    }
    response.status(201).json({
      user: result.user,
      confirmationRequired: result.confirmationRequired,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      response.status(400).json({
        error: "Enter a valid email address and a password of at least 8 characters.",
      });
      return;
    }
    console.error("CardPilot account creation failed", {
      status: error?.status,
      code: error?.code,
    });
    response.status(error?.status === 429 ? 429 : 400).json({
      error:
        error?.status === 429
          ? "Too many account attempts. Wait a moment and try again."
          : "CardPilot could not create that account. Check the email and try again.",
    });
  }
});

app.post("/api/auth/login", async (request, response) => {
  response.set("Cache-Control", "no-store");
  if (!cloudServices) {
    response.status(503).json({
      error: "Cloud accounts have not been configured for CardPilot yet.",
    });
    return;
  }
  try {
    const result = await cloudServices.auth.signIn(request.body);
    cloudServices.auth.setSessionCookies(response, result.session);
    response.json({ user: result.user });
  } catch (error) {
    if (!(error instanceof ZodError)) {
      console.error("CardPilot sign-in failed", {
        status: error?.status,
        code: error?.code,
      });
    }
    response.status(400).json({ error: "The email or password was not accepted." });
  }
});

app.post("/api/auth/logout", (_request, response) => {
  response.set("Cache-Control", "no-store");
  if (cloudServices) cloudServices.auth.clearSessionCookies(response);
  response.status(204).end();
});

app.post("/api/auth/forgot-password", async (request, response) => {
  response.set("Cache-Control", "no-store");
  if (!cloudServices) {
    response.status(503).json({
      error: "Cloud accounts have not been configured for CardPilot yet.",
    });
    return;
  }
  try {
    await cloudServices.auth.requestPasswordReset(request.body);
    response.json({
      message:
        "If that email belongs to a CardPilot account, a password-reset link has been sent.",
    });
  } catch (error) {
    if (error instanceof ZodError) {
      response.status(400).json({ error: "Enter a valid email address." });
      return;
    }
    if (error?.status === 429) {
      response.status(429).json({
        error: "Please wait before requesting another password-reset email.",
      });
      return;
    }
    console.error("CardPilot password reset request failed", {
      status: error?.status,
      code: error?.code,
    });
    response.json({
      message:
        "If that email belongs to a CardPilot account, a password-reset link has been sent.",
    });
  }
});

app.post("/api/auth/recovery-session", async (request, response) => {
  response.set("Cache-Control", "no-store");
  if (!cloudServices) {
    response.status(503).json({ error: "Cloud accounts are not configured." });
    return;
  }
  try {
    const result = await cloudServices.auth.establishRecoverySession(request.body);
    cloudServices.auth.setSessionCookies(response, result.session);
    response.json({ user: result.user });
  } catch (error) {
    if (!(error instanceof ZodError)) {
      console.error("CardPilot recovery session failed", {
        status: error?.status,
        code: error?.code,
      });
    }
    response.status(400).json({
      error: "That password-reset link is invalid or has expired.",
    });
  }
});

if (cloudServices) {
  app.use("/api", requireCloudUser(cloudServices.auth));
}

app.put("/api/account/password", async (request, response) => {
  if (!cloudServices || !request.cardPilotSession) {
    response.status(409).json({ error: "Cloud accounts are not enabled." });
    return;
  }
  try {
    const result = await cloudServices.auth.updatePassword(
      request.cardPilotSession,
      request.body,
    );
    if (result.session) cloudServices.auth.setSessionCookies(response, result.session);
    response.json({ user: result.user });
  } catch (error) {
    if (error instanceof ZodError) {
      response.status(400).json({
        error: "Use a new password containing at least 8 characters.",
      });
      return;
    }
    console.error("CardPilot password update failed", {
      status: error?.status,
      code: error?.code,
    });
    response.status(400).json({
      error: request.body?.currentPassword
        ? "The current password was not accepted, or the new password is invalid."
        : "The new password could not be saved. Request a new reset link and try again.",
    });
  }
});

app.get("/api/account/preferences", async (request, response) => {
  if (!cloudServices) {
    response.json({ autoValueEnabled: false, autoValueMaxCents: null });
    return;
  }
  try {
    response.json(await cloudServices.preferences.get(request.cardPilotUser.id));
  } catch (error) {
    console.error("Account preferences loading failed", error);
    response.status(500).json({ error: "CardPilot could not load account preferences." });
  }
});

app.put("/api/account/preferences", async (request, response) => {
  if (!cloudServices) {
    response.status(409).json({ error: "Cloud accounts are not enabled." });
    return;
  }
  try {
    response.json(
      await cloudServices.preferences.update(request.cardPilotUser.id, request.body),
    );
  } catch (error) {
    if (!(error instanceof ZodError)) {
      console.error("Account preferences update failed", error);
    }
    response.status(400).json({
      error: "Choose a valid automatic-value limit, or turn the rule off.",
    });
  }
});

const EBAY_STATE_COOKIE = "cardpilot_ebay_state";

function requestCookie(request, name) {
  return Object.fromEntries(
    (request.headers.cookie ?? "").split(";").map((part) => {
      const separator = part.indexOf("=");
      return separator < 0
        ? [part.trim(), ""]
        : [part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1))];
    }),
  )[name];
}

app.get("/api/ebay/selling/status", async (request, response) => {
  const connection = cloudServices && ebaySellConfigured
    ? await cloudServices.ebaySelling.connection(request.cardPilotUser.id)
    : null;
  response.json({
    configured: ebaySellConfigured,
    environment: ebaySellEnvironment,
    connected: Boolean(connection),
    connectedAt: connection?.connected_at ?? null,
  });
});

app.post("/api/ebay/selling/authorize", (request, response) => {
  if (!ebaySelling || !cloudServices) {
    response.status(409).json({ error: "eBay Sandbox selling is not configured yet." });
    return;
  }
  const state = randomUUID();
  response.append(
    "Set-Cookie",
    `${EBAY_STATE_COOKIE}=${encodeURIComponent(state)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${cloudConfiguration.secureCookies ? "; Secure" : ""}`,
  );
  response.json({ authorizationUrl: ebaySelling.authorizationUrl(state) });
});

app.get("/api/ebay/selling/callback", async (request, response) => {
  const expectedState = requestCookie(request, EBAY_STATE_COOKIE);
  if (!ebaySelling || !expectedState || request.query.state !== expectedState || typeof request.query.code !== "string") {
    response.redirect(`${cloudConfiguration.appOrigin ?? "/"}?ebay=connection-error`);
    return;
  }
  try {
    const token = await ebaySelling.exchangeCode(request.query.code);
    await cloudServices.ebaySelling.saveConnection(request.cardPilotUser.id, {
      environment: ebaySellEnvironment,
      encryptedRefreshToken: encryptSellerToken(
        token.refresh_token,
        process.env.EBAY_TOKEN_ENCRYPTION_KEY,
      ),
      scopes: token.scope ?? "",
    });
    response.append("Set-Cookie", `${EBAY_STATE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    response.redirect(`${cloudConfiguration.appOrigin ?? "/"}?ebay=connected`);
  } catch (error) {
    console.error("eBay seller connection failed", { status: error?.status, code: error?.code });
    response.redirect(`${cloudConfiguration.appOrigin ?? "/"}?ebay=connection-error`);
  }
});

app.delete("/api/ebay/selling/connection", async (request, response) => {
  if (!cloudServices) return response.status(409).json({ error: "Cloud accounts are required." });
  await cloudServices.ebaySelling.disconnect(request.cardPilotUser.id);
  response.status(204).end();
});

async function loadEbaySellerSetup(token) {
  const [locations, fulfillment, payment, returns] = await Promise.all([
      ebaySelling.request(token, "/sell/inventory/v1/location?limit=100"),
      ebaySelling.request(token, `/sell/account/v1/fulfillment_policy?marketplace_id=${ebayMarketplaceId}`),
      ebaySelling.request(token, `/sell/account/v1/payment_policy?marketplace_id=${ebayMarketplaceId}`),
      ebaySelling.request(token, `/sell/account/v1/return_policy?marketplace_id=${ebayMarketplaceId}`),
  ]);
  return {
    locations: (locations?.locations ?? []).map((item) => ({ id: item.merchantLocationKey, name: item.name })),
    fulfillmentPolicies: (fulfillment?.fulfillmentPolicies ?? []).map((item) => ({ id: item.fulfillmentPolicyId, name: item.name })),
    paymentPolicies: (payment?.paymentPolicies ?? []).map((item) => ({ id: item.paymentPolicyId, name: item.name })),
    returnPolicies: (returns?.returnPolicies ?? []).map((item) => ({ id: item.returnPolicyId, name: item.name })),
  };
}

async function createEbaySandboxResource(label, operation) {
  try {
    return await operation();
  } catch (error) {
    const wrapped = new Error(`${label} could not be created. ${error.message ?? "eBay rejected the request."}`, { cause: error });
    wrapped.status = error?.status;
    wrapped.code = error?.code;
    throw wrapped;
  }
}

app.get("/api/ebay/selling/setup", async (request, response) => {
  try {
    const token = await ebaySellerAccessToken(request.cardPilotUser.id);
    response.json(await loadEbaySellerSetup(token));
  } catch (error) {
    response.status(502).json({ error: error.message ?? "CardPilot could not load eBay seller policies." });
  }
});

app.post("/api/ebay/selling/setup/sandbox", async (request, response) => {
  if (ebaySellEnvironment !== "sandbox") {
    return response.status(403).json({ error: "Automatic seller setup is available only in eBay Sandbox." });
  }
  try {
    const input = EbaySandboxSetupSchema.parse(request.body);
    const token = await ebaySellerAccessToken(request.cardPilotUser.id);
    const resources = ebaySandboxSetupResources(input, ebayMarketplaceId);
    const programs = await ebaySelling.request(token, "/sell/account/v1/program/get_opted_in_programs");
    const optedIn = (programs?.programs ?? []).some((program) => program.programType === "SELLING_POLICY_MANAGEMENT");
    if (!optedIn) {
      await createEbaySandboxResource("Business-policy enrollment", () => ebaySelling.request(token, "/sell/account/v1/program/opt_in", {
        method: "POST",
        body: { programType: "SELLING_POLICY_MANAGEMENT" },
      }));
    }
    const existing = await loadEbaySellerSetup(token);
    if (!existing.locations.length) {
      await createEbaySandboxResource("Inventory location", () => ebaySelling.request(token, `/sell/inventory/v1/location/${encodeURIComponent(resources.merchantLocationKey)}`, {
        method: "POST", body: resources.location,
      }));
    }
    if (!existing.fulfillmentPolicies.length) {
      await createEbaySandboxResource("Shipping policy", () => ebaySelling.request(token, "/sell/account/v1/fulfillment_policy", {
        method: "POST", body: resources.fulfillmentPolicy,
      }));
    }
    if (!existing.paymentPolicies.length) {
      await createEbaySandboxResource("Payment policy", () => ebaySelling.request(token, "/sell/account/v1/payment_policy", {
        method: "POST", body: resources.paymentPolicy,
      }));
    }
    if (!existing.returnPolicies.length) {
      await createEbaySandboxResource("Return policy", () => ebaySelling.request(token, "/sell/account/v1/return_policy", {
        method: "POST", body: resources.returnPolicy,
      }));
    }
    response.json(await loadEbaySellerSetup(token));
  } catch (error) {
    console.error("eBay Sandbox seller setup failed", { status: error?.status, code: error?.code });
    response.status(error instanceof ZodError ? 400 : 502).json({
      error: error instanceof ZodError ? error.issues[0]?.message : error.message ?? "CardPilot could not prepare the Sandbox seller account.",
    });
  }
});

function ebayDraftFromCard(card, defaults = {}) {
  const fields = card.fields;
  const identifying = [fields.year, fields.player ?? fields.character, fields.setOrInsert,
    fields.parallel, fields.cardNumber ? `#${fields.cardNumber}` : null,
    fields.serialNumber, fields.autograph ? "Autograph" : null, fields.rookieStatus ? "Rookie" : null]
    .filter(Boolean).join(" ");
  const priceCents = card.confirmedValuation?.amountCents ?? 100;
  return {
    title: identifying.slice(0, 80) || card.title.slice(0, 80),
    description: `${identifying || card.title}\n\nPlease review the photographs for the exact card and condition.`,
    priceCents,
    currency: card.confirmedValuation?.currency ?? "USD",
    condition: "USED_EXCELLENT",
    conditionDescription: "Ungraded trading card. Please review photographs for condition.",
    categoryId: "",
    aspects: Object.fromEntries([
      [fields.player ? "Player/Athlete" : "Character", fields.player ?? fields.character],
      ["Sport", fields.sport],
      ["Team", fields.team],
      ["Set", fields.setOrInsert],
      ["Year Manufactured", fields.year],
      ["Card Number", fields.cardNumber],
      ["Parallel/Variety", fields.parallel],
      ["Manufacturer", fields.manufacturer],
    ].filter(([, value]) => typeof value === "string" && value.trim()).map(([name, value]) => [name, [value]])),
    merchantLocationKey: defaults.merchantLocationKey ?? "",
    fulfillmentPolicyId: defaults.fulfillmentPolicyId ?? "",
    paymentPolicyId: defaults.paymentPolicyId ?? "",
    returnPolicyId: defaults.returnPolicyId ?? "",
    listingFormat: "FIXED_PRICE",
  };
}

app.get("/api/collection/:collectionId/ebay-draft", async (request, response) => {
  if (!cloudServices) return response.status(409).json({ error: "Cloud accounts are required." });
  const card = await collectionStore.get(collectionUserId(request), request.params.collectionId);
  if (!card) return response.status(404).json({ error: "That saved card was not found." });
  const saved = await cloudServices.ebaySelling.draft(request.cardPilotUser.id, card.collectionId);
  const preferences = await cloudServices.preferences.get(request.cardPilotUser.id);
  response.json({ draft: saved ?? ebayDraftFromCard(card, preferences.ebaySellingDefaults), generated: !saved });
});

app.put("/api/collection/:collectionId/ebay-draft", async (request, response) => {
  try {
    const card = await collectionStore.get(collectionUserId(request), request.params.collectionId);
    if (!card) return response.status(404).json({ error: "That saved card was not found." });
    const draft = await cloudServices.ebaySelling.saveDraft(
      request.cardPilotUser.id,
      card.collectionId,
      request.body,
    );
    const preferences = await cloudServices.preferences.get(request.cardPilotUser.id);
    await cloudServices.preferences.update(request.cardPilotUser.id, {
      ...preferences,
      ebaySellingDefaults: {
        merchantLocationKey: draft.merchantLocationKey,
        fulfillmentPolicyId: draft.fulfillmentPolicyId,
        paymentPolicyId: draft.paymentPolicyId,
        returnPolicyId: draft.returnPolicyId,
      },
    });
    response.json({ draft });
  } catch (error) {
    response.status(error instanceof ZodError ? 400 : 500).json({ error: "CardPilot could not save this eBay draft." });
  }
});

async function ebaySellerAccessToken(userId) {
  if (!ebaySelling || !cloudServices) throw new Error("eBay selling is not configured.");
  const connection = await cloudServices.ebaySelling.connection(userId);
  if (!connection) throw new Error("Connect an eBay seller account first.");
  const refreshToken = decryptSellerToken(connection.encrypted_refresh_token, process.env.EBAY_TOKEN_ENCRYPTION_KEY);
  return (await ebaySelling.refresh(refreshToken)).access_token;
}

app.post("/api/collection/:collectionId/ebay-publish", async (request, response) => {
  if (request.body?.confirmation !== "PUBLISH") {
    return response.status(400).json({ error: "Explicit publication confirmation is required." });
  }
  try {
    const userId = request.cardPilotUser.id;
    const card = await collectionStore.get(userId, request.params.collectionId);
    const saved = card && await cloudServices.ebaySelling.draft(userId, card.collectionId);
    if (!card || !saved) return response.status(404).json({ error: "Save the listing draft first." });
    const draft = EbayListingDraftSchema.parse((({ draftId, collectionId, status, ebayOfferId, ebayListingId, updatedAt, ...value }) => value)(saved));
    if ([draft.categoryId, draft.merchantLocationKey, draft.fulfillmentPolicyId, draft.paymentPolicyId, draft.returnPolicyId].some((value) => !value)) {
      return response.status(400).json({ error: "Category, location, and all three eBay policies are required." });
    }
    const token = await ebaySellerAccessToken(userId);
    const sku = `cardpilot-${card.collectionId}`;
    const [front, back] = await Promise.all([
      collectionStore.image(userId, card.collectionId, "front"),
      collectionStore.image(userId, card.collectionId, "back"),
    ]);
    await ebaySelling.request(token, `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, {
      method: "PUT",
      body: {
        availability: { shipToLocationAvailability: { quantity: 1 } },
        condition: draft.condition,
        conditionDescription: draft.conditionDescription,
        product: { title: draft.title, description: draft.description, aspects: draft.aspects,
          imageUrls: [front?.signedUrl, back?.signedUrl].filter(Boolean) },
      },
    });
    const offer = await ebaySelling.request(token, "/sell/inventory/v1/offer", {
      method: "POST",
      body: { sku, marketplaceId: ebayMarketplaceId, format: draft.listingFormat,
        availableQuantity: 1, categoryId: draft.categoryId,
        merchantLocationKey: draft.merchantLocationKey, listingDuration: "GTC",
        listingPolicies: { fulfillmentPolicyId: draft.fulfillmentPolicyId,
          paymentPolicyId: draft.paymentPolicyId, returnPolicyId: draft.returnPolicyId },
        pricingSummary: { price: { value: (draft.priceCents / 100).toFixed(2), currency: draft.currency } } },
    });
    const published = await ebaySelling.request(token, `/sell/inventory/v1/offer/${encodeURIComponent(offer.offerId)}/publish`, { method: "POST" });
    const result = await cloudServices.ebaySelling.markPublished(userId, card.collectionId, {
      offerId: offer.offerId, listingId: published.listingId,
    });
    response.json({ draft: result });
  } catch (error) {
    console.error("eBay listing publication failed", { status: error?.status, code: error?.code });
    response.status(error instanceof ZodError ? 400 : 502).json({ error: error.message ?? "eBay could not publish this listing." });
  }
});

app.post("/api/collection/:collectionId/ebay-end", async (request, response) => {
  if (request.body?.confirmation !== "END") {
    return response.status(400).json({ error: "Explicit end-listing confirmation is required." });
  }
  try {
    const userId = request.cardPilotUser.id;
    const draft = await cloudServices.ebaySelling.draft(userId, request.params.collectionId);
    if (!draft?.ebayOfferId || draft.status !== "published") {
      return response.status(404).json({ error: "No active CardPilot eBay listing was found." });
    }
    const token = await ebaySellerAccessToken(userId);
    await ebaySelling.request(token, `/sell/inventory/v1/offer/${encodeURIComponent(draft.ebayOfferId)}/withdraw`, { method: "POST" });
    response.json({ draft: await cloudServices.ebaySelling.markEnded(userId, request.params.collectionId) });
  } catch (error) {
    response.status(502).json({ error: error.message ?? "eBay could not end this listing." });
  }
});

app.post("/api/collection/:collectionId/ebay-revise", async (request, response) => {
  if (request.body?.confirmation !== "REVISE") {
    return response.status(400).json({ error: "Explicit revision confirmation is required." });
  }
  try {
    const userId = request.cardPilotUser.id;
    const card = await collectionStore.get(userId, request.params.collectionId);
    const saved = card && await cloudServices.ebaySelling.draft(userId, card.collectionId);
    if (!card || !saved?.ebayOfferId || saved.status !== "published") {
      return response.status(404).json({ error: "No active CardPilot eBay listing was found." });
    }
    const draft = EbayListingDraftSchema.parse((({ draftId, collectionId, status, ebayOfferId, ebayListingId, updatedAt, ...value }) => value)(saved));
    const token = await ebaySellerAccessToken(userId);
    const sku = `cardpilot-${card.collectionId}`;
    const [front, back] = await Promise.all([
      collectionStore.image(userId, card.collectionId, "front"),
      collectionStore.image(userId, card.collectionId, "back"),
    ]);
    await ebaySelling.request(token, `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, {
      method: "PUT",
      body: { availability: { shipToLocationAvailability: { quantity: 1 } }, condition: draft.condition,
        conditionDescription: draft.conditionDescription,
        product: { title: draft.title, description: draft.description, aspects: draft.aspects,
          imageUrls: [front?.signedUrl, back?.signedUrl].filter(Boolean) } },
    });
    await ebaySelling.request(token, `/sell/inventory/v1/offer/${encodeURIComponent(saved.ebayOfferId)}`, {
      method: "PUT",
      body: { sku, marketplaceId: ebayMarketplaceId, format: draft.listingFormat,
        availableQuantity: 1, categoryId: draft.categoryId,
        merchantLocationKey: draft.merchantLocationKey, listingDuration: "GTC",
        listingPolicies: { fulfillmentPolicyId: draft.fulfillmentPolicyId,
          paymentPolicyId: draft.paymentPolicyId, returnPolicyId: draft.returnPolicyId },
        pricingSummary: { price: { value: (draft.priceCents / 100).toFixed(2), currency: draft.currency } } },
    });
    response.json({ draft: saved });
  } catch (error) {
    response.status(502).json({ error: error.message ?? "eBay could not revise this listing." });
  }
});

app.get("/api/account/export", async (request, response) => {
  try {
    const cards = await collectionStore.export(collectionUserId(request));
    const exportedAt = new Date().toISOString();
    const backup = {
      schemaVersion: "cardpilot-account-backup-v1",
      exportedAt,
      account: { email: request.cardPilotUser?.email ?? null },
      cardCount: cards.length,
      cards,
    };
    response.set({
      "Cache-Control": "private, no-store",
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="cardpilot-backup-${exportedAt.slice(0, 10)}.json"`,
    });
    response.send(`${JSON.stringify(backup, null, 2)}\n`);
  } catch (error) {
    console.error("CardPilot account export failed", error);
    response.status(500).json({
      error: "CardPilot could not prepare the collection backup.",
    });
  }
});

const AccountDeletionSchema = z.object({
  password: z.string().min(8).max(128),
  confirmation: z.literal("DELETE"),
}).strict();

app.delete("/api/account", async (request, response) => {
  if (!cloudServices || collectionStore.mode !== "supabase") {
    response.status(409).json({ error: "Cloud accounts are not enabled." });
    return;
  }
  try {
    const input = AccountDeletionSchema.parse(request.body);
    await cloudServices.auth.verifyPassword(
      request.cardPilotUser.email,
      input.password,
    );
    await collectionStore.removeAllForUser(request.cardPilotUser.id);
    await cloudServices.auth.deleteUser(request.cardPilotUser.id);
    cloudServices.auth.clearSessionCookies(response);
    response.status(204).end();
  } catch (error) {
    if (!(error instanceof ZodError)) {
      console.error("CardPilot account deletion failed", {
        status: error?.status,
        code: error?.code,
      });
    }
    response.status(400).json({
      error:
        "CardPilot could not delete the account. Verify the password and type DELETE exactly.",
    });
  }
});

app.get("/api/collection", async (request, response) => {
  try {
    response.json({
      cards: await collectionStore.list(collectionUserId(request)),
    });
  } catch (error) {
    console.error("Collection loading failed", error);
    response.status(500).json({
      error: "CardPilot could not load the collection. Please try again.",
    });
  }
});

app.get("/api/collection-import/status", async (request, response) => {
  if (!cloudServices || !localCollectionImportEnabled) {
    response.json({ enabled: false, localCount: 0, readyCount: 0 });
    return;
  }
  try {
    response.json({
      enabled: true,
      ...(await localImportStatus({
        userId: request.cardPilotUser.id,
        localStore: localCollectionStore,
        cloudRepository: cloudServices.collection,
      })),
    });
  } catch (error) {
    console.error("Local collection import status failed", error);
    response.status(500).json({
      error: "CardPilot could not check the local collection.",
    });
  }
});

app.post("/api/collection-import", async (request, response) => {
  if (!cloudServices || !localCollectionImportEnabled) {
    response.status(403).json({
      error: "Local collection import is not enabled.",
    });
    return;
  }
  try {
    response.json(
      await importLocalCollection({
        userId: request.cardPilotUser.id,
        localStore: localCollectionStore,
        cloudRepository: cloudServices.collection,
      }),
    );
  } catch (error) {
    console.error("Local collection import failed", error);
    response.status(500).json({
      error:
        "CardPilot stopped the import because one local card could not be copied. Cards already copied remain safe.",
    });
  }
});

app.post("/api/collection", async (request, response) => {
  try {
    const card = await collectionStore.create(
      collectionUserId(request),
      request.body,
    );
    response.status(201).json({ card });
  } catch (error) {
    if (error instanceof ZodError || error instanceof TypeError) {
      response.status(400).json({
        error: "The saved card details or images are incomplete or invalid.",
      });
      return;
    }

    console.error("Collection save failed", error);
    response.status(500).json({
      error: "CardPilot could not save this card. Please try again.",
    });
  }
});

app.put("/api/collection/:collectionId", async (request, response) => {
  try {
    const card = await collectionStore.update(
      collectionUserId(request),
      request.params.collectionId,
      request.body,
    );
    if (!card) {
      response.status(404).json({ error: "That saved card was not found." });
      return;
    }
    response.json({ card });
  } catch (error) {
    if (error instanceof ZodError) {
      response.status(400).json({ error: "The card details are invalid." });
      return;
    }

    console.error("Collection update failed", error);
    response.status(500).json({
      error: "CardPilot could not update this card. Please try again.",
    });
  }
});

app.delete("/api/collection/:collectionId", async (request, response) => {
  try {
    const removed = await collectionStore.remove(
      collectionUserId(request),
      request.params.collectionId,
    );
    if (!removed) {
      response.status(404).json({ error: "That saved card was not found." });
      return;
    }
    response.status(204).end();
  } catch (error) {
    console.error("Collection removal failed", error);
    response.status(500).json({
      error: "CardPilot could not remove this card. Please try again.",
    });
  }
});

app.get(
  "/api/collection/:collectionId/valuation",
  async (request, response) => {
    try {
      const card = await collectionStore.get(
        collectionUserId(request),
        request.params.collectionId,
      );
      if (!card) {
        response.status(404).json({ error: "That saved card was not found." });
        return;
      }
      response.json(
        await valuationRecommendations.snapshot(card, {
          soldExcludedObservationIds: excludedObservationIds(
            request,
            "excludeSold",
          ),
          activeExcludedObservationIds: excludedObservationIds(
            request,
            "excludeActive",
          ),
        }),
      );
    } catch (error) {
      console.error("Card valuation recommendation failed", error);
      response.status(500).json({
        error: "CardPilot could not prepare this valuation. Please try again.",
      });
    }
  },
);

app.put(
  "/api/collection/:collectionId/valuation",
  async (request, response) => {
    try {
      const card = await collectionStore.updateConfirmedValuation(
        collectionUserId(request),
        request.params.collectionId,
        request.body,
      );
      if (!card) {
        response.status(404).json({ error: "That saved card was not found." });
        return;
      }
      response.json({ card });
    } catch (error) {
      if (error instanceof ZodError) {
        response.status(400).json({
          error: "Enter a valid confirmed value and confidence level.",
        });
        return;
      }
      console.error("Confirmed card valuation save failed", error);
      response.status(500).json({
        error: "CardPilot could not save this value. Please try again.",
      });
    }
  },
);

app.delete(
  "/api/collection/:collectionId/valuation",
  async (request, response) => {
    try {
      const card = await collectionStore.clearConfirmedValuation(
        collectionUserId(request),
        request.params.collectionId,
      );
      if (!card) {
        response.status(404).json({ error: "That saved card was not found." });
        return;
      }
      response.json({ card });
    } catch (error) {
      console.error("Confirmed card valuation removal failed", error);
      response.status(500).json({
        error: "CardPilot could not clear this value. Please try again.",
      });
    }
  },
);

app.get(
  "/api/collection/:collectionId/images/:side",
  async (request, response) => {
    if (!new Set(["front", "back"]).has(request.params.side)) {
      response.status(404).end();
      return;
    }

    try {
      const image = await collectionStore.image(
        collectionUserId(request),
        request.params.collectionId,
        request.params.side,
      );
      if (!image) {
        response.status(404).end();
        return;
      }
      if (image.signedUrl) {
        response.set("Cache-Control", "private, no-store");
        response.redirect(302, image.signedUrl);
        return;
      }
      const contents = await readFile(image.filePath);
      response.type(image.mimeType).send(contents);
    } catch (error) {
      if (error?.code === "ENOENT") {
        response.status(404).end();
        return;
      }
      console.error("Collection image loading failed", error);
      response.status(500).end();
    }
  },
);

app.get(
  "/api/collection/:collectionId/active-market",
  async (request, response) => {
    try {
      const card = await collectionStore.get(
        collectionUserId(request),
        request.params.collectionId,
      );
      if (!card) {
        response.status(404).json({ error: "That saved card was not found." });
        return;
      }
      if (!activeMarket) {
        response.status(503).json({
          error:
            "Active eBay market search is not configured yet. Add the Production eBay credentials and restart CardPilot.",
        });
        return;
      }
      response.json(
        await activeMarket.snapshot(card.fields, {
          confirmedReferenceItemId: card.ebayReference?.itemId ?? null,
          grading: card.grading,
          valuationProfile: card.valuationProfile,
          excludedObservationIds: excludedObservationIds(request),
        }),
      );
    } catch (error) {
      if (error instanceof TypeError) {
        response.status(422).json({ error: error.message });
        return;
      }
      if (error instanceof EbayApiError) {
        console.error("eBay active-market search failed", {
          service: error.service,
          status: error.status,
          code: error.code,
        });
        if (error.status === 429) {
          response.status(429).json({
            error: "eBay market search is busy. Wait a moment and try again.",
          });
          return;
        }
        if (
          error.service === "oauth" ||
          error.status === 401 ||
          error.status === 403
        ) {
          response.status(503).json({
            error:
              "eBay Browse API access was rejected. Verify the Production credentials and Buy API access.",
          });
          return;
        }
      } else {
        console.error("eBay active-market search failed", error);
      }
      response.status(502).json({
        error: "CardPilot could not reach eBay market search. Please try again.",
      });
    }
  },
);

app.get(
  "/api/collection/:collectionId/sold-comps",
  async (request, response) => {
    try {
      const card = await collectionStore.get(
        collectionUserId(request),
        request.params.collectionId,
      );
      if (!card) {
        response.status(404).json({ error: "That saved card was not found." });
        return;
      }
      if (!soldComps) {
        response.status(503).json({
          error:
            "Completed-sales search is not configured yet. Add THE_CARD_API_KEY to frontend/.env and restart CardPilot.",
        });
        return;
      }
      response.json(
        await soldComps.snapshot(
          card.fields,
          card.grading,
          card.valuationProfile,
          { excludedObservationIds: excludedObservationIds(request) },
        ),
      );
    } catch (error) {
      if (error instanceof TypeError) {
        response.status(422).json({ error: error.message });
        return;
      }
      if (error instanceof TheCardApiError) {
        console.error("The Card API sold-comps search failed", {
          status: error.status,
          code: error.code,
        });
        if (error.status === 429) {
          response.status(429).json({
            error:
              "Completed-sales search has reached its current request limit. Wait and try again later.",
          });
          return;
        }
        if (error.status === 401 || error.status === 403) {
          response.status(503).json({
            error:
              "The Card API key was rejected. Verify THE_CARD_API_KEY and restart CardPilot.",
          });
          return;
        }
      } else {
        console.error("The Card API sold-comps search failed", error);
      }
      response.status(502).json({
        error:
          "CardPilot could not reach the completed-sales provider. Please try again.",
      });
    }
  },
);

app.post("/api/identify-card", async (request, response) => {
  if (!process.env.OPENAI_API_KEY) {
    response.status(503).json({
      error:
        "Card identification is not configured yet. Add OPENAI_API_KEY to frontend/.env and restart CardPilot.",
    });
    return;
  }

  try {
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 60_000,
      maxRetries: 0,
    });
    const identificationEngine = new IdentificationEngine({
      evidenceEngine: new OpenAIEvidenceEngine({
        openai,
        model: accuracyModel,
        fastModel,
      }),
      candidateGenerator: new CatalogCandidateGenerator(),
      model: accuracyModel,
    });
    const identification = await identificationEngine.identify(request.body);
    console.info(
      "Card identification completed",
      JSON.stringify({
        identificationId: identification.identificationId,
        model: identification.pipeline.model,
        totalDurationMs: identification.pipeline.totalDurationMs,
        stages: identification.pipeline.stages,
      }),
    );
    response.json({ identification });
  } catch (error) {
    if (error instanceof ImageIntakeError) {
      response.status(error.status).json({ error: error.message });
      return;
    }

    console.error("Card identification failed", error);

    if (error instanceof OpenAI.AuthenticationError) {
      response.status(503).json({
        error:
          "The OpenAI API key is invalid. Update frontend/.env and restart CardPilot.",
      });
      return;
    }

    if (error instanceof OpenAI.RateLimitError) {
      const quotaCodes = new Set([
        "insufficient_quota",
        "credit_balance_exhausted",
        "organization_spend_limit_exceeded",
        "project_spend_limit_exceeded",
        "organization_usage_limit_exceeded",
      ]);

      if (quotaCodes.has(error.code)) {
        response.status(429).json({
          error:
            "Your OpenAI API account has no available quota. Add API billing or credits, then try again.",
        });
        return;
      }

      response.status(429).json({
        error:
          "The identification service is busy. Wait a moment and try again.",
      });
      return;
    }

    response.status(502).json({
      error:
        error instanceof Error && error.message.startsWith("The card evidence")
          ? error.message
          : "CardPilot could not reach the identification service. Please try again.",
    });
  }
});

app.post("/api/pokemon/catalog-search", async (request, response) => {
  const limit = request.body?.limit ?? 6;
  if (!Number.isInteger(limit) || limit < 1 || limit > 12) {
    response.status(400).json({
      error: "The Pokémon catalog-search limit must be from 1 through 12.",
    });
    return;
  }

  try {
    const fields = CandidateValuesSchema.parse(request.body?.fields);
    const result = await pokemonCatalog.search(fields, { limit });
    console.info(
      "Pokémon catalog search completed",
      JSON.stringify({
        candidateCount: result.candidates.length,
        queryCount: result.queriesUsed.length,
        cacheStatus: result.cacheStatus,
        authenticated: result.source.authenticated,
      }),
    );
    response.json(result);
  } catch (error) {
    if (error instanceof ZodError) {
      response.status(400).json({
        error: "The Pokémon catalog-search card details are invalid.",
      });
      return;
    }
    if (error instanceof TypeError) {
      response.status(422).json({ error: error.message });
      return;
    }
    if (error instanceof PokemonTcgApiError) {
      console.error("Pokémon TCG API catalog search failed", {
        status: error.status,
        code: error.code,
      });
      if (error.status === 429) {
        response.status(429).json({
          error:
            "The Pokémon catalog has reached its current request limit. Wait a moment and try again.",
        });
        return;
      }
      if (error.status === 401 || error.status === 403) {
        response.status(503).json({
          error:
            "The Pokémon TCG API key was rejected. Verify POKEMON_TCG_API_KEY or remove it to use reduced unauthenticated access.",
        });
        return;
      }
    } else {
      console.error("Pokémon catalog search failed", error);
    }
    response.status(502).json({
      error:
        "The Pokémon catalog is temporarily unavailable. CardPilot identification and eBay pricing still work.",
    });
  }
});

app.post("/api/ebay/image-search", async (request, response) => {
  if (!ebayImageSearch) {
    response.status(503).json({
      error:
        "eBay image search is not configured yet. Add the Production eBay credentials to frontend/.env and restart CardPilot.",
    });
    return;
  }

  const limit = request.body?.limit ?? 10;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    response.status(400).json({
      error: "The eBay image-search limit must be an integer from 1 through 50.",
    });
    return;
  }

  try {
    const intake = parseImageIntake(request.body);
    const result = await ebayImageSearch.searchByImage({
      imageDataUrl: intake.frontImage,
      limit,
    });
    console.info(
      "eBay image search completed",
      JSON.stringify({
        marketplaceId: result.marketplaceId,
        candidateCount: result.candidates.length,
        total: result.total,
      }),
    );
    response.json(result);
  } catch (error) {
    if (error instanceof ImageIntakeError) {
      response.status(error.status).json({ error: error.message });
      return;
    }

    if (error instanceof EbayApiError) {
      console.error("eBay image search failed", {
        service: error.service,
        status: error.status,
        code: error.code,
      });

      if (error.status === 429) {
        response.status(429).json({
          error: "eBay image search is busy. Wait a moment and try again.",
        });
        return;
      }

      if (
        error.service === "oauth" ||
        error.status === 401 ||
        error.status === 403
      ) {
        response.status(503).json({
          error:
            "eBay Browse API access was rejected. Verify the Production client credentials and Browse API access.",
        });
        return;
      }

      if (error.service === "browse" && error.status === 400) {
        response.status(422).json({
          error:
            "eBay could not search this image. Try a clear, tightly cropped photo of the card.",
        });
        return;
      }
    } else {
      console.error("eBay image search failed", error);
    }

    response.status(502).json({
      error: "CardPilot could not reach eBay image search. Please try again.",
    });
  }
});

app.get("/api/ebay/items/:itemId", async (request, response) => {
  if (!ebayImageSearch) {
    response.status(503).json({
      error:
        "eBay item details are not configured yet. Add the Production eBay credentials to frontend/.env and restart CardPilot.",
    });
    return;
  }

  const itemId = request.params.itemId;
  if (!itemId || itemId.length > 200) {
    response.status(400).json({ error: "A valid eBay item ID is required." });
    return;
  }

  try {
    const item = await ebayImageSearch.getItemDetails(itemId);
    response.json({ item });
  } catch (error) {
    if (error instanceof EbayApiError) {
      console.error("eBay item lookup failed", {
        service: error.service,
        status: error.status,
        code: error.code,
      });

      if (error.status === 404) {
        response.status(404).json({
          error: "That eBay listing is no longer available.",
        });
        return;
      }

      if (error.status === 429) {
        response.status(429).json({
          error: "eBay item details are busy. Wait a moment and try again.",
        });
        return;
      }

      if (
        error.service === "oauth" ||
        error.status === 401 ||
        error.status === 403
      ) {
        response.status(503).json({
          error:
            "eBay Browse API access was rejected. Verify the Production client credentials and Browse API access.",
        });
        return;
      }
    } else {
      console.error("eBay item lookup failed", error);
    }

    response.status(502).json({
      error: "CardPilot could not load this eBay listing. Please try again.",
    });
  }
});

app.post("/api/corrections", async (request, response) => {
  try {
    const record = await correctionLogger.log(request.body);
    response.status(201).json({ correctionId: record.correctionId });
  } catch (error) {
    if (error instanceof ZodError) {
      response.status(400).json({
        error: "The correction data is incomplete or invalid.",
      });
      return;
    }

    console.error("Correction logging failed", error);
    response.status(500).json({
      error: "CardPilot could not save this correction. Please try again.",
    });
  }
});

const distDirectory = path.resolve(currentDirectory, "../dist");

if (existsSync(distDirectory)) {
  app.use(express.static(distDirectory));
  app.use((request, response, next) => {
    if (request.method !== "GET" || request.path.startsWith("/api/")) {
      next();
      return;
    }

    response.sendFile(path.join(distDirectory, "index.html"));
  });
}
app.use((error, _request, response, _next) => {
  if (error?.type === "entity.too.large") {
    response.status(413).json({
      error: "The selected images are too large. Use images smaller than 12 MB each.",
    });
    return;
  }

  console.error("Unexpected server error", error);
  response.status(500).json({
    error: "CardPilot encountered an unexpected error.",
  });
});

export { app };

if (process.argv[1] && path.resolve(process.argv[1]) === serverFile) {
  app.listen(port, () => {
    console.log(`CardPilot server listening on http://localhost:${port}`);
    if (!process.env.OPENAI_API_KEY) {
      console.log(
        "OPENAI_API_KEY is not set; the app will show setup guidance when identification is requested.",
      );
    }
    if (!ebayConfigured) {
      console.log(
        "EBAY_CLIENT_ID or EBAY_CLIENT_SECRET is not set; eBay image search is disabled.",
      );
    }
    if (!soldComps) {
      console.log(
        "THE_CARD_API_KEY is not set; completed-sales comparisons are disabled.",
      );
    }
    if (!pokemonTcgApiKey) {
      console.log(
        "POKEMON_TCG_API_KEY is not set; Pokémon catalog search will use reduced unauthenticated limits.",
      );
    }
  });
}
