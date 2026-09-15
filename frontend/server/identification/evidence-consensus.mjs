const fieldWeight = {
  category: 0.25,
  player: 1,
  character: 1,
  sport: 0.3,
  team: 0.45,
  year: 0.85,
  manufacturer: 0.45,
  product: 0.8,
  brand: 0.4,
  setOrInsert: 0.85,
  cardNumber: 1,
  language: 0.35,
  rarity: 0.65,
  raritySymbol: 0.6,
  finish: 0.55,
  parallel: 0.9,
  serialNumber: 0.9,
};

function tokens(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/%[0-9a-f]{2}/gi, " ")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function signalSupportsValue(signal, value) {
  const expected = tokens(value);
  const observed = new Set(tokens([signal.text, signal.url, signal.imageUrl].filter(Boolean).join(" ")));
  if (!expected.length) return false;
  if (expected.length === 1 && expected[0].length < 3) return false;
  return expected.every((token) => observed.has(token));
}

function valuesEquivalent(left, right) {
  if (typeof left === "boolean" || typeof right === "boolean" || left === null || right === null) {
    return left === right;
  }
  const normalizedLeft = tokens(left).join("");
  const normalizedRight = tokens(right).join("");
  if (!normalizedLeft || !normalizedRight) return false;
  if (normalizedLeft === normalizedRight) return true;
  if (normalizedLeft.length < 4 || normalizedRight.length < 4) return false;
  return normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft);
}

function valuesExactlyEquivalent(left, right) {
  if (typeof left === "boolean" || typeof right === "boolean" || left === null || right === null) {
    return left === right;
  }
  return tokens(left).join("") === tokens(right).join("");
}

function plainFieldValues(fields) {
  return Object.fromEntries(
    Object.entries(fields).map(([field, result]) => [field, result?.value ?? null]),
  );
}

function catalogSupportsValue(candidateMatches, field, value) {
  return candidateMatches.some((candidate) =>
    candidate.source === "catalog" &&
    candidate.matchConfidence >= 0.65 &&
    valuesEquivalent(candidate.values[field], value),
  );
}

function evidenceDescription(provider, signal, count) {
  const kind = signal.type.replaceAll("_", " ");
  return `${provider} returned ${kind}${count > 1 ? ` plus ${count - 1} corroborating result${count === 2 ? "" : "s"}` : ""} that agrees with this value.`;
}

function normalizedSeason(startText, endText) {
  const start = Number(startText);
  if (!Number.isInteger(start)) return null;
  if (!endText) return String(start);
  let end = Number(endText);
  if (endText.length === 2) {
    const century = Math.floor(start / 100) * 100;
    end = century + end;
    if (end < start) end += 100;
  }
  if (end !== start + 1) return null;
  return `${start}-${String(end).slice(-2)}`;
}

function yearsInSignal(signal) {
  const text = [signal.text, signal.url, signal.imageUrl]
    .filter(Boolean)
    .join(" ");
  const maximumYear = new Date().getFullYear() + 2;
  const explicitSeasons = [...text.matchAll(
    /\b((?:18|19|20)\d{2})\s*[-/]\s*((?:18|19|20)?\d{2})\b/g,
  )]
    .map((match) => normalizedSeason(match[1], match[2]))
    .filter((season) => {
      const start = Number(season?.slice(0, 4));
      return season && start >= 1880 && start <= maximumYear;
    });
  if (explicitSeasons.length) return [...new Set(explicitSeasons)];
  return [...new Set(text.match(/\b(?:18|19|20)\d{2}\b/g) ?? [])]
    .filter((year) => Number(year) >= 1880 && Number(year) <= maximumYear);
}

