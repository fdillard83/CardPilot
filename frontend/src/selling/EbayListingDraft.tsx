import { useEffect, useRef, useState } from "react";
import { cardKindFromFields, type SavedCollectionCard } from "../identification/types";

type Draft = {
  title: string; description: string; priceCents: number; currency: string;
  condition: string; conditionDescription: string; categoryId: string;
  aspects: Record<string, string[]>; merchantLocationKey: string;
  fulfillmentPolicyId: string; paymentPolicyId: string; returnPolicyId: string;
  listingFormat: "FIXED_PRICE" | "AUCTION"; status?: string; ebayListingId?: string | null;
  draftId?: string;
  listingImages?: ("front" | "back")[]; auctionDurationDays?: 1 | 3 | 5 | 7 | 10;
  auctionStartPriceCents?: number; auctionReservePriceCents?: number;
  scheduledPublishAt?: string | null; desiredEndAt?: string | null;
  scheduleStatus?: "unscheduled" | "scheduled" | "processing" | "published" | "failed" | "cancelled";
  scheduleError?: string | null;
  pricingStrategy?: "sell_faster" | "balanced" | "maximize_value";
  promoteListing?: boolean;
  promotionAdRatePercent?: number;
  promotion?: { status: string; error?: string; campaignId?: string; adId?: string | null };
  automationStatus?: "preview" | "needs_attention" | "ready" | "publishing" | "published" | "failed";
  automationReason?: string | null;
  automationUpdatedAt?: string | null;
  automationRepricedAt?: string | null;
  automationOriginalPriceCents?: number | null;
};
type SaleStrategyOptions = Record<"sell_faster" | "balanced" | "maximize_value", {
  amountCents: number; label: string; rationale: string;
}>;

