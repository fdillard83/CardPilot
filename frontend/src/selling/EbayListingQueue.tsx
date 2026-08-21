import { useEffect, useMemo, useState } from "react";
import type { SavedCollectionCard } from "../identification/types";

type QueueItem = {
  collectionId: string; title: string; priceCents: number; currency: string; buyerShippingCostCents?: number | null; status: string;
  updatedAt: string; imageUrl: string; missingAspects: string[];
  checks: { key: string; label: string; ready: boolean }[]; ready: boolean;
  scheduleStatus?: string; scheduledPublishAt?: string | null; desiredEndAt?: string | null; scheduleError?: string | null;
  automationStatus?: "preview" | "needs_attention" | "ready" | "publishing" | "published" | "failed";
  automationReason?: string | null; automationUpdatedAt?: string | null;
  listingUrl?: string | null; publishedAt?: string | null; endedAt?: string | null; soldAt?: string | null; soldAmountCents?: number | null; soldCurrency?: string | null;
  viewCount?: number | null; impressionCount?: number | null; watcherCount?: number | null;
  paymentStatus?: string | null; fulfillmentStatus?: string | null;
  saleId?: string | null; shippingCarrierCode?: string | null; trackingNumber?: string | null; shippedAt?: string | null;
  promotionRequested?: boolean;
  promotion?: { status: "promoted" | "failed"; error?: string; adRatePercent?: number } | null;
  interventionHistory?: Array<{
    id: string; type: "price_undercut" | "listing_optimization" | "promotion"; source: "manual" | "automatic";
    createdAt: string; summary: string; outcomes: Array<{ days: 3 | 7 | 14; capturedAt: string; metrics: Record<string, unknown> }>;
  }>;
  health?: {
    score: number; diagnosis: string; issues: string[]; ageDays: number;
    clickThroughRate: number | null; aspectCompleteness: number | null;
    referenceValueCents: number | null; priceDifferencePercent: number | null;
    hasChanges: boolean; needsAttention: boolean;
    optimized: {
      title: string;
      changes: { title: { from: string; to: string } | null; aspects: string[]; addBackImage: boolean };
    };
  } | null;
};
type InterventionLearning = { type: "price_undercut" | "listing_optimization" | "promotion"; measured: number; improved: number; improvementRate: number; ready: boolean };
type QueuePayload = { environment: string; productionPublishingEnabled: boolean; fulfillmentWriteAuthorized: boolean; analyticsAuthorized: boolean; marketingAuthorized: boolean; engagementUpdatedAt?: string | null; interventionLearning?: { personal: InterventionLearning[]; community: InterventionLearning[] }; items: QueueItem[] };

function InterventionHistory({ history }: { history: NonNullable<QueueItem["interventionHistory"]> }) {
  if (!history.length) return null;
  return <details className="ebay-intervention-history">
    <summary>Before-and-after log ({history.length})</summary>
    <ul>{[...history].reverse().slice(0, 8).map((entry) => {
      const latest = [...(entry.outcomes ?? [])].sort((left, right) => right.days - left.days)[0];
      const metrics = latest?.metrics ?? {};
      return <li key={entry.id}>
        <strong>{entry.summary}</strong>
        <span>{entry.source === "automatic" ? "Automatic" : "Confirmed manually"} · {new Date(entry.createdAt).toLocaleString()}</span>
        {latest ? <small>After {latest.days} days: {String(metrics.impressionCount ?? "—")} impressions · {String(metrics.viewCount ?? "—")} views · {String(metrics.watcherCount ?? "—")} watchers{metrics.status === "sold" ? " · Sold" : ""}</small> : <small>First outcome check will be recorded after 3 days.</small>}
      </li>;
    })}</ul>
  </details>;
}

