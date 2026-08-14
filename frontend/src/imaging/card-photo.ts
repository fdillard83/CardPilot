import { isReliableCardDetection } from "./card-detection";

export type PreparedCardPhoto = {
  image: string;
  normalized: boolean;
};

export type CardDetailImage = {
  label: string;
  image: string;
};

type Point = { x: number; y: number };
type Quad = [Point, Point, Point, Point];

const STANDARD_CARD_RATIO = 2.5 / 3.5;
const DETECTION_MAX_DIMENSION = 480;

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("The selected image could not be read."));
    };
    reader.onerror = () =>
      reject(new Error("The selected image could not be read."));
    reader.readAsDataURL(file);
  });
}

function percentile(values: number[], ratio: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
}

function median(values: number[]) {
  return percentile(values, 0.5);
}

function distance(left: Point, right: Point) {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

function quadArea([topLeft, topRight, bottomRight, bottomLeft]: Quad) {
  return Math.abs(
    (topLeft.x * topRight.y - topRight.x * topLeft.y +
      topRight.x * bottomRight.y - bottomRight.x * topRight.y +
      bottomRight.x * bottomLeft.y - bottomLeft.x * bottomRight.y +
      bottomLeft.x * topLeft.y - topLeft.x * bottomLeft.y) /
      2,
  );
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
  let best:
    | {
        count: number;
        corners: Quad;
      }
    | null = null;

  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue;
    let head = 0;
    let tail = 0;
    queue[tail] = start;
    tail += 1;
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
      const index = queue[head];
      head += 1;
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
            queue[tail] = next;
            tail += 1;
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

function expandQuad(corners: Quad, width: number, height: number): Quad {
  const center = corners.reduce(
    (total, point) => ({ x: total.x + point.x / 4, y: total.y + point.y / 4 }),
    { x: 0, y: 0 },
  );
  return corners.map((point) => ({
    x: Math.max(0, Math.min(width - 1, center.x + (point.x - center.x) * 1.012)),
    y: Math.max(0, Math.min(height - 1, center.y + (point.y - center.y) * 1.012)),
  })) as Quad;
}

function detectCardQuad(canvas: HTMLCanvasElement): Quad | null {
  const scale = Math.min(
    1,
    DETECTION_MAX_DIMENSION / Math.max(canvas.width, canvas.height),
  );
  const width = Math.max(1, Math.round(canvas.width * scale));
  const height = Math.max(1, Math.round(canvas.height * scale));
  const workCanvas = document.createElement("canvas");
  workCanvas.width = width;
  workCanvas.height = height;
  const context = workCanvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(canvas, 0, 0, width, height);
  const { data } = context.getImageData(0, 0, width, height);
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
      red.push(data[dataIndex]);
      green.push(data[dataIndex + 1]);
      blue.push(data[dataIndex + 2]);
    }
  }

  const background = { red: median(red), green: median(green), blue: median(blue) };
  const colorDistance = (pixel: number) => {
    const dataIndex = pixel * 4;
    return Math.sqrt(
      (data[dataIndex] - background.red) ** 2 +
        (data[dataIndex + 1] - background.green) ** 2 +
        (data[dataIndex + 2] - background.blue) ** 2,
    );
  };
  const borderDistances = borderIndexes.map(colorDistance);
  const threshold = Math.max(30, Math.min(115, percentile(borderDistances, 0.9) * 1.35 + 12));
  const mask = new Uint8Array(width * height);
  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    mask[pixel] = colorDistance(pixel) >= threshold ? 1 : 0;
  }
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
  const imageArea = width * height;
  const areaRatio = area / imageArea;
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
  if (!isReliableCardDetection({
    areaRatio,
    shortLongRatio,
    fillRatio,
    foregroundShare,
    oppositeWidthBalance,
    oppositeHeightBalance,
    diagonalBalance,
    frameShortLongRatio,
    confidence,
  })) {
    return null;
  }

  const sourceScaleX = canvas.width / width;
  const sourceScaleY = canvas.height / height;
  return corners.map((point) => ({
    x: point.x * sourceScaleX,
    y: point.y * sourceScaleY,
  })) as Quad;
}

