import sharp from "sharp";

const width = 48;
const height = 68;
const channels = 3;
const maxImageBytes = 8 * 1024 * 1024;
const allowedImageHosts = new Set(["i.ebayimg.com", "thumbs.ebaystatic.com"]);

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

async function normalizedPixels(buffer) {
  const { data } = await sharp(buffer, { failOn: "warning" })
    .rotate()
    .flatten({ background: "white" })
    .resize(width, height, { fit: "fill", kernel: sharp.kernel.lanczos3 })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (data.length !== width * height * channels) throw new Error("The card image could not be normalized.");
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

function pixelSignature(data) {
  const values = new Float64Array(width * height * channels);
  const means = [0, 0, 0];
  for (let index = 0; index < width * height; index += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      means[channel] += data[index * channels + channel];
    }
  }
  means.forEach((_, channel) => { means[channel] /= width * height; });
  for (let index = 0; index < width * height; index += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      values[index * channels + channel] = (data[index * channels + channel] - means[channel]) / 128;
    }
  }
  return values;
}

function borderHistogram(data) {
  const histogram = new Float64Array(64);
  const borderX = Math.max(2, Math.round(width * 0.12));
  const borderY = Math.max(2, Math.round(height * 0.09));
  let count = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x >= borderX && x < width - borderX && y >= borderY && y < height - borderY) continue;
      const offset = (y * width + x) * channels;
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

function layoutSignature(data) {
  const edges = new Float64Array((width - 1) * (height - 1));
  let output = 0;
  for (let y = 0; y < height - 1; y += 1) {
    for (let x = 0; x < width - 1; x += 1) {
      const current = y * width + x;
      const horizontal = luminance(data, current + 1) - luminance(data, current);
      const vertical = luminance(data, current + width) - luminance(data, current);
      edges[output] = Math.sqrt(horizontal ** 2 + vertical ** 2) / 255;
      output += 1;
    }
  }
  return edges;
}

async function signature(buffer) {
  const pixels = await normalizedPixels(buffer);
  return {
    pixels: pixelSignature(pixels),
    border: borderHistogram(pixels),
    layout: layoutSignature(pixels),
  };
}

function compare(source, candidate) {
  const pixelScore = cosineSimilarity(source.pixels, candidate.pixels);
  const borderScore = histogramIntersection(source.border, candidate.border);
  const layoutScore = cosineSimilarity(source.layout, candidate.layout);
  const score = pixelScore * 0.45 + borderScore * 0.3 + layoutScore * 0.25;
  return {
    score: Number(score.toFixed(3)),
    pixelScore: Number(pixelScore.toFixed(3)),
    borderScore: Number(borderScore.toFixed(3)),
    layoutScore: Number(layoutScore.toFixed(3)),
  };
}

export class VisualImageMatcher {
  constructor({ fetchImpl = fetch, timeoutMs = 3_500 } = {}) {
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async rank({ sourceImageDataUrl, candidates, limit = 6 }) {
    const source = await signature(dataUrlBuffer(sourceImageDataUrl));
    const ranked = await Promise.all(candidates.slice(0, limit).map(async (candidate) => {
      const url = safeCandidateUrl(candidate.imageUrl);
      if (!url) return candidate;
      try {
        const response = await this.fetch(url, {
          headers: { Accept: "image/avif,image/webp,image/jpeg,image/png" },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (!response.ok) return candidate;
        const contentLength = Number(response.headers.get("content-length"));
        if (Number.isFinite(contentLength) && contentLength > maxImageBytes) return candidate;
        const buffer = Buffer.from(await response.arrayBuffer());
        if (!buffer.length || buffer.length > maxImageBytes) return candidate;
        return { ...candidate, visualMatch: compare(source, await signature(buffer)) };
      } catch {
        return candidate;
      }
    }));
    return [
      ...ranked,
      ...candidates.slice(limit),
    ];
  }
}

export const visualImageInternals = { signature, compare, safeCandidateUrl };
