import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { EbayApiError } from "./oauth-client.mjs";

export const EbayListingDraftSchema = z.object({
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(100_000),
  priceCents: z.number().int().min(1).max(100_000_000),
  currency: z.string().length(3).default("USD"),
  condition: z.enum(["LIKE_NEW", "NEW_OTHER", "USED_EXCELLENT", "USED_VERY_GOOD", "USED_GOOD", "USED_ACCEPTABLE"]),
  conditionDescription: z.string().trim().max(1000),
  categoryId: z.string().trim().max(20),
  aspects: z.record(z.string(), z.array(z.string())).default({}),
  merchantLocationKey: z.string().trim().max(50),
  fulfillmentPolicyId: z.string().trim().max(64),
  paymentPolicyId: z.string().trim().max(64),
  returnPolicyId: z.string().trim().max(64),
  listingFormat: z.enum(["FIXED_PRICE", "AUCTION"]).default("FIXED_PRICE"),
  listingImages: z.array(z.enum(["front", "back"])).min(1).max(2).default(["front"]),
  auctionDurationDays: z.union([z.literal(1), z.literal(3), z.literal(5), z.literal(7), z.literal(10)]).default(7),
  auctionStartPriceCents: z.number().int().min(1).max(100_000_000).default(99),
  auctionReservePriceCents: z.number().int().min(0).max(100_000_000).default(0),
  pricingStrategy: z.enum(["sell_faster", "balanced", "maximize_value"]).default("balanced"),
  promoteListing: z.boolean().default(false),
  promotionAdRatePercent: z.number().min(1).max(100).default(2),
  automationStatus: z.enum(["preview", "needs_attention", "ready", "publishing", "published", "failed"]).default("preview"),
  automationReason: z.string().max(1000).nullable().default(null),
  automationUpdatedAt: z.string().datetime().nullable().default(null),
  automationRepricedAt: z.string().datetime().nullable().default(null),
  automationOriginalPriceCents: z.number().int().min(1).max(100_000_000).nullable().default(null),
}).strict().superRefine((draft, context) => {
  if (draft.listingFormat === "AUCTION" && draft.auctionReservePriceCents > 0 && draft.auctionReservePriceCents <= draft.auctionStartPriceCents) {
    context.addIssue({ code: "custom", path: ["auctionReservePriceCents"], message: "The reserve price must be higher than the starting bid." });
  }
});

const ebayDraftMetadataKeys = [
  "draftId", "collectionId", "status", "ebayOfferId", "ebayListingId", "updatedAt",
  "scheduledPublishAt", "desiredEndAt", "scheduleStatus", "scheduleError",
  "environment", "publishedAt", "endedAt", "soldAt", "soldAmountCents",
  "soldCurrency", "lastSyncedAt",
];

export function editableEbayDraft(saved) {
  const value = { ...saved };
  for (const key of ebayDraftMetadataKeys) delete value[key];
  return EbayListingDraftSchema.parse(value);
}

const tradingCardCategoryIds = new Set(["261328", "183050", "183454"]);
const rawCardConditionDescriptors = {
  ccg: {
    LIKE_NEW: "400010", // Near Mint or Better
    NEW_OTHER: "400010",
    USED_EXCELLENT: "400015", // Lightly Played (Excellent)
    USED_VERY_GOOD: "400016", // Moderately Played (Very Good)
    USED_GOOD: "400016",
    USED_ACCEPTABLE: "400017", // Heavily Played (Poor)
  },
  other: {
    LIKE_NEW: "400010", // Near Mint or Better
    NEW_OTHER: "400010",
    USED_EXCELLENT: "400011", // Excellent
    USED_VERY_GOOD: "400012", // Very Good
    USED_GOOD: "400012",
    USED_ACCEPTABLE: "400013", // Poor
  },
};

export function inventoryConditionForCard({ categoryId, isGraded, condition }) {
  const normalizedCategoryId = String(categoryId);
  if (!tradingCardCategoryIds.has(normalizedCategoryId)) return { condition };
  if (isGraded) {
    throw new Error("Graded trading cards require eBay grader and grade descriptors before they can be published.");
  }
  return {
    condition: "USED_VERY_GOOD",
    conditionDescriptors: [{
      name: "40001",
      values: [rawCardConditionDescriptors[normalizedCategoryId === "183454" ? "ccg" : "other"][condition]],
    }],
  };
}

