import assert from "node:assert/strict";
import test from "node:test";
import { aggregateInterventionLearning } from "./intervention-learning.mjs";

test("intervention learning separates personal results and requires enough community evidence", () => {
  const outcome = (type, improved) => ({
    type,
    before: { viewCount: 1, watcherCount: 0, clickThroughRate: 0.01 },
    outcomes: [{ days: 7, metrics: { viewCount: improved ? 3 : 1, watcherCount: 0, clickThroughRate: improved ? 0.02 : 0.01 } }],
  });
  const rows = [
    { user_id: "user-1", draft: { interventionHistory: [outcome("price_undercut", true), outcome("price_undercut", true), outcome("price_undercut", false)] } },
    { user_id: "user-2", draft: { interventionHistory: [outcome("price_undercut", true)] } },
  ];
  const result = aggregateInterventionLearning(rows, "user-1");
  assert.equal(result.personal[0].measured, 3);
  assert.equal(result.personal[0].ready, true);
  assert.equal(result.personal[0].improvementRate, 2 / 3);
  assert.equal(result.community[0].ready, false);
});