function projectPoint(corners: Quad, horizontal: number, vertical: number) {
  const [topLeft, topRight, bottomRight, bottomLeft] = corners;
  const dx1 = topRight.x - bottomRight.x;
  const dx2 = bottomLeft.x - bottomRight.x;
  const dx3 = topLeft.x - topRight.x + bottomRight.x - bottomLeft.x;
  const dy1 = topRight.y - bottomRight.y;
  const dy2 = bottomLeft.y - bottomRight.y;
  const dy3 = topLeft.y - topRight.y + bottomRight.y - bottomLeft.y;
  const determinant = dx1 * dy2 - dx2 * dy1;
  let perspectiveX = 0;
  let perspectiveY = 0;
  if (Math.abs(determinant) > 0.0001) {
    perspectiveX = (dx3 * dy2 - dx2 * dy3) / determinant;
    perspectiveY = (dx1 * dy3 - dx3 * dy1) / determinant;
  }
  const a = topRight.x - topLeft.x + perspectiveX * topRight.x;
  const b = bottomLeft.x - topLeft.x + perspectiveY * bottomLeft.x;
  const c = topLeft.x;
  const d = topRight.y - topLeft.y + perspectiveX * topRight.y;
  const e = bottomLeft.y - topLeft.y + perspectiveY * bottomLeft.y;
  const f = topLeft.y;
  const divisor = perspectiveX * horizontal + perspectiveY * vertical + 1;
  return {
    x: (a * horizontal + b * vertical + c) / divisor,
    y: (d * horizontal + e * vertical + f) / divisor,
  };
}

function drawTexturedTriangle(
  context: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  sourcePoints: [Point, Point, Point],
  destinationPoints: [Point, Point, Point],
) {
  const [sourceA, sourceB, sourceC] = sourcePoints;
  const [destinationA, destinationB, destinationC] = destinationPoints;
  const divisor =
    sourceA.x * (sourceB.y - sourceC.y) +
    sourceB.x * (sourceC.y - sourceA.y) +
    sourceC.x * (sourceA.y - sourceB.y);
  if (Math.abs(divisor) < 0.0001) return;
  const a =
    (destinationA.x * (sourceB.y - sourceC.y) +
      destinationB.x * (sourceC.y - sourceA.y) +
      destinationC.x * (sourceA.y - sourceB.y)) /
    divisor;
  const c =
    (destinationA.x * (sourceC.x - sourceB.x) +
      destinationB.x * (sourceA.x - sourceC.x) +
      destinationC.x * (sourceB.x - sourceA.x)) /
    divisor;
  const e =
    (destinationA.x * (sourceB.x * sourceC.y - sourceC.x * sourceB.y) +
      destinationB.x * (sourceC.x * sourceA.y - sourceA.x * sourceC.y) +
      destinationC.x * (sourceA.x * sourceB.y - sourceB.x * sourceA.y)) /
    divisor;
  const b =
    (destinationA.y * (sourceB.y - sourceC.y) +
      destinationB.y * (sourceC.y - sourceA.y) +
      destinationC.y * (sourceA.y - sourceB.y)) /
    divisor;
  const d =
    (destinationA.y * (sourceC.x - sourceB.x) +
      destinationB.y * (sourceA.x - sourceC.x) +
      destinationC.y * (sourceB.x - sourceA.x)) /
    divisor;
  const f =
    (destinationA.y * (sourceB.x * sourceC.y - sourceC.x * sourceB.y) +
      destinationB.y * (sourceC.x * sourceA.y - sourceA.x * sourceC.y) +
      destinationC.y * (sourceA.x * sourceB.y - sourceB.x * sourceA.y)) /
    divisor;

  context.save();
  context.beginPath();
  context.moveTo(destinationA.x, destinationA.y);
  context.lineTo(destinationB.x, destinationB.y);
  context.lineTo(destinationC.x, destinationC.y);
  context.closePath();
  context.clip();
  context.setTransform(a, b, c, d, e, f);
  context.drawImage(source, 0, 0);
  context.restore();
}