function yearConsensus(providerResults, fields = {}) {
  const claims = new Map();
  for (const providerResult of providerResults) {
    if (providerResult.status !== "completed") continue;
    for (const signal of providerResult.signals) {
      if (![
        "full_matching_page",
        "partial_matching_page",
        "best_guess_label",
      ].includes(signal.type)) continue;
      const signalYears = yearsInSignal(signal);
      // Marketplace pages often contain unrelated years in recommendations,
      // navigation, or seller text. Such a page cannot safely resolve a year.
      if (signalYears.length !== 1) continue;
      const identity = fields.player?.value ?? fields.character?.value;
      if (identity && !signalSupportsValue(signal, identity)) continue;
      for (const year of signalYears) {
        const claim = claims.get(year) ?? {
          year,
          score: 0,
          signals: [],
          providers: new Set(),
          fullMatches: 0,
          partialMatches: 0,
        };
        claim.score += signal.strength;
        claim.signals.push(signal);
        claim.providers.add(providerResult.provider);
        if (signal.type === "full_matching_page") claim.fullMatches += 1;
        if (signal.type === "partial_matching_page") claim.partialMatches += 1;
        claims.set(year, claim);
      }
    }
  }
  const ranked = [...claims.values()].sort((left, right) => right.score - left.score);
  const best = ranked[0];
  if (!best) return null;
  const runnerUpScore = ranked[1]?.score ?? 0;
  const hasStrongExactMatch = best.fullMatches >= 2 && best.score >= 1.8;
  const hasRepeatedPartialSupport = best.partialMatches >= 2 && best.score >= 1.4;
  if ((!hasStrongExactMatch && !hasRepeatedPartialSupport) || best.score - runnerUpScore < 0.3) {
    return null;
  }
  return best;
}

function applyYearConsensus(result, providerResults) {
  const fieldResult = result.fields.year;
  if (!fieldResult) return;
  const consensus = yearConsensus(providerResults, result.fields);
  if (!consensus || consensus.year === fieldResult.value) return;
  // Clear, visible printed evidence remains authoritative. Web consensus may
  // correct a tentative/model-derived year, but never a near-certain reading.
  if (fieldResult.value !== null && fieldResult.confidence >= 0.9) return;
  const provider = [...consensus.providers].join(" + ");
  const evidenceId = `ev-year-${provider.replaceAll(/[^a-z0-9]+/gi, "-")}-${fieldResult.evidenceIds.length + 1}`;
  result.evidence.push({
    id: evidenceId,
    field: "year",
    source: "web",
    observation: `${provider} matching-card evidence supports ${consensus.year}${fieldResult.value ? ` instead of the tentative ${fieldResult.value} reading` : ""}.`,
    location: null,
    strength: Number(Math.min(0.92, consensus.score / Math.max(1, consensus.signals.length)).toFixed(3)),
  });
  fieldResult.value = consensus.year;
  fieldResult.confidence = Number(Math.min(0.86, 0.68 + Math.min(0.18, consensus.score * 0.08)).toFixed(3));
  fieldResult.evidenceIds.push(evidenceId);
  fieldResult.inferenceSource = "web";
  fieldResult.missingEvidence = [
    ...new Set([
      ...fieldResult.missingEvidence,
      "Confirm the issue year because web matching evidence corrected the initial image reading.",
    ]),
  ];
}

export function applyEvidenceConsensus(extraction, providerResults) {
  const result = structuredClone(extraction);
  applyYearConsensus(result, providerResults);
  for (const [field, importance] of Object.entries(fieldWeight)) {
    const fieldResult = result.fields[field];
    if (!fieldResult || fieldResult.value === null || typeof fieldResult.value === "boolean") continue;
    if (fieldResult.inferenceSource === "web") continue;
    for (const providerResult of providerResults) {
      if (providerResult.status !== "completed") continue;
      const supporting = providerResult.signals
        .filter((signal) => signalSupportsValue(signal, fieldResult.value))
        .sort((left, right) => right.strength - left.strength);
      if (!supporting.length) continue;
      const strongest = supporting[0];
      const corroboration = Math.min(0.025, Math.max(0, supporting.length - 1) * 0.008);
      const boost = Math.min(0.14, strongest.strength * importance * 0.12 + corroboration);
      const evidenceId = `ev-${field}-${providerResult.provider}-${fieldResult.evidenceIds.length + 1}`;
      result.evidence.push({
        id: evidenceId,
        field,
        source: "web",
        observation: evidenceDescription(providerResult.provider, strongest, supporting.length),
        location: null,
        strength: Number(Math.min(1, strongest.strength).toFixed(3)),
      });
      fieldResult.evidenceIds.push(evidenceId);
      fieldResult.confidence = Number(Math.min(0.99, fieldResult.confidence + boost).toFixed(3));
      fieldResult.inferenceSource = "mixed";
    }
  }
  return result;
}

export function buildMarketConsensusProfile(fields, providerResults) {
  const profile = {};
  for (const [field, value] of Object.entries(fields)) {
    if (value === null || typeof value === "boolean") continue;
    const support = providerResults.flatMap((providerResult) =>
      providerResult.status === "completed"
        ? providerResult.signals.filter((signal) => signalSupportsValue(signal, value))
        : [],
    );
    if (!support.length) continue;
    profile[field] = {
      strength: Number(Math.max(...support.map((signal) => signal.strength)).toFixed(3)),
      resultCount: support.length,
    };
  }
  return profile;
}

