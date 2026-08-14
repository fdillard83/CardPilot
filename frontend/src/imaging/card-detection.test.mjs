import assert from "node:assert/strict";
import test from "node:test";

import { isReliableCardDetection } from "./card-detection.ts";

const reliable = {
  areaRatio: 0.76,
  shortLongRatio: 0.715,
  fillRatio: 0.88,
  foregroundShare: 0.91,
  oppositeWidthBalance: 0.94,
  oppositeHeightBalance: 0.9,
  diagonalBalance: 0.93,
  frameShortLongRatio: 0.75,
  confidence: 0.86,
};

test("accepts a strong full-card boundary", () => {
  assert.equal(isReliableCardDetection(reliable), true);
});

test("rejects an interior region that leaves substantial card evidence outside", () => {
  assert.equal(
    isReliableCardDetection({
      ...reliable,
      areaRatio: 0.44,
      foregroundShare: 0.51,
    }),
    false,
  );
});

test("rejects a partial crop when the original frame is already card-shaped", () => {
  assert.equal(
    isReliableCardDetection({
      ...reliable,
      areaRatio: 0.61,
      frameShortLongRatio: 2.5 / 3.5,
    }),
    false,
  );
});

test("allows a near-full crop when the original frame is card-shaped", () => {
  assert.equal(
    isReliableCardDetection({
      ...reliable,
      areaRatio: 0.79,
      frameShortLongRatio: 2.5 / 3.5,
    }),
    true,
  );
});

test("rejects distorted quadrilaterals", () => {
  assert.equal(
    isReliableCardDetection({
      ...reliable,
      oppositeWidthBalance: 0.4,
      diagonalBalance: 0.55,
    }),
    false,
  );
});
