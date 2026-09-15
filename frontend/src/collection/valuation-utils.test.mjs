import assert from "node:assert/strict";
import test from "node:test";
import { recommendationForStrategy } from "./valuation-utils.ts";

test("saved recommendations use the account's selected valuation strategy", () => {
  const snapshot = {
    recommendation: { amountCents: 225, currency: "USD" },
    saleStrategyOptions: {
      sell_faster: { amountCents: 190 },
      balanced: { amountCents: 225 },
      maximize_value: { amountCents: 275 },
    },
  };

  assert.equal(
    recommendationForStrategy(snapshot, "sell_faster")?.amountCents,
    190,
  );
  assert.equal(
    recommendationForStrategy(snapshot, "balanced")?.amountCents,
    225,
  );
  assert.equal(
    recommendationForStrategy(snapshot, "maximize_value")?.amountCents,
    275,
  );
});
