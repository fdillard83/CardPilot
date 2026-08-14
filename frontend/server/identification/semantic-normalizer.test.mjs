import test from "node:test";
import assert from "node:assert/strict";
import { fieldKeys } from "./contracts.mjs";
import {
  isPlausibleCardNumber,
  isPlausibleIssueYear,
  normalizeCardSemantics,
} from "./semantic-normalizer.mjs";

function field(value = null, confidence = value === null ? 0 : 0.9) {
  return {
    value,
    confidence,
    evidenceIds: [],
    inferenceSource: value === null ? "unknown" : "visible",
    missingEvidence: [],
  };
}

function extraction(overrides = {}) {
  const fields = Object.fromEntries(fieldKeys.map((key) => [key, field()]));
  Object.assign(fields, overrides);
  return {
    status: "partial",
    fields,
    evidence: [],
    missingEvidence: [],
    numericReadings: [],
    visibleMarks: [
      {
        text: "75 Years of Baseball",
        kind: "anniversary_mark",
        imageSide: "front",
        location: "upper left",
        confidence: 0.99,
      },
    ],
    visualFeatures: [],
    candidateSuggestions: [],
    summary: "75 Years of Baseball Nolan Ryan",
  };
}

test("a two-digit anniversary number can never become the issue year", () => {
  const normalized = normalizeCardSemantics(
    extraction({ year: field("75", 0.99) }),
    2026,
  );

  assert.equal(normalized.fields.year.value, null);
  assert.equal(normalized.fields.year.confidence, 0);
  assert.match(normalized.missingEvidence[0].description, /anniversary/i);
});

test("anniversary branding cannot become the product or set", () => {
  const normalized = normalizeCardSemantics(
    extraction({
      product: field("75 Years of Baseball", 0.99),
      setOrInsert: field("75 Years of Baseball", 0.98),
    }),
    2026,
  );

  assert.equal(normalized.fields.product.value, null);
  assert.equal(normalized.fields.setOrInsert.value, null);
  assert.equal(normalized.visibleMarks[0].text, "75 Years of Baseball");
});

test("generic autograph certification wording cannot become an insert name", () => {
  const input = extraction({
    setOrInsert: field("Topps Certified Autograph Issue", 0.98),
  });
  input.visibleMarks.push({
    text: "TOPPS CERTIFIED AUTOGRAPH ISSUE",
    kind: "insert_title",
    imageSide: "front",
    location: "top",
    confidence: 0.98,
  });
  const normalized = normalizeCardSemantics(input, 2026);

  assert.equal(normalized.fields.setOrInsert.value, null);
  assert.match(
    normalized.missingEvidence.find((item) => item.field === "setOrInsert")
      .description,
    /certification wording/i,
  );
});

test("a plausible four-digit year remains valid", () => {
  assert.equal(isPlausibleIssueYear("2026", 2026), true);
  assert.equal(isPlausibleIssueYear("2025-26", 2026), true);
  assert.equal(isPlausibleIssueYear("75", 2026), false);
});

test("a four-digit year inferred from an anniversary mark is still rejected", () => {
  const normalized = normalizeCardSemantics(
    extraction({ year: field("1975", 0.61) }),
    2026,
  );
  assert.equal(normalized.fields.year.value, null);
});

test("a visibly printed copyright year remains available", () => {
  const input = extraction({ year: field("2026", 0.96) });
  input.visibleMarks.push({
    text: "© 2026 THE TOPPS COMPANY",
    kind: "copyright_year",
    imageSide: "back",
    location: "lower back",
    confidence: 0.98,
  });
  const normalized = normalizeCardSemantics(input, 2026);
  assert.equal(normalized.fields.year.value, "2026");
});

test("a stray single letter cannot become a card number", () => {
  const normalized = normalizeCardSemantics(
    extraction({ cardNumber: field("P", 0.84) }),
    2026,
  );
  assert.equal(normalized.fields.cardNumber.value, null);
  assert.equal(isPlausibleCardNumber("CN-14"), true);
  assert.equal(isPlausibleCardNumber("173"), true);
  assert.equal(isPlausibleCardNumber("P"), false);
});

test("Pokémon identity stays separate from sports player fields", () => {
  const input = extraction({
    category: field("Pokémon", 0.99),
    player: field("Charmander", 0.98),
    setOrInsert: field("MEP", 0.94),
    cardNumber: field("038", 0.99),
    promo: field(true, 0.96),
  });
  input.evidence.push({
    id: "ev-player-1",
    field: "player",
    source: "front_image",
    observation: "Charmander",
    location: "top",
    strength: 0.98,
  });
  input.fields.player.evidenceIds = ["ev-player-1"];
  input.visibleMarks.push({
    text: "MEP",
    kind: "set_symbol",
    imageSide: "front",
    location: "lower left",
    confidence: 0.94,
  });

  const normalized = normalizeCardSemantics(input, 2026);
  assert.equal(normalized.fields.category.value, "Pokémon");
  assert.equal(normalized.fields.character.value, "Charmander");
  assert.equal(normalized.fields.player.value, null);
  assert.equal(normalized.fields.sport.value, null);
  assert.equal(normalized.fields.setOrInsert.value, "MEP");
  assert.equal(normalized.fields.promo.value, true);
  assert.equal(normalized.evidence[0].field, "character");
});

