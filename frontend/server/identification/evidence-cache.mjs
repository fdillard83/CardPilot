import { createHash } from "node:crypto";

function intakeFingerprint(intake, namespace) {
  const hash = createHash("sha256");
  hash.update(namespace);
  hash.update(intake.frontImage);
  hash.update(intake.backImage ?? "");
  for (const detail of intake.frontDetailImages) {
    hash.update(detail.label);
    hash.update(detail.image);
  }
  return hash.digest("base64url");
}

export class CachedEvidenceEngine {
  constructor({ engine, maxEntries = 100, ttlMs = 6 * 60 * 60 * 1000, now = Date.now }) {
    this.engine = engine;
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
    this.now = now;
    this.cache = new Map();
    this.inFlight = new Map();
  }

  modelFor(intake) {
    return this.engine.modelFor?.(intake);
  }

  async extract(intake) {
    const namespace = this.modelFor(intake) ?? "card-evidence";
    const key = intakeFingerprint(intake, namespace);
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.now()) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return structuredClone(cached.value);
    }
    if (cached) this.cache.delete(key);
    if (this.inFlight.has(key)) return structuredClone(await this.inFlight.get(key));

    const pending = this.engine.extract(intake);
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
}
