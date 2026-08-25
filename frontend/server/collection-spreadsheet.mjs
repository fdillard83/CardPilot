function csvCell(value) {
  let text = String(value ?? "");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function yesNo(value) {
  return value === true ? "Yes" : value === false ? "No" : "";
}

export function collectionSpreadsheetCsv(cards) {
  const rows = [[
    "Card", "Category", "Player", "Character", "Sport", "Team", "Year",
    "Manufacturer", "Product", "Brand", "Set or insert", "Card number",
    "Language", "Rarity", "Rarity symbol", "Finish", "Promo", "Rookie",
    "Parallel", "Serial number", "Autograph", "Memorabilia", "Image variation",
    "Graded", "Grading company", "Grade", "Certification number",
    "Saved value", "Currency", "Value confidence", "Value method",
    "Collector adjusted", "Valued date", "Identification confidence",
    "eBay reference ID", "eBay reference title", "eBay reference URL",
    "Date added", "Last updated", "Collection ID",
  ]];
  for (const card of cards) {
    const fields = card.fields ?? {};
    const valuation = card.confirmedValuation;
    rows.push([
      card.title, fields.category, fields.player, fields.character, fields.sport,
      fields.team, fields.year, fields.manufacturer, fields.product, fields.brand,
      fields.setOrInsert, fields.cardNumber, fields.language, fields.rarity,
      fields.raritySymbol, fields.finish, yesNo(fields.promo), yesNo(fields.rookieStatus),
      fields.parallel, fields.serialNumber, yesNo(fields.autograph),
      yesNo(fields.memorabilia), yesNo(fields.imageVariation),
      yesNo(card.grading?.isGraded), card.grading?.company, card.grading?.grade,
      card.grading?.certificationNumber,
      valuation ? (valuation.amountCents / 100).toFixed(2) : "",
      valuation?.currency, valuation?.confidence, valuation?.method,
      valuation ? yesNo(valuation.userAdjusted) : "", valuation?.valuedAt,
      typeof card.overallConfidence === "number"
        ? `${(card.overallConfidence * 100).toFixed(1)}%`
        : "",
      card.ebayReference?.itemId, card.ebayReference?.title,
      card.ebayReference?.itemWebUrl, card.createdAt, card.updatedAt,
      card.collectionId,
    ]);
  }
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
