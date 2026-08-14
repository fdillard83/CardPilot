export type CardDetectionMetrics = {
  areaRatio: number;
  shortLongRatio: number;
  fillRatio: number;
  foregroundShare: number;
  oppositeWidthBalance: number;
  oppositeHeightBalance: number;
  diagonalBalance: number;
  frameShortLongRatio: number;
  confidence: number;
};

const STANDARD_CARD_RATIO = 2.5 / 3.5;

/**
 * Reject uncertain detections instead of risking an irreversible partial crop.
 * The original photo remains usable by identification when this returns false.
 */
export function isReliableCardDetection(metrics: CardDetectionMetrics) {
  const frameAlreadyLooksCardShaped =
    Math.abs(metrics.frameShortLongRatio - STANDARD_CARD_RATIO) <= 0.065;

  // Perspective correction amplifies even small corner errors. Favor the
  // untouched photo when opposing edges or diagonals disagree enough that a
  // slightly misplaced corner could visibly skew an otherwise straight card.
  const geometryIsStable =
    metrics.oppositeWidthBalance >= 0.72 &&
    metrics.oppositeHeightBalance >= 0.72 &&
    metrics.diagonalBalance >= 0.76;

  return !(
    metrics.areaRatio < 0.28 ||
    metrics.areaRatio > 0.94 ||
    metrics.shortLongRatio < 0.54 ||
    metrics.shortLongRatio > 0.84 ||
    metrics.fillRatio < 0.48 ||
    metrics.foregroundShare < 0.7 ||
    !geometryIsStable ||
    metrics.confidence < 0.66 ||
    (frameAlreadyLooksCardShaped && metrics.areaRatio < 0.72)
  );
}
