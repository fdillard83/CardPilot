import { randomUUID } from "node:crypto";
import { EbayListingDraftSchema } from "../ebay/selling.mjs";

function dbError(operation, error) {
  const wrapped = new Error(`Supabase ${operation} failed.`);
  wrapped.cause = error;
  return wrapped;
}

export class SupabaseEbaySellingStore {
  constructor({ client }) { this.client = client; }

  async connection(userId) {
    const { data, error } = await this.client.from("ebay_seller_connections").select("*").eq("user_id", userId).maybeSingle();
    if (error) throw dbError("eBay connection read", error);
    return data;
  }

  async saveConnection(userId, { environment, encryptedRefreshToken, scopes }) {
    const { error } = await this.client.from("ebay_seller_connections").upsert({
      user_id: userId, environment, encrypted_refresh_token: encryptedRefreshToken,
      scopes, updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (error) throw dbError("eBay connection save", error);
  }

  async disconnect(userId) {
    const { error } = await this.client.from("ebay_seller_connections").delete().eq("user_id", userId);
    if (error) throw dbError("eBay connection delete", error);
  }

  async draft(userId, collectionId) {
    const { data, error } = await this.client.from("ebay_listing_drafts").select("*").eq("user_id", userId).eq("collection_id", collectionId).maybeSingle();
    if (error) throw dbError("eBay draft read", error);
    return data ? this.#public(data) : null;
  }

  async saveDraft(userId, collectionId, input) {
    const draft = EbayListingDraftSchema.parse(input);
    const existing = await this.draft(userId, collectionId);
    const draftId = existing?.draftId ?? randomUUID();
    const { data, error } = await this.client.from("ebay_listing_drafts").upsert({
      draft_id: draftId, user_id: userId, collection_id: collectionId, draft,
      status: existing?.status ?? "draft", updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,collection_id" }).select("*").single();
    if (error) throw dbError("eBay draft save", error);
    return this.#public(data);
  }

  async markPublished(userId, collectionId, { offerId, listingId }) {
    const { data, error } = await this.client.from("ebay_listing_drafts").update({
      status: "published", ebay_offer_id: offerId, ebay_listing_id: listingId,
      updated_at: new Date().toISOString(),
    }).eq("user_id", userId).eq("collection_id", collectionId).select("*").single();
    if (error) throw dbError("eBay draft publish", error);
    return this.#public(data);
  }

  async markEnded(userId, collectionId) {
    const { data, error } = await this.client.from("ebay_listing_drafts").update({
      status: "ended", updated_at: new Date().toISOString(),
    }).eq("user_id", userId).eq("collection_id", collectionId).select("*").single();
    if (error) throw dbError("eBay listing end", error);
    return this.#public(data);
  }

  #public(row) {
    return { draftId: row.draft_id, collectionId: row.collection_id, ...row.draft,
      status: row.status, ebayOfferId: row.ebay_offer_id, ebayListingId: row.ebay_listing_id,
      updatedAt: row.updated_at };
  }
}
