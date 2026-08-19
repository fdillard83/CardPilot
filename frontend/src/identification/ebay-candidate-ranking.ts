import type { EbayImageSearchCandidate, FieldKey, FieldValue } from "./types";

function normalized(value: FieldValue | undefined) {
  return typeof value === "string" ? value.toLowerCase().replace(/[^a-z0-9]/g, "") : "";
}

function titleContains(title: string, value: FieldValue | undefined) {
  const expected = normalized(value);
  return expected.length >= 2 && normalized(title).includes(expected);
}

function denominator(value: FieldValue | undefined) {
  return typeof value === "string" ? value.replace(/\s/g, "").match(/\/(\d{1,5})/)?.[1] ?? null : null;
}

function visualMismatch(candidate: EbayImageSearchCandidate) {
  if (candidate.visualMatchStatus === "not_evaluated") return true;
  const match = candidate.visualMatch;
  if (!match || !Number.isFinite(match.score)) return false;
  if (match.score < 0.55) return true;
  if (!Number.isFinite(match.structureScore)) return match.score < 0.62;
  return match.structureScore! < 0.35 || (match.score < 0.68 && match.structureScore! < 0.55);
}

function candidateScore(fields: Record<FieldKey, FieldValue>, candidate: EbayImageSearchCandidate) {
  const title = candidate.title;
  const identity = fields.player ?? fields.character;
  // eBay search_by_image rank is the independent visual signal. Preserve it
  // strongly, then use confirmed text to corroborate or reject obvious conflicts.
  let score = Math.max(0, 7 - candidate.rank) * 15;
  score += (candidate.visualMatch?.score ?? 0) * 110;
  if (identity) score += titleContains(title, identity) ? 90 : -120;
  for (const [field, weight] of [
    ["year", 24], ["manufacturer", 12], ["product", 16], ["brand", 8],
    ["setOrInsert", 18], ["cardNumber", 30], ["parallel", 25],
  ] as const) {
    if (fields[field] !== null && titleContains(title, fields[field])) score += weight;
  }
  const serialDenominator = denominator(fields.serialNumber);
  if (serialDenominator) {
    score += new RegExp(`(?:/|out\\s+of\\s+)0*${serialDenominator}\\b`, "i").test(title) ? 45 : -12;
  }
  if (fields.autograph === true) score += /\b(auto|autograph|signed)\b/i.test(title) ? 18 : -12;
  if (fields.memorabilia === true) score += /\b(relic|patch|jersey|memorabilia)\b/i.test(title) ? 14 : -10;
  if (fields.rookieStatus === true) score += /\b(rc|rookie)\b/i.test(title) ? 8 : 0;
  return score;
}

export function rankEbayCandidates(
  fields: Record<FieldKey, FieldValue>,
  candidates: EbayImageSearchCandidate[],
) {
  return candidates.filter((candidate) => !visualMismatch(candidate)).sort((left, right) => {
    const scoreDifference = candidateScore(fields, right) - candidateScore(fields, left);
    return scoreDifference || left.rank - right.rank;
  });
}
