import { useEffect, useMemo, useState } from "react";
import type { SavedCollectionCard } from "../identification/types";

type QueueItem = {
  collectionId: string; title: string; priceCents: number; currency: string; status: string;
  updatedAt: string; imageUrl: string; missingAspects: string[];
  checks: { key: string; label: string; ready: boolean }[]; ready: boolean;
  scheduleStatus?: string; scheduledPublishAt?: string | null; desiredEndAt?: string | null; scheduleError?: string | null;
  automationStatus?: "preview" | "needs_attention" | "ready" | "publishing" | "published" | "failed";
  automationReason?: string | null; automationUpdatedAt?: string | null;
  listingUrl?: string | null; publishedAt?: string | null; endedAt?: string | null; soldAt?: string | null; soldAmountCents?: number | null; soldCurrency?: string | null;
  viewCount?: number | null; impressionCount?: number | null; watcherCount?: number | null;
  paymentStatus?: string | null; fulfillmentStatus?: string | null;
  saleId?: string | null; shippingCarrierCode?: string | null; trackingNumber?: string | null; shippedAt?: string | null;
};
type QueuePayload = { environment: string; productionPublishingEnabled: boolean; fulfillmentWriteAuthorized: boolean; analyticsAuthorized: boolean; engagementUpdatedAt?: string | null; items: QueueItem[] };

