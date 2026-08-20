import sharp from "sharp";

const portraitWidth = 48;
const portraitHeight = 68;
const channels = 3;
const maxImageBytes = 8 * 1024 * 1024;
const allowedImageHosts = new Set([
  "i.ebayimg.com",
  "thumbs.ebaystatic.com",
  "thecardapi.com",
  "www.thecardapi.com",
]);

function dataUrlBuffer(dataUrl) {
  const match = typeof dataUrl === "string" && dataUrl.match(
    /^data:image\/(?:jpeg|png|webp|gif);base64,([a-z0-9+/=\r\n]+)$/i,
  );
  if (!match) throw new TypeError("A supported source card image is required.");
  const buffer = Buffer.from(match[1].replace(/[\r\n]/g, ""), "base64");
  if (!buffer.length || buffer.length > maxImageBytes) throw new TypeError("The source card image is too large.");
  return buffer;
}

function safeCandidateUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && allowedImageHosts.has(url.hostname.toLowerCase())
      ? url
      : null;
  } catch {
    return null;
  }
}

async function orientedImage(buffer) {
  const result = await sharp(buffer, { failOn: "warning" })
    .rotate()
    .flatten({ background: "white" })
    .toColourspace("srgb")
    .png()
    .toBuffer({ resolveWithObject: true });
  return { buffer: result.data, width: result.info.width, height: result.info.height };
}

function targetDimensions(image) {
  return image.width > image.height
    ? { width: portraitHeight, height: portraitWidth }
    : { width: portraitWidth, height: portraitHeight };
}

function centeredCardCrop(image, target, scale = 1, centerY = 0.5) {
  const ratio = target.width / target.height;
  let width = image.width;
  let height = Math.round(width / ratio);
  if (height > image.height) {
    height = image.height;
    width = Math.round(height * ratio);
  }
  width = Math.max(1, Math.round(width * scale));
  height = Math.max(1, Math.round(height * scale));
  const left = Math.max(0, Math.min(image.width - width, Math.round((image.width - width) / 2)));
  const top = Math.max(0, Math.min(image.height - height, Math.round(image.height * centerY - height / 2)));
  return { left, top, width, height };
}

function adjustBoxToRatio(box, image, target) {
  const ratio = target.width / target.height;
  const centerX = box.left + box.width / 2;
  const centerY = box.top + box.height / 2;
  let width = box.width;
  let height = box.height;
  if (width / height > ratio) height = width / ratio;
  else width = height * ratio;
  width = Math.min(image.width, Math.max(1, Math.round(width * 1.04)));
  height = Math.min(image.height, Math.max(1, Math.round(height * 1.04)));
  return {
    left: Math.max(0, Math.min(image.width - width, Math.round(centerX - width / 2))),
    top: Math.max(0, Math.min(image.height - height, Math.round(centerY - height / 2))),
    width,
    height,
  };
}

function colorDistance(left, right) {
  return Math.sqrt(
    (left[0] - right[0]) ** 2 +
    (left[1] - right[1]) ** 2 +
    (left[2] - right[2]) ** 2,
  );
}

async function backgroundObjectBox(image) {
  const sample = await sharp(image.buffer)
    .resize({ width: 320, height: 320, fit: "inside", withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = sample.info;
  const pixel = (x, y) => {
    const offset = (y * width + x) * channels;
    return [sample.data[offset], sample.data[offset + 1], sample.data[offset + 2]];
  };
  const corners = [pixel(0, 0), pixel(width - 1, 0), pixel(0, height - 1), pixel(width - 1, height - 1)];
  if (corners.some((corner, index) => corners.slice(index + 1).some((other) => colorDistance(corner, other) > 34))) {
    return null;
  }
  const background = corners.reduce(
    (mean, color) => mean.map((value, channel) => value + color[channel] / corners.length),
    [0, 0, 0],
  );
  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;
  let foreground = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (colorDistance(pixel(x, y), background) < 38) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
      foreground += 1;
    }
  }
  if (right < left || bottom < top || foreground < width * height * 0.08) return null;
  const boxWidth = right - left + 1;
  const boxHeight = bottom - top + 1;
  const coverage = boxWidth * boxHeight / (width * height);
  if (coverage > 0.94 || boxWidth < width * 0.3 || boxHeight < height * 0.3) return null;
  const scaleX = image.width / width;
  const scaleY = image.height / height;
  return {
    left: Math.max(0, Math.floor(left * scaleX)),
    top: Math.max(0, Math.floor(top * scaleY)),
    width: Math.min(image.width, Math.ceil(boxWidth * scaleX)),
    height: Math.min(image.height, Math.ceil(boxHeight * scaleY)),
  };
}

