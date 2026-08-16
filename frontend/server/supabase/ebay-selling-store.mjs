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

  async connections(environment) {
    const { data, error } = await this.client.from("ebay_seller_connections").select("user_id").eq("environment", environment);
    if (error) throw dbError("eBay connections read", error);
    return data ?? [];
  }

  async draft(userId, collectionId) {
    const { data, error } = await this.client.from("ebay_listing_drafts").select("*").eq("user_id", userId).eq("collection_id", collectionId).maybeSingle();
    if (error) throw dbError("eBay draft read", error);
    return data ? this.#public(data) : null;
  }

  async drafts(userId) {
    const { data, error } = await this.client.from("ebay_listing_drafts").select("*").eq("user_id", userId).order("updated_at", { ascending: false });
    if (error) throw dbError("eBay drafts read", error);
    return (data ?? []).map((row) => this.#public(row));
  }

  async saveDraft(userId, collectionId, input, environment = "sandbox") {
    const draft = EbayListingDraftSchema.parse(input);
    const existing = await this.draft(userId, collectionId);
    const draftId = existing?.draftId ?? randomUUID();
    const { data, error } = await this.client.from("ebay_listing_drafts").upsert({
      draft_id: draftId, user_id: userId, collection_id: collectionId, draft,
      status: existing?.status ?? "draft", environment, updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,collection_id" }).select("*").single();
    if (error) throw dbError("eBay draft save", error);
    return this.#public(data);
  }

  async markPublished(userId, collectionId, { offerId, listingId }) {
    const now = new Date().toISOString();
    const { data, error } = await this.client.from("ebay_listing_drafts").update({
      status: "published", ebay_offer_id: offerId, ebay_listing_id: listingId,
      schedule_status: "published", schedule_error: null,
      published_at: now, ended_at: null, updated_at: now,
    }).eq("user_id", userId).eq("collection_id", collectionId).select("*").single();
    if (error) throw dbError("eBay draft publish", error);
    return this.#public(data);
  }

  async markOfferCreated(userId, collectionId, offerId) {
    const { data, error } = await this.client.from("ebay_listing_drafts").update({
      ebay_offer_id: offerId, updated_at: new Date().toISOString(),
    }).eq("user_id", userId).eq("collection_id", collectionId).select("*").single();
    if (error) throw dbError("eBay offer save", error);
    return this.#public(data);
  }

  async markEnded(userId, collectionId) {
    const now = new Date().toISOString();
    const { data, error } = await this.client.from("ebay_listing_drafts").update({
      status: "ended", ended_at: now, updated_at: now,
    }).eq("user_id", userId).eq("collection_id", collectionId).select("*").single();
    if (error) throw dbError("eBay listing end", error);
    return this.#public(data);
  }

  async schedule(userId, collectionId, { publishAt, endAt }) {
    const { data, error } = await this.client.from("ebay_listing_drafts").update({
      scheduled_publish_at: publishAt, desired_end_at: endAt,
      schedule_status: "scheduled", schedule_error: null, updated_at: new Date().toISOString(),
    }).eq("user_id", userId).eq("collection_id", collectionId).eq("status", "draft").select("*").single();
    if (error) throw dbError("eBay schedule save", error);
    return this.#public(data);
  }

  async cancelSchedule(userId, collectionId) {
    const { data, error } = await this.client.from("ebay_listing_drafts").update({
      scheduled_publish_at: null, desired_end_at: null, schedule_status: "cancelled",
      schedule_error: null, updated_at: new Date().toISOString(),
    }).eq("user_id", userId).eq("collection_id", collectionId).eq("schedule_status", "scheduled").select("*").single();
    if (error) throw dbError("eBay schedule cancellation", error);
    return this.#public(data);
  }

  async dueSchedules(environment, now = new Date().toISOString()) {
    const { data, error } = await this.client.from("ebay_listing_drafts").select("*")
      .eq("environment", environment).eq("schedule_status", "scheduled").lte("scheduled_publish_at", now).order("scheduled_publish_at", { ascending: true }).limit(20);
    if (error) throw dbError("due eBay schedules read", error);
    return (data ?? []).map((row) => ({ ...this.#public(row), userId: row.user_id }));
  }

  async scheduleResult(userId, collectionId, { status, errorMessage = null }) {
    const { data, error } = await this.client.from("ebay_listing_drafts").update({
      schedule_status: status, schedule_error: errorMessage, updated_at: new Date().toISOString(),
    }).eq("user_id", userId).eq("collection_id", collectionId).select("*").single();
    if (error) throw dbError("eBay schedule result", error);
    return this.#public(data);
  }

  async saveSale(userId, sale) {
    const { error } = await this.client.from("ebay_order_sales").upsert({
      sale_id: sale.saleId, user_id: userId, collection_id: sale.collectionId,
      order_id: sale.orderId, line_item_id: sale.lineItemId, listing_id: sale.listingId,
      order_status: sale.orderStatus, amount_cents: sale.amountCents,
      currency: sale.currency, quantity: sale.quantity, sold_at: sale.soldAt,
      last_synced_at: new Date().toISOString(),
    }, { onConflict: "user_id,order_id,line_item_id" });
    if (error) throw dbError("eBay sale save", error);
    if (sale.collectionId) {
      const now = new Date().toISOString();
      const { error: listingError } = await this.client.from("ebay_listing_drafts").update({
        status: "sold", sold_at: sale.soldAt, sold_amount_cents: sale.amountCents,
        sold_currency: sale.currency, last_synced_at: now, updated_at: now,
      }).eq("user_id", userId).eq("collection_id", sale.collectionId);
      if (listingError) throw dbError("sold listing update", listingError);
    }
  }

  async sales(userId) {
    const { data, error } = await this.client.from("ebay_order_sales").select("*").eq("user_id", userId).order("sold_at", { ascending: false });
    if (error) throw dbError("eBay sales read", error);
    return data ?? [];
  }

  #public(row) {
    return { draftId: row.draft_id, collectionId: row.collection_id, ...row.draft,
      status: row.status, ebayOfferId: row.ebay_offer_id, ebayListingId: row.ebay_listing_id,
      updatedAt: row.updated_at, scheduledPublishAt: row.scheduled_publish_at,
      desiredEndAt: row.desired_end_at, scheduleStatus: row.schedule_status ?? "unscheduled",
      scheduleError: row.schedule_error, environment: row.environment ?? "sandbox",
      publishedAt: row.published_at, endedAt: row.ended_at, soldAt: row.sold_at,
      soldAmountCents: row.sold_amount_cents, soldCurrency: row.sold_currency,
      lastSyncedAt: row.last_synced_at };
  }
}
