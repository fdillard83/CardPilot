import { useEffect, useMemo, useState } from "react";
import type { SavedCollectionCard } from "../identification/types";

type PricingStrategy = "sell_faster" | "balanced" | "maximize_value";
type BatchAction = "publish" | "save_draft" | "skip";
type Draft = {
  title: string;
  priceCents: number;
  currency: string;
  categoryId: string;
  merchantLocationKey: string;
  fulfillmentPolicyId: string;
  paymentPolicyId: string;
  returnPolicyId: string;
  pricingStrategy: PricingStrategy;
  promoteListing: boolean;
  promotionAdRatePercent: number;
};
type StrategyOption = {
  amountCents: number;
  minimumListingPriceCents?: number | null;
};
type StrategyOptions = Record<PricingStrategy, StrategyOption> | null;
type Row = {
  card: SavedCollectionCard;
  draft: Draft | null;
  priceInput: string;
  strategyOptions: StrategyOptions;
  action: BatchAction;
  state: "loading" | "ready" | "saving" | "publishing" | "saved" | "published" | "failed";
  error: string | null;
};
type Setup = {
  locations: { id: string; name: string }[];
  fulfillmentPolicies: { id: string; name: string; buyerShippingCostCents?: number | null }[];
  paymentPolicies: { id: string; name: string }[];
  returnPolicies: { id: string; name: string }[];
};

function priceInputFromCents(priceCents: number) {
  return (priceCents / 100).toFixed(2);
}

function priceCentsFromInput(value: string) {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{0,2})?$/.test(normalized)) return null;
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(amount * 100);
}

function actionLabel(action: BatchAction) {
  if (action === "publish") return "List on eBay";
  if (action === "save_draft") return "Save Draft";
  return "Do Nothing";
}

