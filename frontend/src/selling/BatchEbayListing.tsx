import { useEffect, useMemo, useState } from "react";
import type { SavedCollectionCard } from "../identification/types";

type Draft = Record<string, any> & { title: string; priceCents: number; currency: string; categoryId: string;
  merchantLocationKey: string; fulfillmentPolicyId: string; paymentPolicyId: string; returnPolicyId: string;
  pricingStrategy: "sell_faster" | "balanced" | "maximize_value"; promoteListing: boolean; promotionAdRatePercent: number };
type StrategyOptions = Record<Draft["pricingStrategy"], { amountCents: number }> | null;
type Row = { card: SavedCollectionCard; draft: Draft | null; strategyOptions: StrategyOptions; selected: boolean; state: "loading" | "ready" | "saving" | "publishing" | "published" | "failed"; error: string | null };
type Setup = { locations: { id: string; name: string }[]; fulfillmentPolicies: { id: string; name: string; buyerShippingCostCents?: number | null }[]; paymentPolicies: { id: string; name: string }[]; returnPolicies: { id: string; name: string }[] };

export function BatchEbayListing({ cards, onClose, onComplete }: { cards: SavedCollectionCard[]; onClose: () => void; onComplete: () => void }) {
  const [rows, setRows] = useState<Row[]>(() => cards.slice(0, 50).map((card) => ({ card, draft: null, strategyOptions: null, selected: true, state: "loading", error: null })));
  const [setup, setSetup] = useState<Setup | null>(null);
  const [busy, setBusy] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [batchTotal, setBatchTotal] = useState(0);
  const selected = useMemo(() => rows.filter((row) => row.selected && row.draft && row.state !== "published"), [rows]);

  useEffect(() => {
    let current = true;
    void Promise.all([
      fetch("/api/ebay/selling/setup").then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error); return body; }),
      Promise.all(cards.slice(0, 50).map(async (card) => {
        const response = await fetch(`/api/collection/${encodeURIComponent(card.collectionId)}/ebay-draft`);
        const body = await response.json();
        if (!response.ok || !body.draft) throw new Error(body.error ?? "Draft could not be prepared.");
        return { card, draft: body.draft as Draft, strategyOptions: (body.saleStrategyOptions ?? null) as StrategyOptions };
      })),
    ]).then(([sellerSetup, prepared]) => {
      if (!current) return;
      setSetup(sellerSetup);
      setRows(prepared.map(({ card, draft, strategyOptions }) => ({ card, draft, strategyOptions, selected: true, state: "ready", error: null })));
    }).catch((error) => current && setRows((existing) => existing.map((row) => ({ ...row, state: "failed", error: error.message ?? "Batch could not be prepared." }))));
    return () => { current = false; };
  }, [cards]);

  const updateAll = (change: Partial<Draft>) => setRows((current) => current.map((row) => row.draft ? ({ ...row, draft: { ...row.draft, ...change } }) : row));
  const updateRow = (collectionId: string, change: Partial<Draft>) => setRows((current) => current.map((row) => row.card.collectionId === collectionId && row.draft ? ({ ...row, draft: { ...row.draft, ...change } }) : row));
  const shared = rows.find((row) => row.draft)?.draft ?? null;
  const applyStrategy = (strategy: Draft["pricingStrategy"]) => setRows((current) => current.map((row) => {
    if (!row.draft) return row;
    const option = row.strategyOptions?.[strategy];
    const shipping = setup?.fulfillmentPolicies.find((policy) => policy.id === row.draft?.fulfillmentPolicyId)?.buyerShippingCostCents ?? 0;
    return { ...row, draft: { ...row.draft, pricingStrategy: strategy,
      ...(option ? { priceCents: Math.max(1, option.amountCents - (strategy === "sell_faster" ? shipping : 0)) } : {}) } };
  }));
  const applyFulfillment = (fulfillmentPolicyId: string) => setRows((current) => current.map((row) => {
    if (!row.draft) return row;
    const shipping = setup?.fulfillmentPolicies.find((policy) => policy.id === fulfillmentPolicyId)?.buyerShippingCostCents ?? 0;
    const option = row.strategyOptions?.sell_faster;
    return { ...row, draft: { ...row.draft, fulfillmentPolicyId,
      ...(row.draft.pricingStrategy === "sell_faster" && option ? { priceCents: Math.max(1, option.amountCents - shipping) } : {}) } };
  }));

  const publishBatch = async () => {
    if (!selected.length || busy) return;
    if (!window.confirm(`Publish ${selected.length} checked card${selected.length === 1 ? "" : "s"} publicly on eBay now? This is the final confirmation and may create eBay fees.`)) return;
    setBusy(true); setCompleted(0); setBatchTotal(selected.length);
    for (const target of selected) {
      const id = target.card.collectionId;
      try {
        setRows((current) => current.map((row) => row.card.collectionId === id ? { ...row, state: "saving", error: null } : row));
        const save = await fetch(`/api/collection/${encodeURIComponent(id)}/ebay-draft`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(target.draft) });
        const saved = await save.json(); if (!save.ok) throw new Error(saved.error ?? "Draft could not be saved.");
        setRows((current) => current.map((row) => row.card.collectionId === id ? { ...row, state: "publishing" } : row));
        const publish = await fetch(`/api/collection/${encodeURIComponent(id)}/ebay-publish`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmation: "PUBLISH" }) });
        const published = await publish.json(); if (!publish.ok) throw new Error(published.error ?? "eBay could not publish this card.");
        setRows((current) => current.map((row) => row.card.collectionId === id ? { ...row, state: "published", selected: false } : row));
      } catch (error) {
        setRows((current) => current.map((row) => row.card.collectionId === id ? { ...row, state: "failed", error: error instanceof Error ? error.message : "This listing failed." } : row));
      } finally { setCompleted((value) => value + 1); }
    }
    setBusy(false); onComplete();
  };

  return <div className="ebay-draft-backdrop" role="presentation"><section className="ebay-draft-panel batch-ebay-panel" role="dialog" aria-modal="true" aria-labelledby="batch-ebay-title">
    <header><div><span>Batch eBay listing</span><h2 id="batch-ebay-title">Review shared rules and every card</h2></div><button type="button" disabled={busy} onClick={onClose}>Close</button></header>
    {!shared || !setup ? <div className="collection-empty"><span className="spinner" /> Preparing card listings...</div> : <>
      <section className="batch-ebay-rules"><div><strong>Rules applied to every card</strong><small>These choices update all rows; each title, price, category, and condition remains card-specific.</small></div>
        <label>Inventory location<select value={shared.merchantLocationKey} onChange={(event) => updateAll({ merchantLocationKey: event.target.value })}><option value="">Choose...</option>{setup.locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Shipping policy<select value={shared.fulfillmentPolicyId} onChange={(event) => applyFulfillment(event.target.value)}><option value="">Choose...</option>{setup.fulfillmentPolicies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Payment policy<select value={shared.paymentPolicyId} onChange={(event) => updateAll({ paymentPolicyId: event.target.value })}><option value="">Choose...</option>{setup.paymentPolicies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Return policy<select value={shared.returnPolicyId} onChange={(event) => updateAll({ returnPolicyId: event.target.value })}><option value="">Choose...</option>{setup.returnPolicies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Pricing goal<select value={shared.pricingStrategy} onChange={(event) => applyStrategy(event.target.value as Draft["pricingStrategy"])}><option value="sell_faster">Sell faster</option><option value="balanced">Balanced</option><option value="maximize_value">Maximize value</option></select></label>
        <label className="account-toggle-row"><input type="checkbox" checked={shared.promoteListing} onChange={(event) => updateAll({ promoteListing: event.target.checked })} /> Promote all checked listings</label>
        {shared.promoteListing && <label>Promotion rate<select value={shared.promotionAdRatePercent} onChange={(event) => updateAll({ promotionAdRatePercent: Number(event.target.value) })}>{Array.from({ length: 50 }, (_, index) => index + 1).map((rate) => <option value={rate} key={rate}>{rate}%</option>)}</select></label>}
      </section>
      <div className="batch-ebay-selection"><button type="button" disabled={busy} onClick={() => setRows((current) => current.map((row) => row.state === "published" ? row : { ...row, selected: true }))}>Check all</button><button type="button" disabled={busy} onClick={() => setRows((current) => current.map((row) => ({ ...row, selected: false })))}>Uncheck all</button><strong>{selected.length} selected</strong></div>
      <div className="batch-ebay-grid">{rows.map((row) => <article className={row.selected ? "selected" : ""} key={row.card.collectionId}>
        <label className="batch-ebay-check"><input type="checkbox" checked={row.selected} disabled={busy || row.state === "published"} onChange={() => setRows((current) => current.map((item) => item.card.collectionId === row.card.collectionId ? { ...item, selected: !item.selected } : item))} /><img src={row.card.images.frontUrl} alt="" /><span>{row.state === "published" ? "Published" : row.state === "saving" ? "Saving" : row.state === "publishing" ? "Publishing" : row.state === "failed" ? "Needs attention" : "Include"}</span></label>
        {row.draft && <><label>Title<input maxLength={80} value={row.draft.title} disabled={busy} onChange={(event) => updateRow(row.card.collectionId, { title: event.target.value })} /></label><label>Buy It Now price<div className="account-inline-unit"><span>$</span><input inputMode="decimal" value={(row.draft.priceCents / 100).toFixed(2)} disabled={busy} onChange={(event) => updateRow(row.card.collectionId, { priceCents: Math.max(1, Math.round(Number(event.target.value || 0) * 100)) })} /></div></label><label>eBay category ID<input value={row.draft.categoryId} disabled={busy} onChange={(event) => updateRow(row.card.collectionId, { categoryId: event.target.value })} /></label></>}
        {row.error && <small className="account-inline-error">{row.error}</small>}
      </article>)}</div>
      {busy && <div className="batch-progress"><span style={{ width: `${Math.round(completed / Math.max(1, batchTotal) * 100)}%` }} /></div>}
      <div className="batch-ebay-final"><div><strong>Final public confirmation</strong><small>Only checked cards will publish. A failed card will not stop the remaining cards, and its error will stay visible for correction.</small></div><button className="primary-action" type="button" disabled={busy || !selected.length} onClick={() => void publishBatch()}>{busy ? `Publishing ${completed} of ${batchTotal}...` : `Review confirmation and publish ${selected.length} on eBay`}</button></div>
    </>}
  </section></div>;
}
