const ANNIVERSARY_PATTERN = /\b(?:\d{1,3}(?:st|nd|rd|th)?\s+)?(?:years?|yrs?)\s+of\s+baseball\b|\banniversary\b/i;
const SEASON_PATTERN = /^(18|19|20)\d{2}(?:\s*[-/]\s*(?:(?:18|19|20)?\d{2}))?$/;
const GENERIC_AUTOGRAPH_SET_PATTERN =
  /^(?:topps\s+)?(?:certified\s+)?autograph(?:ed)?(?:\s+card)?(?:\s+issue)?$/i;
const POKEMON_LANGUAGES = new Map([
  ["en", "English"],
  ["eng", "English"],
  ["english", "English"],
  ["jp", "Japanese"],
  ["jpn", "Japanese"],
  ["japanese", "Japanese"],
  ["de", "German"],
  ["german", "German"],
  ["fr", "French"],
  ["french", "French"],
  ["it", "Italian"],
  ["italian", "Italian"],
  ["es", "Spanish"],
  ["spanish", "Spanish"],
  ["pt", "Portuguese"],
  ["portuguese", "Portuguese"],
  ["kr", "Korean"],
  ["korean", "Korean"],
  ["cn", "Chinese"],
  ["chinese", "Chinese"],
]);
const POKEMON_RARITIES = new Map([
  ["common", { rarity: "Common", symbol: "Circle" }],
  ["circle", { rarity: "Common", symbol: "Circle" }],
  ["uncommon", { rarity: "Uncommon", symbol: "Diamond" }],
  ["diamond", { rarity: "Uncommon", symbol: "Diamond" }],
  ["rare", { rarity: "Rare", symbol: "Black Star" }],
  ["blackstar", { rarity: "Rare", symbol: "Black Star" }],
  ["doublerare", { rarity: "Double Rare", symbol: "Double Black Star" }],
  ["doubleblackstar", { rarity: "Double Rare", symbol: "Double Black Star" }],
  ["illustrationrare", { rarity: "Illustration Rare", symbol: "Single Gold Star" }],
  ["singlegoldstar", { rarity: "Illustration Rare", symbol: "Single Gold Star" }],
  ["ultrarare", { rarity: "Ultra Rare", symbol: "Double Silver Star" }],
  ["doublesilverstar", { rarity: "Ultra Rare", symbol: "Double Silver Star" }],
  ["specialillustrationrare", { rarity: "Special Illustration Rare", symbol: "Double Gold Star" }],
  ["doublegoldstar", { rarity: "Special Illustration Rare", symbol: "Double Gold Star" }],
  ["hyperrare", { rarity: "Hyper Rare", symbol: "Triple Gold Star" }],
  ["triplegoldstar", { rarity: "Hyper Rare", symbol: "Triple Gold Star" }],
]);
const SPORT_ALIASES = new Map([
  ["baseball", "Baseball"],
  ["mlb", "Baseball"],
  ["basketball", "Basketball"],
  ["nba", "Basketball"],
  ["football", "Football"],
  ["american football", "Football"],
  ["nfl", "Football"],
  ["soccer", "Soccer"],
  ["association football", "Soccer"],
  ["ice hockey", "Hockey"],
  ["hockey", "Hockey"],
  ["nhl", "Hockey"],
  ["golf", "Golf"],
  ["tennis", "Tennis"],
  ["boxing", "Boxing"],
  ["wrestling", "Wrestling"],
  ["mixed martial arts", "Mixed Martial Arts"],
  ["mma", "Mixed Martial Arts"],
  ["auto racing", "Racing"],
  ["motorsport", "Racing"],
  ["motorsports", "Racing"],
  ["nascar", "Racing"],
  ["formula 1", "Racing"],
  ["cricket", "Cricket"],
  ["rugby", "Rugby"],
  ["lacrosse", "Lacrosse"],
  ["volleyball", "Volleyball"],
  ["multi sport", "Multi-sport"],
  ["multisport", "Multi-sport"],
]);

function normalizedText(value) {
  return typeof value === "string"
    ? value.toLowerCase().replace(/[^a-z0-9]/g, "")
    : "";
}

function isPokemonExtraction(extraction) {
  const values = [
    extraction.fields.category?.value,
    extraction.fields.character?.value,
    extraction.fields.product?.value,
    extraction.fields.brand?.value,
  ]
    .filter((value) => typeof value === "string")
    .join(" ")
    .toLowerCase();
  return values.includes("pokémon") || values.includes("pokemon");
}

function canonicalSport(value) {
  if (typeof value !== "string") return null;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return SPORT_ALIASES.get(normalized) ?? null;
}

