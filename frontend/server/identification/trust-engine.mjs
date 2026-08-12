export const defaultTrustConfig = Object.freeze({
  highConfidenceThreshold: 0.95,
  mediumConfidenceThreshold: 0.8,
  uncertainParallelThreshold: 0.9,
  sensitiveFieldThreshold: 0.95,
  materialBackPhotoGain: 0.08,
  sensitiveCardsRequireConfirmation: true,
});

function hasUncertainParallel(fields, missingEvidence, config) {
  const parallelMissing = missingEvidence.some(
    (item) => item.field === "parallel" && item.expectedConfidenceGain >= 0.05,
  );
  return (
    (fields.parallel.value !== null &&
      fields.parallel.confidence < config.uncertainParallelThreshold) ||
    parallelMissing
  );
}

function sensitiveFields(fields) {
  return [
    ["serial-numbered card", fields.serialNumber.value !== null, fields.serialNumber],
    ["autograph", fields.autograph.value === true, fields.autograph],
    ["memorabilia", fields.memorabilia.value === true, fields.memorabilia],
    ["image variation", fields.imageVariation.value === true, fields.imageVariation],
  ].filter(([, active]) => active);
}

export function evaluateTrust(
  { status, fields, missingEvidence, overallConfidence },
  config = defaultTrustConfig,
) {
  const reasons = [];
  const blockers = [];

  if (status === "not_sports_card") {
    return {
      action: "review",
      reviewRequired: true,
      reviewRequirement: "full_review",
      reasons: ["The image was not confirmed as a sports card."],
      blockers: ["No card identity can be accepted."],
    };
  }

  if (hasUncertainParallel(fields, missingEvidence, config)) {
    blockers.push("The parallel or variation is not sufficiently verified.");
  }

  const unresolvedSpecialFields = new Set([
    "serialNumber",
    "autograph",
    "memorabilia",
    "imageVariation",
  ]);
  for (const missing of missingEvidence) {
    if (
      unresolvedSpecialFields.has(missing.field) &&
      missing.expectedConfidenceGain >= 0.05
    ) {
      blockers.push(`A possible ${missing.field} feature remains unresolved.`);
    }
  }

  const sensitive = sensitiveFields(fields);
  for (const [label, , field] of sensitive) {
    if (field.confidence < config.sensitiveFieldThreshold) {
      blockers.push(`The ${label} requires stronger evidence.`);
    }
  }

  if (blockers.length > 0) {
    return {
      action: "review",
      reviewRequired: true,
      reviewRequirement: "full_review",
      reasons: ["A high-impact card detail remains uncertain."],
      blockers,
    };
  }

  if (overallConfidence >= config.highConfidenceThreshold) {
    if (sensitive.length > 0 && config.sensitiveCardsRequireConfirmation) {
      reasons.push(
        "The identification is strong, but a high-impact card feature should be confirmed once.",
      );
      return {
        action: "confirm",
        reviewRequired: true,
        reviewRequirement: "confirmation",
        reasons,
        blockers: [],
      };
    }

    reasons.push("The identity fields have strong supporting evidence.");
    return {
      action: "auto_accept",
      reviewRequired: false,
      reviewRequirement: "none",
      reasons,
      blockers: [],
    };
  }

  if (overallConfidence >= config.mediumConfidenceThreshold) {
    reasons.push("The basic identity is plausible but needs one-tap confirmation.");
    return {
      action: "confirm",
      reviewRequired: true,
      reviewRequirement: "confirmation",
      reasons,
      blockers: [],
    };
  }

  reasons.push("Important identity evidence is missing or conflicting.");
  return {
    action: "review",
    reviewRequired: true,
    reviewRequirement: "full_review",
    reasons,
    blockers: [],
  };
}

export function getBackPhotoGuidance(
  { provided, decision, missingEvidence, overallConfidence = 0 },
  config = defaultTrustConfig,
) {
  if (provided || decision.action === "auto_accept") {
    return {
      provided,
      suggested: false,
      expectedConfidenceGain: 0,
      reason: null,
    };
  }

  const materialBackPhotoFields = new Set([
    "year",
    "manufacturer",
    "product",
    "setOrInsert",
    "cardNumber",
    "parallel",
    "serialNumber",
    "autograph",
    "memorabilia",
    "imageVariation",
  ]);
  const backEvidence = missingEvidence
    .filter(
      (item) =>
        item.suggestedSource === "back_image" &&
        materialBackPhotoFields.has(item.field),
    )
    .sort(
      (left, right) =>
        right.expectedConfidenceGain - left.expectedConfidenceGain,
    );
  const best = backEvidence[0];
  const expectedConfidenceGain = Number(
    Math.min(
      best?.expectedConfidenceGain ?? 0,
      Math.max(0, 1 - overallConfidence),
      0.35,
    ).toFixed(3),
  );
  const suggested = expectedConfidenceGain >= config.materialBackPhotoGain;

  return {
    provided: false,
    suggested,
    expectedConfidenceGain: suggested ? expectedConfidenceGain : 0,
    reason: suggested ? best.description : null,
  };
}
