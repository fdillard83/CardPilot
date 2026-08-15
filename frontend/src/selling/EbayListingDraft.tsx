import { useEffect, useState } from "react";
import type { SavedCollectionCard } from "../identification/types";

type Draft = {
  title: string; description: string; priceCents: number; currency: string;
  condition: string; conditionDescription: string; categoryId: string;
  aspects: Record<string, string[]>; merchantLocationKey: string;
  fulfillmentPolicyId: string; paymentPolicyId: string; returnPolicyId: string;
  listingFormat: "FIXED_PRICE" | "AUCTION"; status?: string; ebayListingId?: string | null;
};

type SellingStatus = { configured: boolean; connected: boolean; environment: string };
type SellerSetup = {
  locations: { id: string; name: string }[];
  fulfillmentPolicies: { id: string; name: string }[];
  paymentPolicies: { id: string; name: string }[];
  returnPolicies: { id: string; name: string }[];
};

export function EbayListingDraft({ card, onClose }: { card: SavedCollectionCard; onClose: () => void }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [status, setStatus] = useState<SellingStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [setup, setSetup] = useState<SellerSetup | null>(null);
  const [sandboxPostalCode, setSandboxPostalCode] = useState("");
  const [sandboxShippingCost, setSandboxShippingCost] = useState("4.99");

  useEffect(() => {
    let current = true;
    void Promise.all([
      fetch(`/api/collection/${encodeURIComponent(card.collectionId)}/ebay-draft`).then((response) => response.json()),
      fetch("/api/ebay/selling/status").then((response) => response.json()),
    ]).then(([draftPayload, statusPayload]) => {
      if (current) { setDraft(draftPayload.draft); setStatus(statusPayload); }
    }).catch(() => current && setError("CardPilot could not prepare this eBay draft."));
    return () => { current = false; };
  }, [card.collectionId]);

  useEffect(() => {
    if (!status?.connected) return;
    let current = true;
    void fetch("/api/ebay/selling/setup").then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      if (current) setSetup(payload);
    }).catch((caught) => current && setError(caught instanceof Error ? caught.message : "Seller policies could not be loaded."));
    return () => { current = false; };
  }, [status?.connected]);

  const update = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    if (draft) setDraft({ ...draft, [key]: value });
  };
  const updateAspect = (name: string, value: string) => {
    if (!draft) return;
    const aspects = { ...draft.aspects };
    if (value.trim()) aspects[name] = [value];
    else delete aspects[name];
    setDraft({ ...draft, aspects });
  };

  const save = async () => {
    if (!draft) return false;
    setBusy(true); setError(null); setMessage(null);
    try {
      const input = { ...draft };
      delete input.status;
      delete input.ebayListingId;
      const response = await fetch(`/api/collection/${encodeURIComponent(card.collectionId)}/ebay-draft`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      setDraft(payload.draft); setMessage("Draft saved privately in CardPilot."); return true;
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Draft could not be saved."); return false; }
    finally { setBusy(false); }
  };

  const connect = async () => {
    const response = await fetch("/api/ebay/selling/authorize", { method: "POST" });
    const payload = await response.json();
    if (!response.ok) { setError(payload.error); return; }
    window.location.assign(payload.authorizationUrl);
  };

  const createSandboxSetup = async () => {
    if (!draft) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const shippingCost = Number(sandboxShippingCost);
      if (!/^\d{5}(?:-\d{4})?$/.test(sandboxPostalCode.trim())) throw new Error("Enter a valid US ZIP code.");
      if (!Number.isFinite(shippingCost) || shippingCost < 0) throw new Error("Enter a valid shipping charge.");
      const response = await fetch("/api/ebay/selling/setup/sandbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          postalCode: sandboxPostalCode.trim(),
          shippingCostCents: Math.round(shippingCost * 100),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      const next = payload as SellerSetup;
      setSetup(next);
      setDraft((current) => current ? {
        ...current,
        merchantLocationKey: current.merchantLocationKey || next.locations[0]?.id || "",
        fulfillmentPolicyId: current.fulfillmentPolicyId || next.fulfillmentPolicies[0]?.id || "",
        paymentPolicyId: current.paymentPolicyId || next.paymentPolicies[0]?.id || "",
        returnPolicyId: current.returnPolicyId || next.returnPolicies[0]?.id || "",
      } : current);
      setMessage("Sandbox seller settings created and selected. Save the draft to remember them.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sandbox seller settings could not be created.");
    } finally { setBusy(false); }
  };

  const publish = async () => {
    if (!draft || !window.confirm(`Publish “${draft.title}” to eBay ${status?.environment}? This creates an eBay listing.`)) return;
    if (!(await save())) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/collection/${encodeURIComponent(card.collectionId)}/ebay-publish`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmation: "PUBLISH" }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      setDraft(payload.draft); setMessage(`Published to eBay ${status?.environment}. Listing ${payload.draft.ebayListingId}.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "eBay could not publish this listing."); }
    finally { setBusy(false); }
  };

  const endListing = async () => {
    if (!draft || !window.confirm(`End eBay listing ${draft.ebayListingId}? Buyers will no longer be able to purchase it.`)) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/collection/${encodeURIComponent(card.collectionId)}/ebay-end`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmation: "END" }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      setDraft(payload.draft); setMessage("The eBay listing was ended.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The listing could not be ended."); }
    finally { setBusy(false); }
  };

  const reviseListing = async () => {
    if (!draft || !window.confirm(`Save these changes to active eBay listing ${draft.ebayListingId}?`)) return;
    if (!(await save())) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/collection/${encodeURIComponent(card.collectionId)}/ebay-revise`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmation: "REVISE" }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      setMessage("The active eBay listing was revised.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The listing could not be revised."); }
    finally { setBusy(false); }
  };

  return (
    <div className="ebay-draft-backdrop" role="presentation">
      <section className="ebay-draft-panel" role="dialog" aria-modal="true" aria-labelledby="ebay-draft-title">
        <header><div><span>Sandbox-first selling</span><h2 id="ebay-draft-title">Sell {card.title} on eBay</h2></div><button type="button" onClick={onClose}>Close</button></header>
        {!draft || !status ? <div className="collection-empty"><span className="spinner" /> Preparing draft...</div> : (
          <>
            <div className={`ebay-connection-status ${status.connected ? "connected" : ""}`}>
              <strong>{status.connected ? "eBay seller connected" : status.configured ? "Connect your eBay seller account" : "eBay selling setup required"}</strong>
              <span>Environment: {status.environment}. Production publishing remains separate.</span>
              {status.configured && !status.connected && <button type="button" onClick={() => void connect()}>Connect eBay</button>}
            </div>
            {status.connected && status.environment === "sandbox" && setup && (
              !setup.locations.length || !setup.fulfillmentPolicies.length || !setup.paymentPolicies.length || !setup.returnPolicies.length
            ) && <section className="ebay-sandbox-setup" aria-labelledby="ebay-sandbox-setup-title">
              <div>
                <strong id="ebay-sandbox-setup-title">Finish setting up this test seller</strong>
                <p>This new Sandbox account has no listing policies or inventory location. CardPilot can create test-only defaults; this cannot affect real eBay.</p>
              </div>
              <div className="ebay-sandbox-setup-fields">
                <label>Ship-from ZIP code <input inputMode="numeric" autoComplete="postal-code" placeholder="12345" value={sandboxPostalCode} onChange={(event) => setSandboxPostalCode(event.target.value)} /></label>
                <label>Buyer shipping charge <input type="number" min="0" step="0.01" value={sandboxShippingCost} onChange={(event) => setSandboxShippingCost(event.target.value)} /></label>
              </div>
              <small>Creates a one-business-day USPS test shipping policy, immediate payment, 30-day buyer-paid returns, and a ZIP-level warehouse location.</small>
              <button className="primary-action" type="button" disabled={busy} onClick={() => void createSandboxSetup()}>{busy ? "Creating test settings..." : "Create Sandbox seller settings"}</button>
            </section>}
            <div className="ebay-draft-grid">
              <label className="wide">Title <input maxLength={80} value={draft.title} onChange={(e) => update("title", e.target.value)} /><small>{draft.title.length}/80</small></label>
              <label className="wide">Description <textarea rows={7} value={draft.description} onChange={(e) => update("description", e.target.value)} /></label>
              <label>Buy It Now price <input type="number" min="0.01" step="0.01" value={(draft.priceCents / 100).toFixed(2)} onChange={(e) => update("priceCents", Math.round(Number(e.target.value) * 100))} /></label>
              <label>Condition <select value={draft.condition} onChange={(e) => update("condition", e.target.value)}><option value="USED_EXCELLENT">Excellent</option><option value="USED_VERY_GOOD">Very good</option><option value="USED_GOOD">Good</option><option value="USED_ACCEPTABLE">Acceptable</option><option value="LIKE_NEW">Like new</option><option value="NEW_OTHER">New other</option></select></label>
              <label className="wide">Condition details <input value={draft.conditionDescription} onChange={(e) => update("conditionDescription", e.target.value)} /></label>
              <label>eBay category ID <input value={draft.categoryId} onChange={(e) => update("categoryId", e.target.value)} placeholder="Trading-card category" /></label>
              {Object.entries(draft.aspects).map(([name, values]) => <label key={name}>{name}<input value={values[0] ?? ""} onChange={(e) => updateAspect(name, e.target.value)} /></label>)}
              <label>Inventory location <select value={draft.merchantLocationKey} onChange={(e) => update("merchantLocationKey", e.target.value)}><option value="">Choose location</option>{setup?.locations.map((item) => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}</select></label>
              <label>Shipping policy <select value={draft.fulfillmentPolicyId} onChange={(e) => update("fulfillmentPolicyId", e.target.value)}><option value="">Choose shipping policy</option>{setup?.fulfillmentPolicies.map((item) => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}</select></label>
              <label>Payment policy <select value={draft.paymentPolicyId} onChange={(e) => update("paymentPolicyId", e.target.value)}><option value="">Choose payment policy</option>{setup?.paymentPolicies.map((item) => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}</select></label>
              <label>Return policy <select value={draft.returnPolicyId} onChange={(e) => update("returnPolicyId", e.target.value)}><option value="">Choose return policy</option>{setup?.returnPolicies.map((item) => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}</select></label>
            </div>
            {error && <div className="error-banner" role="alert">{error}</div>}
            {message && <div className="collection-status-banner" role="status">{message}</div>}
            <div className="ebay-draft-actions"><button type="button" disabled={busy} onClick={() => void save()}>{busy ? "Working..." : "Save draft"}</button>{draft.status === "published" ? <><button className="primary-action" type="button" disabled={busy} onClick={() => void reviseListing()}>Save and revise eBay</button><button className="account-delete-button" type="button" disabled={busy} onClick={() => void endListing()}>End eBay listing</button></> : <button className="primary-action" type="button" disabled={busy || !status.connected || draft.status === "ended"} onClick={() => void publish()}>{draft.status === "ended" ? "Listing ended" : `Review and publish to ${status.environment}`}</button>}</div>
            <p className="valuation-disclaimer">CardPilot never publishes from this screen without a separate confirmation. Verify condition, category, policies, price, and photographs first.</p>
          </>
        )}
      </section>
    </div>
  );
}
