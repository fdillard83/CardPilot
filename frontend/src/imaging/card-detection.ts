export type CardDetectionMetrics = {
  areaRatio: number;
  shortLongRatio: number;
  fillRatio: number;
  foregroundShare: number;
  oppositeWidthBalance: number;
  oppositeHeightBalance: number;
  diagonalBalance: number;
  borderClearanceRatio: number;
  frameShortLongRatio: number;
  confidence: number;
};

const STANDARD_CARD_RATIO = 2.5 / 3.5;

export function getNormalizedCardDimensions(
  horizontalLength: number,
  verticalLength: number,
  maxDimension: number,
) {
  const isLandscape = horizontalLength > verticalLength;
  return isLandscape
    ? {
        width: Math.max(1, Math.round(maxDimension)),
        height: Math.max(1, Math.round(maxDimension * STANDARD_CARD_RATIO)),
        isLandscape,
      }
    : {
        width: Math.max(1, Math.round(maxDimension * STANDARD_CARD_RATIO)),
        height: Math.max(1, Math.round(maxDimension)),
        isLandscape,
      };
}

/**
 * Reject uncertain detections instead of risking an irreversible partial crop.
 * The original photo remains usable by identification when this returns false.
 */
export function isReliableCardDetection(metrics: CardDetectionMetrics) {
  const frameAlreadyLooksCardShaped =
    Math.abs(metrics.frameShortLongRatio - STANDARD_CARD_RATIO) <= 0.02;

  // Perspective correction amplifies even small corner errors. Favor the
  // untouched photo when opposing edges or diagonals disagree enough that a
  // slightly misplaced corner could visibly skew an otherwise straight card.
  const geometryIsStable =
    metrics.oppositeWidthBalance >= 0.72 &&
    metrics.oppositeHeightBalance >= 0.72 &&
    metrics.diagonalBalance >= 0.76;
  // A complete card needs visible background around every recovered corner.
  // When a corner lands on the photo frame, the mask has usually merged the
  // card with a tabletop or fabric pattern; warping that guess stretches the
  // card toward the edge. Keeping the original is safer and still identifiable.
  const completeCornersAreVisible = metrics.borderClearanceRatio >= 0.008;

  return !(
    metrics.areaRatio < 0.28 ||
    metrics.areaRatio > 0.94 ||
    metrics.shortLongRatio < 0.54 ||
    metrics.shortLongRatio > 0.84 ||
    metrics.fillRatio < 0.48 ||
    metrics.foregroundShare < 0.7 ||
    !completeCornersAreVisible ||
    !geometryIsStable ||
    metrics.confidence < 0.66 ||
    (frameAlreadyLooksCardShaped && metrics.areaRatio < 0.72)
  );
}