export function BatchEbayListing({
  cards,
  onClose,
  onComplete,
}: {
  cards: SavedCollectionCard[];
  onClose: () => void;
  onComplete: () => void;
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    cards.slice(0, 50).map((card) => ({
      card,
      draft: null,
      priceInput: "",
      strategyOptions: null,
      action: "publish",
      state: "loading",
      error: null,
    })),
  );
  const [setup, setSetup] = useState<Setup | null>(null);
  const [busy, setBusy] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [batchTotal, setBatchTotal] = useState(0);
  const publishRows = useMemo(
    () => rows.filter((row) => row.action === "publish" && row.draft && row.state !== "published"),
    [rows],
  );
  const draftRows = useMemo(
    () => rows.filter((row) => row.action === "save_draft" && row.draft && row.state !== "saved"),
    [rows],
  );
  const actionableRows = useMemo(() => [...publishRows, ...draftRows], [publishRows, draftRows]);

  useEffect(() => {
    let current = true;
    void Promise.all([
      fetch("/api/ebay/selling/setup").then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error);
        return body;
      }),
      Promise.all(cards.slice(0, 50).map(async (card) => {
        const response = await fetch(`/api/collection/${encodeURIComponent(card.collectionId)}/ebay-draft`);
        const body = await response.json();
        if (!response.ok || !body.draft) throw new Error(body.error ?? "Draft could not be prepared.");
        return {
          card,
          draft: body.draft as Draft,
          strategyOptions: (body.saleStrategyOptions ?? null) as StrategyOptions,
        };
      })),
    ]).then(([sellerSetup, prepared]) => {
      if (!current) return;
      setSetup(sellerSetup);
      setRows(prepared.map(({ card, draft, strategyOptions }) => ({
        card,
        draft,
        priceInput: priceInputFromCents(draft.priceCents),
        strategyOptions,
        action: "publish",
        state: "ready",
        error: null,
      })));
    }).catch((error) => {
      if (!current) return;
      setRows((existing) => existing.map((row) => ({
        ...row,
        state: "failed",
        error: error instanceof Error ? error.message : "Batch could not be prepared.",
      })));
    });
    return () => { current = false; };
  }, [cards]);

  const updateAll = (change: Partial<Draft>) => setRows((current) =>
    current.map((row) => row.draft ? { ...row, draft: { ...row.draft, ...change } } : row),
  );

  const updateRow = (collectionId: string, change: Partial<Draft>) => setRows((current) =>
    current.map((row) => row.card.collectionId === collectionId && row.draft
      ? { ...row, draft: { ...row.draft, ...change } }
      : row),
  );

  const updateRowAction = (collectionId: string, action: BatchAction) => setRows((current) =>
    current.map((row) => row.card.collectionId === collectionId ? { ...row, action } : row),
  );

  const updatePriceInput = (collectionId: string, value: string) => setRows((current) =>
    current.map((row) => {
      if (row.card.collectionId !== collectionId || !row.draft) return row;
      const priceCents = priceCentsFromInput(value);
      return {
        ...row,
        priceInput: value,
        draft: priceCents === null ? row.draft : { ...row.draft, priceCents },
      };
    }),
  );

  const normalizePriceInput = (collectionId: string) => setRows((current) =>
    current.map((row) => row.card.collectionId === collectionId && row.draft
      ? { ...row, priceInput: priceInputFromCents(row.draft.priceCents) }
      : row),
  );

  const shared = rows.find((row) => row.draft)?.draft ?? null;
  const fulfillmentShipping = (fulfillmentPolicyId: string) =>
    setup?.fulfillmentPolicies.find((policy) => policy.id === fulfillmentPolicyId)?.buyerShippingCostCents ?? 0;
  const strategyItemPrice = (row: Row, strategy: PricingStrategy, shipping: number) => {
    const option = row.strategyOptions?.[strategy];
    if (!option) return null;
    const proposed = option.amountCents - (strategy === "sell_faster" ? shipping : 0);
    return Math.max(1, proposed, option.minimumListingPriceCents ?? 1);
  };
  const applyStrategy = (strategy: PricingStrategy) => setRows((current) => current.map((row) => {
    if (!row.draft) return row;
    const priceCents = strategyItemPrice(row, strategy, fulfillmentShipping(row.draft.fulfillmentPolicyId));
    return {
      ...row,
      priceInput: priceCents === null ? row.priceInput : priceInputFromCents(priceCents),
      draft: {
        ...row.draft,
        pricingStrategy: strategy,
        ...(priceCents === null ? {} : { priceCents }),
      },
    };
  }));
  const applyFulfillment = (fulfillmentPolicyId: string) => setRows((current) => current.map((row) => {
    if (!row.draft) return row;
    const priceCents = row.draft.pricingStrategy === "sell_faster"
      ? strategyItemPrice(row, "sell_faster", fulfillmentShipping(fulfillmentPolicyId))
      : null;
    return {
      ...row,
      priceInput: priceCents === null ? row.priceInput : priceInputFromCents(priceCents),
      draft: {
        ...row.draft,
        fulfillmentPolicyId,
        ...(priceCents === null ? {} : { priceCents }),
      },
    };
  }));

  const runBatch = async () => {
    if (!actionableRows.length || busy) return;
    const invalidPrice = actionableRows.find((row) => priceCentsFromInput(row.priceInput) === null);
    if (invalidPrice) {
      setRows((current) => current.map((row) => row.card.collectionId === invalidPrice.card.collectionId
        ? { ...row, state: "failed", error: "Enter a valid Buy It Now price of at least $0.01." }
        : row));
      return;
    }
    const message = [
      publishRows.length ? `publish ${publishRows.length} publicly on eBay` : null,
      draftRows.length ? `save ${draftRows.length} as ${draftRows.length === 1 ? "a draft" : "drafts"}` : null,
    ].filter(Boolean).join(" and ");
    if (!window.confirm(`Continue and ${message}? Publishing is the final confirmation and may create eBay fees.`)) return;
    setBusy(true);
    setCompleted(0);
    setBatchTotal(actionableRows.length);
    for (const target of actionableRows) {
      const id = target.card.collectionId;
      try {
        setRows((current) => current.map((row) => row.card.collectionId === id
          ? { ...row, state: "saving", error: null }
          : row));
        const save = await fetch(`/api/collection/${encodeURIComponent(id)}/ebay-draft`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(target.draft),
        });
        const saved = await save.json();
        if (!save.ok) throw new Error(saved.error ?? "Draft could not be saved.");
        if (target.action === "save_draft") {
          setRows((current) => current.map((row) => row.card.collectionId === id
            ? { ...row, state: "saved" }
            : row));
          continue;
        }
        setRows((current) => current.map((row) => row.card.collectionId === id
          ? { ...row, state: "publishing" }
          : row));
        const publish = await fetch(`/api/collection/${encodeURIComponent(id)}/ebay-publish`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmation: "PUBLISH" }),
        });
        const published = await publish.json();
        if (!publish.ok) throw new Error(published.error ?? "eBay could not publish this card.");
        setRows((current) => current.map((row) => row.card.collectionId === id
          ? { ...row, state: "published" }
          : row));
      } catch (error) {
        setRows((current) => current.map((row) => row.card.collectionId === id
          ? { ...row, state: "failed", error: error instanceof Error ? error.message : "This listing failed." }
          : row));
      } finally {
        setCompleted((value) => value + 1);
      }
    }
    setBusy(false);
    onComplete();
  };

  const stateLabel = (row: Row) => {
    if (row.state === "published") return "Published";
    if (row.state === "saved") return "Draft saved";
    if (row.state === "saving") return "Saving";
    if (row.state === "publishing") return "Publishing";
    if (row.state === "failed") return "Needs attention";
    return actionLabel(row.action);
  };

  return <div className="ebay-draft-backdrop" role="presentation">
    <section className="ebay-draft-panel batch-ebay-panel" role="dialog" aria-modal="true" aria-labelledby="batch-ebay-title">
      <header>
        <div><span>Batch eBay listing</span><h2 id="batch-ebay-title">Choose what happens to every card</h2></div>
        <button type="button" disabled={busy} onClick={onClose}>Close</button>
      </header>
      {!shared || !setup ? <div className="collection-empty"><span className="spinner" /> Preparing card previews—nothing is saved yet...</div> : <>
        <section className="batch-ebay-rules">
          <div><strong>Rules applied to every card</strong><small>Opening this screen only prepares previews. No eBay draft is saved until you choose Save Draft or List on eBay below.</small></div>
          <label>Inventory location<select value={shared.merchantLocationKey} onChange={(event) => updateAll({ merchantLocationKey: event.target.value })}><option value="">Choose...</option>{setup.locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>Shipping policy<select value={shared.fulfillmentPolicyId} onChange={(event) => applyFulfillment(event.target.value)}><option value="">Choose...</option>{setup.fulfillmentPolicies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>Payment policy<select value={shared.paymentPolicyId} onChange={(event) => updateAll({ paymentPolicyId: event.target.value })}><option value="">Choose...</option>{setup.paymentPolicies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>Return policy<select value={shared.returnPolicyId} onChange={(event) => updateAll({ returnPolicyId: event.target.value })}><option value="">Choose...</option>{setup.returnPolicies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>Pricing goal<select value={shared.pricingStrategy} onChange={(event) => applyStrategy(event.target.value as PricingStrategy)}><option value="sell_faster">Sell faster</option><option value="balanced">Balanced</option><option value="maximize_value">Maximize value</option></select></label>
          <label className="account-toggle-row"><input type="checkbox" checked={shared.promoteListing} onChange={(event) => updateAll({ promoteListing: event.target.checked })} /> Promote listings selected for eBay</label>
          {shared.promoteListing && <label>Promotion rate<select value={shared.promotionAdRatePercent} onChange={(event) => updateAll({ promotionAdRatePercent: Number(event.target.value) })}>{Array.from({ length: 50 }, (_, index) => index + 1).map((rate) => <option value={rate} key={rate}>{rate}%</option>)}</select></label>}
        </section>
        <div className="batch-ebay-selection">
          <button type="button" disabled={busy} onClick={() => setRows((current) => current.map((row) => row.state === "published" ? row : { ...row, action: "publish" }))}>List all</button>
          <button type="button" disabled={busy} onClick={() => setRows((current) => current.map((row) => row.state === "published" ? row : { ...row, action: "save_draft" }))}>Save all as drafts</button>
          <button type="button" disabled={busy} onClick={() => setRows((current) => current.map((row) => row.state === "published" ? row : { ...row, action: "skip" }))}>Do nothing for all</button>
          <strong>{publishRows.length} to list · {draftRows.length} to save · {rows.filter((row) => row.action === "skip").length} unchanged</strong>
        </div>
        <div className="batch-ebay-grid">{rows.map((row) => <article className={row.action === "skip" ? "" : row.action === "save_draft" ? "save-draft" : "selected"} key={row.card.collectionId}>
          <div className="batch-ebay-card-heading"><img src={row.card.images.frontUrl} alt="" /><div><strong>{row.card.title}</strong><span>{stateLabel(row)}</span></div></div>
          <label>Action<select value={row.action} disabled={busy || row.state === "published"} onChange={(event) => updateRowAction(row.card.collectionId, event.target.value as BatchAction)}><option value="publish">List on eBay</option><option value="save_draft">Save Draft</option><option value="skip">Do Nothing</option></select></label>
          {row.draft && <>
            <label>Title<input maxLength={80} value={row.draft.title} disabled={busy || row.action === "skip"} onChange={(event) => updateRow(row.card.collectionId, { title: event.target.value })} /></label>
            <label>Buy It Now price<div className="account-inline-unit"><span>$</span><input type="text" inputMode="decimal" value={row.priceInput} disabled={busy || row.action === "skip"} onChange={(event) => updatePriceInput(row.card.collectionId, event.target.value)} onBlur={() => normalizePriceInput(row.card.collectionId)} /></div></label>
            <label>eBay category ID<input value={row.draft.categoryId} disabled={busy || row.action === "skip"} onChange={(event) => updateRow(row.card.collectionId, { categoryId: event.target.value })} /></label>
          </>}
          {row.error && <small className="account-inline-error">{row.error}</small>}
        </article>)}</div>
        {busy && <div className="batch-progress"><span style={{ width: `${Math.round(completed / Math.max(1, batchTotal) * 100)}%` }} /></div>}
        <div className="batch-ebay-final">
          <div><strong>Final batch confirmation</strong><small>{publishRows.length} will publish, {draftRows.length} will be saved as drafts, and Do Nothing cards will remain unchanged. A failed card will not stop the rest.</small></div>
          <button className="primary-action" type="button" disabled={busy || !actionableRows.length} onClick={() => void runBatch()}>{busy ? `Processing ${completed} of ${batchTotal}...` : `Continue with ${actionableRows.length} card${actionableRows.length === 1 ? "" : "s"}`}</button>
        </div>
      </>}
    </section>
  </div>;
}
