import assert from "node:assert/strict";
import test from "node:test";
import {
  PokemonCatalogSearchService,
  buildQueries,
  candidateValues,
} from "./catalog-search.mjs";

const pokemonFields = {
  category: "Pokémon",
  player: null,
  character: "Charmander",
  sport: null,
  team: null,
  year: "2023",
  manufacturer: "The Pokémon Company",
  product: "Scarlet & Violet",
  brand: "Pokémon TCG",
  setOrInsert: "151",
  cardNumber: "004",
  language: "English",
  rarity: "Common",
  raritySymbol: "Circle",
  finish: null,
  promo: false,
  rookieStatus: null,
  parallel: null,
  serialNumber: null,
  autograph: null,
  memorabilia: null,
  imageVariation: null,
};

const catalogCard = {
  id: "sv3pt5-4",
  name: "Charmander",
  number: "004",
  rarity: "Common",
  set: {
    id: "sv3pt5",
    name: "151",
    series: "Scarlet & Violet",
    releaseDate: "2023/09/22",
  },
  images: {
    small: "https://images.pokemontcg.io/sv3pt5/4.png",
    large: "https://images.pokemontcg.io/sv3pt5/4_hires.png",
  },
  tcgplayer: { url: "https://prices.pokemontcg.io/tcgplayer/sv3pt5-4" },
};

test("Pokémon catalog builds progressively broader identity queries", () => {
  assert.deepEqual(buildQueries(pokemonFields), [
    'name:"Charmander" number:"004" set.name:"151"',
    'name:"Charmander" number:"004"',
    'name:"Charmander" set.name:"151"',
    'name:"Charmander"',
  ]);
});

test("Pokémon catalog maps provider cards into CardPilot fields", () => {
  assert.deepEqual(candidateValues(catalogCard), {
    ...Object.fromEntries(Object.keys(pokemonFields).map((field) => [field, null])),
    category: "Pokémon",
    character: "Charmander",
    year: "2023",
    manufacturer: "The Pokémon Company",
    product: "Scarlet & Violet",
    brand: "Pokémon TCG",
    setOrInsert: "151",
    cardNumber: "004",
    language: "English",
    rarity: "Common",
    promo: false,
  });
});

test("Pokémon catalog ranks and deduplicates matching candidates", async () => {
  const calls = [];
  const service = new PokemonCatalogSearchService({
    client: {
      apiKey: null,
      async searchCards({ query }) {
        calls.push(query);
        return {
          cards: [catalogCard],
          totalCount: 1,
          cacheStatus: calls.length === 1 ? "miss" : "fresh",
        };
      },
    },
  });

  const result = await service.search(pokemonFields, { limit: 3 });
  assert.equal(calls.length, 4);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].cardId, "sv3pt5-4");
  assert.equal(result.candidates[0].matchScore, 1);
  assert.deepEqual(result.candidates[0].matchedSignals, [
    "name",
    "collector number",
    "set",
    "series",
    "year",
    "rarity",
  ]);
  assert.equal(result.source.authenticated, false);
});

test("Pokémon catalog rejects non-Pokémon cards", async () => {
  const service = new PokemonCatalogSearchService({
    client: { searchCards: async () => ({ cards: [] }) },
  });
  await assert.rejects(
    () => service.search({ ...pokemonFields, category: "Sports", character: null }),
    /requires a Pokémon card/,
  );
});
