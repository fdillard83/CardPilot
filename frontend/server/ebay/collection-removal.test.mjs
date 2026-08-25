import assert from "node:assert/strict";
import test from "node:test";
import {
  ActiveListingConfirmationRequiredError,
  removeCollectionCardSafely,
} from "./collection-removal.mjs";

function stores(draft) {
  const calls = [];
  return {
    calls,
    collectionStore: {
      async get() { calls.push("get-card"); return { collectionId: "card-1" }; },
      async remove() { calls.push("remove-card"); return true; },
    },
    ebaySellingStore: {
      async draft() { calls.push("get-draft"); return draft; },
      async markEnded() { calls.push("mark-ended"); },
      async cancelSchedule() { calls.push("cancel-schedule"); },
    },
  };
}

test("an active listing requires explicit combined-removal confirmation", async () => {
  const state = stores({ status: "published", ebayOfferId: "offer-1" });
  await assert.rejects(
    removeCollectionCardSafely({
      userId: "user-1", collectionId: "card-1", collectionStore: state.collectionStore,
      ebaySellingStore: state.ebaySellingStore, endActiveListing: async () => state.calls.push("withdraw"),
    }),
    ActiveListingConfirmationRequiredError,
  );
  assert.deepEqual(state.calls, ["get-card", "get-draft"]);
});

test("an active listing is ended before its collection card is removed", async () => {
  const state = stores({ status: "published", ebayOfferId: "offer-1" });
  const result = await removeCollectionCardSafely({
    userId: "user-1", collectionId: "card-1", confirmation: "END_AND_REMOVE",
    collectionStore: state.collectionStore, ebaySellingStore: state.ebaySellingStore,
    endActiveListing: async () => state.calls.push("withdraw"),
  });
  assert.equal(result.endedActiveListing, true);
  assert.deepEqual(state.calls, ["get-card", "get-draft", "withdraw", "mark-ended", "remove-card"]);
});

test("a failed eBay withdrawal preserves the collection card", async () => {
  const state = stores({ status: "published", ebayOfferId: "offer-1" });
  await assert.rejects(removeCollectionCardSafely({
    userId: "user-1", collectionId: "card-1", confirmation: "END_AND_REMOVE",
    collectionStore: state.collectionStore, ebaySellingStore: state.ebaySellingStore,
    endActiveListing: async () => { state.calls.push("withdraw"); throw new Error("eBay unavailable"); },
  }), /eBay unavailable/);
  assert.deepEqual(state.calls, ["get-card", "get-draft", "withdraw"]);
});

test("scheduled publication is cancelled before collection removal", async () => {
  const state = stores({ status: "draft", scheduleStatus: "scheduled" });
  await removeCollectionCardSafely({
    userId: "user-1", collectionId: "card-1", collectionStore: state.collectionStore,
    ebaySellingStore: state.ebaySellingStore, endActiveListing: async () => state.calls.push("withdraw"),
  });
  assert.deepEqual(state.calls, ["get-card", "get-draft", "cancel-schedule", "remove-card"]);
});
