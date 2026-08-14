const confidenceParts = [
  { field: "player", weight: 1.5 },
  { field: "year", weight: 1.3 },
  { field: "product", weight: 1.2 },
  { field: "setOrInsert", weight: 1.1 },
  { field: "cardNumber", weight: 1.5 },
];

function fieldScore(field) {
  if (!field) return 0;
  if (field.value === null) return 0;
  if (field.inferenceSource === "candidate") return Math.min(field.confidence, 0.55);
  if (field.inferenceSource === "catalog") return Math.min(field.confidence, 0.68);
  return field.confidence;
}

export function calculateOverallConfidence({
  status,
  fields,
  missingEvidence,
  candidateMatches,
}) {
  if (status === "not_sports_card" || status === "not_trading_card") return 0;

  const pokemon =
    /pok(?:é|e)mon/i.test(fields.category?.value ?? "") ||
    fields.character?.value !== null && fields.character?.value !== undefined;

  const producer =
    fieldScore(fields.manufacturer) > fieldScore(fields.brand)
      ? fields.manufacturer
      : fields.brand;
  const parts = pokemon
    ? [
        { field: "character", weight: 1.8 },
        { field: "setOrInsert", weight: 1.4 },
        { field: "cardNumber", weight: 1.8 },
        { field: "rarity", weight: 0.9 },
        { field: "finish", weight: 0.8 },
        { field: "year", weight: 0.7 },
        { field: "producer", weight: 0.5, result: producer },
      ]
    : [
        ...confidenceParts,
        { field: "producer", weight: 0.9, result: producer },
      ];

  if (
    pokemon &&
    (Boolean(fields.raritySymbol?.value) ||
      missingEvidence.some((item) => item.field === "raritySymbol"))
  ) {
    parts.push({
      field: "raritySymbol",
      weight: 0.7,
      result: fields.raritySymbol,
    });
  }

  if (
    fields.parallel.value !== null ||
    missingEvidence.some((item) => item.field === "parallel")
  ) {
    parts.push({ field: "parallel", weight: 1, result: fields.parallel });
  }

  let weightedConfidence = 0;
  let totalWeight = 0;
  for (const part of parts) {
    const result = part.result ?? fields[part.field];
    weightedConfidence += fieldScore(result) * part.weight;
    totalWeight += part.weight;
  }

  let overall = totalWeight > 0 ? weightedConfidence / totalWeight : 0;
  const bestCandidate = candidateMatches[0];
  const coreFields = pokemon
    ? [
        "character",
        "setOrInsert",
        "cardNumber",
        "rarity",
        "raritySymbol",
        "finish",
      ]
    : ["player", "year", "product", "setOrInsert", "cardNumber"];
  const coreConflicts = bestCandidate?.conflictingFields.filter((field) =>
    coreFields.includes(field),
  );

  if (coreConflicts?.length) overall = Math.min(overall, 0.79);

  const highestMissingGain = Math.max(
    0,
    ...missingEvidence.map((item) => item.expectedConfidenceGain),
  );
  if (highestMissingGain >= 0.15) overall = Math.min(overall, 0.89);
  else if (highestMissingGain >= 0.08) overall = Math.min(overall, 0.94);

  const visibleCoreCount = (pokemon
    ? [
        fields.character,
        fields.setOrInsert,
        fields.cardNumber,
        fields.rarity,
        fields.raritySymbol,
        fields.finish,
        producer,
      ]
    : [
        fields.player,
        fields.year,
        producer,
        fields.product,
        fields.setOrInsert,
        fields.cardNumber,
      ]).filter(
    (field) =>
      field?.value !== null &&
      field?.value !== undefined &&
      field.inferenceSource !== "candidate" &&
      field.inferenceSource !== "catalog",
  ).length;

  const identity = pokemon ? fields.character : fields.player;
  if (!identity || identity.value === null) overall = Math.min(overall, 0.7);
  if (visibleCoreCount < 3) overall = Math.min(overall, 0.79);
  else if (visibleCoreCount < 5) overall = Math.min(overall, 0.94);

  return Number(Math.max(0, Math.min(1, overall)).toFixed(3));
}