async function normalizedPixels(image, crop, target) {
  const { data } = await sharp(image.buffer, { failOn: "warning" })
    .extract(crop)
    .resize(target.width, target.height, { fit: "fill", kernel: sharp.kernel.lanczos3 })
    .removeAlpha()
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (data.length !== target.width * target.height * channels) throw new Error("The card image could not be normalized.");
  return data;
}

function luminance(data, pixelIndex) {
  const offset = pixelIndex * channels;
  return data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114;
}

function cosineSimilarity(left, right) {
  let dot = 0;
  let leftLength = 0;
  let rightLength = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftLength += left[index] ** 2;
    rightLength += right[index] ** 2;
  }
  if (!leftLength || !rightLength) return 0;
  return Math.max(0, Math.min(1, dot / Math.sqrt(leftLength * rightLength)));
}

function pixelSignature(data, target) {
  const values = new Float64Array(target.width * target.height * channels);
  const means = [0, 0, 0];
  for (let index = 0; index < target.width * target.height; index += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      means[channel] += data[index * channels + channel];
    }
  }
  means.forEach((_, channel) => { means[channel] /= target.width * target.height; });
  for (let index = 0; index < target.width * target.height; index += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      values[index * channels + channel] = (data[index * channels + channel] - means[channel]) / 128;
    }
  }
  return values;
}

function borderHistogram(data, target) {
  const histogram = new Float64Array(64);
  const borderX = Math.max(2, Math.round(target.width * 0.12));
  const borderY = Math.max(2, Math.round(target.height * 0.09));
  let count = 0;
  for (let y = 0; y < target.height; y += 1) {
    for (let x = 0; x < target.width; x += 1) {
      if (x >= borderX && x < target.width - borderX && y >= borderY && y < target.height - borderY) continue;
      const offset = (y * target.width + x) * channels;
      const red = Math.min(3, Math.floor(data[offset] / 64));
      const green = Math.min(3, Math.floor(data[offset + 1] / 64));
      const blue = Math.min(3, Math.floor(data[offset + 2] / 64));
      histogram[red * 16 + green * 4 + blue] += 1;
      count += 1;
    }
  }
  if (count) for (let index = 0; index < histogram.length; index += 1) histogram[index] /= count;
  return histogram;
}

function histogramIntersection(left, right) {
  let overlap = 0;
  for (let index = 0; index < left.length; index += 1) overlap += Math.min(left[index], right[index]);
  return Math.max(0, Math.min(1, overlap));
}

function layoutSignature(data, target) {
  const edges = new Float64Array((target.width - 1) * (target.height - 1));
  let output = 0;
  for (let y = 0; y < target.height - 1; y += 1) {
    for (let x = 0; x < target.width - 1; x += 1) {
      const current = y * target.width + x;
      const horizontal = luminance(data, current + 1) - luminance(data, current);
      const vertical = luminance(data, current + target.width) - luminance(data, current);
      edges[output] = Math.sqrt(horizontal ** 2 + vertical ** 2) / 255;
      output += 1;
    }
  }
  return edges;
}

function structureSignature(data, target) {
  // Focus on the photograph/artwork area and preserve signed light/dark shapes.
  // This distinguishes a different pose on the same card template while being
  // substantially less sensitive than RGB pixels to parallel color changes.
  const left = Math.round(target.width * 0.12);
  const right = Math.round(target.width * 0.88);
  const top = Math.round(target.height * 0.14);
  const bottom = Math.round(target.height * 0.82);
  const values = new Float64Array((right - left) * (bottom - top));
  let mean = 0;
  let output = 0;
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const value = luminance(data, y * target.width + x);
      values[output] = value;
      mean += value;
      output += 1;
    }
  }
  mean /= values.length;
  for (let index = 0; index < values.length; index += 1) {
    values[index] = (values[index] - mean) / 128;
  }
  return values;
}

async function signature(image, crop, target) {
  const pixels = await normalizedPixels(image, crop, target);
  return {
    pixels: pixelSignature(pixels, target),
    border: borderHistogram(pixels, target),
    layout: layoutSignature(pixels, target),
    structure: structureSignature(pixels, target),
  };
}

async function sourceSignature(buffer) {
  const image = await orientedImage(buffer);
  const target = targetDimensions(image);
  const aspectDifference = Math.abs(
    image.width / image.height - target.width / target.height,
  ) / (target.width / target.height);
  const objectBox = aspectDifference > 0.12
    ? await backgroundObjectBox(image)
    : null;
  const crop = objectBox
    ? adjustBoxToRatio(objectBox, image, target)
    : centeredCardCrop(image, target);
  return {
    signature: await signature(image, crop, target),
    target,
  };
}