export function reconcileBackwardEvidence({
  originalExtraction,
  forwardExtraction,
  verification,
  providerResults,
}) {
  const fields = structuredClone(verification.fields);
  const evidence = structuredClone(forwardExtraction.evidence);
  const changedFields = Object.keys(fields).filter((field) =>
    !valuesExactlyEquivalent(fields[field]?.value, forwardExtraction.fields[field]?.value),
  );
  if (!changedFields.length || !providerResults.some((result) => result.status === "completed")) {
    return { ...verification, fields, evidence };
  }

  // Recheck only the late-changing fields against the same cached Google
  // evidence. This gives web evidence a backward vote without making a second
  // Vision request or allowing a candidate to verify itself.
  const checked = applyEvidenceConsensus(
    { fields: structuredClone(fields), evidence: [] },
    providerResults,
  );
  const forwardProfile = buildMarketConsensusProfile(
    plainFieldValues(forwardExtraction.fields),
    providerResults,
  );
  const finalProfile = buildMarketConsensusProfile(
    plainFieldValues(fields),
    providerResults,
  );

  const adoptCheckedField = (field) => {
    const previousIds = new Set(fields[field].evidenceIds);
    fields[field] = structuredClone(checked.fields[field]);
    const addedIds = fields[field].evidenceIds.filter((id) => !previousIds.has(id));
    for (const item of checked.evidence) {
      if (item.field === field && addedIds.includes(item.id) && !evidence.some((existing) => existing.id === item.id)) {
        evidence.push(structuredClone(item));
      }
    }
  };

  for (const field of changedFields) {
    const original = originalExtraction.fields[field];
    const forward = forwardExtraction.fields[field];
    const backward = fields[field];
    if (!original || !forward || !backward) continue;

    const originalIsStrongVisible =
      original.inferenceSource === "visible" &&
      original.confidence >= 0.9 &&
      original.value !== null;
    if (originalIsStrongVisible && !valuesExactlyEquivalent(original.value, backward.value)) {
      fields[field] = structuredClone(original);
      fields[field].missingEvidence = [
        ...new Set([
          ...fields[field].missingEvidence,
          "Late search evidence conflicted with a near-certain visible reading, so the original image evidence was retained.",
        ]),
      ];
      continue;
    }

    // A repeated Google year consensus may correct a late catalog/model change.
    if (!valuesExactlyEquivalent(checked.fields[field].value, backward.value)) {
      adoptCheckedField(field);
      continue;
    }

    const googleSupportsBackward = Boolean(finalProfile[field]);
    const googleSupportsForward = Boolean(forwardProfile[field]);
    const catalogSupportsBackward = catalogSupportsValue(
      verification.candidateMatches,
      field,
      backward.value,
    );

    if (googleSupportsBackward) {
      adoptCheckedField(field);
      if (catalogSupportsBackward) {
        fields[field].confidence = Number(
          Math.min(0.94, Math.max(fields[field].confidence, 0.82)).toFixed(3),
        );
        fields[field].inferenceSource = "mixed";
      }
      continue;
    }

    // If Google produced the forward value and the late candidate cannot earn
    // an independent Google vote, retain the forward result. This is especially
    // important for a year corrected by repeated full-image page matches.
    if (forward.inferenceSource === "web" && googleSupportsForward) {
      fields[field] = structuredClone(forward);
      fields[field].missingEvidence = [
        ...new Set([
          ...fields[field].missingEvidence,
          "A late candidate conflicted with repeated Google matching-card evidence; the Google-supported value was retained.",
        ]),
      ];
      continue;
    }

    if (googleSupportsForward && !catalogSupportsBackward) {
      fields[field].confidence = Number((fields[field].confidence * 0.75).toFixed(3));
      fields[field].missingEvidence = [
        ...new Set([
          ...fields[field].missingEvidence,
          "The backward candidate conflicts with Google evidence supporting the earlier reading.",
        ]),
      ];
    }
  }

  return { ...verification, fields, evidence };
}

export const evidenceConsensusInternals = {
  tokens,
  signalSupportsValue,
  valuesEquivalent,
  valuesExactlyEquivalent,
  yearsInSignal,
  yearConsensus,
  normalizedSeason,
};
