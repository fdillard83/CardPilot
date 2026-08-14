import { readFile } from "node:fs/promises";

async function imageDataUrl(localStore, collectionId, side) {
  const image = await localStore.image(collectionId, side);
  if (!image) return null;
  const contents = await readFile(image.filePath);
  return `data:${image.mimeType};base64,${contents.toString("base64")}`;
}

export async function localImportStatus({ userId, localStore, cloudRepository }) {
  const [localCards, cloudCards] = await Promise.all([
    localStore.list(),
    cloudRepository.list(userId),
  ]);
  const existing = new Set(cloudCards.map((card) => card.identificationId));
  return {
    localCount: localCards.length,
    alreadyImportedCount: localCards.filter((card) =>
      existing.has(card.identificationId),
    ).length,
    readyCount: localCards.filter(
      (card) => !existing.has(card.identificationId),
    ).length,
  };
}

export async function importLocalCollection({
  userId,
  localStore,
  cloudRepository,
}) {
  const localCards = await localStore.list();
  const cloudCards = await cloudRepository.list(userId);
  const existing = new Set(cloudCards.map((card) => card.identificationId));
  let importedCount = 0;
  let skippedCount = 0;

  for (const card of localCards) {
    if (existing.has(card.identificationId)) {
      skippedCount += 1;
      continue;
    }
    const [frontImage, backImage] = await Promise.all([
      imageDataUrl(localStore, card.collectionId, "front"),
      imageDataUrl(localStore, card.collectionId, "back"),
    ]);
    if (!frontImage) {
      throw new Error(`The local image for ${card.title} is missing.`);
    }
    const created = await cloudRepository.create(userId, {
      identificationId: card.identificationId,
      fields: card.fields,
      overallConfidence: card.overallConfidence,
      decision: card.decision,
      frontImage,
      backImage,
      ebayReference: card.ebayReference,
      pokemonCatalogReference: card.pokemonCatalogReference,
      grading: card.grading,
      valuationProfile: card.valuationProfile,
    });
    if (card.confirmedValuation) {
      const confirmedInput = {
        amountCents: card.confirmedValuation.amountCents,
        currency: card.confirmedValuation.currency,
        confidence: card.confirmedValuation.confidence,
        method: card.confirmedValuation.method,
        userAdjusted: card.confirmedValuation.userAdjusted,
      };
      await cloudRepository.updateConfirmedValuation(
        userId,
        created.collectionId,
        confirmedInput,
      );
    }
    existing.add(card.identificationId);
    importedCount += 1;
  }

  return { importedCount, skippedCount, totalCount: localCards.length };
}
