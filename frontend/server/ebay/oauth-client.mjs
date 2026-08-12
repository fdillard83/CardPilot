const EBAY_BUY_SCOPE = "https://api.ebay.com/oauth/api_scope";
const EBAY_PRODUCTION_TOKEN_URL =
  "https://api.ebay.com/identity/v1/oauth2/token";

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function ebayErrorCode(payload) {
  return (
    payload?.error ??
    payload?.errors?.[0]?.errorId?.toString() ??
    payload?.errors?.[0]?.error?.toString() ??
    null
  );
}

export class EbayApiError extends Error {
  constructor(message, { service, status = 502, code = null, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "EbayApiError";
    this.service = service ?? "ebay";
    this.status = status;
    this.code = code;
  }
}

export class EbayOAuthClient {
  constructor({
    clientId,
    clientSecret,
    fetchImpl = globalThis.fetch,
    now = Date.now,
    tokenUrl = EBAY_PRODUCTION_TOKEN_URL,
    scope = EBAY_BUY_SCOPE,
    refreshSkewMs = 60_000,
    timeoutMs = 10_000,
  }) {
    if (!clientId || !clientSecret) {
      throw new TypeError("eBay OAuth requires a client ID and client secret.");
    }

    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.fetch = fetchImpl;
    this.now = now;
    this.tokenUrl = tokenUrl;
    this.scope = scope;
    this.refreshSkewMs = refreshSkewMs;
    this.timeoutMs = timeoutMs;
    this.cachedToken = null;
    this.pendingTokenRequest = null;
  }

  async getAccessToken({ forceRefresh = false } = {}) {
    if (
      !forceRefresh &&
      this.cachedToken &&
      this.cachedToken.expiresAtMs - this.now() > this.refreshSkewMs
    ) {
      return this.cachedToken.accessToken;
    }

    if (this.pendingTokenRequest) return this.pendingTokenRequest;

    this.pendingTokenRequest = this.requestAccessToken();
    try {
      return await this.pendingTokenRequest;
    } finally {
      this.pendingTokenRequest = null;
    }
  }

  invalidate(accessToken) {
    if (
      this.cachedToken &&
      (!accessToken || this.cachedToken.accessToken === accessToken)
    ) {
      this.cachedToken = null;
    }
  }

  async requestAccessToken() {
    const credentials = Buffer.from(
      `${this.clientId}:${this.clientSecret}`,
      "utf8",
    ).toString("base64");
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      scope: this.scope,
    });

    let response;
    try {
      response = await this.fetch(this.tokenUrl, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (cause) {
      throw new EbayApiError("The eBay OAuth service could not be reached.", {
        service: "oauth",
        cause,
      });
    }

    const payload = await readJson(response);
    if (!response.ok) {
      throw new EbayApiError("eBay rejected the OAuth token request.", {
        service: "oauth",
        status: response.status,
        code: ebayErrorCode(payload),
      });
    }

    const expiresInSeconds = Number(payload?.expires_in);
    if (
      typeof payload?.access_token !== "string" ||
      payload.access_token.length === 0 ||
      !Number.isFinite(expiresInSeconds) ||
      expiresInSeconds <= 0
    ) {
      throw new EbayApiError("eBay returned an invalid OAuth token response.", {
        service: "oauth",
      });
    }

    this.cachedToken = {
      accessToken: payload.access_token,
      expiresAtMs: this.now() + expiresInSeconds * 1_000,
    };
    return this.cachedToken.accessToken;
  }
}

export { EBAY_BUY_SCOPE, EBAY_PRODUCTION_TOKEN_URL };
