const confidenceRank = Object.freeze({ low: 1, medium: 2, high: 3 });

export function shouldAutomaticallySaveValuation({ card, preferences, recommendation }) {
  return Boolean(
    recommendation &&
    preferences.autoValueEnabled &&
    preferences.autoValueMaxCents !== null &&
    recommendation.amountCents <= preferences.autoValueMaxCents &&
    !card.confirmedValuation?.userAdjusted
  );
}

function missingIdentityFields(card) {
  const fields = card.fields ?? {};
  const missing = [];
  if (!fields.year) missing.push("verified year");
  if (!(fields.player || fields.character)) missing.push("player or character");
  if (!(fields.setOrInsert || fields.product)) missing.push("set or product");
  if (!fields.cardNumber) missing.push("card number");
  return missing;
}

export function assessAutopilot({ card, preferences, recommendation, connection, draft }) {
  if (preferences.automationMode !== "autopilot") {
    return { status: "preview", publish: false, reason: "Preview mode is enabled for this account." };
  }
  if (card.decision !== "auto_accept" || card.overallConfidence < preferences.autopilotMinConfidence) {
    return {
      status: "needs_attention",
      publish: false,
      reason: `Identification confidence is ${Math.round(card.overallConfidence * 100)}%; Autopilot requires ${Math.round(preferences.autopilotMinConfidence * 100)}% and an evidence-backed automatic match.`,
    };
  }
  const missing = missingIdentityFields(card);
  if (missing.length) {
    return { status: "needs_attention", publish: false, reason: `CardPilot still needs a ${missing.join(", ")}.` };
  }
  if (!recommendation || confidenceRank[recommendation.confidence] < confidenceRank.medium) {
    return { status: "needs_attention", publish: false, reason: "Pricing does not yet have enough compatible market evidence." };
  }
  const priceCents = Number(draft?.priceCents ?? recommendation.amountCents);
  if (priceCents < preferences.autopilotMinimumPriceCents) {
    return { status: "needs_attention", publish: false, reason: `The recommended price is below the account's $${(preferences.autopilotMinimumPriceCents / 100).toFixed(2)} minimum.` };
  }
  if (preferences.autopilotApprovalAboveCents !== null && priceCents > preferences.autopilotApprovalAboveCents) {
    return { status: "needs_attention", publish: false, reason: `The card is above the account's $${(preferences.autopilotApprovalAboveCents / 100).toFixed(2)} approval threshold.` };
  }
  if (!connection) {
    return { status: "needs_attention", publish: false, reason: "Connect an eBay seller account to finish and confirm this listing." };
  }
  if (!draft || [draft.categoryId, draft.merchantLocationKey, draft.fulfillmentPolicyId, draft.paymentPolicyId, draft.returnPolicyId].some((value) => !value)) {
    return { status: "needs_attention", publish: false, reason: "eBay category, inventory location, or seller policies still need setup." };
  }
  return {
    status: "ready",
    publish: false,
    reason: "The listing is ready. User confirmation is required before publishing to eBay during Autopilot testing.",
  };
}

export function autopilotRepriceCents({ currentPriceCents, originalPriceCents, marketFloorCents, accountMinimumCents, floorPercent }) {
  const protectedFloor = Math.max(
    accountMinimumCents,
    Math.ceil(originalPriceCents * (floorPercent / 100)),
  );
  const target = Math.max(protectedFloor, marketFloorCents);
  return target < currentPriceCents ? target : null;
}
