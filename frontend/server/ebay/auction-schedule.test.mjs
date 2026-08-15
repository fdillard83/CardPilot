import assert from "node:assert/strict";
import test from "node:test";
import { calculateAuctionSchedule } from "./auction-schedule.mjs";

test("calculates publication from the user-selected duration and ending time", () => {
  const result = calculateAuctionSchedule({
    desiredEndAt: "2026-08-22T20:00:00.000Z", durationDays: 5,
    now: new Date("2026-08-15T12:00:00.000Z"),
  });
  assert.equal(result.publishAt, "2026-08-17T20:00:00.000Z");
  assert.equal(result.endAt, "2026-08-22T20:00:00.000Z");
});

test("rejects unsupported lengths and publication times that are already due", () => {
  assert.throws(() => calculateAuctionSchedule({ desiredEndAt: "2026-08-22T20:00:00.000Z", durationDays: 2, now: new Date("2026-08-15T12:00:00.000Z") }));
  assert.throws(() => calculateAuctionSchedule({ desiredEndAt: "2026-08-16T12:01:00.000Z", durationDays: 1, now: new Date("2026-08-15T12:00:00.000Z") }));
});
