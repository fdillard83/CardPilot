function text(value) {
  if (value === null || value === undefined || value === false) return "";
  return String(value).trim();
}

function normalized(value) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function mappedEbayAspects(card, definitions = []) {
  const fields = card.fields ?? {};
  const features = [
    fields.rookieStatus && "Rookie",
    fields.serialNumber && "Serial Numbered",
    fields.autograph && "Autograph",
    fields.memorabilia && "Memorabilia",
  ].filter(Boolean).join(", ");
  const candidates = {
    playerathlete: fields.player ?? fields.character,
    player: fields.player,
    athlete: fields.player,
    character: fields.character,
    sport: fields.sport,
    team: fields.team,
    set: fields.setOrInsert ?? fields.product,
    cardname: fields.character ?? fields.player,
    yearmanufactured: fields.year,
    year: fields.year,
    cardnumber: fields.cardNumber ?? fields.collectorNumber,
    parallellvariety: fields.parallel ?? fields.finish,
    parallelvariety: fields.parallel ?? fields.finish,
    manufacturer: fields.manufacturer,
    autographed: fields.autograph ? "Yes" : "No",
    features,
    graded: card.grading?.isGraded ? "Yes" : "No",
    professionalgrader: card.grading?.company,
    grade: card.grading?.grade,
    game: fields.character ? "Pokémon TCG" : "",
    rarity: fields.rarity,
    finish: fields.finish,
    language: fields.language,
  };
  return Object.fromEntries(definitions.map((definition) => {
    const value = text(candidates[normalized(definition.name)]);
    return value ? [definition.name, [value]] : null;
  }).filter(Boolean));
}

export function listingReadiness(card, draft, definitions = []) {
  const mapped = mappedEbayAspects(card, definitions);
  const aspects = { ...mapped, ...(draft.aspects ?? {}) };
  const requiredAspects = definitions.filter((item) => item.required);
  const missingAspects = requiredAspects.filter((item) => !aspects[item.name]?.some((value) => text(value))).map((item) => item.name);
  const checks = [
    { key: "category", label: "eBay category selected", ready: /^\d+$/.test(draft.categoryId ?? "") },
    { key: "specifics", label: "Required item specifics complete", ready: missingAspects.length === 0 },
    { key: "title", label: "Listing title ready", ready: text(draft.title).length > 0 && text(draft.title).length <= 80 },
    { key: "description", label: "Description ready", ready: text(draft.description).length > 0 },
    { key: "price", label: draft.listingFormat === "AUCTION" ? "Auction starting bid ready" : "Buy It Now price ready", ready: Number(draft.listingFormat === "AUCTION" ? draft.auctionStartPriceCents : draft.priceCents) > 0 },
    { key: "photo", label: "Front card photo ready", ready: Boolean(card.images?.frontUrl) },
    { key: "seller", label: "eBay location and policies ready", ready: [draft.merchantLocationKey, draft.fulfillmentPolicyId, draft.paymentPolicyId, draft.returnPolicyId].every(Boolean) },
  ];
  return { aspects, missingAspects, checks, ready: checks.every((check) => check.ready) };
}