function straightenCard(
  source: HTMLCanvasElement,
  detectedCorners: Quad,
  maxDimension: number,
) {
  const horizontalLength =
    (distance(detectedCorners[0], detectedCorners[1]) +
      distance(detectedCorners[3], detectedCorners[2])) /
    2;
  const verticalLength =
    (distance(detectedCorners[0], detectedCorners[3]) +
      distance(detectedCorners[1], detectedCorners[2])) /
    2;
  const corners: Quad =
    horizontalLength > verticalLength
      ? [
          detectedCorners[3],
          detectedCorners[0],
          detectedCorners[1],
          detectedCorners[2],
        ]
      : detectedCorners;
  const output = document.createElement("canvas");
  output.height = Math.max(1, Math.round(maxDimension));
  output.width = Math.max(1, Math.round(output.height * STANDARD_CARD_RATIO));
  const context = output.getContext("2d");
  if (!context) return null;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  const columns = 16;
  const rows = 22;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const left = column / columns;
      const right = (column + 1) / columns;
      const top = row / rows;
      const bottom = (row + 1) / rows;
      const sourceTopLeft = projectPoint(corners, left, top);
      const sourceTopRight = projectPoint(corners, right, top);
      const sourceBottomRight = projectPoint(corners, right, bottom);
      const sourceBottomLeft = projectPoint(corners, left, bottom);
      const destinationTopLeft = { x: left * output.width, y: top * output.height };
      const destinationTopRight = { x: right * output.width, y: top * output.height };
      const destinationBottomRight = {
        x: right * output.width,
        y: bottom * output.height,
      };
      const destinationBottomLeft = {
        x: left * output.width,
        y: bottom * output.height,
      };
      drawTexturedTriangle(
        context,
        source,
        [sourceTopLeft, sourceTopRight, sourceBottomRight],
        [destinationTopLeft, destinationTopRight, destinationBottomRight],
      );
      drawTexturedTriangle(
        context,
        source,
        [sourceTopLeft, sourceBottomRight, sourceBottomLeft],
        [destinationTopLeft, destinationBottomRight, destinationBottomLeft],
      );
    }
  }
  return output;
}

export async function prepareCardPhoto(
  file: File,
  maxDimension = 2400,
): Promise<PreparedCardPhoto> {
  if (typeof createImageBitmap !== "function" || file.type === "image/gif") {
    return { image: await fileToDataUrl(file), normalized: false };
  }

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const source = document.createElement("canvas");
    source.width = Math.max(1, Math.round(bitmap.width * scale));
    source.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = source.getContext("2d");
    if (!context) return { image: await fileToDataUrl(file), normalized: false };
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, source.width, source.height);
    const corners = detectCardQuad(source);
    const normalized = corners
      ? straightenCard(source, corners, Math.min(maxDimension, 2200))
      : null;
    if (normalized) {
      return { image: normalized.toDataURL("image/jpeg", 0.92), normalized: true };
    }
    if (scale === 1 && file.size < 2.5 * 1024 * 1024) {
      return { image: await fileToDataUrl(file), normalized: false };
    }
    return { image: source.toDataURL("image/jpeg", 0.92), normalized: false };
  } catch {
    return { image: await fileToDataUrl(file), normalized: false };
  } finally {
    bitmap?.close();
  }
}

export async function createCardDetailImages(
  imageDataUrl: string,
): Promise<CardDetailImage[]> {
  if (typeof createImageBitmap !== "function") return [];
  let bitmap: ImageBitmap | null = null;
  try {
    const imageBlob = await (await fetch(imageDataUrl)).blob();
    bitmap = await createImageBitmap(imageBlob);
    const cropWidth = Math.max(1, Math.round(bitmap.width * 0.55));
    const cropHeight = Math.max(1, Math.round(bitmap.height * 0.55));
    const zones = [
      { label: "top-left", x: 0, y: 0 },
      { label: "top-right", x: bitmap.width - cropWidth, y: 0 },
      { label: "bottom-left", x: 0, y: bitmap.height - cropHeight },
      {
        label: "bottom-right",
        x: bitmap.width - cropWidth,
        y: bitmap.height - cropHeight,
      },
    ];
    return zones.flatMap((zone) => {
      const scale = Math.min(2, 960 / Math.max(cropWidth, cropHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(cropWidth * scale));
      canvas.height = Math.max(1, Math.round(cropHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) return [];
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(
        bitmap as ImageBitmap,
        zone.x,
        zone.y,
        cropWidth,
        cropHeight,
        0,
        0,
        canvas.width,
        canvas.height,
      );
      return [{ label: zone.label, image: canvas.toDataURL("image/jpeg", 0.88) }];
    });
  } catch {
    return [];
  } finally {
    bitmap?.close();
  }
}
