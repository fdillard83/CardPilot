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
        values: record.values,
        plausibility,
        basis: `Independent checklist candidate. Ranked from visible player, team, marks, and card-design clues. Verify ${record.values.cardNumber ? `card number ${record.values.cardNumber}` : "the card number"} before accepting.`,
      }));

    return catalogCandidates.length > 0
      ? catalogCandidates
      : this.fallback.generate(extraction);
  }
}

export function createProvisionalCandidate(extraction) {
  const values = Object.fromEntries(
    fieldKeys.map((field) => [field, extraction.fields[field].value]),
  );
  const label = [
    values.year,
    values.product ?? values.brand ?? values.manufacturer,
    values.player,
    values.cardNumber ? `#${values.cardNumber}` : null,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    id: "candidate-provisional",
    label: label || "Visible-evidence candidate",
    source: "provisional",
    catalogRecordId: null,
    values,
    plausibility: 0.5,
    basis: "Built from visible evidence because no independent candidate provider result was available.",
  };
}