test("a boxed Pokémon regulation mark cannot become the language", () => {
  const normalized = normalizeCardSemantics(
    extraction({
      category: field("Pokémon", 0.99),
      character: field("Charmander", 0.98),
      language: field("J", 0.91),
    }),
    2026,
  );

  assert.equal(normalized.fields.language.value, null);
  assert.match(
    normalized.missingEvidence.find((item) => item.field === "language")
      .description,
    /regulation mark/i,
  );
});

test("a supported Pokémon language code is normalized for display", () => {
  const normalized = normalizeCardSemantics(
    extraction({
      category: field("Pokémon", 0.99),
      character: field("Charmander", 0.98),
      language: field("EN", 0.94),
    }),
    2026,
  );

  assert.equal(normalized.fields.language.value, "English");
});

test("JP inferred only from a regulation mark cannot become Japanese", () => {
  const input = extraction({
    category: field("Pokémon", 0.99),
    character: field("Charmander", 0.98),
    language: field("JP", 0.81),
  });
  input.evidence.push({
    id: "ev-language-1",
    field: "language",
    source: "front_image",
    observation: "A boxed J mark appears at the lower left.",
    location: "lower left",
    strength: 0.81,
  });
  input.fields.language.evidenceIds = ["ev-language-1"];

  const normalized = normalizeCardSemantics(input, 2026);
  assert.equal(normalized.fields.language.value, null);
});

test("Japanese remains available when Japanese writing is visibly supported", () => {
  const input = extraction({
    category: field("Pokémon", 0.99),
    character: field("ヒトカゲ", 0.98),
    language: field("Japanese", 0.96),
  });
  input.evidence.push({
    id: "ev-language-1",
    field: "language",
    source: "front_image",
    observation: "Japanese characters and kana are printed throughout the card.",
    location: "front overall",
    strength: 0.96,
  });
  input.fields.language.evidenceIds = ["ev-language-1"];

  const normalized = normalizeCardSemantics(input, 2026);
  assert.equal(normalized.fields.language.value, "Japanese");
});

test("Pokémon rarity keeps the normalized name and printed symbol separate", () => {
  const normalized = normalizeCardSemantics(
    extraction({
      category: field("Pokémon", 0.99),
      character: field("Penny", 0.98),
      rarity: field("Special Illustration Rare", 0.95),
      raritySymbol: field("Double Gold Star", 0.97),
    }),
    2026,
  );

  assert.equal(normalized.fields.rarity.value, "Special Illustration Rare");
  assert.equal(normalized.fields.raritySymbol.value, "Double Gold Star");
});

test("a printed Pokémon rarity symbol can normalize a basic rarity", () => {
  const normalized = normalizeCardSemantics(
    extraction({
      category: field("Pokémon", 0.99),
      character: field("Squirtle", 0.98),
      raritySymbol: field("Diamond", 0.96),
    }),
    2026,
  );

  assert.equal(normalized.fields.rarity.value, "Uncommon");
  assert.equal(normalized.fields.raritySymbol.value, "Diamond");
});

test("sports cards keep category and sport as separate canonical fields", () => {
  const normalized = normalizeCardSemantics(
    extraction({
      category: field("Baseball", 0.95),
      player: field("Nolan Ryan", 0.98),
      sport: field("MLB", 0.92),
    }),
    2026,
  );

  assert.equal(normalized.fields.category.value, "Sports");
  assert.equal(normalized.fields.sport.value, "Baseball");
  assert.equal(normalized.fields.player.value, "Nolan Ryan");
  assert.equal(normalized.fields.character.value, null);
});

test("common football and racing aliases normalize consistently", () => {
  const football = normalizeCardSemantics(
    extraction({
      category: field("Sports", 0.95),
      player: field("Joe Burrow", 0.98),
      sport: field("American Football", 0.92),
    }),
    2026,
  );
  const racing = normalizeCardSemantics(
    extraction({
      category: field("Sports", 0.95),
      player: field("Max Verstappen", 0.98),
      sport: field("Formula 1", 0.92),
    }),
    2026,
  );

  assert.equal(football.fields.sport.value, "Football");
  assert.equal(racing.fields.sport.value, "Racing");
});
