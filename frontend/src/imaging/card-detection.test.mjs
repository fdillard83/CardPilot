import assert from "node:assert/strict";
import test from "node:test";

import {
  getNormalizedCardDimensions,
  isReliableCardDetection,
} from "./card-detection.ts";

const reliable = {
  areaRatio: 0.76,
  shortLongRatio: 0.715,
  fillRatio: 0.88,
  foregroundShare: 0.91,
  oppositeWidthBalance: 0.94,
  oppositeHeightBalance: 0.9,
  diagonalBalance: 0.93,
  borderClearanceRatio: 0.08,
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

test("does not mistake a common 3:4 camera photo for an already-cropped card", () => {
  assert.equal(
    isReliableCardDetection({
      ...reliable,
      areaRatio: 0.49,
      frameShortLongRatio: 3 / 4,
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

test("preserves the original when a detected corner attaches to the photo frame", () => {
  assert.equal(
    isReliableCardDetection({
      ...reliable,
      borderClearanceRatio: 0.002,
    }),
    false,
  );
});

test("preserves a nearly straight photo when one detected corner would exaggerate perspective", () => {
  assert.equal(
    isReliableCardDetection({
      ...reliable,
      oppositeWidthBalance: 0.7,
      oppositeHeightBalance: 0.93,
      diagonalBalance: 0.74,
      confidence: 0.84,
    }),
    false,
  );
});

test("still corrects modest perspective when all four edges agree", () => {
  assert.equal(
    isReliableCardDetection({
      ...reliable,
      oppositeWidthBalance: 0.78,
      oppositeHeightBalance: 0.8,
      diagonalBalance: 0.82,
    }),
    true,
  );
});

test("keeps a detected horizontal card in landscape orientation", () => {
  assert.deepEqual(getNormalizedCardDimensions(700, 500, 1900), {
    width: 1900,
    height: 1357,
    isLandscape: true,
  });
});

test("keeps a detected vertical card in portrait orientation", () => {
  assert.deepEqual(getNormalizedCardDimensions(500, 700, 1900), {
    width: 1357,
    height: 1900,
    isLandscape: false,
  });
});
