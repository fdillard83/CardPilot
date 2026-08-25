export class ActiveListingConfirmationRequiredError extends Error {
  constructor() {
    super("This card has an active eBay listing. Confirm that CardPilot should end the listing and remove the card.");
    this.status = 409;
    this.code = "ACTIVE_EBAY_LISTING_CONFIRMATION_REQUIRED";
  }
}

export async function removeCollectionCardSafely({
  userId,
  collectionId,
  confirmation,
  collectionStore,
  ebaySellingStore = null,
  endActiveListing,
}) {
  const card = await collectionStore.get(userId, collectionId);
  if (!card) return { removed: false, notFound: true, endedActiveListing: false };

  const draft = ebaySellingStore ? await ebaySellingStore.draft(userId, collectionId) : null;
  let endedActiveListing = false;

  if (draft?.status === "published") {
    if (confirmation !== "END_AND_REMOVE") {
      throw new ActiveListingConfirmationRequiredError();
    }
    if (!draft.ebayOfferId) {
      const error = new Error("CardPilot cannot safely remove this card because its active eBay offer could not be identified.");
      error.status = 409;
      throw error;
    }
    await endActiveListing(draft);
    await ebaySellingStore.markEnded(userId, collectionId);
    endedActiveListing = true;
  } else if (draft?.scheduleStatus === "processing") {
    const error = new Error("CardPilot is publishing this listing now. Wait for publication to finish, then remove the card so CardPilot can safely end any live listing first.");
    error.status = 409;
    throw error;
  } else if (draft?.scheduleStatus === "scheduled") {
    await ebaySellingStore.cancelSchedule(userId, collectionId);
  }

  const removed = await collectionStore.remove(userId, collectionId);
  return { removed, notFound: !removed, endedActiveListing };
}
