import {
  type CardDetectionMetrics,
  isReliableCardDetection,
} from "./card-detection.ts";

export type CardBoundaryPoint = { x: number; y: number };
export type CardBoundaryQuad = [
  CardBoundaryPoint,
  CardBoundaryPoint,
  CardBoundaryPoint,
  CardBoundaryPoint,
];

export type CardBoundaryDetection = {
  corners: CardBoundaryQuad;
  metrics: CardDetectionMetrics;
};

export type CardBoundaryCandidate = CardBoundaryDetection & {
  threshold: number;
  reliable: boolean;
};

const STANDARD_CARD_RATIO = 2.5 / 3.5;

function percentile(values: number[], ratio: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
}

function median(values: number[]) {
  return percentile(values, 0.5);
}

function distance(left: CardBoundaryPoint, right: CardBoundaryPoint) {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

function quadArea(
  [topLeft, topRight, bottomRight, bottomLeft]: CardBoundaryQuad,
) {
  return Math.abs(
    (topLeft.x * topRight.y - topRight.x * topLeft.y +
      topRight.x * bottomRight.y - bottomRight.x * topRight.y +
      bottomRight.x * bottomLeft.y - bottomLeft.x * bottomRight.y +
      bottomLeft.x * topLeft.y - topLeft.x * bottomLeft.y) /
      2,
  );
}

function smoothRgb(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
) {
  if (radius <= 0) return data;
  const stride = width + 1;
  const red = new Uint32Array(stride * (height + 1));
  const green = new Uint32Array(stride * (height + 1));
  const blue = new Uint32Array(stride * (height + 1));

  for (let y = 1; y <= height; y += 1) {
    let rowRed = 0;
    let rowGreen = 0;
    let rowBlue = 0;
    for (let x = 1; x <= width; x += 1) {
      const dataIndex = ((y - 1) * width + x - 1) * 4;
      rowRed += data[dataIndex];
      rowGreen += data[dataIndex + 1];
      rowBlue += data[dataIndex + 2];
      const integralIndex = y * stride + x;
      red[integralIndex] = red[integralIndex - stride] + rowRed;
      green[integralIndex] = green[integralIndex - stride] + rowGreen;
      blue[integralIndex] = blue[integralIndex - stride] + rowBlue;
    }
  }

  const smoothed = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y += 1) {
    const top = Math.max(0, y - radius);
    const bottom = Math.min(height, y + radius + 1);
    for (let x = 0; x < width; x += 1) {
      const left = Math.max(0, x - radius);
      const right = Math.min(width, x + radius + 1);
      const count = (right - left) * (bottom - top);
      const topLeft = top * stride + left;
      const topRight = top * stride + right;
      const bottomLeft = bottom * stride + left;
      const bottomRight = bottom * stride + right;
      const outputIndex = (y * width + x) * 4;
      smoothed[outputIndex] = Math.round(
        (red[bottomRight] - red[topRight] - red[bottomLeft] + red[topLeft]) /
          count,
      );
      smoothed[outputIndex + 1] = Math.round(
        (green[bottomRight] -
          green[topRight] -
          green[bottomLeft] +
          green[topLeft]) /
          count,
      );
      smoothed[outputIndex + 2] = Math.round(
        (blue[bottomRight] - blue[topRight] - blue[bottomLeft] + blue[topLeft]) /
          count,
      );
      smoothed[outputIndex + 3] = 255;
    }
  }
  return smoothed;
}

function morphMask(
  mask: Uint8Array,
  width: number,
  height: number,
  operation: "dilate" | "erode",
) {
  const result = new Uint8Array(mask.length);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      let value = operation === "erode" ? 1 : 0;
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          const neighbor = mask[(y + offsetY) * width + x + offsetX];
          if (operation === "dilate" && neighbor) value = 1;
          if (operation === "erode" && !neighbor) value = 0;
        }
      }
      result[y * width + x] = value;
    }
  }
  return result;
}