export function EbayListingQueue({ cards, onOpenDraft, onClose }: {
  cards: SavedCollectionCard[]; onOpenDraft: (card: SavedCollectionCard) => void; onClose: () => void;
}) {
  const [payload, setPayload] = useState<QueuePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [shippingId, setShippingId] = useState<string | null>(null);
  const [shippingCarrierCode, setShippingCarrierCode] = useState("USPS");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [shippingBusy, setShippingBusy] = useState(false);
  const [selectedOptimizationIds, setSelectedOptimizationIds] = useState<string[]>([]);
  const [optimizationBusy, setOptimizationBusy] = useState(false);
  const [promoteOptimized, setPromoteOptimized] = useState(false);
  const [promotionAdRate, setPromotionAdRate] = useState(2);
  const [optimizationMessage, setOptimizationMessage] = useState<string | null>(null);
  const [optimizationReviewOpen, setOptimizationReviewOpen] = useState(false);
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
    setError(null); setReconnecting(true);
    try {
      const response = await fetch("/api/ebay/selling/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ returnTo: "listing-queue" }),
      });
      const body = await response.json();
      if (!response.ok || !body.authorizationUrl) throw new Error(body.error ?? "eBay reconnect could not start.");
      window.location.assign(body.authorizationUrl);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "eBay reconnect could not start.");
      setReconnecting(false);
    }
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

  const activeNeedingOptimization = payload?.items.filter(
    (item) => item.status === "published" && item.health?.needsAttention,
  ) ?? [];
  const activeActionableListings = activeNeedingOptimization.filter((item) =>
    item.health?.hasChanges ||
    (payload?.marketingAuthorized && item.promotion?.status !== "promoted"),
  );
  const selectedOptimizationItems = activeActionableListings.filter((item) =>
    selectedOptimizationIds.includes(item.collectionId),
  );
  const optimizationActionLabel = (item: QueueItem) => {
    const actions = [
      item.health?.optimized.changes.title ? "searchable title" : null,
      item.health?.optimized.changes.aspects.length ? `${item.health.optimized.changes.aspects.length} card detail${item.health.optimized.changes.aspects.length === 1 ? "" : "s"}` : null,
      item.health?.optimized.changes.addBackImage ? "back photo" : null,
      promoteOptimized ? "promotion" : null,
    ].filter(Boolean);
    return actions.join(", ") || "visibility";
  };
  const toggleOptimization = (collectionId: string) => {
    setOptimizationReviewOpen(false);
    setOptimizationMessage(null);
    setSelectedOptimizationIds((current) => current.includes(collectionId)
      ? current.filter((id) => id !== collectionId)
      : [...current, collectionId]);
  };
  const optimizeSelected = async () => {
    if (!selectedOptimizationIds.length || optimizationBusy) return;
    setOptimizationBusy(true);
    setError(null);
    setOptimizationMessage(null);
    try {
      const response = await fetch("/api/ebay/listings/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collectionIds: selectedOptimizationIds,
          promoteListings: promoteOptimized,
          promotionAdRatePercent: promotionAdRate,
          confirmation: "OPTIMIZE_ACTIVE_LISTINGS",
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "The active listings could not be optimized.");
      setOptimizationMessage(`${body.updated} active listing${body.updated === 1 ? " was" : "s were"} improved${body.failed ? `; ${body.failed} could not be changed` : ""}.`);
      setSelectedOptimizationIds([]);
      setPromoteOptimized(false);
      setOptimizationReviewOpen(false);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The active listings could not be optimized.");
    } finally {
      setOptimizationBusy(false);
    }
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
        {(!payload.fulfillmentWriteAuthorized || !payload.marketingAuthorized || (payload.environment === "production" && !payload.analyticsAuthorized)) && <div className="ebay-permission-notice" role="status">
          <strong>One-time eBay permission update</strong>
          <span>
            Reconnect eBay to enable {[
              !payload.analyticsAuthorized && payload.environment === "production" ? "listing views" : null,
              !payload.fulfillmentWriteAuthorized ? "shipment tracking" : null,
              !payload.marketingAuthorized ? "active listing promotion" : null,
            ].filter(Boolean).join(" and ")}. Your active listings and drafts will not be changed or republished.
          </span>
          {!payload.analyticsAuthorized && payload.environment === "production" && <small>Watchers can still appear when eBay provides them.</small>}
          <button type="button" disabled={reconnecting} onClick={() => void reconnectEbay()}>{reconnecting ? "Opening eBay authorization..." : "Reconnect eBay and return here"}</button>
        </div>}
        <div className="ebay-queue-tabs" role="tablist" aria-label="Listing status">{(["all", "draft", "scheduled", "active", "sold", "ended"] as const).map((state) => <button type="button" role="tab" aria-selected={tab === state} className={tab === state ? "active" : ""} key={state} onClick={() => setTab(state)}>{state[0].toUpperCase() + state.slice(1)} {state === "all" ? payload.items.length : counts[state]}</button>)}</div>
        {(payload.interventionLearning?.personal.some((entry) => entry.ready) || payload.interventionLearning?.community.some((entry) => entry.ready)) && <div className="ebay-learning-summary">
          <strong>What CardPilot is learning</strong>
          <div>{(payload.interventionLearning.personal.some((entry) => entry.ready) ? payload.interventionLearning.personal : payload.interventionLearning.community).filter((entry) => entry.ready).map((entry) => <span key={entry.type}>{entry.type === "price_undercut" ? "Delivered-price changes" : entry.type === "promotion" ? "Promotions" : "Listing improvements"}: {Math.round(entry.improvementRate * 100)}% improved after {entry.measured} measured changes</span>)}</div>
          <small>Personal results are used after 3 measured outcomes; anonymized community patterns require at least 10.</small>
        </div>}
        {activeNeedingOptimization.length > 0 && (tab === "all" || tab === "active") && <section className="ebay-optimization-panel">
          <div>
            <span>Active listing health</span>
            <strong>{activeNeedingOptimization.length} listing{activeNeedingOptimization.length === 1 ? " needs" : "s need"} attention</strong>
            <small>{activeActionableListings.length > 0 ? `${activeActionableListings.length} ${activeActionableListings.length === 1 ? "has" : "have"} changes CardPilot can apply now.` : "These listings need more exposure, but their titles and card details are already optimized."}</small>
          </div>
          {activeActionableListings.length > 0 && <div className="ebay-optimization-actions">
            <button type="button" disabled={optimizationBusy} onClick={() => {
              setOptimizationReviewOpen(false);
              setOptimizationMessage(null);
              setSelectedOptimizationIds(selectedOptimizationItems.length === activeActionableListings.length
                ? []
                : activeActionableListings.map((item) => item.collectionId));
            }}>{selectedOptimizationItems.length === activeActionableListings.length ? "Clear selected" : "Select all available improvements"}</button>
            <strong className="ebay-selection-count">{selectedOptimizationItems.length} selected</strong>
            <button type="button" disabled={optimizationBusy || selectedOptimizationItems.length === 0} onClick={() => setOptimizationReviewOpen(true)}>Review {selectedOptimizationItems.length || "selected"}</button>
          </div>}
          {!payload.marketingAuthorized && <small>Reconnect eBay once to unlock promotion. Title, card-detail, and photo improvements remain available now.</small>}
          {optimizationReviewOpen && selectedOptimizationItems.length > 0 && <div className="ebay-optimization-review">
            <div>
              <strong>Review {selectedOptimizationItems.length} live eBay change{selectedOptimizationItems.length === 1 ? "" : "s"}</strong>
              <small>Nothing changes on eBay until you press the green apply button below.</small>
            </div>
            <ul>{selectedOptimizationItems.map((item) => <li key={item.collectionId}>
              <strong>{item.title}</strong>
              <span>{optimizationActionLabel(item)}</span>
            </li>)}</ul>
            {payload.marketingAuthorized ? <>
              <label className="ebay-promotion-choice"><input type="checkbox" checked={promoteOptimized} disabled={optimizationBusy} onChange={(event) => setPromoteOptimized(event.target.checked)} /> Add eBay promotion to these listings</label>
              {promoteOptimized && <label className="ebay-promotion-rate">Promotion rate
                <select value={promotionAdRate} disabled={optimizationBusy} onChange={(event) => setPromotionAdRate(Number(event.target.value))}>
                  {Array.from({ length: 50 }, (_, index) => index + 1).map((rate) => <option value={rate} key={rate}>{rate}%</option>)}
                </select>
              </label>}
            </> : <small>Promotion is unavailable until the one-time eBay permission update is complete.</small>}
            <div className="ebay-optimization-confirm-actions">
              <button type="button" className="primary" disabled={optimizationBusy || (promoteOptimized && !payload.marketingAuthorized)} onClick={() => void optimizeSelected()}>{optimizationBusy ? "Applying changes to eBay..." : `Apply changes to ${selectedOptimizationItems.length} listing${selectedOptimizationItems.length === 1 ? "" : "s"}`}</button>
              <button type="button" disabled={optimizationBusy} onClick={() => setOptimizationReviewOpen(false)}>Go back</button>
            </div>
          </div>}
          {optimizationMessage && <p role="status">{optimizationMessage}</p>}
        </section>}
        {payload.items.length === 0 ? <div className="collection-empty"><strong>No saved eBay drafts yet</strong><span>Open a card and choose Sell on eBay, then save its draft.</span></div> :
          visibleItems.length === 0 ? <div className="collection-empty"><strong>No {tab} listings</strong><span>Choose another status above.</span></div> : <div className="ebay-queue-list">{visibleItems.map((item) => {
            const card = cards.find((candidate) => candidate.collectionId === item.collectionId);
            const missing = [...item.checks.filter((check) => !check.ready).map((check) => check.label), ...item.missingAspects];
            const optimizationActionable = Boolean(item.health?.hasChanges || (
              payload.marketingAuthorized && item.health?.needsAttention && item.promotion?.status !== "promoted"
            ));
            return <article key={item.collectionId}>
              <img src={item.imageUrl} alt="" />
              <div><span className={`ebay-queue-state ${item.ready ? "ready" : "waiting"}`}>{item.status === "published" ? "Active" : item.status === "sold" ? "Sold" : item.status === "ended" ? "Ended" : item.automationStatus === "publishing" ? "Publishing" : item.automationStatus === "failed" ? "Autopilot stopped" : item.automationStatus === "needs_attention" ? "Needs attention" : item.scheduleStatus === "scheduled" ? "Scheduled" : item.scheduleStatus === "failed" ? "Schedule failed" : item.ready ? "Ready" : "Needs attention"}</span><h3>{item.title}</h3><strong>{item.currency} {(item.priceCents / 100).toFixed(2)}</strong>{item.status === "published" && <small>{item.buyerShippingCostCents == null ? "Total buyer cost unavailable until eBay returns shipping" : `Total buyer cost: ${item.currency} ${((item.priceCents + item.buyerShippingCostCents) / 100).toFixed(2)} (${item.currency} ${(item.priceCents / 100).toFixed(2)} item + ${item.currency} ${(item.buyerShippingCostCents / 100).toFixed(2)} shipping)`}</small>}<small>Updated {new Date(item.updatedAt).toLocaleString()}</small>{item.automationReason && item.status === "draft" && <p>{item.automationReason}</p>}{item.publishedAt && item.status === "published" && <p>Active since {new Date(item.publishedAt).toLocaleString()}</p>}{item.status === "published" && (item.viewCount != null || item.watcherCount != null || item.impressionCount != null) && <p><strong>{item.impressionCount ?? "—"}</strong> impressions · <strong>{item.viewCount ?? "—"}</strong> views · <strong>{item.watcherCount ?? "—"}</strong> watchers{item.health?.clickThroughRate != null ? ` · ${(item.health.clickThroughRate * 100).toFixed(1)}% click-through` : ""}</p>}{item.soldAt && <p>Sold {new Date(item.soldAt).toLocaleString()}{item.soldAmountCents != null ? ` for ${item.soldCurrency ?? "USD"} ${(item.soldAmountCents / 100).toFixed(2)}` : ""}</p>}{item.status === "sold" && <p>{item.paymentStatus === "PAID" ? "Buyer paid" : `Payment: ${item.paymentStatus ?? "check eBay"}`} · {item.shippedAt || item.fulfillmentStatus === "FULFILLED" ? "Shipped" : "Needs shipment"}</p>}{item.shippedAt && <p>Shipped {new Date(item.shippedAt).toLocaleString()} · {item.shippingCarrierCode} {item.trackingNumber}</p>}{item.listingUrl && <a href={item.listingUrl} target="_blank" rel="noreferrer">View on eBay</a>}{item.scheduleStatus === "scheduled" && item.scheduledPublishAt && <p>Publishes automatically {new Date(item.scheduledPublishAt).toLocaleString()}{item.desiredEndAt ? ` · Expected end ${new Date(item.desiredEndAt).toLocaleString()}` : ""}</p>}{item.scheduleError && <p>{item.scheduleError}</p>}{missing.length > 0 && item.status === "draft" && <p>Still needed: {missing.join(", ")}.</p>}{shippingId === item.collectionId && <div className="ebay-shipment-form"><label>Carrier<select value={shippingCarrierCode} onChange={(event) => setShippingCarrierCode(event.target.value)}><option value="USPS">USPS</option><option value="UPS">UPS</option><option value="FedEx">FedEx</option><option value="DHL">DHL</option></select></label><label>Tracking number<input value={trackingNumber} maxLength={100} autoComplete="off" onChange={(event) => setTrackingNumber(event.target.value)} /></label><button type="button" disabled={shippingBusy || trackingNumber.trim().length < 3} onClick={() => void confirmShipment(item)}>{shippingBusy ? "Sending to eBay..." : "Confirm shipped and send tracking"}</button><button type="button" disabled={shippingBusy} onClick={() => { setShippingId(null); setTrackingNumber(""); }}>Cancel</button></div>}{item.health && <div className="ebay-listing-health"><div><span className={`health-score health-${item.health.score >= 80 ? "strong" : item.health.score >= 60 ? "watch" : "weak"}`}>{item.health.score}/100</span><strong>{item.health.diagnosis}</strong></div>{item.health.issues.length > 0 && <ul>{item.health.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}{item.health.optimized.changes.title && <div className="ebay-title-preview"><span>Proposed searchable title</span><strong>{item.health.optimized.title}</strong></div>}<div className="ebay-health-meta">{item.health.aspectCompleteness != null && <span>{Math.round(item.health.aspectCompleteness * 100)}% important specifics complete</span>}{item.health.optimized.changes.aspects.length > 0 && <span>{item.health.optimized.changes.aspects.length} specifics improved</span>}{item.health.optimized.changes.addBackImage && <span>Back photo will be added</span>}{item.promotion?.status === "promoted" && <span>Promoted at {item.promotion.adRatePercent ?? "saved"}%</span>}</div>{optimizationActionable && <label className="ebay-optimize-select"><input type="checkbox" checked={selectedOptimizationIds.includes(item.collectionId)} onChange={() => toggleOptimization(item.collectionId)} /> {selectedOptimizationIds.includes(item.collectionId) ? "Selected for review — no eBay changes yet" : "Include in listing review"}</label>}</div>}{item.interventionHistory && <InterventionHistory history={item.interventionHistory} />}</div>
              <div>{item.status === "draft" && item.scheduleStatus !== "scheduled" && <button className="account-delete-button" type="button" disabled={deletingId === item.collectionId} onClick={() => void deleteDraft(item)}>{deletingId === item.collectionId ? "Deleting..." : "Delete draft"}</button>}{item.status === "sold" && !item.shippedAt && item.fulfillmentStatus !== "FULFILLED" && payload.environment === "production" && <a className="button-link" href="https://www.ebay.com/sh/ord" target="_blank" rel="noreferrer">Buy discounted label on eBay</a>}{item.status === "sold" && !item.shippedAt && item.fulfillmentStatus !== "FULFILLED" && item.saleId && <button type="button" disabled={!payload.fulfillmentWriteAuthorized} onClick={() => setShippingId(item.collectionId)}>Add tracking bought elsewhere</button>}<button type="button" disabled={!card} onClick={() => card && onOpenDraft(card)}>{item.status === "published" ? "View listing" : "Review draft"}</button></div>
            </article>;
          })}</div>}
        <p className="valuation-disclaimer">For an eBay label, open the sold order on eBay and choose Purchase shipping label. eBay uploads its tracking automatically; return here and sync sales. Use Add tracking bought elsewhere only for postage purchased outside eBay.</p>
        <p className="valuation-disclaimer">CardPilot never bulk-publishes this queue. Every listing requires a final individual review and confirmation.</p>
      </>}
    </section>
  </div>;
}
