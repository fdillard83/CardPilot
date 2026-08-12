const ANNIVERSARY_PATTERN = /\b(?:\d{1,3}(?:st|nd|rd|th)?\s+)?(?:years?|yrs?)\s+of\s+baseball\b|\banniversary\b/i;
const SEASON_PATTERN = /^(18|19|20)\d{2}(?:\s*[-/]\s*(?:(?:18|19|20)?\d{2}))?$/;

function normalizedText(value) {
  return typeof value === "string"
    ? value.toLowerCase().replace(/[^a-z0-9]/g, "")
    : "";
}

function hasVisibleRoleSupport(value, visibleMarks, allowedKinds) {
  if (typeof value !== "string") return false;
  const target = normalizedText(value);
  return visibleMarks.some(
    (mark) =>
      allowedKinds.has(mark.kind) &&
      !ANNIVERSARY_PATTERN.test(mark.text) &&
      (normalizedText(mark.text).includes(target) ||
        target.includes(normalizedText(mark.text))),
  );
}

export function isPlausibleIssueYear(value, currentYear = new Date().getFullYear()) {
  if (typeof value !== "string" || !SEASON_PATTERN.test(value.trim())) return false;
  const firstYear = Number(value.trim().slice(0, 4));
  return firstYear >= 1880 && firstYear <= currentYear + 1;
}

export function isPlausibleCardNumber(value) {
  return (
    typeof value === "string" &&
    value.trim().length <= 20 &&
    /\d/.test(value) &&
    /^[a-z0-9][a-z0-9 .#/-]*$/i.test(value.trim())
  );
}

export function isPromotionalAnniversaryText(value, visibleMarks = []) {
  if (typeof value !== "string") return false;
  if (ANNIVERSARY_PATTERN.test(value)) return true;
  const target = normalizedText(value);
  return visibleMarks.some(
    (mark) =>
      mark.kind === "anniversary_mark" && normalizedText(mark.text) === target,
  );
}

function addMissingEvidence(extraction, field, description, suggestedSource, gain) {
  if (
    extraction.missingEvidence.some(
      (item) => item.field === field && item.description === description,
    )
  ) {
    return;
  }

  extraction.missingEvidence.push({
    field,
    description,
    suggestedSource,
    expectedConfidenceGain: gain,
  });
  extraction.fields[field].missingEvidence = [
    ...new Set([...extraction.fields[field].missingEvidence, description]),
  ];
}

function clearSemanticField(extraction, field) {
  extraction.fields[field] = {
    ...extraction.fields[field],
    value: null,
    confidence: 0,
    inferenceSource: "unknown",
  };
}

function sanitizeCandidate(candidate, visibleMarks, currentYear) {
  const values = { ...candidate.values };
  if (!isPlausibleIssueYear(values.year, currentYear)) values.year = null;
  if (values.cardNumber !== null && !isPlausibleCardNumber(values.cardNumber)) {
    values.cardNumber = null;
  }
  if (isPromotionalAnniversaryText(values.product, visibleMarks)) values.product = null;
  if (isPromotionalAnniversaryText(values.setOrInsert, visibleMarks)) {
    values.setOrInsert = null;
  }

  return {
    ...candidate,
    label: candidate.label.replace(
      /\b\d{1,3}(?:st|nd|rd|th)?\s+years?\s+of\s+baseball\b/gi,
      "anniversary-mark",
    ),
    values,
  };
}

export function normalizeCardSemantics(extraction, currentYear = new Date().getFullYear()) {
  const normalized = structuredClone(extraction);
  const visibleMarks = normalized.visibleMarks ?? [];
  const invalidYear =
    normalized.fields.year.value !== null &&
    (!isPlausibleIssueYear(normalized.fields.year.value, currentYear) ||
      !hasVisibleRoleSupport(
        normalized.fields.year.value,
        visibleMarks,
        new Set(["copyright_year", "product_title"]),
      ));
  const anniversaryProduct = isPromotionalAnniversaryText(
    normalized.fields.product.value,
    visibleMarks,
  );
  const anniversarySet = isPromotionalAnniversaryText(
    normalized.fields.setOrInsert.value,
    visibleMarks,
  );
  const unsupportedProduct =
    normalized.fields.product.value !== null &&
    !hasVisibleRoleSupport(
      normalized.fields.product.value,
      visibleMarks,
      new Set(["product_title"]),
    );
  const unsupportedSet =
    normalized.fields.setOrInsert.value !== null &&
    !hasVisibleRoleSupport(
      normalized.fields.setOrInsert.value,
      visibleMarks,
      new Set(["insert_title"]),
    );
  const invalidCardNumber =
    normalized.fields.cardNumber.value !== null &&
    !isPlausibleCardNumber(normalized.fields.cardNumber.value);

  if (invalidYear) {
    clearSemanticField(normalized, "year");
    addMissingEvidence(
      normalized,
      "year",
      "A valid four-digit issue year was not visibly printed; anniversary numbers are branding, not the card year.",
      "catalog",
      0.12,
    );
  }
  if (anniversaryProduct || unsupportedProduct) {
    clearSemanticField(normalized, "product");
    addMissingEvidence(
      normalized,
      "product",
      anniversaryProduct
        ? "The anniversary logo does not identify the card product or series."
        : "A specific product title was not visibly printed; catalog verification is needed.",
      "catalog",
      0.12,
    );
  }
  if (anniversarySet || unsupportedSet) {
    clearSemanticField(normalized, "setOrInsert");
    addMissingEvidence(
      normalized,
      "setOrInsert",
      anniversarySet
        ? "The anniversary logo is not a set or insert name; a checklist match is needed."
        : "A set or insert title was not visibly printed; catalog verification is needed.",
      "catalog",
      0.14,
    );
  }
  if (invalidCardNumber) {
    clearSemanticField(normalized, "cardNumber");
    addMissingEvidence(
      normalized,
      "cardNumber",
      "A readable card number containing digits was not visible.",
      "back_image",
      0.15,
    );
  }

  normalized.candidateSuggestions = normalized.candidateSuggestions.map((candidate) =>
    sanitizeCandidate(candidate, visibleMarks, currentYear),
  );

  if (
    invalidYear ||
    anniversaryProduct ||
    anniversarySet ||
    unsupportedProduct ||
    unsupportedSet ||
    invalidCardNumber
  ) {
    const player = normalized.fields.player.value;
    normalized.summary = `${player ? `${player} is visible on the card. ` : ""}Anniversary branding was kept as a visual clue and was not used as the issue year, product, or set. Catalog confirmation is still needed.`;
  }

  return normalized;
}
