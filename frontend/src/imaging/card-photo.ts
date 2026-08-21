import {
  getNormalizedCardDimensions,
} from "./card-detection.ts";
import {
  detectCardBoundary,
  type CardBoundaryQuad,
} from "./card-boundary.ts";

export type PreparedCardPhoto = {
  image: string;
  normalized: boolean;
};

export type CardDetailImage = {
  label: string;
  image: string;
};

type Point = { x: number; y: number };
type Quad = CardBoundaryQuad;

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

function distance(left: Point, right: Point) {
  return Math.hypot(right.x - left.x, right.y - left.y);
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
  const detection = detectCardBoundary(data, width, height);
  if (!detection) return null;

  const sourceScaleX = canvas.width / width;
  const sourceScaleY = canvas.height / height;
  return detection.corners.map((point) => ({
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
  // Canvas clips antialias each triangle independently. When neighboring mesh
  // triangles meet exactly, that can leave a transparent sub-pixel seam which
  // JPEG encoding renders as a thin black line. Slightly overlapping only the
  // clip (not the texture transform) keeps the warp continuous without moving
  // the sampled card image.
  const clipPoints = expandedTriangleClip(destinationPoints);
  context.beginPath();
  context.moveTo(clipPoints[0].x, clipPoints[0].y);
  context.lineTo(clipPoints[1].x, clipPoints[1].y);
  context.lineTo(clipPoints[2].x, clipPoints[2].y);
  context.closePath();
  context.clip();
  context.setTransform(a, b, c, d, e, f);
  context.drawImage(source, 0, 0);
  context.restore();
}

export function expandedTriangleClip(
  points: [Point, Point, Point],
  overlapPixels = 1.25,
): [Point, Point, Point] {
  const center = {
    x: (points[0].x + points[1].x + points[2].x) / 3,
    y: (points[0].y + points[1].y + points[2].y) / 3,
  };
  return points.map((point) => {
    const offsetX = point.x - center.x;
    const offsetY = point.y - center.y;
    const length = Math.max(1, Math.hypot(offsetX, offsetY));
    const scale = 1 + overlapPixels / length;
    return {
      x: center.x + offsetX * scale,
      y: center.y + offsetY * scale,
    };
  }) as [Point, Point, Point];
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
  const corners = detectedCorners;
  const dimensions = getNormalizedCardDimensions(
    horizontalLength,
    verticalLength,
    maxDimension,
  );
  const output = document.createElement("canvas");
  output.width = dimensions.width;
  output.height = dimensions.height;
  const context = output.getContext("2d");
  if (!context) return null;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  // JPEG has no transparency. Keep any edge rounding or unexpected uncovered
  // pixel from being converted to black even before the overlapping mesh draws.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, output.width, output.height);
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
  maxDimension = 1900,
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
      ? straightenCard(source, corners, Math.min(maxDimension, 1900))
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
    const cropWidth = bitmap.width;
    // Narrow detail bands retain the small identifying text while avoiding two
    // nearly complete duplicate images in the model request.
    const cropHeight = Math.max(1, Math.round(bitmap.height * 0.32));
    const zones = [
      { label: "upper detail band", x: 0, y: 0 },
      { label: "lower detail band", x: 0, y: bitmap.height - cropHeight },
    ];
    return zones.flatMap((zone) => {
      const scale = Math.min(1.2, 900 / Math.max(cropWidth, cropHeight));
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
      return [{ label: zone.label, image: canvas.toDataURL("image/jpeg", 0.9) }];
    });
  } catch {
    return [];
  } finally {
    bitmap?.close();
  }
}
