function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function cardKind(fields = {}) {
  const category = cleanText(fields.category).toLowerCase();
  if (category.includes("pokémon") || category.includes("pokemon")) {
    return "pokemon";
  }
  if (category.includes("sport")) return "sports";
  if (cleanText(fields.character)) return "pokemon";
  if (cleanText(fields.player) || cleanText(fields.sport)) return "sports";
  return "unknown";
}

export function isPokemonCard(fields = {}) {
  return cardKind(fields) === "pokemon";
}

export function cardIdentity(fields = {}) {
  return isPokemonCard(fields)
    ? cleanText(fields.character)
    : cleanText(fields.player);
}

export function categoryLabel(fields = {}) {
  if (isPokemonCard(fields)) return "Pokémon";
  return cleanText(fields.sport) || cleanText(fields.category) || "Trading card";
}
