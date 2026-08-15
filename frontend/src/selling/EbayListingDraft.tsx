import { useEffect, useState } from "react";
import type { SavedCollectionCard } from "../identification/types";

type Draft = {
  title: string; description: string; priceCents: number; currency: string;
  condition: string; conditionDescription: string; categoryId: string;
  aspects: Record<string, string[]>; merchantLocationKey: string;
  fulfillmentPolicyId: string; paymentPolicyId: string; returnPolicyId: string;
  listingFormat: "FIXED_PRICE" | "AUCTION"; status?: string; ebayListingId?: string | null;
  listingImages?: ("front" | "back")[]; auctionDurationDays?: 1 | 3 | 5 | 7 | 10;
  auctionStartPriceCents?: number; auctionReservePriceCents?: number;
  scheduledPublishAt?: string | null; desiredEndAt?: string | null;
  scheduleStatus?: "unscheduled" | "scheduled" | "processing" | "published" | "failed" | "cancelled";
  scheduleError?: string | null;
};

type SellingStatus = { configured: boolean; connected: boolean; environment: string };
type SellerSetup = {
  locations: { id: string; name: string }[];
  fulfillmentPolicies: { id: string; name: string }[];
  paymentPolicies: { id: string; name: string }[];
  returnPolicies: { id: string; name: string }[];
};
type CategoryOption = { id: string; name: string; breadcrumb: string };
type AspectDefinition = { name: string; required: boolean; recommended: boolean; multiValue: boolean; values: string[] };
type Readiness = { definitions: AspectDefinition[]; aspects: Record<string, string[]>; missingAspects: string[]; checks: { key: string; label: string; ready: boolean }[]; ready: boolean };
const emptySellerSetup = (): SellerSetup => ({
  locations: [], fulfillmentPolicies: [], paymentPolicies: [], returnPolicies: [],
});

async function responsePayload(response: Response) {
  const body = await response.text();
  if (!body) return { error: response.ok
    ? "CardPilot received an empty response from the server. Please try again."
    : "The local CardPilot server restarted or disconnected. Please try again." };
  try { return JSON.parse(body); }
  catch { return { error: "CardPilot received an invalid response from the server. Please try again." }; }
}