type SellingStatus = { configured: boolean; connected: boolean; environment: "sandbox" | "production"; marketingAuthorized?: boolean };
type SellerSetup = {
  locations: { id: string; name: string }[];
  fulfillmentPolicies: { id: string; name: string }[];
  paymentPolicies: { id: string; name: string }[];
  returnPolicies: { id: string; name: string }[];
};
type CategoryOption = { id: string; name: string; breadcrumb: string };
type AspectDefinition = { name: string; required: boolean; recommended: boolean; multiValue: boolean; values: string[] };
type Readiness = { definitions: AspectDefinition[]; aspects: Record<string, string[]>; missingAspects: string[]; checks: { key: string; label: string; ready: boolean }[]; ready: boolean };
type RawCondition = "LIKE_NEW" | "USED_EXCELLENT" | "USED_VERY_GOOD" | "USED_ACCEPTABLE";
const pokemonConditionOptions: { value: RawCondition; label: string }[] = [
  { value: "LIKE_NEW", label: "Near Mint or Better" },
  { value: "USED_EXCELLENT", label: "Lightly Played (Excellent)" },
  { value: "USED_VERY_GOOD", label: "Moderately Played (Very Good)" },
  { value: "USED_ACCEPTABLE", label: "Heavily Played (Poor)" },
];
const sportsConditionOptions: { value: RawCondition; label: string }[] = [
  { value: "LIKE_NEW", label: "Near Mint or Better" },
  { value: "USED_EXCELLENT", label: "Excellent" },
  { value: "USED_VERY_GOOD", label: "Very Good" },
  { value: "USED_ACCEPTABLE", label: "Poor" },
];
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
  const [shippingService, setShippingService] = useState<"STANDARD_ENVELOPE" | "GROUND" | "PRIORITY">("GROUND");
  const [categoryOptions, setCategoryOptions] = useState<CategoryOption[]>([]);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [auctionReferenceTime] = useState(() => Date.now());
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [desiredEndLocal, setDesiredEndLocal] = useState("");
  const [priceInput, setPriceInput] = useState("");
  const [saleStrategyOptions, setSaleStrategyOptions] = useState<SaleStrategyOptions | null>(null);
  const revisionDetailsDirtyRef = useRef(false);
  const selectedCategoryId = draft?.categoryId ?? "";
  const pokemonCategory = selectedCategoryId === "183454" || (!selectedCategoryId && cardKindFromFields(card.fields) === "pokemon");
  const rawConditionOptions = pokemonCategory ? pokemonConditionOptions : sportsConditionOptions;

  useEffect(() => {
    let current = true;
    void Promise.all([
      fetch(`/api/collection/${encodeURIComponent(card.collectionId)}/ebay-draft`).then((response) => response.json()),
      fetch("/api/ebay/selling/status").then((response) => response.json()),
    ]).then(([draftPayload, statusPayload]) => {
      if (current) {
        setDraft(draftPayload.draft);
        setSaleStrategyOptions(draftPayload.saleStrategyOptions ?? null);
        revisionDetailsDirtyRef.current = false;
        setPriceInput((draftPayload.draft.priceCents / 100).toFixed(2));
        setStatus(statusPayload);
        const priceCents = Number(draftPayload.draft.priceCents ?? 0);
        if (priceCents > 0 && priceCents < 2000) {
          setShippingService("STANDARD_ENVELOPE");
          setSandboxShippingCost("1.25");
        }
      }
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
    }).catch((caught) => {
      if (!current) return;
      setSetup(emptySellerSetup());
      setError(caught instanceof Error
        ? caught.message
        : `CardPilot could not load the eBay ${status.environment} inventory location and listing policies.`);
    });
    return () => { current = false; };
  }, [status?.connected, status?.environment]);

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
    if (draft) {
      revisionDetailsDirtyRef.current = true;
      setDraft({ ...draft, [key]: value });
    }
  };
  const updateAspect = (name: string, value: string) => {
    if (!draft) return;
    revisionDetailsDirtyRef.current = true;
    const aspects = { ...draft.aspects };
    if (value.trim()) aspects[name] = [value];
    else delete aspects[name];
    setDraft({ ...draft, aspects });
  };
  const updateCondition = (condition: RawCondition) => {
    if (!draft) return;
    revisionDetailsDirtyRef.current = true;
    const label = rawConditionOptions.find((option) => option.value === condition)?.label ?? "Raw / ungraded";
    setDraft({
      ...draft,
      condition,
      conditionDescription: `Raw / ungraded trading card. Selected condition: ${label}. Please review photographs for the exact condition.`,
    });
  };

  const save = async (draftToSave: Draft | null = draft) => {
    if (!draftToSave) return false;
    setBusy(true); setError(null); setMessage(null);
    try {
      const enteredPrice = Number(priceInput);
      if (draftToSave.listingFormat === "FIXED_PRICE" && (!Number.isFinite(enteredPrice) || enteredPrice < 0.01)) {
        throw new Error("Enter a valid Buy It Now price of at least $0.01.");
      }
      const input = {
        title: draftToSave.title,
        description: draftToSave.description,
        priceCents: draftToSave.listingFormat === "FIXED_PRICE" ? Math.round(enteredPrice * 100) : draftToSave.priceCents,
        currency: draftToSave.currency,
        condition: draftToSave.condition,
        conditionDescription: draftToSave.conditionDescription,
        categoryId: draftToSave.categoryId,
        aspects: draftToSave.aspects,
        merchantLocationKey: draftToSave.merchantLocationKey,
        fulfillmentPolicyId: draftToSave.fulfillmentPolicyId,
        paymentPolicyId: draftToSave.paymentPolicyId,
        returnPolicyId: draftToSave.returnPolicyId,
        listingFormat: draftToSave.listingFormat,
        listingImages: draftToSave.listingImages ?? ["front"],
        auctionDurationDays: draftToSave.auctionDurationDays ?? 7,
        auctionStartPriceCents: draftToSave.auctionStartPriceCents ?? 99,
        auctionReservePriceCents: draftToSave.auctionReservePriceCents ?? 0,
        pricingStrategy: draftToSave.pricingStrategy ?? "balanced",
        promoteListing: draftToSave.promoteListing ?? false,
        promotionAdRatePercent: draftToSave.promotionAdRatePercent ?? 2,
      };
      const response = await fetch(`/api/collection/${encodeURIComponent(card.collectionId)}/ebay-draft`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      setDraft(payload.draft); setPriceInput((payload.draft.priceCents / 100).toFixed(2)); setMessage("Draft saved privately in CardPilot."); return true;
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Draft could not be saved."); return false; }
    finally { setBusy(false); }
  };

  const connect = async () => {
    const response = await fetch("/api/ebay/selling/authorize", { method: "POST" });
    const payload = await response.json();
    if (!response.ok) { setError(payload.error); return; }
    window.location.assign(payload.authorizationUrl);
  };

  const reconnect = async () => {
    if (!window.confirm("Reconnect eBay to grant CardPilot the current selling, sales, shipping, and optional promotion permissions? Your eBay listings and CardPilot drafts will not be deleted.")) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/ebay/selling/connection", { method: "DELETE" });
      if (!response.ok) throw new Error("CardPilot could not restart the eBay connection.");
      await connect();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "CardPilot could not reconnect eBay.");
      setBusy(false);
    }
  };

  const createSellerSetup = async () => {
    if (!draft || !status) return;
    if (status.environment === "production" && !window.confirm(
      "Create a real eBay inventory location plus CardPilot shipping, immediate-payment, and 30-day buyer-paid return policies? These settings will be added to your Production seller account.",
    )) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const shippingCost = Number(sandboxShippingCost);
      if (!/^\d{5}(?:-\d{4})?$/.test(sandboxPostalCode.trim())) throw new Error("Enter a valid US ZIP code.");
      if (!Number.isFinite(shippingCost) || shippingCost < 0) throw new Error("Enter a valid shipping charge.");
      const response = await fetch(`/api/ebay/selling/setup/${status.environment}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          postalCode: sandboxPostalCode.trim(),
          shippingCostCents: Math.round(shippingCost * 100),
          ...(status.environment === "production" ? { confirmation: "CREATE_PRODUCTION_DEFAULTS" } : {}),
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
      setMessage(`${status.environment === "production" ? "Production" : "Sandbox"} seller settings created and selected. Save the draft to remember them.`);
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : "eBay seller settings could not be created.";
      setError(status.environment === "sandbox" && /system error|fulfillment policy/i.test(detail)
        ? "eBay Sandbox is currently reporting a known seller-policy service outage. Your CardPilot draft is safe; retry this setup after eBay restores the Sandbox Account API."
        : detail);
    } finally { setBusy(false); }
  };

  const createShippingCharge = async () => {
    if (!draft || !status) return;
    const shippingCost = Number(sandboxShippingCost);
    if (!Number.isFinite(shippingCost) || shippingCost < 0 || shippingCost > 100) {
      setError("Enter a shipping charge from $0.00 through $100.00."); return;
    }
    if (shippingService === "STANDARD_ENVELOPE" && draft.priceCents >= 2000) {
      setError("eBay Standard Envelope is limited to eligible items priced under $20. Choose USPS Ground Advantage for this card."); return;
    }
    const serviceLabel = shippingService === "STANDARD_ENVELOPE" ? "eBay Standard Envelope" : shippingService === "GROUND" ? "USPS Ground Advantage" : "USPS Priority Mail";
    const label = shippingCost === 0 ? "free shipping" : `$${shippingCost.toFixed(2)} buyer-paid shipping`;
    if (!window.confirm(`Create or select a ${serviceLabel} policy with ${label}? Local pickup will be disabled. This policy can be reused as your account default or changed on an individual listing.`)) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const response = await fetch("/api/ebay/selling/shipping-policy", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shippingCostCents: Math.round(shippingCost * 100),
          shippingService,
          confirmation: status.environment === "production" ? "CREATE_PRODUCTION_SHIPPING" : "CREATE_SANDBOX_SHIPPING",
        }),
      });
      const payload = await responsePayload(response);
      if (!response.ok) throw new Error(payload.error);
      const next = payload as SellerSetup & { selectedFulfillmentPolicyId: string };
      setSetup(next);
      const revisedDraft = { ...draft, fulfillmentPolicyId: next.selectedFulfillmentPolicyId };
      revisionDetailsDirtyRef.current = true;
      setDraft(revisedDraft);
      if (draft.status === "published") {
        const reviseResponse = await fetch(`/api/collection/${encodeURIComponent(card.collectionId)}/ebay-revise`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            confirmation: "REVISE",
            revisionScope: "SHIPPING_ONLY",
            fulfillmentPolicyId: next.selectedFulfillmentPolicyId,
          }),
        });
        const revisePayload = await responsePayload(reviseResponse);
        if (!reviseResponse.ok) throw new Error(revisePayload.error);
        setDraft(revisePayload.draft);
        revisionDetailsDirtyRef.current = false;
        setMessage(`${serviceLabel} with ${label} is now applied to the active eBay listing. Other listing details were kept.`);
      } else {
        setMessage(`${serviceLabel} with ${label} is selected and local pickup is off. Save the draft to remember it.`);
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "CardPilot could not create that shipping charge."); }
    finally { setBusy(false); }
  };

  const deleteDraft = async () => {
    if (!draft?.draftId || draft.status !== "draft" || !window.confirm(`Delete the saved eBay draft for “${draft.title}”? This cannot be undone.`)) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/collection/${encodeURIComponent(card.collectionId)}/ebay-draft`, { method: "DELETE" });
      if (!response.ok) { const payload = await response.json().catch(() => null); throw new Error(payload?.error ?? "Draft could not be deleted."); }
      onClose();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Draft could not be deleted."); setBusy(false); }
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
      setDraft(payload.draft);
      setMessage(payload.draft.promotion?.status === "promoted"
        ? `Published and promoted on eBay ${status?.environment}. Listing ${payload.draft.ebayListingId}.`
        : payload.draft.promotion?.status === "failed"
          ? `Published to eBay, but promotion was not enabled: ${payload.draft.promotion.error}`
          : `Published to eBay ${status?.environment}. Listing ${payload.draft.ebayListingId}.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "eBay could not publish this listing."); }
    finally { setBusy(false); }
  };

  const endListing = async () => {
    if (!draft || !window.confirm(`Cancel/end eBay listing ${draft.ebayListingId}? Buyers will no longer be able to purchase it.`)) return;
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

  const prepareRelist = async () => {
    if (!draft || draft.status !== "ended" || !window.confirm(`Create a fresh eBay draft for “${draft.title}”? The ended eBay listing will remain ended.`)) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const response = await fetch(`/api/collection/${encodeURIComponent(card.collectionId)}/ebay-relist`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmation: "RELIST" }),
      });
      const payload = await responsePayload(response);
      if (!response.ok) throw new Error(payload.error);
      setDraft(payload.draft); setPriceInput((payload.draft.priceCents / 100).toFixed(2));
      revisionDetailsDirtyRef.current = false;
      setMessage("A fresh draft is ready. Review it before publishing a new eBay listing.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "CardPilot could not prepare this card for relisting."); }
    finally { setBusy(false); }
  };

  const reviseListing = async () => {
    if (!draft || !window.confirm(`Save these changes to active eBay listing ${draft.ebayListingId}?`)) return;
    if (!(await save())) return;
    setBusy(true); setError(null);
    try {
      const priceOnly = !revisionDetailsDirtyRef.current;
      const response = await fetch(`/api/collection/${encodeURIComponent(card.collectionId)}/ebay-revise`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmation: "REVISE", revisionScope: priceOnly ? "PRICE_ONLY" : "FULL" }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      setDraft(payload.draft); revisionDetailsDirtyRef.current = false;
      setMessage(priceOnly ? "The active eBay price was revised." : "The active eBay listing was revised.");
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
  const missingRequiredAspects = draft
    ? requiredDefinitions
        .filter((definition) => !draft.aspects[definition.name]?.some((value) => value.trim()))
        .map((definition) => definition.name)
    : [];
  const currentReadinessChecks = readiness?.checks.map((check) => {
    if (check.key === "specifics") return { ...check, ready: missingRequiredAspects.length === 0 };
    if (check.key === "category") return { ...check, ready: /^\d+$/.test(draft?.categoryId ?? "") };
    if (check.key === "seller") return { ...check, ready: missingPublishingFields.filter((field) => field !== "eBay category").length === 0 };
    return check;
  }) ?? [];
  const selectedImages = draft?.listingImages ?? ["front"];
  const auctionDays = draft?.auctionDurationDays ?? 7;
  const auctionEnd = new Date(auctionReferenceTime + auctionDays * 86_400_000);
  const enteredFixedPrice = Number(priceInput);
  const fixedPriceCents = Number.isFinite(enteredFixedPrice) && enteredFixedPrice >= 0
    ? Math.round(enteredFixedPrice * 100)
    : 0;
  const referencePriceCents = draft?.listingFormat === "AUCTION" ? draft.auctionStartPriceCents ?? 99 : fixedPriceCents;
  const estimatedFeeCents = Math.round(referencePriceCents * 0.1325 + 30);
  const promotionFeeCents = draft?.promoteListing
    ? Math.round(referencePriceCents * ((draft.promotionAdRatePercent ?? 2) / 100))
    : 0;
  const estimatedProceedsCents = Math.max(0, referencePriceCents - estimatedFeeCents - promotionFeeCents);
  const publishBlockers = draft && status ? [
    !status.connected ? `Connect the eBay ${status.environment} seller account` : null,
    draft.status === "sold" ? "This card is already marked sold" : null,
    ...missingPublishingFields,
    ...missingRequiredAspects,
  ].filter((value): value is string => Boolean(value)) : ["Listing details are still loading"];

  return (
    <div className="ebay-draft-backdrop" role="presentation">
      <section className="ebay-draft-panel" role="dialog" aria-modal="true" aria-labelledby="ebay-draft-title">
        <header><div><span>{status?.environment === "production" ? "Live eBay selling" : "Sandbox-first selling"}</span><h2 id="ebay-draft-title">Sell {card.title} on eBay</h2></div><button type="button" onClick={onClose}>Close</button></header>
        {!draft || !status ? <div className="collection-empty"><span className="spinner" /> Preparing draft...</div> : (
          <>
            <div className={`ebay-connection-status ${status.connected ? "connected" : ""}`}>
              <strong>{status.connected ? "eBay seller connected" : status.configured ? "Connect your eBay seller account" : "eBay selling setup required"}</strong>
              <span>Environment: {status.environment}. Production publishing remains separate.</span>
              {status.configured && !status.connected && <button type="button" onClick={() => void connect()}>Connect eBay</button>}
              {status.connected && <button type="button" disabled={busy} onClick={() => void reconnect()}>Reconnect eBay permissions</button>}
            </div>
            {status.connected && setup && (
              !setup.locations.length || !setup.fulfillmentPolicies.length || !setup.paymentPolicies.length || !setup.returnPolicies.length
            ) && <section className="ebay-sandbox-setup" aria-labelledby="ebay-sandbox-setup-title">
              <div>
                <strong id="ebay-sandbox-setup-title">Finish setting up this {status.environment === "production" ? "eBay seller" : "test seller"}</strong>
                <p>{status.environment === "production"
                  ? "Your Production account has no available listing policies or inventory location. CardPilot can create real defaults after you review and confirm them."
                  : "This new Sandbox account has no listing policies or inventory location. CardPilot can create test-only defaults; this cannot affect real eBay."}</p>
              </div>
              <div className="ebay-sandbox-setup-fields">
                <label>Ship-from ZIP code <input inputMode="numeric" autoComplete="postal-code" placeholder="12345" value={sandboxPostalCode} onChange={(event) => setSandboxPostalCode(event.target.value)} /></label>
                <label>Buyer shipping charge <input type="number" min="0" step="0.01" value={sandboxShippingCost} onChange={(event) => setSandboxShippingCost(event.target.value)} /></label>
              </div>
              <small>Creates a one-business-day USPS shipping policy, immediate payment, 30-day buyer-paid returns, and a ZIP-level inventory location. Review the shipping charge before continuing.</small>
              <button className="primary-action" type="button" disabled={busy} onClick={() => void createSellerSetup()}>{busy ? "Creating seller settings..." : `Review and create ${status.environment === "production" ? "Production" : "Sandbox"} settings`}</button>
            </section>}
            {error && <div className="error-banner ebay-setup-feedback" role="alert">{error}</div>}
            {message && <div className="collection-status-banner ebay-setup-feedback" role="status">{message}</div>}
            <section className="ebay-listing-preview" aria-labelledby="ebay-preview-title">
              <div className="ebay-preview-images">{selectedImages.includes("front") && <img src={card.images.frontUrl} alt="Front of the card being listed" />}{selectedImages.includes("back") && card.images.backUrl && <img src={card.images.backUrl} alt="Back of the card being listed" />}</div>
              <div><span>Listing preview</span><h3 id="ebay-preview-title">{draft.title || "Add a listing title"}</h3><strong>{draft.listingFormat === "AUCTION" ? `Starting bid ${draft.currency} ${((draft.auctionStartPriceCents ?? 99) / 100).toFixed(2)}` : `${draft.currency} ${(fixedPriceCents / 100).toFixed(2)}`}</strong><p>{draft.description || "Add a description."}</p></div>
            </section>
            {readiness && <section className="ebay-readiness" aria-labelledby="ebay-readiness-title"><div><h3 id="ebay-readiness-title">Listing readiness</h3><p>CardPilot filled what it could from the confirmed card details. Only items still needing attention are marked below.</p></div><ul>{currentReadinessChecks.map((check) => <li className={check.ready ? "ready" : "missing"} key={check.key}><span>{check.ready ? "✓" : "!"}</span>{check.label}</li>)}</ul></section>}
            <div className="ebay-draft-grid">
              <label className="wide">Title <input maxLength={80} value={draft.title} onChange={(e) => update("title", e.target.value)} /><small>{draft.title.length}/80</small></label>
              <label className="wide">Description <textarea rows={7} value={draft.description} onChange={(e) => update("description", e.target.value)} /></label>
              <label>Listing format <select disabled={draft.status === "published"} value={draft.listingFormat} onChange={(e) => update("listingFormat", e.target.value as Draft["listingFormat"])}><option value="FIXED_PRICE">Buy It Now (recommended)</option><option value="AUCTION">Auction</option></select>{draft.status === "published" && <small>End and create a new listing to change its format.</small>}</label>
              {draft.listingFormat === "FIXED_PRICE" && <label>Pricing goal <select value={draft.pricingStrategy ?? "balanced"} onChange={(event) => {
                const strategy = event.target.value as NonNullable<Draft["pricingStrategy"]>;
                update("pricingStrategy", strategy);
                const option = saleStrategyOptions?.[strategy];
                if (option) setPriceInput((option.amountCents / 100).toFixed(2));
              }}><option value="sell_faster">Sell faster</option><option value="balanced">Balanced</option><option value="maximize_value">Maximize value</option></select><small>{saleStrategyOptions?.[draft.pricingStrategy ?? "balanced"]?.rationale ?? "Choose how price and expected selling time should trade off."}</small></label>}
              {draft.listingFormat === "FIXED_PRICE" ? <label>Buy It Now price <input type="text" inputMode="decimal" placeholder="0.00" value={priceInput} onChange={(e) => setPriceInput(e.target.value)} /><small>Enter dollars and cents, for example 12.95.</small></label> : <>
                <label>Starting bid <input type="number" min="0.01" step="0.01" value={((draft.auctionStartPriceCents ?? 99) / 100).toFixed(2)} onChange={(e) => update("auctionStartPriceCents", Math.round(Number(e.target.value) * 100))} /></label>
                <label>Optional reserve price <input type="number" min="0" step="0.01" value={((draft.auctionReservePriceCents ?? 0) / 100).toFixed(2)} onChange={(e) => update("auctionReservePriceCents", Math.round(Number(e.target.value) * 100))} /><small>Reserve fees can apply even if the card does not sell.</small></label>
                <label>Auction ending day <select value={auctionDays} onChange={(e) => update("auctionDurationDays", Number(e.target.value) as Draft["auctionDurationDays"])}>{([1, 3, 5, 7, 10] as const).map((days) => <option key={days} value={days}>{new Date(auctionReferenceTime + days * 86_400_000).toLocaleString([], { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} ({days} day{days === 1 ? "" : "s"})</option>)}</select><small>eBay ends the auction at approximately the same time it is published.</small></label>
              </>}
              <label>Card type <input value={card.grading.isGraded ? `Professionally graded${card.grading.company ? ` by ${card.grading.company}` : ""}` : "Raw / ungraded"} readOnly /><small>Set automatically from Card Details.</small></label>
              {!card.grading.isGraded && <label>Card condition <select value={draft.condition} onChange={(event) => updateCondition(event.target.value as RawCondition)}>{rawConditionOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><small>{pokemonCategory ? "Pokémon / CCG condition choices" : "Sports and non-sport condition choices"} required by eBay.</small></label>}
              <label className="wide">Condition details <input value={draft.conditionDescription} onChange={(e) => update("conditionDescription", e.target.value)} /></label>
              <label>eBay category <input list={`ebay-categories-${card.collectionId}`} value={draft.categoryId} onChange={(e) => update("categoryId", e.target.value)} placeholder="Recommended automatically" /><datalist id={`ebay-categories-${card.collectionId}`}>{categoryOptions.map((option) => <option key={option.id} value={option.id}>{option.breadcrumb || option.name}</option>)}</datalist><small>{categoryOptions.find((option) => option.id === draft.categoryId)?.breadcrumb ?? "Numeric eBay leaf category ID; advanced users can override it."}</small></label>
              {requiredDefinitions.map((definition) => <label className={!draft.aspects[definition.name]?.[0] ? "ebay-required-missing" : ""} key={definition.name}>{definition.name} <span>{definition.required ? "Required" : ""}</span>{definition.values.length ? <select value={draft.aspects[definition.name]?.[0] ?? ""} onChange={(e) => updateAspect(definition.name, e.target.value)}><option value="">Choose</option>{definition.values.map((value) => <option key={value} value={value}>{value}</option>)}</select> : <input value={draft.aspects[definition.name]?.[0] ?? ""} onChange={(e) => updateAspect(definition.name, e.target.value)} />}</label>)}
              {optionalDefinitions.map((definition) => <label key={definition.name}>{definition.name}{definition.values.length ? <select value={draft.aspects[definition.name]?.[0] ?? ""} onChange={(e) => updateAspect(definition.name, e.target.value)}><option value="">Optional</option>{definition.values.map((value) => <option key={value} value={value}>{value}</option>)}</select> : <input value={draft.aspects[definition.name]?.[0] ?? ""} onChange={(e) => updateAspect(definition.name, e.target.value)} />}</label>)}
              <label>Inventory location <select value={draft.merchantLocationKey} onChange={(e) => update("merchantLocationKey", e.target.value)}><option value="">Choose location</option>{setup?.locations.map((item) => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}</select></label>
              <label>Shipping policy <select value={draft.fulfillmentPolicyId} onChange={(e) => update("fulfillmentPolicyId", e.target.value)}><option value="">Choose shipping policy</option>{setup?.fulfillmentPolicies.map((item) => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}</select></label>
              <div className="wide ebay-shipping-charge">
                <label>Shipping method <select value={shippingService} onChange={(event) => setShippingService(event.target.value as typeof shippingService)}><option value="STANDARD_ENVELOPE">eBay Standard Envelope — lowest-cost tracked option</option><option value="GROUND">USPS Ground Advantage — protected package</option><option value="PRIORITY">USPS Priority Mail — faster, more expensive</option></select><small>CardPilot recommends Standard Envelope only for eligible cards under $20; Ground Advantage is the fallback. Local pickup is always off.</small></label>
                <label>Buyer shipping charge <input type="text" inputMode="decimal" placeholder="4.99" value={sandboxShippingCost} onChange={(event) => setSandboxShippingCost(event.target.value)} /><small>Enter what the buyer pays, or 0 for free shipping. This is separate from the label price charged to the seller.</small></label>
                <button type="button" disabled={busy || !status.connected} onClick={() => void createShippingCharge()}>{draft.status === "published" ? "Apply shipping change to active eBay listing" : "Use this method and charge"}</button>
              </div>
              <label>Payment policy <select value={draft.paymentPolicyId} onChange={(e) => update("paymentPolicyId", e.target.value)}><option value="">Choose payment policy</option>{setup?.paymentPolicies.map((item) => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}</select></label>
              <label>Return policy <select value={draft.returnPolicyId} onChange={(e) => update("returnPolicyId", e.target.value)}><option value="">Choose return policy</option>{setup?.returnPolicies.map((item) => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}</select></label>
              {draft.listingFormat === "FIXED_PRICE" && <label className="wide"><span><input type="checkbox" checked={draft.promoteListing ?? false} onChange={(event) => update("promoteListing", event.target.checked)} /> Promote this listing on eBay</span><small>{status.marketingAuthorized ? "Eligible sellers can add the published listing to a cost-per-sale eBay advertising campaign." : "The listing can still publish. Reconnect eBay permissions to enable promotion; without that permission CardPilot will leave the listing active but unpromoted."}</small></label>}
              {draft.listingFormat === "FIXED_PRICE" && draft.promoteListing && <label>Promotion ad rate <select value={Math.min(50, Math.max(1, Math.round(draft.promotionAdRatePercent ?? 2)))} onChange={(event) => update("promotionAdRatePercent", Number(event.target.value))}>{Array.from({ length: 50 }, (_, index) => index + 1).map((rate) => <option key={rate} value={rate}>{rate}%</option>)}</select><small>Additional percentage eBay may charge when the promoted ad receives sale attribution.</small></label>}
            </div>
            {draft.listingFormat === "AUCTION" && <section className="ebay-auction-schedule"><div><h3>Schedule by desired ending time</h3><p>Optional. Leave this off to publish the auction manually.</p></div>{draft.scheduleStatus === "scheduled" && draft.scheduledPublishAt && draft.desiredEndAt ? <div className="ebay-scheduled-summary"><strong>Automatic publication scheduled</strong><span>Publishes {new Date(draft.scheduledPublishAt).toLocaleString()}</span><span>Expected to end {new Date(draft.desiredEndAt).toLocaleString()}</span><button type="button" disabled={busy} onClick={() => void cancelSchedule()}>Cancel schedule</button></div> : <><label className="ebay-schedule-toggle"><input type="checkbox" checked={scheduleEnabled} onChange={(event) => setScheduleEnabled(event.target.checked)} /> Automatically publish to end when I choose</label>{scheduleEnabled && <div className="ebay-schedule-fields"><label>Desired local ending date and time <input type="datetime-local" value={desiredEndLocal} onChange={(event) => setDesiredEndLocal(event.target.value)} /></label><div><span>Your timezone</span><strong>{Intl.DateTimeFormat().resolvedOptions().timeZone}</strong></div>{desiredEndLocal && Number.isFinite(new Date(desiredEndLocal).getTime()) && <div><span>Calculated publication</span><strong>{new Date(new Date(desiredEndLocal).getTime() - auctionDays * 86_400_000).toLocaleString()}</strong></div>}<button className="primary-action" type="button" disabled={busy || !desiredEndLocal || publishBlockers.length > 0} onClick={() => void scheduleAuction()}>Review and schedule automatic publication</button></div>}</>}</section>}
            <section className="ebay-photo-manager"><div><h3>Listing photos</h3><p>The front image is used by default. Add the back only when you want buyers to see it.</p></div><label><input type="checkbox" checked readOnly /> Front photo <span>Primary</span></label>{card.images.backUrl ? <label><input type="checkbox" checked={selectedImages.includes("back")} onChange={(e) => update("listingImages", e.target.checked ? ["front", "back"] : ["front"])} /> Include back photo</label> : <small>No back photo was saved for this card. One front image is acceptable.</small>}</section>
            <section className="ebay-proceeds"><div><span>Price reference</span><strong>{draft.currency} {(referencePriceCents / 100).toFixed(2)}</strong></div><div><span>Illustrative eBay fee</span><strong>− {draft.currency} {(estimatedFeeCents / 100).toFixed(2)}</strong></div>{draft.promoteListing && <div><span>Maximum promotion fee ({draft.promotionAdRatePercent ?? 2}%)</span><strong>− {draft.currency} {(promotionFeeCents / 100).toFixed(2)}</strong></div>}<div><span>Approximate proceeds</span><strong>{draft.currency} {(estimatedProceedsCents / 100).toFixed(2)}</strong></div><p>Illustrative estimate using 13.25% plus $0.30{draft.promoteListing ? ", plus the selected promotion rate when eBay attributes the sale to the ad" : ""}. Actual fees vary by seller, category, promotions, taxes, shipping, and final auction price.{draft.listingFormat === "AUCTION" ? ` Selected auction currently ends around ${auctionEnd.toLocaleString()}.` : ""}</p></section>
            {draft.status !== "published" && publishBlockers.length > 0 && <p className="ebay-missing-fields">Publish button unavailable: {publishBlockers.join(", ")}.</p>}
            <div className="ebay-draft-actions"><button type="button" disabled={busy || draft.status === "sold" || draft.status === "ended"} onClick={() => void save()}>{busy ? "Working..." : "Save draft"}</button>{draft.draftId && draft.status === "draft" && draft.scheduleStatus !== "scheduled" && <button className="account-delete-button" type="button" disabled={busy} onClick={() => void deleteDraft()}>Delete draft</button>}{draft.status === "ended" && <button className="primary-action" type="button" disabled={busy} onClick={() => void prepareRelist()}>Relist this card</button>}{draft.status === "published" ? <><button className="primary-action" type="button" disabled={busy} onClick={() => void reviseListing()}>Save and revise eBay</button><button className="account-delete-button" type="button" disabled={busy} onClick={() => void endListing()}>End eBay listing</button></> : draft.status !== "ended" && <button className="primary-action" type="button" disabled={busy || publishBlockers.length > 0} onClick={() => void publish()}>{draft.status === "sold" ? "Card sold — relisting blocked" : `Review and publish to ${status.environment}`}</button>}</div>
            <p className="valuation-disclaimer">CardPilot never publishes from this screen without a separate confirmation. Verify condition, category, policies, price, and photographs first.</p>
          </>
        )}
      </section>
    </div>
  );
}
