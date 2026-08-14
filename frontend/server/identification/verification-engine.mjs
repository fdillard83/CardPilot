const fieldWeights = {
  category: 0.8,
  player: 2,
  character: 2,
  sport: 0.5,
  team: 0.5,
  year: 1.6,
  manufacturer: 0.9,
  product: 1.5,
  brand: 0.7,
  setOrInsert: 1.5,
  cardNumber: 2,
  language: 0.5,
  rarity: 1.2,
  raritySymbol: 1.2,
  finish: 1.2,
  promo: 0.8,
  rookieStatus: 0.5,
  parallel: 1.3,
  serialNumber: 1.3,
  autograph: 0.8,
  memorabilia: 0.8,
  imageVariation: 1.2,
};

function normalize(value) {
  if (typeof value === "boolean" || value === null) return value;
  if (typeof value !== "string") return null;
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function valuesMatch(left, right) {
  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);

  if (typeof normalizedLeft === "boolean" || normalizedLeft === null) {
    return normalizedLeft === normalizedRight;
  }

  if (typeof normalizedRight !== "string") return false;
  if (normalizedLeft === normalizedRight) return true;
  if (normalizedLeft.length < 4 || normalizedRight.length < 4) return false;
  return (
    normalizedLeft.includes(normalizedRight) ||
    normalizedRight.includes(normalizedLeft)
  );
}

function scoreCandidate(extraction, candidate) {
  const supportingFields = [];
  const conflictingFields = [];
  let earnedWeight = 0;
  let comparableWeight = 0;

  for (const [field, weight] of Object.entries(fieldWeights)) {
    const observed = extraction.fields[field].value;
    const proposed = candidate.values[field];
    if (observed === null || proposed === null) continue;

    comparableWeight += weight;
    if (valuesMatch(observed, proposed)) {
      supportingFields.push(field);
      earnedWeight += weight;
    } else {
      conflictingFields.push(field);
    }
  }

  const evidenceMatch = comparableWeight > 0 ? earnedWeight / comparableWeight : 0;
  // A catalog candidate is independent evidence. Model suggestions are search
  // leads from the extraction call itself and must not verify their own guess.
  const providerWeight = candidate.source === "catalog" ? 0.55 : 0.05;
  const matchConfidence = Math.max(
    0,
    Math.min(
      1,
      evidenceMatch * (1 - providerWeight) + candidate.plausibility * providerWeight,
    ),
  );

  return {
    id: candidate.id,
    label: candidate.label,
    source: candidate.source,
    catalogRecordId: candidate.catalogRecordId,
    values: candidate.values,
    matchConfidence: Number(matchConfidence.toFixed(3)),
    supportingFields,
    conflictingFields,
    basis: candidate.basis,
  };
}

function nearbyCatalogCandidates(candidates) {
  const best = candidates[0];
  if (!best || best.source !== "catalog") return [];
  return candidates.filter(
    (candidate) =>
      candidate.source === "catalog" &&
      best.matchConfidence - candidate.matchConfidence <= 0.2,
  );
}

function consensusValue(candidates, field) {
  const proposed = candidates
    .map((candidate) => candidate.values[field])
    .filter((value) => value !== null);
  if (proposed.length !== candidates.length) return null;
  return proposed.every((value) => valuesMatch(value, proposed[0]))
    ? proposed[0]
    : null;
}

function mergeVerifiedCandidates(extraction, candidates) {
  const fields = structuredClone(extraction.fields);
  const candidate = candidates[0];
  if (!candidate) return fields;
  const catalogPeers = nearbyCatalogCandidates(candidates);

  for (const [field, result] of Object.entries(fields)) {
    const proposed =
      catalogPeers.length > 1
        ? consensusValue(catalogPeers, field)
        : candidate.values[field];
    if (proposed === null) continue;

    if (result.value === null) {
      result.value = proposed;
      result.confidence = Number(
        Math.min(
          candidate.source === "catalog" ? 0.68 : 0.55,
          candidate.matchConfidence * 0.72,
        ).toFixed(3),
      );
      result.inferenceSource = candidate.source === "catalog" ? "catalog" : "candidate";
      continue;
    }

    if (valuesMatch(result.value, proposed)) {
      const boost =
        candidate.source === "catalog"
          ? 0.08
          : candidate.source === "model_knowledge"
            ? 0.02
            : 0;
      result.confidence = Number(
        Math.min(0.99, result.confidence + boost * candidate.matchConfidence).toFixed(3),
      );
      if (boost > 0) result.inferenceSource = "mixed";
    } else {
      result.confidence = Number((result.confidence * 0.85).toFixed(3));
      result.missingEvidence = [
        ...new Set([
          ...result.missingEvidence,
          "A candidate conflicts with the visible extraction and needs review.",
        ]),
      ];
    }
  }

  return fields;
}

export function verifyCandidates(extraction, candidates) {
  const candidateMatches = candidates
    .map((candidate) => scoreCandidate(extraction, candidate))
    .sort((left, right) => right.matchConfidence - left.matchConfidence)
    .slice(0, 5);

  return {
    fields: mergeVerifiedCandidates(extraction, candidateMatches),
    candidateMatches,
  };
}

export { valuesMatch };
