const DEFAULT_BASE_URL = "https://api.pokemontcg.io/v2";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_STALE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function errorCode(payload) {
  const code = payload?.error?.code ?? payload?.code;
  return typeof code === "string" || typeof code === "number"
    ? String(code)
    : null;
}

function cleanQueryValue(value) {
  return String(value).replace(/[\\"]/g, "\\$&");
}

export class PokemonTcgApiError extends Error {
  constructor(message, { status = null, code = null, cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "PokemonTcgApiError";
    this.status = status;
    this.code = code;
  }
}

export class PokemonTcgClient {
  constructor({
    apiKey = null,
    baseUrl = DEFAULT_BASE_URL,
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRetries = 1,
    cacheTtlMs = DEFAULT_CACHE_TTL_MS,
    staleTtlMs = DEFAULT_STALE_TTL_MS,
    now = () => Date.now(),
    sleep = (durationMs) =>
      new Promise((resolve) => setTimeout(resolve, durationMs)),
  } = {}) {
    if (typeof fetchImpl !== "function") {
      throw new TypeError("A fetch implementation is required.");
    }
    this.apiKey = apiKey?.trim() || null;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
    this.cacheTtlMs = cacheTtlMs;
    this.staleTtlMs = staleTtlMs;
    this.now = now;
    this.sleep = sleep;
    this.cache = new Map();
    this.inFlight = new Map();
  }

  async searchCards({ query, pageSize = 12 } = {}) {
    const normalizedQuery = query?.trim();
    if (!normalizedQuery) {
      throw new TypeError("A Pokémon catalog query is required.");
    }
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) {
      throw new TypeError("Pokémon catalog page size must be from 1 through 50.");
    }

    const url = new URL(`${this.baseUrl}/cards`);
    url.searchParams.set("q", normalizedQuery);
    url.searchParams.set("pageSize", String(pageSize));
    url.searchParams.set(
      "select",
      "id,name,number,rarity,supertype,subtypes,set,images,tcgplayer",
    );
    const result = await this.#getJson(url);
    return {
      cards: Array.isArray(result.payload?.data) ? result.payload.data : [],
      totalCount: Number.isFinite(result.payload?.totalCount)
        ? result.payload.totalCount
        : 0,
      cacheStatus: result.cacheStatus,
    };
  }

  async #getJson(url) {
    const key = url.toString();
    const cached = this.cache.get(key);
    const age = cached ? this.now() - cached.storedAt : Number.POSITIVE_INFINITY;
    if (cached && age <= this.cacheTtlMs) {
      return { payload: cached.payload, cacheStatus: "fresh" };
    }
    if (this.inFlight.has(key)) return this.inFlight.get(key);

    const request = this.#requestWithFallback(url, cached, age).finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, request);
    return request;
  }

  async #requestWithFallback(url, cached, cachedAge) {
    try {
      const payload = await this.#request(url);
      this.cache.set(url.toString(), { payload, storedAt: this.now() });
      return { payload, cacheStatus: "miss" };
    } catch (error) {
      if (
        cached &&
        cachedAge <= this.staleTtlMs &&
        (error.status === null || error.status >= 500 || error.status === 429)
      ) {
        return { payload: cached.payload, cacheStatus: "stale" };
      }
      throw error;
    }
  }

  async #request(url) {
    let lastError = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const headers = { Accept: "application/json" };
        if (this.apiKey) headers["X-Api-Key"] = this.apiKey;
        const response = await this.fetchImpl(url, {
          method: "GET",
          headers,
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => null);
        if (response.ok) return payload;

        lastError = new PokemonTcgApiError(
          "The Pokémon TCG API rejected the catalog request.",
          { status: response.status, code: errorCode(payload) },
        );
        if (response.status < 500 && response.status !== 429) throw lastError;
      } catch (error) {
        if (error instanceof PokemonTcgApiError) {
          lastError = error;
        } else if (error?.name === "AbortError") {
          lastError = new PokemonTcgApiError(
            "The Pokémon TCG API request timed out.",
            { cause: error },
          );
        } else {
          lastError = new PokemonTcgApiError(
            "The Pokémon TCG API request could not be completed.",
            { cause: error },
          );
        }
      } finally {
        clearTimeout(timer);
      }

      if (attempt < this.maxRetries) await this.sleep(150 * (attempt + 1));
    }
    throw lastError;
  }
}

export function pokemonQueryTerm(field, value) {
  const text = value?.trim();
  return text ? `${field}:"${cleanQueryValue(text)}"` : null;
}
