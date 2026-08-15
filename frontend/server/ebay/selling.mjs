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
}).strict();

const SELL_SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account",
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

  async refresh(refreshToken) {
    return this.#token({ grant_type: "refresh_token", refresh_token: refreshToken, scope: SELL_SCOPES.join(" ") });
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
        "Content-Type": "application/json",
        "Content-Language": "en-US",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = response.status === 204 ? null : await json(response);
    if (!response.ok) {
      const message = payload?.errors?.[0]?.message ?? "eBay rejected the selling request.";
      throw new EbayApiError(message, { service: "selling", status: response.status, code: payload?.errors?.[0]?.errorId?.toString() });
    }
    return payload;
  }
}

export { SELL_SCOPES };