function largestComponent(mask: Uint8Array, width: number, height: number) {
  const visited = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  let best: { count: number; corners: CardBoundaryQuad } | null = null;

  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    let count = 0;
    let topLeft = { x: width, y: height };
    let topRight = { x: 0, y: height };
    let bottomRight = { x: 0, y: 0 };
    let bottomLeft = { x: width, y: 0 };
    let minimumSum = Number.POSITIVE_INFINITY;
    let maximumSum = Number.NEGATIVE_INFINITY;
    let minimumDifference = Number.POSITIVE_INFINITY;
    let maximumDifference = Number.NEGATIVE_INFINITY;

    while (head < tail) {
      const index = queue[head++];
      const x = index % width;
      const y = Math.floor(index / width);
      const sum = x + y;
      const difference = x - y;
      count += 1;
      if (sum < minimumSum) {
        minimumSum = sum;
        topLeft = { x, y };
      }
      if (difference > maximumDifference) {
        maximumDifference = difference;
        topRight = { x, y };
      }
      if (sum > maximumSum) {
        maximumSum = sum;
        bottomRight = { x, y };
      }
      if (difference < minimumDifference) {
        minimumDifference = difference;
        bottomLeft = { x, y };
      }

      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if (offsetX === 0 && offsetY === 0) continue;
          const nextX = x + offsetX;
          const nextY = y + offsetY;
          if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) {
            continue;
          }
          const next = nextY * width + nextX;
          if (mask[next] && !visited[next]) {
            visited[next] = 1;
            queue[tail++] = next;
          }
        }
      }
    }

    if (!best || count > best.count) {
      best = {
        count,
        corners: [topLeft, topRight, bottomRight, bottomLeft],
      };
    }
  }
  return best;
}

function expandQuad(
  corners: CardBoundaryQuad,
  width: number,
  height: number,
): CardBoundaryQuad {
  const center = corners.reduce(
    (total, point) => ({ x: total.x + point.x / 4, y: total.y + point.y / 4 }),
    { x: 0, y: 0 },
  );
  return corners.map((point) => ({
    x: Math.max(0, Math.min(width - 1, center.x + (point.x - center.x) * 1.012)),
    y: Math.max(0, Math.min(height - 1, center.y + (point.y - center.y) * 1.012)),
  })) as CardBoundaryQuad;
}

function candidateFromMask(mask: Uint8Array, width: number, height: number) {
  const closedMask = morphMask(
    morphMask(mask, width, height, "dilate"),
    width,
    height,
    "erode",
  );
  const component = largestComponent(closedMask, width, height);
  if (!component) return null;

  let foregroundCount = 0;
  for (const value of closedMask) foregroundCount += value;
  const corners = expandQuad(component.corners, width, height);
  const area = quadArea(corners);
  const areaRatio = area / (width * height);
  const topWidth = distance(corners[0], corners[1]);
  const bottomWidth = distance(corners[3], corners[2]);
  const leftHeight = distance(corners[0], corners[3]);
  const rightHeight = distance(corners[1], corners[2]);
  const measuredWidth = (topWidth + bottomWidth) / 2;
  const measuredHeight = (leftHeight + rightHeight) / 2;
  const shortLongRatio =
    Math.min(measuredWidth, measuredHeight) /
    Math.max(measuredWidth, measuredHeight);
  const fillRatio = Math.min(1, component.count / Math.max(1, area));
  const foregroundShare = component.count / Math.max(1, foregroundCount);
  const oppositeWidthBalance =
    Math.min(topWidth, bottomWidth) / Math.max(1, Math.max(topWidth, bottomWidth));
  const oppositeHeightBalance =
    Math.min(leftHeight, rightHeight) /
    Math.max(1, Math.max(leftHeight, rightHeight));
  const firstDiagonal = distance(corners[0], corners[2]);
  const secondDiagonal = distance(corners[1], corners[3]);
  const diagonalBalance =
    Math.min(firstDiagonal, secondDiagonal) /
    Math.max(1, Math.max(firstDiagonal, secondDiagonal));
  const frameShortLongRatio = Math.min(width, height) / Math.max(width, height);
  const aspectScore = Math.max(
    0,
    1 - Math.abs(shortLongRatio - STANDARD_CARD_RATIO) / 0.22,
  );
  const fillScore = Math.max(0, Math.min(1, (fillRatio - 0.35) / 0.5));
  const sizeScore = Math.max(0, Math.min(1, (areaRatio - 0.14) / 0.24));
  const confidence = aspectScore * 0.45 + fillScore * 0.4 + sizeScore * 0.15;
  const metrics: CardDetectionMetrics = {
    areaRatio,
    shortLongRatio,
    fillRatio,
    foregroundShare,
    oppositeWidthBalance,
    oppositeHeightBalance,
    diagonalBalance,
    frameShortLongRatio,
    confidence,
  };
  return { corners, metrics };
}

