type PricingSnapshotKind = "active" | "sold" | "valuation";

const CACHE_PREFIX = "cardpilot:pricing:v1";
const RETRYABLE_STATUSES = new Set([500, 502, 503, 504]);

export type CachedPricingSnapshot<T> = {
  snapshot: T;
  savedAt: string;
};

function cacheKey(
  kind: PricingSnapshotKind,
  collectionId: string,
  context: string,
) {
  return `${CACHE_PREFIX}:${kind}:${encodeURIComponent(collectionId)}:${context}`;
}

export function pricingCacheContext(...excludedIdGroups: string[][]) {
  const normalized = excludedIdGroups.map((ids) => [...ids].sort().join(","));
  return normalized.map((value) => encodeURIComponent(value || "none")).join(":");
}

export function readPricingSnapshot<T>(
  kind: PricingSnapshotKind,
  collectionId: string,
  context: string,
  storage: Pick<Storage, "getItem"> = window.sessionStorage,
): CachedPricingSnapshot<T> | null {
  try {
    const raw = storage.getItem(cacheKey(kind, collectionId, context));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedPricingSnapshot<T>>;
    if (!parsed.snapshot || typeof parsed.savedAt !== "string") return null;
    return parsed as CachedPricingSnapshot<T>;
  } catch {
    return null;
  }
}

export function writePricingSnapshot<T>(
  kind: PricingSnapshotKind,
  collectionId: string,
  context: string,
  snapshot: T,
  storage: Pick<Storage, "setItem"> = window.sessionStorage,
) {
  try {
    storage.setItem(
      cacheKey(kind, collectionId, context),
      JSON.stringify({ snapshot, savedAt: new Date().toISOString() }),
    );
  } catch {
    // Pricing remains usable when browser storage is disabled or full.
  }
}

export async function fetchJsonWithTransientRetry<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
  {
    fetchImpl = globalThis.fetch.bind(globalThis),
    retryDelayMs = 400,
  }: {
    fetchImpl?: typeof fetch;
    retryDelayMs?: number;
  } = {},
) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetchImpl(input, init);
      const payload = (await response.json().catch(() => null)) as T | null;
      if (attempt === 0 && RETRYABLE_STATUSES.has(response.status)) {
        await new Promise((resolve) => globalThis.setTimeout(resolve, retryDelayMs));
        continue;
      }
      return { response, payload, attemptCount: attempt + 1 };
    } catch (error) {
      lastError = error;
      if (attempt === 0) {
        await new Promise((resolve) => globalThis.setTimeout(resolve, retryDelayMs));
        continue;
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("CardPilot could not reach its local pricing service.");
}