export function EbayListingQueue({ cards, onOpenDraft, onClose }: {
  cards: SavedCollectionCard[]; onOpenDraft: (card: SavedCollectionCard) => void; onClose: () => void;
}) {
  const [payload, setPayload] = useState<QueuePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [shippingId, setShippingId] = useState<string | null>(null);
  const [shippingCarrierCode, setShippingCarrierCode] = useState("USPS");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [shippingBusy, setShippingBusy] = useState(false);
  const [tab, setTab] = useState<"all" | "draft" | "scheduled" | "active" | "sold" | "ended">("all");

  const load = () => fetch("/api/ebay/listing-queue").then(async (response) => {
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    setPayload(body);
  });

  useEffect(() => {
    void load().catch((caught) => setError(caught instanceof Error ? caught.message : "CardPilot could not load listing drafts."));
  }, []);

  const itemState = (item: QueueItem) => item.status === "published" ? "active" : item.status === "sold" ? "sold" : item.status === "ended" ? "ended" : item.scheduleStatus === "scheduled" ? "scheduled" : "draft";
  const counts = useMemo(() => Object.fromEntries(["draft", "scheduled", "active", "sold", "ended"].map((state) => [state, payload?.items.filter((item) => itemState(item) === state).length ?? 0])), [payload]);
  const visibleItems = useMemo(() => payload?.items.filter((item) => tab === "all" || itemState(item) === tab) ?? [], [payload, tab]);
  const deleteDraft = async (item: QueueItem) => {
    if (!window.confirm(`Delete the saved eBay draft for “${item.title}”? This cannot be undone.`)) return;
    setDeletingId(item.collectionId); setError(null);
    try {
      const response = await fetch(`/api/collection/${encodeURIComponent(item.collectionId)}/ebay-draft`, { method: "DELETE" });
      if (!response.ok) { const body = await response.json().catch(() => null); throw new Error(body?.error ?? "Draft could not be deleted."); }
      setPayload((current) => current ? { ...current, items: current.items.filter((candidate) => candidate.collectionId !== item.collectionId) } : current);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Draft could not be deleted."); }
    finally { setDeletingId(null); }
  };
  const reconnectEbay = async () => {
    setError(null);
    try {
      const response = await fetch("/api/ebay/selling/authorize", { method: "POST" });
      const body = await response.json();
      if (!response.ok || !body.authorizationUrl) throw new Error(body.error ?? "eBay reconnect could not start.");
      window.location.assign(body.authorizationUrl);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "eBay reconnect could not start."); }
  };
  const confirmShipment = async (item: QueueItem) => {
    if (!item.saleId || !trackingNumber.trim()) return;
    if (!window.confirm(`Confirm that “${item.title}” has been shipped with ${shippingCarrierCode} tracking ${trackingNumber.trim()}? CardPilot will send this to eBay.`)) return;
    setShippingBusy(true); setError(null);
    try {
      const response = await fetch(`/api/ebay/sales/${encodeURIComponent(item.saleId)}/ship`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: "SHIP", shippingCarrierCode, trackingNumber: trackingNumber.trim() }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Shipment could not be confirmed.");
      setShippingId(null); setTrackingNumber(""); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Shipment could not be confirmed."); }
    finally { setShippingBusy(false); }
  };

  return <div className="ebay-draft-backdrop" role="presentation">
    <section className="ebay-draft-panel ebay-queue-panel" role="dialog" aria-modal="true" aria-labelledby="ebay-queue-title">
      <header><div><span>eBay selling</span><h2 id="ebay-queue-title">Listings and drafts</h2></div><div><a className="button-link" href="/api/ebay/sales/export.csv">Download sales CSV</a><button type="button" disabled={syncing} onClick={() => { setSyncing(true); setError(null); void fetch("/api/ebay/sales/sync", { method: "POST" }).then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error); await load(); }).catch((caught) => setError(caught instanceof Error ? caught.message : "Sales sync failed.")).finally(() => setSyncing(false)); }}>{syncing ? "Syncing..." : "Sync eBay sales"}</button><button type="button" onClick={onClose}>Close</button></div></header>
      {!payload && !error && <div className="collection-empty"><span className="spinner" /> Loading saved drafts...</div>}
      {error && <div className="error-banner" role="alert">{error}</div>}
      {payload && <>
        <div className={`ebay-environment-guard ${payload.environment}`}>
          <strong>{payload.environment === "sandbox" ? "Sandbox test mode" : "Production mode"}</strong>
          <span>{payload.environment === "sandbox" ? "Nothing in this queue can become a real eBay listing." : "Publishing can create a real public listing and may incur eBay fees."}</span>
        </div>
        {!payload.fulfillmentWriteAuthorized && <div className="error-banner"><span>Reconnect eBay once before CardPilot can send shipment tracking.</span> <button type="button" onClick={() => void reconnectEbay()}>Reconnect eBay permissions</button></div>}
        {payload.environment === "production" && !payload.analyticsAuthorized && <div className="error-banner"><span>Reconnect eBay once to show views for active listings. Watchers will still appear when eBay provides them.</span> <button type="button" onClick={() => void reconnectEbay()}>Enable listing views</button></div>}
        <div className="ebay-queue-tabs" role="tablist" aria-label="Listing status">{(["all", "draft", "scheduled", "active", "sold", "ended"] as const).map((state) => <button type="button" role="tab" aria-selected={tab === state} className={tab === state ? "active" : ""} key={state} onClick={() => setTab(state)}>{state[0].toUpperCase() + state.slice(1)} {state === "all" ? payload.items.length : counts[state]}</button>)}</div>
        {payload.items.length === 0 ? <div className="collection-empty"><strong>No saved eBay drafts yet</strong><span>Open a card and choose Sell on eBay, then save its draft.</span></div> :
          visibleItems.length === 0 ? <div className="collection-empty"><strong>No {tab} listings</strong><span>Choose another status above.</span></div> : <div className="ebay-queue-list">{visibleItems.map((item) => {
            const card = cards.find((candidate) => candidate.collectionId === item.collectionId);
            const missing = [...item.checks.filter((check) => !check.ready).map((check) => check.label), ...item.missingAspects];
            return <article key={item.collectionId}>
              <img src={item.imageUrl} alt="" />
              <div><span className={`ebay-queue-state ${item.ready ? "ready" : "waiting"}`}>{item.status === "published" ? "Active" : item.status === "sold" ? "Sold" : item.status === "ended" ? "Ended" : item.automationStatus === "publishing" ? "Publishing" : item.automationStatus === "failed" ? "Autopilot stopped" : item.automationStatus === "needs_attention" ? "Needs attention" : item.scheduleStatus === "scheduled" ? "Scheduled" : item.scheduleStatus === "failed" ? "Schedule failed" : item.ready ? "Ready" : "Needs attention"}</span><h3>{item.title}</h3><strong>{item.currency} {(item.priceCents / 100).toFixed(2)}</strong><small>Updated {new Date(item.updatedAt).toLocaleString()}</small>{item.automationReason && item.status === "draft" && <p>{item.automationReason}</p>}{item.publishedAt && item.status === "published" && <p>Active since {new Date(item.publishedAt).toLocaleString()}</p>}{item.status === "published" && (item.viewCount != null || item.watcherCount != null) && <p><strong>{item.viewCount ?? "—"}</strong> views · <strong>{item.watcherCount ?? "—"}</strong> watchers{item.impressionCount != null ? ` · ${item.impressionCount} impressions` : ""}</p>}{item.soldAt && <p>Sold {new Date(item.soldAt).toLocaleString()}{item.soldAmountCents != null ? ` for ${item.soldCurrency ?? "USD"} ${(item.soldAmountCents / 100).toFixed(2)}` : ""}</p>}{item.status === "sold" && <p>{item.paymentStatus === "PAID" ? "Buyer paid" : `Payment: ${item.paymentStatus ?? "check eBay"}`} · {item.shippedAt || item.fulfillmentStatus === "FULFILLED" ? "Shipped" : "Needs shipment"}</p>}{item.shippedAt && <p>Shipped {new Date(item.shippedAt).toLocaleString()} · {item.shippingCarrierCode} {item.trackingNumber}</p>}{item.listingUrl && <a href={item.listingUrl} target="_blank" rel="noreferrer">View on eBay</a>}{item.scheduleStatus === "scheduled" && item.scheduledPublishAt && <p>Publishes automatically {new Date(item.scheduledPublishAt).toLocaleString()}{item.desiredEndAt ? ` · Expected end ${new Date(item.desiredEndAt).toLocaleString()}` : ""}</p>}{item.scheduleError && <p>{item.scheduleError}</p>}{missing.length > 0 && item.status === "draft" && <p>Still needed: {missing.join(", ")}.</p>}{shippingId === item.collectionId && <div className="ebay-shipment-form"><label>Carrier<select value={shippingCarrierCode} onChange={(event) => setShippingCarrierCode(event.target.value)}><option value="USPS">USPS</option><option value="UPS">UPS</option><option value="FedEx">FedEx</option><option value="DHL">DHL</option></select></label><label>Tracking number<input value={trackingNumber} maxLength={100} autoComplete="off" onChange={(event) => setTrackingNumber(event.target.value)} /></label><button type="button" disabled={shippingBusy || trackingNumber.trim().length < 3} onClick={() => void confirmShipment(item)}>{shippingBusy ? "Sending to eBay..." : "Confirm shipped and send tracking"}</button><button type="button" disabled={shippingBusy} onClick={() => { setShippingId(null); setTrackingNumber(""); }}>Cancel</button></div>}</div>
              <div>{item.status === "draft" && item.scheduleStatus !== "scheduled" && <button className="account-delete-button" type="button" disabled={deletingId === item.collectionId} onClick={() => void deleteDraft(item)}>{deletingId === item.collectionId ? "Deleting..." : "Delete draft"}</button>}{item.status === "sold" && !item.shippedAt && item.fulfillmentStatus !== "FULFILLED" && payload.environment === "production" && <a className="button-link" href="https://www.ebay.com/sh/ord" target="_blank" rel="noreferrer">Buy discounted label on eBay</a>}{item.status === "sold" && !item.shippedAt && item.fulfillmentStatus !== "FULFILLED" && item.saleId && <button type="button" disabled={!payload.fulfillmentWriteAuthorized} onClick={() => setShippingId(item.collectionId)}>Add tracking bought elsewhere</button>}<button type="button" disabled={!card} onClick={() => card && onOpenDraft(card)}>{item.status === "published" ? "View listing" : "Review draft"}</button></div>
            </article>;
          })}</div>}
        <p className="valuation-disclaimer">For an eBay label, open the sold order on eBay and choose Purchase shipping label. eBay uploads its tracking automatically; return here and sync sales. Use Add tracking bought elsewhere only for postage purchased outside eBay.</p>
        <p className="valuation-disclaimer">CardPilot never bulk-publishes this queue. Every listing requires a final individual review and confirmation.</p>
      </>}
    </section>
  </div>;
}