/**
 * Finds a complete card boundary against uneven surfaces. The small box blur
 * suppresses leather/fabric grain, while trying several thresholds avoids
 * making one reflective card or one background texture decide the result.
 */
export function evaluateCardBoundaries(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): CardBoundaryCandidate[] {
  if (width < 8 || height < 8 || data.length < width * height * 4) return [];
  const smoothed = smoothRgb(data, width, height, 2);
  const borderDepth = Math.max(2, Math.round(Math.min(width, height) * 0.025));
  const red: number[] = [];
  const green: number[] = [];
  const blue: number[] = [];
  const borderIndexes: number[] = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (
        x >= borderDepth &&
        x < width - borderDepth &&
        y >= borderDepth &&
        y < height - borderDepth
      ) {
        continue;
      }
      const pixel = y * width + x;
      const dataIndex = pixel * 4;
      borderIndexes.push(pixel);
      red.push(smoothed[dataIndex]);
      green.push(smoothed[dataIndex + 1]);
      blue.push(smoothed[dataIndex + 2]);
    }
  }

  const background = { red: median(red), green: median(green), blue: median(blue) };
  const distances = new Float32Array(width * height);
  for (let pixel = 0; pixel < distances.length; pixel += 1) {
    const dataIndex = pixel * 4;
    distances[pixel] = Math.hypot(
      smoothed[dataIndex] - background.red,
      smoothed[dataIndex + 1] - background.green,
      smoothed[dataIndex + 2] - background.blue,
    );
  }
  const borderDistances = borderIndexes.map((pixel) => distances[pixel]);
  const adaptiveThreshold = Math.max(
    26,
    Math.min(105, percentile(borderDistances, 0.9) * 1.35 + 10),
  );
  const thresholds = [...new Set([
    adaptiveThreshold,
    adaptiveThreshold * 0.82,
    adaptiveThreshold * 1.18,
    34,
    44,
    56,
    70,
    86,
  ].map((value) => Math.round(value)))];
  const candidates: CardBoundaryCandidate[] = [];

  for (const threshold of thresholds) {
    const mask = new Uint8Array(width * height);
    for (let pixel = 0; pixel < mask.length; pixel += 1) {
      mask[pixel] = distances[pixel] >= threshold ? 1 : 0;
    }
    const candidate = candidateFromMask(mask, width, height);
    if (candidate) {
      candidates.push({
        ...candidate,
        threshold,
        reliable: isReliableCardDetection(candidate.metrics),
      });
    }
  }

  return candidates;
}

export function detectCardBoundary(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): CardBoundaryDetection | null {
  const candidates = evaluateCardBoundaries(data, width, height).filter(
    (candidate) => candidate.reliable,
  );

  return candidates.sort((left, right) => {
    const leftScore = left.metrics.confidence + left.metrics.areaRatio * 0.08;
    const rightScore = right.metrics.confidence + right.metrics.areaRatio * 0.08;
    return rightScore - leftScore;
  })[0] ?? null;
}
