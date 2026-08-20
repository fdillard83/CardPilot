import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateMarketFeedback,
  learnedExclusionIds,
  MarketFeedbackSubmissionSchema,
} from "./market-feedback.mjs";

test("market feedback reports accuracy, false matches, and missing results by source", () => {
  const summary = aggregateMarketFeedback([
    { source: "active_market", outcome: "correct_match", match_score: 0.91 },
    { source: "active_market", outcome: "wrong_card", match_score: 0.62 },
    { source: "active_market", outcome: "wrong_variation", match_score: 0.7 },
    { source: "active_market", outcome: "missing_matches", match_score: null },
    { source: "sold_comps", outcome: "correct_match", match_score: 0.84 },
  ]);
  const active = summary.find((item) => item.source === "active_market");
  assert.equal(active.reviewedResults, 3);
  assert.equal(active.correctMatches, 1);
  assert.equal(active.missingMatchReports, 1);
  assert.equal(active.correctRate, 1 / 3);
  assert.equal(active.falseMatchRate, 2 / 3);
  assert.equal(active.averageReviewedScore, (0.91 + 0.62 + 0.7) / 3);
});

test("learned exclusions remember personal corrections and require global agreement", () => {
  const rows = [
    { user_id: "owner", collection_id: "card-1", observation_id: "personal", outcome: "wrong_variation", updated_at: "2026-08-20T12:00:00Z" },
    { user_id: "a", collection_id: "card-a", observation_id: "global", outcome: "wrong_card", updated_at: "2026-08-20T12:00:00Z" },
    { user_id: "b", collection_id: "card-b", observation_id: "global", outcome: "wrong_variation", updated_at: "2026-08-20T12:00:00Z" },
    { user_id: "c", collection_id: "card-c", observation_id: "global", outcome: "wrong_card", updated_at: "2026-08-20T12:00:00Z" },
    { user_id: "a", collection_id: "card-a", observation_id: "too-few", outcome: "wrong_card", updated_at: "2026-08-20T12:00:00Z" },
    { user_id: "b", collection_id: "card-b", observation_id: "too-few", outcome: "wrong_card", updated_at: "2026-08-20T12:00:00Z" },
  ];
  const learned = learnedExclusionIds(rows, { userId: "owner", collectionId: "card-1" });
  assert.deepEqual(new Set(learned.ids), new Set(["personal", "global"]));
  assert.equal(learned.personalCount, 1);
  assert.equal(learned.globalCount, 1);
});

test("market feedback requires a result for result-level outcomes", () => {
  const parsed = MarketFeedbackSubmissionSchema.safeParse({
    collectionId: "card-1",
    source: "sold_comps",
    snapshotSearchedAt: "2026-08-20T12:00:00.000Z",
    observationId: null,
    outcome: "wrong_card",
    targetTitle: "2025 Example Player",
    resultTitle: null,
    matchTier: null,
    matchScore: null,
    visualMatchScore: null,
    visualMatchStatus: null,
    matchedSignals: [],
    candidateCount: 10,
    matchedCount: 2,
    exactMatchedCount: 1,
    broaderMatchedCount: 1,
    excludedCount: 8,
  });
  assert.equal(parsed.success, false);
});