export function EbayListingDraft({ card, onClose }: { card: SavedCollectionCard; onClose: () => void }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [status, setStatus] = useState<SellingStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [setup, setSetup] = useState<SellerSetup | null>(null);
  const [sandboxPostalCode, setSandboxPostalCode] = useState("");
  const [sandboxShippingCost, setSandboxShippingCost] = useState("4.99");
  const [categoryOptions, setCategoryOptions] = useState<CategoryOption[]>([]);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [auctionReferenceTime] = useState(() => Date.now());
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [desiredEndLocal, setDesiredEndLocal] = useState("");
  const selectedCategoryId = draft?.categoryId ?? "";

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
    if (!/^\d+$/.test(selectedCategoryId)) return;
    let current = true;
    void fetch(`/api/collection/${encodeURIComponent(card.collectionId)}/ebay-readiness?categoryId=${encodeURIComponent(selectedCategoryId)}`).then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      if (!current) return;
      setReadiness(payload);
      setDraft((existing) => existing ? { ...existing, aspects: { ...payload.aspects, ...existing.aspects } } : existing);
    }).catch(() => current && setReadiness(null));
    return () => { current = false; };
  }, [card.collectionId, selectedCategoryId]);

  useEffect(() => {
    if (!status?.connected) return;
    let current = true;
    void fetch("/api/ebay/selling/setup").then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      if (current) setSetup(payload);
    }).catch(() => {
      if (!current) return;
      setSetup(emptySellerSetup());
      setMessage("This new Sandbox seller needs its first inventory location and listing policies.");
    });
    return () => { current = false; };
  }, [status?.connected]);

  useEffect(() => {
    let current = true;
    void fetch(`/api/collection/${encodeURIComponent(card.collectionId)}/ebay-categories`).then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      if (!current) return;
      const options = (payload.suggestions ?? []) as CategoryOption[];
      setCategoryOptions(options);
      setDraft((existing) => existing && !/^\d+$/.test(existing.categoryId) && options[0]
        ? { ...existing, categoryId: options[0].id }
        : existing);
    }).catch(() => { /* Category ID remains manually editable if eBay taxonomy is unavailable. */ });
    return () => { current = false; };
  }, [card.collectionId]);

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
      const input = {
        title: draft.title,
        description: draft.description,
        priceCents: draft.priceCents,
        currency: draft.currency,
        condition: draft.condition,
        conditionDescription: draft.conditionDescription,
        categoryId: draft.categoryId,
        aspects: draft.aspects,
        merchantLocationKey: draft.merchantLocationKey,
        fulfillmentPolicyId: draft.fulfillmentPolicyId,
        paymentPolicyId: draft.paymentPolicyId,
        returnPolicyId: draft.returnPolicyId,
        listingFormat: draft.listingFormat,
        listingImages: draft.listingImages ?? ["front"],
        auctionDurationDays: draft.auctionDurationDays ?? 7,
        auctionStartPriceCents: draft.auctionStartPriceCents ?? 99,
        auctionReservePriceCents: draft.auctionReservePriceCents ?? 0,
      };
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
      const payload = await responsePayload(response);
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
      const detail = caught instanceof Error ? caught.message : "Sandbox seller settings could not be created.";
      setError(/system error|fulfillment policy/i.test(detail)
        ? "eBay Sandbox is currently reporting a known seller-policy service outage. Your CardPilot draft is safe; retry this setup after eBay restores the Sandbox Account API."
        : detail);
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

  const scheduleAuction = async () => {
    if (!draft || !desiredEndLocal) return;
    const endAt = new Date(desiredEndLocal);
    const publishAt = new Date(endAt.getTime() - auctionDays * 86_400_000);
    if (!Number.isFinite(endAt.getTime()) || publishAt.getTime() < Date.now() + 5 * 60_000) {
      setError("Choose an ending date and time that leaves at least five minutes before publication."); return;
    }
    if (!window.confirm(`Schedule this ${auctionDays}-day auction to publish automatically on ${publishAt.toLocaleString()} and end around ${endAt.toLocaleString()}?`)) return;
    if (!(await save())) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const response = await fetch(`/api/collection/${encodeURIComponent(card.collectionId)}/ebay-schedule`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: "SCHEDULE", desiredEndAt: endAt.toISOString() }),
      });
      const payload = await responsePayload(response);
      if (!response.ok) throw new Error(payload.error);
      setDraft(payload.draft); setMessage(`Auction scheduled to publish ${new Date(payload.publishAt).toLocaleString()}.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "CardPilot could not schedule this auction."); }
    finally { setBusy(false); }
  };

  const cancelSchedule = async () => {
    if (!draft || !window.confirm("Cancel this scheduled publication? The draft will remain saved.")) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/collection/${encodeURIComponent(card.collectionId)}/ebay-schedule`, { method: "DELETE" });
      const payload = await responsePayload(response);
      if (!response.ok) throw new Error(payload.error);
      setDraft(payload.draft); setScheduleEnabled(false); setMessage("Scheduled publication cancelled. The draft is still saved.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "CardPilot could not cancel this schedule."); }
    finally { setBusy(false); }
  };

  const missingPublishingFields = draft ? [
    !draft.categoryId && "eBay category",
    !draft.merchantLocationKey && "inventory location",
    !draft.fulfillmentPolicyId && "shipping policy",
    !draft.paymentPolicyId && "payment policy",
    !draft.returnPolicyId && "return policy",
  ].filter(Boolean) as string[] : [];
  const requiredDefinitions = readiness?.definitions.filter((item) => item.required) ?? [];
  const optionalDefinitions = readiness?.definitions.filter((item) => !item.required && item.recommended).slice(0, 8) ?? [];
  const selectedImages = draft?.listingImages ?? ["front"];
  const auctionDays = draft?.auctionDurationDays ?? 7;
  const auctionEnd = new Date(auctionReferenceTime + auctionDays * 86_400_000);
  const referencePriceCents = draft?.listingFormat === "AUCTION" ? draft.auctionStartPriceCents ?? 99 : draft?.priceCents ?? 0;
  const estimatedFeeCents = Math.round(referencePriceCents * 0.1325 + 30);
  const estimatedProceedsCents = Math.max(0, referencePriceCents - estimatedFeeCents);

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
            {error && <div className="error-banner ebay-setup-feedback" role="alert">{error}</div>}
            {message && <div className="collection-status-banner ebay-setup-feedback" role="status">{message}</div>}
            <section className="ebay-listing-preview" aria-labelledby="ebay-preview-title">
              <div className="ebay-preview-images">{selectedImages.includes("front") && <img src={card.images.frontUrl} alt="Front of the card being listed" />}{selectedImages.includes("back") && card.images.backUrl && <img src={card.images.backUrl} alt="Back of the card being listed" />}</div>
              <div><span>Listing preview</span><h3 id="ebay-preview-title">{draft.title || "Add a listing title"}</h3><strong>{draft.listingFormat === "AUCTION" ? `Starting bid ${draft.currency} ${((draft.auctionStartPriceCents ?? 99) / 100).toFixed(2)}` : `${draft.currency} ${(draft.priceCents / 100).toFixed(2)}`}</strong><p>{draft.description || "Add a description."}</p></div>
            </section>
            {readiness && <section className="ebay-readiness" aria-labelledby="ebay-readiness-title"><div><h3 id="ebay-readiness-title">Listing readiness</h3><p>CardPilot filled what it could from the confirmed card details. Only items still needing attention are marked below.</p></div><ul>{readiness.checks.map((check) => <li className={check.ready ? "ready" : "missing"} key={check.key}><span>{check.ready ? "✓" : "!"}</span>{check.label}</li>)}</ul></section>}
            <div className="ebay-draft-grid">
              <label className="wide">Title <input maxLength={80} value={draft.title} onChange={(e) => update("title", e.target.value)} /><small>{draft.title.length}/80</small></label>
              <label className="wide">Description <textarea rows={7} value={draft.description} onChange={(e) => update("description", e.target.value)} /></label>
              <label>Listing format <select disabled={draft.status === "published"} value={draft.listingFormat} onChange={(e) => update("listingFormat", e.target.value as Draft["listingFormat"])}><option value="FIXED_PRICE">Buy It Now (recommended)</option><option value="AUCTION">Auction</option></select>{draft.status === "published" && <small>End and create a new listing to change its format.</small>}</label>
              {draft.listingFormat === "FIXED_PRICE" ? <label>Buy It Now price <input type="number" min="0.01" step="0.01" value={(draft.priceCents / 100).toFixed(2)} onChange={(e) => update("priceCents", Math.round(Number(e.target.value) * 100))} /></label> : <>
                <label>Starting bid <input type="number" min="0.01" step="0.01" value={((draft.auctionStartPriceCents ?? 99) / 100).toFixed(2)} onChange={(e) => update("auctionStartPriceCents", Math.round(Number(e.target.value) * 100))} /></label>
                <label>Optional reserve price <input type="number" min="0" step="0.01" value={((draft.auctionReservePriceCents ?? 0) / 100).toFixed(2)} onChange={(e) => update("auctionReservePriceCents", Math.round(Number(e.target.value) * 100))} /><small>Reserve fees can apply even if the card does not sell.</small></label>
                <label>Auction ending day <select value={auctionDays} onChange={(e) => update("auctionDurationDays", Number(e.target.value) as Draft["auctionDurationDays"])}>{([1, 3, 5, 7, 10] as const).map((days) => <option key={days} value={days}>{new Date(auctionReferenceTime + days * 86_400_000).toLocaleString([], { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} ({days} day{days === 1 ? "" : "s"})</option>)}</select><small>eBay ends the auction at approximately the same time it is published.</small></label>
              </>}
              <label>Card type <input value={card.grading.isGraded ? `Professionally graded${card.grading.company ? ` by ${card.grading.company}` : ""}` : "Raw / ungraded"} readOnly /><small>Set automatically from Card Details.</small></label>
              <label className="wide">Condition details <input value={draft.conditionDescription} onChange={(e) => update("conditionDescription", e.target.value)} /></label>
              <label>eBay category <input list={`ebay-categories-${card.collectionId}`} value={draft.categoryId} onChange={(e) => update("categoryId", e.target.value)} placeholder="Recommended automatically" /><datalist id={`ebay-categories-${card.collectionId}`}>{categoryOptions.map((option) => <option key={option.id} value={option.id}>{option.breadcrumb || option.name}</option>)}</datalist><small>{categoryOptions.find((option) => option.id === draft.categoryId)?.breadcrumb ?? "Numeric eBay leaf category ID; advanced users can override it."}</small></label>
              {requiredDefinitions.map((definition) => <label className={!draft.aspects[definition.name]?.[0] ? "ebay-required-missing" : ""} key={definition.name}>{definition.name} <span>{definition.required ? "Required" : ""}</span>{definition.values.length ? <select value={draft.aspects[definition.name]?.[0] ?? ""} onChange={(e) => updateAspect(definition.name, e.target.value)}><option value="">Choose</option>{definition.values.map((value) => <option key={value} value={value}>{value}</option>)}</select> : <input value={draft.aspects[definition.name]?.[0] ?? ""} onChange={(e) => updateAspect(definition.name, e.target.value)} />}</label>)}
              {optionalDefinitions.map((definition) => <label key={definition.name}>{definition.name}{definition.values.length ? <select value={draft.aspects[definition.name]?.[0] ?? ""} onChange={(e) => updateAspect(definition.name, e.target.value)}><option value="">Optional</option>{definition.values.map((value) => <option key={value} value={value}>{value}</option>)}</select> : <input value={draft.aspects[definition.name]?.[0] ?? ""} onChange={(e) => updateAspect(definition.name, e.target.value)} />}</label>)}
              <label>Inventory location <select value={draft.merchantLocationKey} onChange={(e) => update("merchantLocationKey", e.target.value)}><option value="">Choose location</option>{setup?.locations.map((item) => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}</select></label>
              <label>Shipping policy <select value={draft.fulfillmentPolicyId} onChange={(e) => update("fulfillmentPolicyId", e.target.value)}><option value="">Choose shipping policy</option>{setup?.fulfillmentPolicies.map((item) => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}</select></label>
              <label>Payment policy <select value={draft.paymentPolicyId} onChange={(e) => update("paymentPolicyId", e.target.value)}><option value="">Choose payment policy</option>{setup?.paymentPolicies.map((item) => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}</select></label>
              <label>Return policy <select value={draft.returnPolicyId} onChange={(e) => update("returnPolicyId", e.target.value)}><option value="">Choose return policy</option>{setup?.returnPolicies.map((item) => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}</select></label>
            </div>
            {draft.listingFormat === "AUCTION" && <section className="ebay-auction-schedule"><div><h3>Schedule by desired ending time</h3><p>Optional. Leave this off to publish the auction manually.</p></div>{draft.scheduleStatus === "scheduled" && draft.scheduledPublishAt && draft.desiredEndAt ? <div className="ebay-scheduled-summary"><strong>Automatic publication scheduled</strong><span>Publishes {new Date(draft.scheduledPublishAt).toLocaleString()}</span><span>Expected to end {new Date(draft.desiredEndAt).toLocaleString()}</span><button type="button" disabled={busy} onClick={() => void cancelSchedule()}>Cancel schedule</button></div> : <><label className="ebay-schedule-toggle"><input type="checkbox" checked={scheduleEnabled} onChange={(event) => setScheduleEnabled(event.target.checked)} /> Automatically publish to end when I choose</label>{scheduleEnabled && <div className="ebay-schedule-fields"><label>Desired local ending date and time <input type="datetime-local" value={desiredEndLocal} onChange={(event) => setDesiredEndLocal(event.target.value)} /></label><div><span>Your timezone</span><strong>{Intl.DateTimeFormat().resolvedOptions().timeZone}</strong></div>{desiredEndLocal && Number.isFinite(new Date(desiredEndLocal).getTime()) && <div><span>Calculated publication</span><strong>{new Date(new Date(desiredEndLocal).getTime() - auctionDays * 86_400_000).toLocaleString()}</strong></div>}<button className="primary-action" type="button" disabled={busy || !desiredEndLocal || missingPublishingFields.length > 0 || (readiness?.missingAspects.length ?? 0) > 0} onClick={() => void scheduleAuction()}>Review and schedule automatic publication</button></div>}</>}</section>}
            <section className="ebay-photo-manager"><div><h3>Listing photos</h3><p>The front image is used by default. Add the back only when you want buyers to see it.</p></div><label><input type="checkbox" checked readOnly /> Front photo <span>Primary</span></label>{card.images.backUrl ? <label><input type="checkbox" checked={selectedImages.includes("back")} onChange={(e) => update("listingImages", e.target.checked ? ["front", "back"] : ["front"])} /> Include back photo</label> : <small>No back photo was saved for this card. One front image is acceptable.</small>}</section>
            <section className="ebay-proceeds"><div><span>Price reference</span><strong>{draft.currency} {(referencePriceCents / 100).toFixed(2)}</strong></div><div><span>Illustrative eBay fee</span><strong>− {draft.currency} {(estimatedFeeCents / 100).toFixed(2)}</strong></div><div><span>Approximate proceeds</span><strong>{draft.currency} {(estimatedProceedsCents / 100).toFixed(2)}</strong></div><p>Illustrative estimate using 13.25% plus $0.30. Actual fees vary by seller, category, promotions, taxes, shipping, and final auction price.{draft.listingFormat === "AUCTION" ? ` Selected auction currently ends around ${auctionEnd.toLocaleString()}.` : ""}</p></section>
            {draft.status !== "published" && (missingPublishingFields.length > 0 || (readiness?.missingAspects.length ?? 0) > 0) && <p className="ebay-missing-fields">Before publishing, complete: {[...missingPublishingFields, ...(readiness?.missingAspects ?? [])].join(", ")}.</p>}
            <div className="ebay-draft-actions"><button type="button" disabled={busy} onClick={() => void save()}>{busy ? "Working..." : "Save draft"}</button>{draft.status === "published" ? <><button className="primary-action" type="button" disabled={busy} onClick={() => void reviseListing()}>Save and revise eBay</button><button className="account-delete-button" type="button" disabled={busy} onClick={() => void endListing()}>End eBay listing</button></> : <button className="primary-action" type="button" disabled={busy || !status.connected || draft.status === "ended" || missingPublishingFields.length > 0 || (readiness?.missingAspects.length ?? 0) > 0} onClick={() => void publish()}>{draft.status === "ended" ? "Listing ended" : `Review and publish to ${status.environment}`}</button>}</div>
            <p className="valuation-disclaimer">CardPilot never publishes from this screen without a separate confirmation. Verify condition, category, policies, price, and photographs first.</p>
          </>
        )}
      </section>
    </div>
  );
}