async function candidateSignatures(buffer, target) {
  const image = await orientedImage(buffer);
  const proposals = [];
  const add = (crop, normalization) => {
    const key = `${crop.left}:${crop.top}:${crop.width}:${crop.height}`;
    if (!proposals.some((proposal) => proposal.key === key)) proposals.push({ key, crop, normalization });
  };
  add(centeredCardCrop(image, target), "card_aspect");
  const objectBox = await backgroundObjectBox(image);
  if (objectBox) add(adjustBoxToRatio(objectBox, image, target), "background_trimmed");
  for (const scale of [0.88, 0.76, 0.66, 0.56]) {
    add(centeredCardCrop(image, target, scale, 0.5), `center_${Math.round(scale * 100)}`);
    if (image.height > image.width) {
      add(centeredCardCrop(image, target, scale, 0.57), `lower_${Math.round(scale * 100)}`);
    }
  }
  return Promise.all(proposals.map(async ({ crop, normalization }) => ({
    signature: await signature(image, crop, target),
    normalization,
    cropCoverage: Number((crop.width * crop.height / (image.width * image.height)).toFixed(3)),
  })));
}

function compare(source, candidate) {
  const pixelScore = cosineSimilarity(source.pixels, candidate.pixels);
  const borderScore = histogramIntersection(source.border, candidate.border);
  const layoutScore = cosineSimilarity(source.layout, candidate.layout);
  const structureScore = cosineSimilarity(source.structure, candidate.structure);
  const score = pixelScore * 0.25 + borderScore * 0.15 + layoutScore * 0.2 + structureScore * 0.4;
  return {
    score: Number(score.toFixed(3)),
    pixelScore: Number(pixelScore.toFixed(3)),
    borderScore: Number(borderScore.toFixed(3)),
    layoutScore: Number(layoutScore.toFixed(3)),
    structureScore: Number(structureScore.toFixed(3)),
  };
}

export function isVisualMismatch(visualMatch, visualMatchStatus = null) {
  // A missing or uninspected image is unknown evidence, not negative evidence.
  // Only a completed comparison can veto an otherwise strong text match.
  if (visualMatchStatus === "not_evaluated" || visualMatchStatus === "unavailable") return false;
  if (!Number.isFinite(visualMatch?.score)) return false;
  const structureScore = Number.isFinite(visualMatch.structureScore)
    ? visualMatch.structureScore
    : null;
  if (structureScore === null) return visualMatch.score < 0.5;
  return visualMatch.score < 0.4 ||
    structureScore < 0.25 ||
    (visualMatch.score < 0.58 && structureScore < 0.38);
}

export class VisualImageMatcher {
  constructor({ fetchImpl = fetch, timeoutMs = 3_500 } = {}) {
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async rank({ sourceImageDataUrl, candidates, limit = 6 }) {
    const source = await sourceSignature(dataUrlBuffer(sourceImageDataUrl));
    const ranked = await Promise.all(candidates.slice(0, limit).map(async (candidate) => {
      const url = safeCandidateUrl(candidate.imageUrl);
      if (!url) return { ...candidate, visualMatchStatus: "unavailable" };
      try {
        const response = await this.fetch(url, {
          headers: { Accept: "image/avif,image/webp,image/jpeg,image/png" },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (!response.ok) return { ...candidate, visualMatchStatus: "unavailable" };
        const contentLength = Number(response.headers.get("content-length"));
        if (Number.isFinite(contentLength) && contentLength > maxImageBytes) return { ...candidate, visualMatchStatus: "unavailable" };
        const buffer = Buffer.from(await response.arrayBuffer());
        if (!buffer.length || buffer.length > maxImageBytes) return { ...candidate, visualMatchStatus: "unavailable" };
        const comparisons = (await candidateSignatures(buffer, source.target)).map((variant) => {
          const visualMatch = compare(source.signature, variant.signature);
          const cropPenalty = Math.max(0, 0.32 - variant.cropCoverage) * 0.08;
          return {
            ...visualMatch,
            score: Number(Math.max(0, visualMatch.score - cropPenalty).toFixed(3)),
            normalization: variant.normalization,
            cropCoverage: variant.cropCoverage,
          };
        });
        const visualMatch = comparisons.sort((left, right) => right.score - left.score)[0];
        return { ...candidate, visualMatchStatus: "matched", visualMatch };
      } catch {
        return { ...candidate, visualMatchStatus: "unavailable" };
      }
    }));
    return [
      ...ranked,
      ...candidates.slice(limit).map((candidate) => ({
        ...candidate,
        visualMatchStatus: "not_evaluated",
      })),
    ];
  }
}

export const visualImageInternals = {
  backgroundObjectBox,
  candidateSignatures,
  compare,
  safeCandidateUrl,
  sourceSignature,
};
