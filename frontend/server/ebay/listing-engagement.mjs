export const EBAY_ANALYTICS_SCOPE =
  "https://api.ebay.com/oauth/api_scope/sell.analytics.readonly";

function metricNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function parseTrafficReport(payload) {
  const metricKeys = (payload?.header?.metrics ?? []).map((metric) => metric.key);
  const byListingId = new Map();
  for (const record of payload?.records ?? []) {
    const listingId = String(record?.dimensionValues?.[0]?.value ?? "").trim();
    if (!listingId) continue;
    const values = Object.fromEntries(metricKeys.map((key, index) => [
      key,
      record?.metricValues?.[index]?.applicable === false
        ? null
        : metricNumber(record?.metricValues?.[index]?.value),
    ]));
    byListingId.set(listingId, {
      viewCount: values.LISTING_VIEWS_TOTAL ?? null,
      impressionCount: values.TOTAL_IMPRESSION_TOTAL ?? null,
    });
  }
  return { byListingId, updatedAt: payload?.lastUpdatedDate ?? null };
}

export function parseWatchCounts(xml) {
  const byListingId = new Map();
  for (const match of String(xml ?? "").matchAll(/<Item>([\s\S]*?)<\/Item>/gi)) {
    const item = match[1];
    const listingId = item.match(/<ItemID>(\d+)<\/ItemID>/i)?.[1];
    if (!listingId) continue;
    const watcherCount = metricNumber(item.match(/<WatchCount>(\d+)<\/WatchCount>/i)?.[1] ?? 0);
    byListingId.set(listingId, watcherCount);
  }
  return byListingId;
}

function compactDate(value) {
  return new Date(value).toISOString().slice(0, 10).replaceAll("-", "");
}

export function trafficReportPath(listings, now = Date.now()) {
  const listingIds = [...new Set(listings.map((listing) => String(listing.listingId)).filter(Boolean))];
  const earliestPublished = Math.min(
    ...listings.map((listing) => Date.parse(listing.publishedAt)).filter(Number.isFinite),
    now,
  );
  const twoYearsAgo = now - 730 * 24 * 60 * 60 * 1000;
  const start = Math.max(earliestPublished, twoYearsAgo);
  const params = new URLSearchParams({
    dimension: "LISTING",
    filter: `listing_ids:{${listingIds.join("|")}},date_range:[${compactDate(start)}..${compactDate(now)}]`,
    metric: "LISTING_VIEWS_TOTAL,TOTAL_IMPRESSION_TOTAL",
  });
  return `/sell/analytics/v1/traffic_report?${params}`;
}

function watchersRequest() {
  return `<?xml version="1.0" encoding="utf-8"?>
<GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <DetailLevel>ReturnAll</DetailLevel>
  <IncludeWatchCount>true</IncludeWatchCount>
  <ActiveList>
    <Include>true</Include>
    <Pagination><EntriesPerPage>200</EntriesPerPage><PageNumber>1</PageNumber></Pagination>
  </ActiveList>
</GetMyeBaySellingRequest>`;
}

export class EbayListingEngagementService {
  constructor({ ebayClient, now = () => Date.now(), cacheDurationMs = 5 * 60 * 1000 }) {
    if (!ebayClient) throw new TypeError("An eBay seller client is required.");
    this.ebayClient = ebayClient;
    this.now = now;
    this.cacheDurationMs = cacheDurationMs;
    this.cache = new Map();
  }

  async snapshot({ userId, listings, analyticsAuthorized, environment, accessToken }) {
    const active = listings
      .filter((listing) => listing?.listingId)
      .map((listing) => ({
        listingId: String(listing.listingId),
        publishedAt: listing.publishedAt ?? new Date(this.now()).toISOString(),
      }));
    const empty = {
      byListingId: new Map(),
      analyticsAuthorized,
      viewsUpdatedAt: null,
      fetchedAt: new Date(this.now()).toISOString(),
    };
    if (!active.length) return empty;
    const fingerprint = active.map((listing) => `${listing.listingId}:${listing.publishedAt}`).sort().join("|");
    const cacheKey = `${userId}|${environment}|analytics:${analyticsAuthorized}|${fingerprint}`;
    const cached = this.cache.get(cacheKey);
    if (cached?.expiresAt > this.now()) return cached.value;

    const token = await accessToken();
    const watchersPromise = this.ebayClient.tradingRequest(
      token,
      "GetMyeBaySelling",
      watchersRequest(),
    );
    const viewsPromise = analyticsAuthorized && environment === "production"
      ? this.ebayClient.request(token, trafficReportPath(active, this.now()))
      : Promise.resolve(null);
    const [watchersResult, viewsResult] = await Promise.allSettled([watchersPromise, viewsPromise]);
    const watcherCounts = watchersResult.status === "fulfilled"
      ? parseWatchCounts(watchersResult.value)
      : new Map();
    const traffic = viewsResult.status === "fulfilled" && viewsResult.value
      ? parseTrafficReport(viewsResult.value)
      : { byListingId: new Map(), updatedAt: null };
    const byListingId = new Map(active.map(({ listingId }) => {
      const viewMetrics = traffic.byListingId.get(listingId);
      return [listingId, {
        viewCount: viewMetrics?.viewCount ?? null,
        impressionCount: viewMetrics?.impressionCount ?? null,
        watcherCount: watcherCounts.get(listingId) ?? null,
      }];
    }));
    const value = {
      byListingId,
      analyticsAuthorized,
      viewsUpdatedAt: traffic.updatedAt,
      fetchedAt: new Date(this.now()).toISOString(),
    };
    this.cache.set(cacheKey, { value, expiresAt: this.now() + this.cacheDurationMs });
    return value;
  }
}

