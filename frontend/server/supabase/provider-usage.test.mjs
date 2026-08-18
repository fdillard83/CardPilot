import assert from "node:assert/strict";
import test from "node:test";
import { aggregateProviderUsage } from "./provider-usage.mjs";

test("provider usage separates operations and calculates usefulness", () => {
  const rows = Array.from({ length: 10 }, (_, index) => ({
    provider: "the_card_api",
    operation: index < 5 ? "catalog_candidates" : "sold_comps",
    success: index !== 9,
    duration_ms: 100 + index,
    returned_count: 4,
    useful_count: index < 5 ? 1 : 3,
  }));
  const summary = aggregateProviderUsage(rows, { the_card_api: 3000 });
  const catalog = summary.find((item) => item.operation === "catalog_candidates");
  const sold = summary.find((item) => item.operation === "sold_comps");
  assert.equal(catalog.requests, 5);
  assert.equal(catalog.usefulRate, 0.25);
  assert.equal(sold.usefulRate, 0.75);
  assert.equal(catalog.configuredMonthlyCostCents, 3000);
  assert.equal(sold.estimatedCostPerUsefulResultCents, 100);
});
