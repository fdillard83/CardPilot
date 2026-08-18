import { fieldKeys } from "./contracts.mjs";
import { embeddedCatalogRecords } from "./catalog-records.mjs";

export class EmbeddedCandidateGenerator {
  async generate(extraction) {
    return extraction.candidateSuggestions;
  }
}

export const OpenAICandidateGenerator = EmbeddedCandidateGenerator;

function normalizedText(value) {
  return typeof value === "string"
    ? value.toLowerCase().replace(/[^a-z0-9]/g, "")
    : "";
}

function textMatches(left, right) {
  const normalizedLeft = normalizedText(left);
  const normalizedRight = normalizedText(right);
  return (
    normalizedLeft.length >= 3 &&
    normalizedRight.length >= 3 &&
    (normalizedLeft.includes(normalizedRight) ||
      normalizedRight.includes(normalizedLeft))
  );
}

function scoreCatalogRecord(extraction, record) {
  if (extraction.fields.character?.value) return 0;
  const player = extraction.fields.player.value;
  if (!player || !textMatches(player, record.values.player)) return 0;

  let score = 0.38;
  const weightedFields = [
    ["team", 0.1],
    ["year", 0.12],
    ["manufacturer", 0.08],
    ["brand", 0.06],
    ["product", 0.12],
    ["setOrInsert", 0.14],
    ["cardNumber", 0.18],
    ["serialNumber", 0.2],
  ];
  for (const [field, weight] of weightedFields) {
    const observed = extraction.fields[field].value;
    const catalogValue = record.values[field];
    if (
      observed !== null &&
      catalogValue !== null &&
      textMatches(observed, catalogValue)
    ) {
      score += weight;
    }
  }

  const marks = (extraction.visibleMarks ?? []).map((mark) => mark.text);
  if (
    record.visibleMarks.some((expected) =>
      marks.some((mark) => textMatches(mark, expected)),
    )
  ) {
    score += 0.06;
  }
  const features = (extraction.visualFeatures ?? []).map(
    (feature) => feature.description,
  );
  const cueMatches = record.visualCues.filter((cue) =>
    features.some((feature) => textMatches(feature, cue)),
  ).length;
  score += Math.min(0.18, cueMatches * 0.06);

  return Number(Math.min(0.9, score).toFixed(3));
}

export class CatalogCandidateGenerator {
  constructor({
    records = embeddedCatalogRecords,
    fallback = new EmbeddedCandidateGenerator(),
  } = {}) {
    this.records = records;
    this.fallback = fallback;
  }

  async generate(extraction) {
    const catalogCandidates = this.records
      .map((record) => ({
        record,
        plausibility: scoreCatalogRecord(extraction, record),
      }))
      .filter(({ plausibility }) => plausibility >= 0.35)
      .sort((left, right) => right.plausibility - left.plausibility)
      .slice(0, 5)
      .map(({ record, plausibility }) => ({
        id: `catalog-${record.id}`,
        label: record.label,
        source: "catalog",
        catalogRecordId: record.id,
        imageUrl: record.imageUrl ?? null,
        values: record.values,
        plausibility,
        basis: `Independent checklist candidate. Ranked from visible player, team, marks, and card-design clues. Verify ${record.values.cardNumber ? `card number ${record.values.cardNumber}` : "the card number"} before accepting.`,
      }));

    return catalogCandidates.length > 0
      ? catalogCandidates
      : this.fallback.generate(extraction);
  }
}

function catalogQuery(extraction) {
  const fields = extraction.fields;
  return [
    fields.player.value,
    fields.parentSetName?.value,
    fields.product.value,
    fields.setOrInsert.value,
    fields.parallel.value,
  ].filter(Boolean).join(" ");
}

function remoteCandidate(card) {
  const values = Object.fromEntries(fieldKeys.map((field) => [field, null]));
  Object.assign(values, {
    category: "Sports",
    player: card.subject,
    sport: card.sport,
    year: card.year === null ? null : String(card.year),
    manufacturer: card.manufacturer,
    product: card.parentSetName ?? card.setName,
    setOrInsert: card.parentSetName ? card.setName : null,
    cardNumber: card.cardNumber,
    rookieStatus: card.isRookie,
    parallel: card.parallel,
    serialNumber: card.printRun === null ? null : `/${card.printRun}`,
    autograph: card.isAuto,
    memorabilia: card.isRelic,
  });
  return {
    id: `the-card-api-${card.ucid}`,
    label: [card.year, card.setName, card.subject, card.cardNumber ? `#${card.cardNumber}` : null, card.printRun ? `/${card.printRun}` : null].filter(Boolean).join(" "),
    source: "catalog",
    catalogRecordId: card.ucid,
    imageUrl: card.imageUrlFront,
    values,
    plausibility: 0.84,
    basis: "The Card API checklist candidate matched from structured player, set, card-number, parallel, and print-run data.",
  };
}

export class RemoteCatalogCandidateGenerator {
  constructor({ client, fallback = new CatalogCandidateGenerator(), now = Date.now, cacheDurationMs = 60 * 60 * 1000 } = {}) {
    this.client = client;
    this.fallback = fallback;
    this.now = now;
    this.cacheDurationMs = cacheDurationMs;
    this.cache = new Map();
  }

  async generate(extraction) {
    if (!this.client || extraction.fields.character?.value || !extraction.fields.player.value) {
      return this.fallback.generate(extraction);
    }
    const query = catalogQuery(extraction);
    const year = Number(extraction.fields.year.value);
    const search = {
      query,
      sport: extraction.fields.sport.value,
      year: Number.isInteger(year) && year >= 1800 && year <= 2200 ? year : null,
      cardNumber: extraction.fields.cardNumber.value,
      isAuto: extraction.fields.autograph.value === true ? true : null,
      isRookie: extraction.fields.rookieStatus.value === true ? true : null,
      limit: 5,
    };
    const key = JSON.stringify(search);
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.now()) return structuredClone(cached.candidates);
    try {
      let result = await this.client.searchCards(search);
      if (!result.cards.length) {
        result = await this.client.searchCards({
          ...search,
          query: [
            extraction.fields.player.value,
            extraction.fields.manufacturer.value,
            extraction.fields.product.value,
            extraction.fields.setOrInsert.value,
          ].filter(Boolean).join(" "),
          year: null,
        });
      }
      if (!result.cards.length && extraction.fields.player.value) {
        result = await this.client.searchCards({
          ...search,
          query: extraction.fields.player.value,
          year: null,
          cardNumber: extraction.fields.cardNumber.value,
        });
      }
      const candidates = result.cards.map(remoteCandidate);
      if (!candidates.length) return this.fallback.generate(extraction);
      this.cache.set(key, { candidates: structuredClone(candidates), expiresAt: this.now() + this.cacheDurationMs });
      return candidates;
    } catch (error) {
      console.warn("The Card API catalog search degraded; using local candidates.", error?.message ?? error);
      return this.fallback.generate(extraction);
    }
  }
}

export function createProvisionalCandidate(extraction) {
  const values = Object.fromEntries(
    fieldKeys.map((field) => [field, extraction.fields[field].value]),
  );
  const label = [
    values.year,
    values.product ?? values.brand ?? values.manufacturer,
    values.character ?? values.player,
    values.cardNumber ? `#${values.cardNumber}` : null,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    id: "candidate-provisional",
    label: label || "Visible-evidence candidate",
    source: "provisional",
    catalogRecordId: null,
    imageUrl: null,
    values,
    plausibility: 0.5,
    basis: "Built from visible evidence because no independent checklist result was available.",
  };
}
