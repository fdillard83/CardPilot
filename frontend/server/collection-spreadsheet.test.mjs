import assert from "node:assert/strict";
import test from "node:test";

import { collectionSpreadsheetCsv } from "./collection-spreadsheet.mjs";

test("collection spreadsheet is Excel-compatible and protects formula-like text", () => {
  const csv = collectionSpreadsheetCsv([{
    collectionId: "card-1",
    title: "=SUM(1,1)",
    fields: { player: "Nolan Ryan", rookieStatus: false, autograph: true },
    overallConfidence: 0.914,
    grading: { isGraded: false, company: null, grade: null, certificationNumber: null },
    confirmedValuation: {
      amountCents: 1195,
      currency: "USD",
      confidence: "high",
      method: "blended",
      userAdjusted: false,
      valuedAt: "2026-08-25T12:00:00.000Z",
    },
    ebayReference: null,
    createdAt: "2026-08-24T12:00:00.000Z",
    updatedAt: "2026-08-25T12:00:00.000Z",
  }]);

  assert.ok(csv.startsWith("\uFEFF"));
  assert.match(csv, /"Saved value"/);
  assert.match(csv, /"11\.95"/);
  assert.match(csv, /"'\=SUM\(1,1\)"/);
  assert.match(csv, /"91\.4%"/);
});