export function duplicateOfferId(error) {
  if (String(error?.code ?? "") !== "25002") return null;
  return error?.message?.match(/offerId:\s*(\d+)/i)?.[1] ?? null;
}

export const EbaySandboxSetupSchema = z.object({
  postalCode: z.string().trim().regex(/^\d{5}(?:-\d{4})?$/, "Enter a valid US ZIP code."),
  shippingCostCents: z.number().int().min(0).max(10_000),
  shippingService: z.enum(["STANDARD_ENVELOPE", "GROUND", "PRIORITY"]).default("GROUND"),
}).strict();

const ebayShippingServices = {
  STANDARD_ENVELOPE: { code: "US_eBayStandardEnvelope", label: "eBay Standard Envelope" },
  GROUND: { code: "USPSGround", label: "USPS Ground Advantage" },
  PRIORITY: { code: "USPSPriority", label: "USPS Priority Mail" },
};

export function ebaySandboxSetupResources(input, marketplaceId = "EBAY_US") {
  return ebaySellerSetupResources(input, marketplaceId, "sandbox");
}

export function ebaySellerSetupResources(input, marketplaceId = "EBAY_US", environment = "sandbox") {
  const setup = EbaySandboxSetupSchema.parse(input);
  const service = ebayShippingServices[setup.shippingService];
  const shippingCost = (setup.shippingCostCents / 100).toFixed(2);
  const production = environment === "production";
  const label = production ? "CardPilot" : "CardPilot Sandbox";
  return {
    merchantLocationKey: production ? "cardpilot-primary" : "cardpilot-sandbox-primary",
    location: {
      name: `${label} Inventory`,
      merchantLocationStatus: "ENABLED",
      location: { address: { postalCode: setup.postalCode, country: "US" } },
    },
    fulfillmentPolicy: {
      name: `${label} ${service.label}`,
      marketplaceId,
      categoryTypes: [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }],
      handlingTime: { value: 1, unit: "DAY" },
      localPickup: false,
      pickupDropOff: false,
      freightShipping: false,
      shippingOptions: [{
        optionType: "DOMESTIC",
        costType: "FLAT_RATE",
        shippingServices: [{
          sortOrder: 1,
          shippingCarrierCode: "USPS",
          shippingServiceCode: service.code,
          shippingCost: { value: shippingCost, currency: "USD" },
          freeShipping: setup.shippingCostCents === 0,
          buyerResponsibleForShipping: setup.shippingCostCents > 0,
        }],
      }],
    },
    paymentPolicy: {
      name: `${label} Payment`,
      marketplaceId,
      categoryTypes: [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }],
      immediatePay: true,
    },
    returnPolicy: {
      name: `${label} Returns`,
      marketplaceId,
      categoryTypes: [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }],
      returnsAccepted: true,
      returnPeriod: { value: 30, unit: "DAY" },
      refundMethod: "MONEY_BACK",
      returnShippingCostPayer: "BUYER",
    },
  };
}

export function ebayShippingPolicyResource(shippingCostCents, shippingService = "GROUND", marketplaceId = "EBAY_US", environment = "sandbox") {
  const resources = ebaySellerSetupResources({ postalCode: "00000", shippingCostCents, shippingService }, marketplaceId, environment);
  const amount = (shippingCostCents / 100).toFixed(2);
  const service = ebayShippingServices[shippingService];
  const prefix = `CardPilot${environment === "sandbox" ? " Sandbox" : ""} ${service.label}`;
  return {
    ...resources.fulfillmentPolicy,
    name: shippingCostCents === 0
      ? `${prefix} - Free Shipping`
      : `${prefix} - Buyer Pays $${amount}`,
  };
}

const SELL_SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
  "https://api.ebay.com/oauth/api_scope/sell.marketing",
  "https://api.ebay.com/oauth/api_scope/sell.analytics.readonly",
];

