import assert from "node:assert/strict";
import test from "node:test";
import {
  EbayListingEngagementService,
  parseTrafficReport,
  parseWatchCounts,
  trafficReportPath,
} from "./listing-engagement.mjs";

test("traffic reports map metrics by header order", () => {
  const parsed = parseTrafficReport({
    header: { metrics: [{ key: "TOTAL_IMPRESSION_TOTAL" }, { key: "LISTING_VIEWS_TOTAL" }] },
    records: [{
      dimensionValues: [{ value: "123" }],
      metricValues: [{ value: 90, applicable: true }, { value: 24, applicable: true }],
    }],
    lastUpdatedDate: "2026-08-19T12:00:00.000Z",
  });
  assert.deepEqual(parsed.byListingId.get("123"), { viewCount: 24, impressionCount: 90 });
  assert.equal(parsed.updatedAt, "2026-08-19T12:00:00.000Z");
});

test("watch counts are read from active seller items", () => {
  const counts = parseWatchCounts(`<ActiveList><ItemArray>
    <Item><ItemID>123</ItemID><WatchCount>4</WatchCount></Item>
    <Item><ItemID>456</ItemID></Item>
  </ItemArray></ActiveList>`);
  assert.equal(counts.get("123"), 4);
  assert.equal(counts.get("456"), 0);
});

test("traffic report requests listing-level lifetime metrics", () => {
  const path = trafficReportPath(
    [{ listingId: "123", publishedAt: "2026-08-01T12:00:00.000Z" }],
    Date.parse("2026-08-19T12:00:00.000Z"),
  );
  const url = new URL(path, "https://api.ebay.com");
  assert.equal(url.searchParams.get("dimension"), "LISTING");
  assert.match(url.searchParams.get("filter"), /listing_ids:\{123\}/);
  assert.match(url.searchParams.get("filter"), /date_range:\[20260801\.\.20260819\]/);
  assert.equal(url.searchParams.get("metric"), "LISTING_VIEWS_TOTAL,TOTAL_IMPRESSION_TOTAL");
});

test("engagement snapshots combine views and watchers and cache the result", async () => {
  let calls = 0;
  const service = new EbayListingEngagementService({
    ebayClient: {
      async tradingRequest() {
        calls += 1;
        return "<Item><ItemID>123</ItemID><WatchCount>3</WatchCount></Item>";
      },
      async request() {
        calls += 1;
        return {
          header: { metrics: [{ key: "LISTING_VIEWS_TOTAL" }, { key: "TOTAL_IMPRESSION_TOTAL" }] },
          records: [{ dimensionValues: [{ value: "123" }], metricValues: [{ value: 18 }, { value: 60 }] }],
          lastUpdatedDate: "2026-08-19T12:00:00.000Z",
        };
      },
    },
  });
  const input = {
    userId: "user-1",
    listings: [{ listingId: "123", publishedAt: "2026-08-01T12:00:00.000Z" }],
    analyticsAuthorized: true,
    environment: "production",
    accessToken: async () => "token",
  };
  const first = await service.snapshot(input);
  const second = await service.snapshot(input);
  assert.deepEqual(first.byListingId.get("123"), { viewCount: 18, impressionCount: 60, watcherCount: 3 });
  assert.deepEqual(second, first);
  assert.equal(calls, 2);
});

