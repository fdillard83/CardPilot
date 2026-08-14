import { isPokemonCard } from "../card-category.mjs";
import { fieldKeys } from "../identification/contracts.mjs";
import { pokemonQueryTerm } from "./client.mjs";

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizedText(value) {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function textMatches(left, right) {
  const a = normalizedText(left);
  const b = normalizedText(right);
  if (!a || !b) return false;
  if (/^0*\d+$/.test(a) && /^0*\d+$/.test(b)) {
    return Number(a) === Number(b);
  }
  return a === b || (a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a)));
}

function releaseYear(card) {
  const match = cleanText(card?.set?.releaseDate).match(/^(\d{4})/);
  return match?.[1] ?? null;
}

function promoCard(card) {
  return /promo/i.test(
    [card?.set?.id, card?.set?.name, card?.set?.series]
      .filter(Boolean)
      .join(" "),
  );
}

function candidateValues(card) {
  const values = Object.fromEntries(fieldKeys.map((field) => [field, null]));
  return {
    ...values,
    category: "Pokémon",
    character: cleanText(card.name) || null,
    year: releaseYear(card),
    manufacturer: "The Pokémon Company",
    product: cleanText(card?.set?.series) || null,
    brand: "Pokémon TCG",
    setOrInsert: cleanText(card?.set?.name) || null,
    cardNumber: cleanText(card.number) || null,
    language: "English",
    rarity: cleanText(card.rarity) || null,
    promo: promoCard(card),
  };
}

const matchFields = [
  ["character", "name", 0.34],
  ["cardNumber", "collector number", 0.28],
  ["setOrInsert", "set", 0.18],
  ["product", "series", 0.08],
  ["year", "year", 0.06],
  ["rarity", "rarity", 0.06],
];

function scoreCandidate(fields, values) {
  let score = 0;
  let compared = 0;
  const matchedSignals = [];
  const conflictingSignals = [];
  for (const [field, label, weight] of matchFields) {
    const observed = fields[field];
    const candidate = values[field];
    if (!cleanText(observed) || !cleanText(candidate)) continue;
    compared += weight;
    if (textMatches(observed, candidate)) {
      score += weight;
      matchedSignals.push(label);
    } else {
      conflictingSignals.push(label);
    }
  }
  const confidence = compared > 0 ? score / compared : 0;
  return {
    matchScore: Number(Math.min(1, confidence).toFixed(3)),
    matchedSignals,
    conflictingSignals,
  };
}

function buildQueries(fields) {
  const name = pokemonQueryTerm("name", fields.character);
  if (!name) return [];
  const number = pokemonQueryTerm("number", fields.cardNumber);
  const set = pokemonQueryTerm("set.name", fields.setOrInsert);
  return [
    [name, number, set],
    [name, number],
    [name, set],
    [name],
  ]
    .map((parts) => parts.filter(Boolean).join(" "))
    .filter((query, index, queries) => query && queries.indexOf(query) === index);
}

function catalogCandidate(card, fields) {
  const values = candidateValues(card);
  const score = scoreCandidate(fields, values);
  const setLabel = values.setOrInsert ?? values.product ?? "Unknown set";
  return {
    id: `pokemon-tcg-${card.id}`,
    source: "pokemon_tcg",
    cardId: card.id,
    label: [values.character, setLabel, values.cardNumber ? `#${values.cardNumber}` : null]
      .filter(Boolean)
      .join(" · "),
    imageUrl: cleanText(card?.images?.small) || null,
    largeImageUrl: cleanText(card?.images?.large) || null,
    catalogUrl: cleanText(card?.tcgplayer?.url) || null,
    values,
    ...score,
    basis:
      score.matchedSignals.length > 0
        ? `Catalog match based on ${score.matchedSignals.join(", ")}.`
        : "Catalog candidate based on the identified Pokémon name.",
  };
}

export class PokemonCatalogSearchService {
  constructor({ client }) {
    if (!client) throw new TypeError("A Pokémon TCG client is required.");
    this.client = client;
  }

  async search(fields, { limit = 6 } = {}) {
    if (!isPokemonCard(fields)) {
      throw new TypeError("Pokémon catalog search requires a Pokémon card.");
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 12) {
      throw new TypeError("Pokémon catalog result limit must be from 1 through 12.");
    }
    const queries = buildQueries(fields);
    if (queries.length === 0) {
      throw new TypeError("Identify the Pokémon name before searching the catalog.");
    }

    const cards = new Map();
    const queriesUsed = [];
    const cacheStatuses = [];
    for (const query of queries) {
      if (cards.size >= limit) break;
      const result = await this.client.searchCards({
        query,
        pageSize: Math.max(limit, 12),
      });
      queriesUsed.push(query);
      cacheStatuses.push(result.cacheStatus);
      for (const card of result.cards) {
        if (card?.id && !cards.has(card.id)) cards.set(card.id, card);
      }
    }

    const candidates = [...cards.values()]
      .map((card) => catalogCandidate(card, fields))
      .filter((candidate) => candidate.matchScore >= 0.35)
      .sort((left, right) => right.matchScore - left.matchScore)
      .slice(0, limit)
      .map((candidate, index) => ({ ...candidate, rank: index + 1 }));

    return {
      source: {
        provider: "pokemon_tcg_api",
        displayName: "Pokémon TCG API",
        authenticated: Boolean(this.client.apiKey),
      },
      searchedAt: new Date().toISOString(),
      queriesUsed,
      cacheStatus: cacheStatuses.includes("stale")
        ? "stale"
        : cacheStatuses.length > 0 && cacheStatuses.every((status) => status === "fresh")
          ? "fresh"
          : "live",
      candidates,
    };
  }
}

export { buildQueries, candidateValues, scoreCandidate };