function normalizeCardCategory(extraction) {
  const pokemon = isPokemonExtraction(extraction);
  const categorySport = canonicalSport(extraction.fields.category?.value);
  const normalizedSport =
    canonicalSport(extraction.fields.sport?.value) ?? categorySport;
  const inferredSports =
    !pokemon &&
    Boolean(
      extraction.fields.player?.value ||
        extraction.fields.sport?.value ||
        categorySport ||
        /sport/i.test(extraction.fields.category?.value ?? ""),
    );

  if (pokemon) {
    if (
      extraction.fields.character.value === null &&
      extraction.fields.player.value !== null
    ) {
      extraction.fields.character = { ...extraction.fields.player };
      const movedEvidenceIds = new Set(extraction.fields.player.evidenceIds);
      extraction.evidence = extraction.evidence.map((item) =>
        movedEvidenceIds.has(item.id) ? { ...item, field: "character" } : item,
      );
      clearSemanticField(extraction, "player");
    }
    extraction.fields.category = {
      ...extraction.fields.category,
      value: "Pokémon",
      confidence: Math.max(
        extraction.fields.category.confidence,
        extraction.fields.character.confidence,
      ),
      inferenceSource:
        extraction.fields.category.inferenceSource === "unknown"
          ? extraction.fields.character.inferenceSource
          : extraction.fields.category.inferenceSource,
    };
    for (const field of [
      "player",
      "sport",
      "team",
      "rookieStatus",
      "autograph",
      "memorabilia",
      "imageVariation",
    ]) {
      clearSemanticField(extraction, field);
    }
    return;
  }

  if (inferredSports) {
    extraction.fields.category = {
      ...extraction.fields.category,
      value: "Sports",
      confidence: Math.max(
        extraction.fields.player.confidence,
        extraction.fields.sport.confidence,
      ),
      inferenceSource: "visible",
    };
    if (normalizedSport) {
      extraction.fields.sport = {
        ...extraction.fields.sport,
        value: normalizedSport,
        confidence: Math.max(
          extraction.fields.sport.confidence,
          extraction.fields.category.confidence,
        ),
        inferenceSource:
          extraction.fields.sport.inferenceSource === "unknown"
            ? extraction.fields.category.inferenceSource
            : extraction.fields.sport.inferenceSource,
      };
    }
  }
}

function normalizePokemonLanguage(value) {
  if (typeof value !== "string") return null;
  return POKEMON_LANGUAGES.get(value.trim().toLowerCase()) ?? null;
}

function supportedPokemonLanguage(extraction) {
  const language = normalizePokemonLanguage(extraction.fields.language.value);
  if (language !== "Japanese") return language;
  const observations = extraction.evidence
    .filter((item) => extraction.fields.language.evidenceIds.includes(item.id))
    .map((item) => item.observation)
    .join(" ");
  return /(?:japanese\s+(?:text|characters?|writing)|kanji|kana|hiragana|katakana)/i.test(
    observations,
  )
    ? language
    : null;
}

function normalizePokemonRarity(extraction) {
  const rarity = normalizedText(extraction.fields.rarity.value);
  const symbol = normalizedText(extraction.fields.raritySymbol.value);
  const rarityMatch = POKEMON_RARITIES.get(rarity);
  const symbolMatch = POKEMON_RARITIES.get(symbol);

  if (!rarityMatch && !symbolMatch) return;

  const resolvedRarity = rarityMatch?.rarity ?? symbolMatch?.rarity ?? null;
  const resolvedSymbol = symbolMatch?.symbol ?? rarityMatch?.symbol ?? null;
  if (resolvedRarity) extraction.fields.rarity.value = resolvedRarity;
  if (resolvedSymbol) extraction.fields.raritySymbol.value = resolvedSymbol;
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

export function isGenericAutographCertificationText(value) {
  return (
    typeof value === "string" &&
    GENERIC_AUTOGRAPH_SET_PATTERN.test(value.trim())
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
  if (isGenericAutographCertificationText(values.setOrInsert)) {
    values.setOrInsert = null;
  }
  if (
    /pok(?:é|e)mon/i.test(values.category ?? "") ||
    values.character !== null
  ) {
    values.language = normalizePokemonLanguage(values.language);
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
  normalizeCardCategory(normalized);
  const pokemon = isPokemonExtraction(normalized);
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
  const genericAutographSet = isGenericAutographCertificationText(
    normalized.fields.setOrInsert.value,
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
      new Set(pokemon ? ["insert_title", "set_symbol"] : ["insert_title"]),
    );
  const invalidCardNumber =
    normalized.fields.cardNumber.value !== null &&
    !isPlausibleCardNumber(normalized.fields.cardNumber.value);
  const pokemonLanguage = pokemon
    ? supportedPokemonLanguage(normalized)
    : normalized.fields.language.value;

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
  if (anniversarySet || genericAutographSet || unsupportedSet) {
    clearSemanticField(normalized, "setOrInsert");
    addMissingEvidence(
      normalized,
      "setOrInsert",
      anniversarySet
        ? "The anniversary logo is not a set or insert name; a checklist match is needed."
        : genericAutographSet
          ? "Printed autograph certification wording is not a set or insert name; a checklist or confirmed visual match is needed."
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
  if (pokemon && normalized.fields.language.value !== null) {
    if (pokemonLanguage) {
      normalized.fields.language.value = pokemonLanguage;
    } else {
      clearSemanticField(normalized, "language");
      addMissingEvidence(
        normalized,
        "language",
        "A lone boxed regulation mark is not a language code; verify a separate language mark such as EN or JP.",
        "user_review",
        0.05,
      );
    }
  }
  if (pokemon) normalizePokemonRarity(normalized);

  normalized.candidateSuggestions = normalized.candidateSuggestions.map(
    (candidate) => {
      const sanitized = sanitizeCandidate(candidate, visibleMarks, currentYear);
      if (pokemon && normalized.fields.language.value === null) {
        sanitized.values.language = null;
      }
      return sanitized;
    },
  );

  if (
    invalidYear ||
    anniversaryProduct ||
    anniversarySet ||
    genericAutographSet ||
    unsupportedProduct ||
    unsupportedSet ||
    invalidCardNumber
  ) {
    const subject = pokemon
      ? normalized.fields.character.value
      : normalized.fields.player.value;
    normalized.summary = pokemon
      ? `${subject ? `${subject} is visible on the card. ` : ""}Printed collector details were kept separate from set or expansion assumptions. Confirm any set name that is not printed in full.`
      : `${subject ? `${subject} is visible on the card. ` : ""}Anniversary branding was kept as a visual clue and was not used as the issue year, product, or set. Catalog confirmation is still needed.`;
  }

  return normalized;
}
