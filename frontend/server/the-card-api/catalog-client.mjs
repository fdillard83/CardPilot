const defaultCatalogUrl = "https://www.thecardapi.com/api/v1/catalog";

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeCard(card) {
  const ucid = text(card?.ucid);
  if (!ucid) return null;
  return {
    ucid,
    setUsid: text(card?.set_usid),
    setName: text(card?.set_name),
    parentSetName: text(card?.parent_set_name),
    cardNumber: text(card?.card_number),
    subject: text(card?.subject),
    sport: text(card?.sport),
    year: number(card?.year),
    manufacturer: text(card?.manufacturer),
    parallel: text(card?.parallel_name) ?? text(card?.parallel),
    isRookie: typeof card?.is_rookie === "boolean" ? card.is_rookie : null,
    isAuto: typeof card?.is_auto === "boolean" ? card.is_auto : null,
    isRelic: typeof card?.is_relic === "boolean" ? card.is_relic : null,
    printRun: number(card?.print_run),
    imageUrlFront: text(card?.image_url_front),
    imageUrlBack: text(card?.image_url_back),
  };
}

export class TheCardCatalogError extends Error {
  constructor(message, { status = null, code = null } = {}) {
    super(message);
    this.name = "TheCardCatalogError";
    this.status = status;
    this.code = code;
  }
}

export class TheCardCatalogClient {
  constructor({ apiKey, fetchImpl = fetch, baseUrl = defaultCatalogUrl, timeoutMs = 5_000 }) {
    if (!text(apiKey)) throw new TypeError("A The Card API key is required for catalog search.");
    this.apiKey = apiKey.trim();
    this.fetchImpl = fetchImpl;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.timeoutMs = timeoutMs;
  }

  async searchCards({ query, sport = null, year = null, cardNumber = null, isAuto = null, isRookie = null, limit = 5 }) {
    if (!text(query) && !text(cardNumber)) throw new TypeError("A catalog identity or card number is required.");
    if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new TypeError("Catalog result limit must be from 1 through 10.");
    const url = new URL(this.baseUrl);
    if (text(query)) url.searchParams.set("q", query.trim().slice(0, 200));
    if (text(sport)) url.searchParams.set("sport", sport.trim());
    if (Number.isInteger(year)) url.searchParams.set("year", String(year));
    if (text(cardNumber)) url.searchParams.set("card_number", cardNumber.trim().replace(/^#/, ""));
    if (typeof isAuto === "boolean") url.searchParams.set("is_auto", String(isAuto));
    if (typeof isRookie === "boolean") url.searchParams.set("is_rookie", String(isRookie));
    url.searchParams.set("limit", String(limit));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await this.fetchImpl(url, {
        headers: { Accept: "application/json", "x-api-key": this.apiKey },
        signal: controller.signal,
      });
    } catch (error) {
      throw new TheCardCatalogError(error?.name === "AbortError" ? "The card catalog timed out." : "The card catalog could not be reached.", { code: error?.name === "AbortError" ? "timeout" : "network_error" });
    } finally {
      clearTimeout(timeout);
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new TheCardCatalogError("The Card API rejected the catalog search.", { status: response.status, code: text(payload?.code) ?? text(payload?.error) });
    if (!Array.isArray(payload?.data)) throw new TheCardCatalogError("The card catalog returned an invalid response.", { status: response.status, code: "invalid_response" });
    return {
      cards: payload.data.map(normalizeCard).filter(Boolean),
      total: number(payload.pagination?.total) ?? payload.data.length,
      rateLimit: {
        limit: number(response.headers.get("x-ratelimit-limit")),
        remaining: number(response.headers.get("x-ratelimit-remaining")),
      },
    };
  }
}
