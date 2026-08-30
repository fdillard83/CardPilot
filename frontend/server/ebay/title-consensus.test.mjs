import assert from "node:assert/strict";
import test from "node:test";
import { buildVisualTitleConsensus } from "./title-consensus.mjs";

const fields = {
  year: "2024",
  player: "Joey Ortiz",
  manufacturer: "Topps",
  product: "Topps Chrome",
  setOrInsert: null,
  cardNumber: "12",
  parallel: null,
  serialNumber: "/250",
  rookieStatus: true,
  autograph: false,
  memorabilia: false,
};

function candidate(itemId, title, score, structureScore = score) {
  return {
    itemId,
    title,
    visualMatchStatus: "matched",
    visualMatch: { score, structureScore },
  };
}

test("visual consensus uses common trustworthy terms from strong identity matches", () => {
  const result = buildVisualTitleConsensus(fields, [
    candidate("one", "2024 Topps Chrome Joey Ortiz #12 Logofractor /250 RC", 0.88, 0.83),
    candidate("two", "2024 Topps Chrome Joey Ortiz Logofractor #12 /250 Rookie", 0.82, 0.79),
    candidate("three", "2024 Topps Chrome Joey Ortiz #12 Logofractor Rare Invest PSA Ready", 0.75, 0.72),
  ], { generatedAt: "2026-08-30T12:00:00.000Z" });
  assert.ok(result);
  assert.deepEqual(result.terms, ["Logofractor"]);
  assert.match(result.title, /Logofractor/);
  assert.doesNotMatch(result.title, /Rare|Invest|PSA Ready/i);
  assert.equal(result.supportingItemIds.length, 3);
});

test("visual consensus rejects conflicting years, card numbers, and weak images", () => {
  const result = buildVisualTitleConsensus(fields, [
    candidate("good", "2024 Topps Chrome Joey Ortiz #12 Logofractor", 0.86, 0.8),
    candidate("wrong-year", "2023 Topps Chrome Joey Ortiz #12 Logofractor", 0.9, 0.85),
    candidate("wrong-number", "2024 Topps Chrome Joey Ortiz #99 Logofractor", 0.9, 0.85),
    candidate("weak", "2024 Topps Chrome Joey Ortiz #12 Logofractor", 0.51, 0.3),
  ]);
  assert.equal(result, null);
});
