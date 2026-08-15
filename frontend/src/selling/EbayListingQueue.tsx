import { useEffect, useState } from "react";
import type { SavedCollectionCard } from "../identification/types";

type QueueItem = {
  collectionId: string; title: string; priceCents: number; currency: string; status: string;
  updatedAt: string; imageUrl: string; missingAspects: string[];
  checks: { key: string; label: string; ready: boolean }[]; ready: boolean;
};
type QueuePayload = { environment: string; productionPublishingEnabled: boolean; items: QueueItem[] };

export function EbayListingQueue({ cards, onOpenDraft, onClose }: {
  cards: SavedCollectionCard[]; onOpenDraft: (card: SavedCollectionCard) => void; onClose: () => void;
}) {
  const [payload, setPayload] = useState<QueuePayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/ebay/listing-queue").then(async (response) => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setPayload(body);
    }).catch((caught) => setError(caught instanceof Error ? caught.message : "CardPilot could not load listing drafts."));
  }, []);

  return <div className="ebay-draft-backdrop" role="presentation">
    <section className="ebay-draft-panel ebay-queue-panel" role="dialog" aria-modal="true" aria-labelledby="ebay-queue-title">
      <header><div><span>eBay selling</span><h2 id="ebay-queue-title">Ready to List queue</h2></div><button type="button" onClick={onClose}>Close</button></header>
      {!payload && !error && <div className="collection-empty"><span className="spinner" /> Loading saved drafts...</div>}
      {error && <div className="error-banner" role="alert">{error}</div>}
      {payload && <>
        <div className={`ebay-environment-guard ${payload.environment}`}>
          <strong>{payload.environment === "sandbox" ? "Sandbox test mode" : "Production mode"}</strong>
          <span>{payload.environment === "sandbox" ? "Nothing in this queue can become a real eBay listing." : "Publishing can create a real public listing and may incur eBay fees."}</span>
        </div>
        {payload.items.length === 0 ? <div className="collection-empty"><strong>No saved eBay drafts yet</strong><span>Open a card and choose Sell on eBay, then save its draft.</span></div> :
          <div className="ebay-queue-list">{payload.items.map((item) => {
            const card = cards.find((candidate) => candidate.collectionId === item.collectionId);
            const missing = [...item.checks.filter((check) => !check.ready).map((check) => check.label), ...item.missingAspects];
            return <article key={item.collectionId}>
              <img src={item.imageUrl} alt="" />
              <div><span className={`ebay-queue-state ${item.ready ? "ready" : "waiting"}`}>{item.status === "published" ? "Published" : item.ready ? "Ready" : "Needs attention"}</span><h3>{item.title}</h3><strong>{item.currency} {(item.priceCents / 100).toFixed(2)}</strong><small>Updated {new Date(item.updatedAt).toLocaleString()}</small>{missing.length > 0 && <p>Still needed: {missing.join(", ")}.</p>}</div>
              <button type="button" disabled={!card} onClick={() => card && onOpenDraft(card)}>{item.status === "published" ? "View listing" : "Review draft"}</button>
            </article>;
          })}</div>}
        <p className="valuation-disclaimer">CardPilot never bulk-publishes this queue. Every listing requires a final individual review and confirmation.</p>
      </>}
    </section>
  </div>;
}
