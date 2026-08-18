import { createHash } from "node:crypto";
import { GoogleAuth } from "google-auth-library";

const visionEndpoint = "https://vision.googleapis.com/v1/images:annotate";
const supportedDataUrl = /^data:image\/(?:jpeg|png|webp|gif);base64,([a-z0-9+/=\r\n]+)$/i;

function imageContent(dataUrl) {
  const match = typeof dataUrl === "string" && dataUrl.match(supportedDataUrl);
  if (!match) throw new TypeError("Google web evidence requires a supported card image.");
  return match[1].replace(/[\r\n]/g, "");
}

function finiteScore(value, fallback) {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
}

function normalizeWebDetection(webDetection = {}) {
  const signals = [];
  for (const label of webDetection.bestGuessLabels ?? []) {
    if (label?.label) signals.push({
      type: "best_guess_label",
      text: label.label,
      url: null,
      imageUrl: null,
      strength: 0.58,
    });
  }
  for (const entity of webDetection.webEntities ?? []) {
    if (entity?.description) signals.push({
      type: "web_entity",
      text: entity.description,
      url: null,
      imageUrl: null,
      strength: finiteScore(entity.score, 0.45) * 0.65,
    });
  }
  for (const page of webDetection.pagesWithMatchingImages ?? []) {
    const fullImages = page.fullMatchingImages ?? [];
    const partialImages = page.partialMatchingImages ?? [];
    const matchType = fullImages.length
      ? "full_matching_page"
      : partialImages.length
        ? "partial_matching_page"
        : "matching_page";
    const baseStrength = matchType === "full_matching_page" ? 0.94 : matchType === "partial_matching_page" ? 0.78 : 0.6;
    const text = page.pageTitle || page.url;
    if (text) signals.push({
      type: matchType,
      text,
      url: page.url ?? null,
      imageUrl: fullImages[0]?.url ?? partialImages[0]?.url ?? null,
      strength: Math.max(baseStrength, finiteScore(page.score, baseStrength)),
    });
  }
  for (const image of webDetection.fullMatchingImages ?? []) {
    if (image?.url) signals.push({
      type: "full_matching_image",
      text: image.url,
      url: null,
      imageUrl: image.url,
      strength: Math.max(0.9, finiteScore(image.score, 0.9)),
    });
  }
  for (const image of webDetection.partialMatchingImages ?? []) {
    if (image?.url) signals.push({
      type: "partial_matching_image",
      text: image.url,
      url: null,
      imageUrl: image.url,
      strength: Math.max(0.72, finiteScore(image.score, 0.72)),
    });
  }
  for (const image of webDetection.visuallySimilarImages ?? []) {
    if (image?.url) signals.push({
      type: "visually_similar_image",
      text: image.url,
      url: null,
      imageUrl: image.url,
      strength: finiteScore(image.score, 0.32) * 0.45,
    });
  }
  return signals
    .filter((signal) => signal.strength > 0)
    .sort((left, right) => right.strength - left.strength)
    .slice(0, 30);
}

export function googleVisionConfiguration(environment = process.env) {
  if (environment.GOOGLE_VISION_ENABLED !== "true") return null;
  const encoded = environment.GOOGLE_CLOUD_CREDENTIALS_BASE64?.trim();
  if (!encoded) throw new Error("GOOGLE_CLOUD_CREDENTIALS_BASE64 is required when Google Vision is enabled.");
  let credentials;
  try {
    credentials = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  } catch {
    throw new Error("The Google Cloud credential is not valid Base64-encoded JSON.");
  }
  if (
    credentials?.type !== "service_account" ||
    typeof credentials.project_id !== "string" ||
    typeof credentials.client_email !== "string" ||
    typeof credentials.private_key !== "string"
  ) {
    throw new Error("The Google Cloud credential must be a service-account JSON key.");
  }
  return {
    credentials,
    projectId: environment.GOOGLE_CLOUD_PROJECT_ID?.trim() || credentials.project_id,
    timeoutMs: Math.max(500, Math.min(8_000, Number(environment.GOOGLE_VISION_TIMEOUT_MS) || 3_000)),
  };
}

export class GoogleWebEvidenceProvider {
  constructor({
    credentials,
    projectId,
    timeoutMs = 3_000,
    fetchImpl = fetch,
    auth = new GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/cloud-platform"] }),
    now = Date.now,
    ttlMs = 24 * 60 * 60 * 1000,
    maxEntries = 250,
  }) {
    this.name = "google_web_detection";
    this.projectId = projectId;
    this.timeoutMs = timeoutMs;
    this.fetch = fetchImpl;
    this.auth = auth;
    this.now = now;
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.cache = new Map();
    this.inFlight = new Map();
  }

  async analyze(intake) {
    const content = imageContent(intake.frontImage);
    const key = createHash("sha256").update(content).digest("base64url");
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.now()) return structuredClone(cached.value);
    if (cached) this.cache.delete(key);
    if (this.inFlight.has(key)) return structuredClone(await this.inFlight.get(key));
    const pending = this.#request(content);
    this.inFlight.set(key, pending);
    try {
      const value = await pending;
      this.cache.set(key, { value: structuredClone(value), expiresAt: this.now() + this.ttlMs });
      while (this.cache.size > this.maxEntries) this.cache.delete(this.cache.keys().next().value);
      return value;
    } finally {
      this.inFlight.delete(key);
    }
  }

  async #request(content) {
    const accessToken = await this.auth.getAccessToken();
    if (!accessToken) throw new Error("Google Cloud did not issue an access token.");
    const response = await this.fetch(visionEndpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "x-goog-user-project": this.projectId,
      },
      body: JSON.stringify({
        requests: [{
          image: { content },
          features: [{ type: "WEB_DETECTION", maxResults: 15 }],
        }],
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const payload = await response.json().catch(() => ({}));
    const annotation = payload?.responses?.[0];
    if (!response.ok || annotation?.error?.message) {
      throw new Error(annotation?.error?.message || `Google Vision returned HTTP ${response.status}.`);
    }
    return { provider: this.name, signals: normalizeWebDetection(annotation?.webDetection) };
  }
}

export class WebEvidenceOrchestrator {
  constructor({ providers = [] } = {}) {
    this.providers = providers;
  }

  get configured() {
    return this.providers.length > 0;
  }

  async analyze(intake) {
    const settled = await Promise.all(this.providers.map(async (provider) => {
      const startedAt = performance.now();
      try {
        const result = await provider.analyze(intake);
        return {
          provider: provider.name,
          status: "completed",
          durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
          signals: result.signals ?? [],
        };
      } catch (error) {
        console.warn(`${provider.name} degraded; identification will continue.`, error?.message ?? error);
        return {
          provider: provider.name,
          status: "degraded",
          durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
          signals: [],
        };
      }
    }));
    return settled;
  }
}

export const googleWebEvidenceInternals = { normalizeWebDetection, imageContent };