function tokenKey(secret) {
  if (!secret) throw new Error("EBAY_TOKEN_ENCRYPTION_KEY is required for eBay selling.");
  return createHash("sha256").update(secret, "utf8").digest();
}

export function encryptSellerToken(token, secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", tokenKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((value) => value.toString("base64url")).join(".");
}

export function decryptSellerToken(value, secret) {
  const [iv, tag, encrypted] = value.split(".").map((part) => Buffer.from(part, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", tokenKey(secret), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

async function json(response) {
  return response.json().catch(() => null);
}

export class EbaySellingClient {
  constructor({ clientId, clientSecret, redirectUriName, environment = "sandbox", fetchImpl = fetch }) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.redirectUriName = redirectUriName;
    this.environment = environment;
    this.fetch = fetchImpl;
    this.apiRoot = environment === "production" ? "https://api.ebay.com" : "https://api.sandbox.ebay.com";
    this.authRoot = environment === "production" ? "https://auth.ebay.com" : "https://auth.sandbox.ebay.com";
  }

  authorizationUrl(state) {
    const query = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUriName,
      response_type: "code",
      scope: SELL_SCOPES.join(" "),
      state,
    });
    return `${this.authRoot}/oauth2/authorize?${query}`;
  }

  async exchangeCode(code) {
    return this.#token({ grant_type: "authorization_code", code, redirect_uri: this.redirectUriName });
  }

  async refresh(refreshToken, scopes = SELL_SCOPES.join(" ")) {
    return this.#token({ grant_type: "refresh_token", refresh_token: refreshToken, scope: scopes });
  }

  async #token(fields) {
    const response = await this.fetch(`${this.apiRoot}/identity/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(fields),
    });
    const payload = await json(response);
    if (!response.ok || !payload?.access_token) {
      throw new EbayApiError("eBay rejected the seller authorization.", { service: "selling_oauth", status: response.status });
    }
    return payload;
  }

  async request(accessToken, path, { method = "GET", body } = {}) {
    const response = await this.fetch(`${this.apiRoot}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Accept-Language": "en-US",
        "Content-Type": "application/json",
        "Content-Language": "en-US",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const payload = response.status === 204 ? null : await json(response);
    if (!response.ok) {
      const ebayError = payload?.errors?.[0];
      const parameterDetails = (ebayError?.parameters ?? [])
        .map((parameter) => [parameter.name, parameter.value].filter(Boolean).join(": "))
        .filter(Boolean)
        .join(", ");
      const details = [ebayError?.message, ebayError?.longMessage, parameterDetails]
        .filter((value, index, values) => value && values.indexOf(value) === index)
        .join(" ");
      const code = ebayError?.errorId?.toString();
      const message = details
        ? `${details}${code ? ` (eBay error ${code})` : ""}`
        : `eBay rejected the selling request${code ? ` (error ${code})` : ""}.`;
      throw new EbayApiError(message, { service: "selling", status: response.status, code });
    }
    const location = response.headers.get("location");
    return payload ?? (location ? { location } : null);
  }

  async tradingRequest(accessToken, callName, body) {
    const response = await this.fetch(`${this.apiRoot}/ws/api.dll`, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml",
        "X-EBAY-API-CALL-NAME": callName,
        "X-EBAY-API-COMPATIBILITY-LEVEL": "1423",
        "X-EBAY-API-SITEID": "0",
        "X-EBAY-API-IAF-TOKEN": accessToken,
      },
      body,
    });
    const payload = await response.text();
    if (!response.ok || /<Ack>(?:Failure|PartialFailure)<\/Ack>/i.test(payload)) {
      const detail = payload.match(/<LongMessage>([\s\S]*?)<\/LongMessage>/i)?.[1]
        ?? payload.match(/<ShortMessage>([\s\S]*?)<\/ShortMessage>/i)?.[1];
      throw new EbayApiError(detail || "eBay could not return seller listing activity.", {
        service: "selling",
        status: response.status,
      });
    }
    return payload;
  }
}

export { SELL_SCOPES };
