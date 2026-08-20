import { z } from "zod";

const feedbackOutcomeSchema = z.enum([
  "correct_match",
  "wrong_card",
  "wrong_variation",
  "missing_matches",
]);

export const MarketFeedbackSubmissionSchema = z.object({
  collectionId: z.string().min(1).max(100),
  source: z.enum(["active_market", "sold_comps"]),
  snapshotSearchedAt: z.iso.datetime(),
  observationId: z.string().min(1).max(500).nullable(),
  outcome: feedbackOutcomeSchema,
  targetTitle: z.string().min(1).max(500),
  resultTitle: z.string().min(1).max(500).nullable(),
  matchTier: z.string().min(1).max(30).nullable(),
  matchScore: z.number().min(0).max(10).nullable(),
  visualMatchScore: z.number().min(0).max(1).nullable(),
  visualMatchStatus: z.enum(["matched", "unavailable", "not_evaluated"]).nullable(),
  matchedSignals: z.array(z.string().min(1).max(100)).max(25),
  candidateCount: z.number().int().min(0).max(100_000),
  matchedCount: z.number().int().min(0).max(100_000),
  exactMatchedCount: z.number().int().min(0).max(100_000),
  broaderMatchedCount: z.number().int().min(0).max(100_000),
  excludedCount: z.number().int().min(0).max(100_000),
}).strict().superRefine((submission, context) => {
  const missing = submission.outcome === "missing_matches";
  if (missing && (submission.observationId !== null || submission.resultTitle !== null)) {
    context.addIssue({
      code: "custom",
      message: "Missing-match feedback applies to the search, not one result.",
      path: ["observationId"],
    });
  }
  if (!missing && (!submission.observationId || !submission.resultTitle)) {
    context.addIssue({
      code: "custom",
      message: "Result feedback requires the reviewed result.",
      path: ["observationId"],
    });
  }
});

export function aggregateMarketFeedback(rows) {
  const summaries = new Map();
  for (const row of rows ?? []) {
    const source = row.source;
    const current = summaries.get(source) ?? {
      source,
      reviewedResults: 0,
      correctMatches: 0,
      wrongCards: 0,
      wrongVariations: 0,
      missingMatchReports: 0,
      scoreTotal: 0,
      scoredResults: 0,
    };
    if (row.outcome === "missing_matches") {
      current.missingMatchReports += 1;
    } else {
      current.reviewedResults += 1;
      if (row.outcome === "correct_match") current.correctMatches += 1;
      if (row.outcome === "wrong_card") current.wrongCards += 1;
      if (row.outcome === "wrong_variation") current.wrongVariations += 1;
      if (Number.isFinite(Number(row.match_score))) {
        current.scoreTotal += Number(row.match_score);
        current.scoredResults += 1;
      }
    }
    summaries.set(source, current);
  }
  return [...summaries.values()].map(({ scoreTotal, scoredResults, ...summary }) => ({
    ...summary,
    correctRate: summary.reviewedResults
      ? summary.correctMatches / summary.reviewedResults
      : 0,
    falseMatchRate: summary.reviewedResults
      ? (summary.wrongCards + summary.wrongVariations) / summary.reviewedResults
      : 0,
    averageReviewedScore: scoredResults ? scoreTotal / scoredResults : null,
  })).sort((left, right) => right.reviewedResults - left.reviewedResults);
}

export function learnedExclusionIds(rows, { userId, collectionId }) {
  const ordered = [...(rows ?? [])].sort((left, right) =>
    new Date(right.updated_at ?? 0).getTime() - new Date(left.updated_at ?? 0).getTime(),
  );
  const personalOutcomes = new Map();
  const globalOutcomes = new Map();
  for (const row of ordered) {
    if (!row.observation_id || row.observation_id === "__snapshot__") continue;
    if (row.user_id === userId && row.collection_id === collectionId) {
      if (!personalOutcomes.has(row.observation_id)) {
        personalOutcomes.set(row.observation_id, row.outcome);
      }
    }
    const userOutcomes = globalOutcomes.get(row.observation_id) ?? new Map();
    if (!userOutcomes.has(row.user_id)) userOutcomes.set(row.user_id, row.outcome);
    globalOutcomes.set(row.observation_id, userOutcomes);
  }
  const personalIds = [...personalOutcomes]
    .filter(([, outcome]) => outcome === "wrong_card" || outcome === "wrong_variation")
    .map(([observationId]) => observationId);
  const globalIds = [...globalOutcomes]
    .filter(([, userOutcomes]) => {
      const outcomes = [...userOutcomes.values()];
      const incorrect = outcomes.filter(
        (outcome) => outcome === "wrong_card" || outcome === "wrong_variation",
      ).length;
      return outcomes.length >= 3 && incorrect / outcomes.length >= 0.8;
    })
    .map(([observationId]) => observationId);
  return {
    ids: [...new Set([...personalIds, ...globalIds])],
    personalCount: personalIds.length,
    globalCount: globalIds.filter((id) => !personalIds.includes(id)).length,
  };
}

export class SupabaseMarketFeedback {
  constructor({ client }) {
    this.client = client;
  }

  async record(userId, submission) {
    const missing = submission.outcome === "missing_matches";
    const { error } = await this.client.from("market_match_reviews").upsert({
      user_id: userId,
      collection_id: submission.collectionId,
      source: submission.source,
      snapshot_searched_at: submission.snapshotSearchedAt,
      observation_id: missing ? "__snapshot__" : submission.observationId,
      outcome: submission.outcome,
      target_title: submission.targetTitle,
      result_title: submission.resultTitle,
      match_tier: submission.matchTier,
      match_score: submission.matchScore,
      visual_match_score: submission.visualMatchScore,
      visual_match_status: submission.visualMatchStatus,
      matched_signals: submission.matchedSignals,
      candidate_count: submission.candidateCount,
      matched_count: submission.matchedCount,
      exact_matched_count: submission.exactMatchedCount,
      broader_matched_count: submission.broaderMatchedCount,
      excluded_count: submission.excludedCount,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,collection_id,source,snapshot_searched_at,observation_id" });
    if (error?.code === "42P01" || error?.code === "PGRST205") {
      return { recorded: false, migrationRequired: true };
    }
    if (error) throw error;
    return { recorded: true };
  }

  async summary() {
    const { data, error } = await this.client
      .from("market_match_reviews")
      .select("source,outcome,match_score")
      .limit(10_000);
    if (error) {
      if (error.code === "42P01" || error.code === "PGRST205") return [];
      throw error;
    }
    return aggregateMarketFeedback(data);
  }

  async learnedExclusions({ userId, collectionId, source, targetTitle }) {
    const fields = "user_id,collection_id,observation_id,outcome,updated_at";
    const [personal, global] = await Promise.all([
      this.client
        .from("market_match_reviews")
        .select(fields)
        .eq("user_id", userId)
        .eq("collection_id", collectionId)
        .eq("source", source)
        .neq("observation_id", "__snapshot__")
        .order("updated_at", { ascending: false })
        .limit(1_000),
      this.client
        .from("market_match_reviews")
        .select(fields)
        .eq("source", source)
        .eq("target_title", targetTitle)
        .neq("observation_id", "__snapshot__")
        .order("updated_at", { ascending: false })
        .limit(5_000),
    ]);
    const error = personal.error ?? global.error;
    if (error) {
      if (error.code === "42P01" || error.code === "PGRST205") {
        return { ids: [], personalCount: 0, globalCount: 0 };
      }
      throw error;
    }
    return learnedExclusionIds(
      [...(personal.data ?? []), ...(global.data ?? [])],
      { userId, collectionId },
    );
  }
}
