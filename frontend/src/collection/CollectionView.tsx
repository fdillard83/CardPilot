import { useMemo, useRef, useState } from "react";
import {
  fieldDefinitions,
  formatFieldValue,
  type ActiveMarketSnapshot,
  type FieldKey,
  type FieldValue,
  type GradingProfile,
  type SavedCollectionCard,
  type SoldCompsSnapshot,
} from "../identification/types";

type CollectionFilter = "all" | "numbered" | "autograph" | "rookie";

function searchableText(card: SavedCollectionCard) {
  return Object.values(card.fields)
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
}
function matchesFilter(card: SavedCollectionCard, filter: CollectionFilter) {
  if (filter === "numbered") return Boolean(card.fields.serialNumber);
  if (filter === "autograph") return card.fields.autograph === true;
  if (filter === "rookie") return card.fields.rookieStatus === true;
  return true;
}

function createDraft(card: SavedCollectionCard) {
  return { ...card.fields };
}

function formatPrice(amountCents: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(amountCents / 100);
}

function confidenceLabel(confidence: "low" | "medium" | "high") {
  if (confidence === "high") return "Stronger snapshot";
  if (confidence === "medium") return "Useful snapshot";
  return "Limited snapshot";
}

function saleDateLabel(value: string | null) {
  if (!value) return "Sale date not provided";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : `Sold ${date.toLocaleDateString()}`;
}

function listingTypeLabel(value: string | null) {
  if (!value) return "Completed sale";
  const labels: Record<string, string> = {
    auction: "Auction",
    fixed_price: "Buy It Now",
    best_offer: "Best Offer",
  };
  return labels[value.toLowerCase()] ?? value.replaceAll("_", " ");
}

function groupMatchesSavedCondition(
  card: SavedCollectionCard,
  group: ActiveMarketSnapshot["groups"][number],
) {
  if (!card.grading.isGraded) return group.classification === "raw";
  const savedGrade = `${card.grading.company ?? ""} ${card.grading.grade ?? ""}`
    .trim()
    .toLowerCase();
  return (
    group.classification === "graded" &&
    group.label.trim().toLowerCase() === savedGrade
  );
}

function ActiveMarketPanel({
  card,
  snapshot,
  isLoading,
  error,
  onRetry,
}: {
  card: SavedCollectionCard;
  snapshot: ActiveMarketSnapshot | null;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const orderedGroups = snapshot
    ? [...snapshot.groups].sort(
        (left, right) =>
          Number(groupMatchesSavedCondition(card, right)) -
          Number(groupMatchesSavedCondition(card, left)),
      )
    : [];
  return (
    <section
      className="valuation-panel"
      aria-labelledby={`active-market-${card.collectionId}`}
    >
      <div className="valuation-heading">
        <div>
          <span className="step-label">Current marketplace snapshot</span>
          <h3 id={`active-market-${card.collectionId}`}>
            Comparable Buy It Now listings
          </h3>
        </div>
        <span className="valuation-source">eBay Buy It Now</span>
      </div>

      {error && (
        <div className="valuation-error" role="alert">
          <strong>Active listings are unavailable.</strong>
          <span>{error}</span>
          <button type="button" onClick={onRetry}>Try again</button>
        </div>
      )}

      {isLoading ? (
        <div className="valuation-loading" role="status">
          <span className="spinner" /> Finding closely matching active listings...
        </div>
      ) : snapshot ? (
        <>
          <div className="market-summary">
            <div>
              <span>Search used</span>
              <strong>{snapshot.query}</strong>
            </div>
            <div className="valuation-meta">
              <span>{snapshot.exactMatchedCount} exact matches</span>
              {snapshot.broaderMatchedCount > 0 && (
                <span>{snapshot.broaderMatchedCount} broader comparisons</span>
              )}
              <span>{snapshot.excludedCount} results excluded</span>
              <span>Checked {new Date(snapshot.searchedAt).toLocaleString()}</span>
            </div>
          </div>

          {snapshot.broaderMatchedCount > 0 && (
            <div className="market-fallback-note">
              <strong>Broader comparison mode was used.</strong>
              <span>
                Too few exact listings were available, so these lower-confidence
                comparisons relax missing title details while still rejecting
                conflicting players, years, parallels, card numbers, and print runs.
              </span>
            </div>
          )}

          {orderedGroups.length > 0 ? (
            <div className="market-groups">
              {orderedGroups.map((group) => (
                <article className="market-group" key={`${group.id}-${group.currency}`}>
                  <div className="market-group-heading">
                    <div>
                      <span>
                        {group.matchTier === "broader" ? "Broader " : ""}
                        {group.classification === "raw" ? "ungraded comparisons" : "graded comparisons"}
                      </span>
                      <h4>{group.label}</h4>
                      {groupMatchesSavedCondition(card, group) && (
                        <span className="market-condition-match">
                          Matches saved condition
                        </span>
                      )}
                    </div>
                    <span className={`market-confidence market-confidence-${group.confidence}`}>
                      {confidenceLabel(group.confidence)}
                    </span>
                  </div>
                  <div className="valuation-prices">
                    <div>
                      <span>Median active ask</span>
                      <strong>{formatPrice(group.medianAmountCents, group.currency)}</strong>
                    </div>
                    <div>
                      <span>Typical asking range</span>
                      <strong>
                        {formatPrice(group.typicalRange.lowAmountCents, group.currency)}–
                        {formatPrice(group.typicalRange.highAmountCents, group.currency)}
                      </strong>
                    </div>
                    <div>
                      <span>Listings used</span>
                      <strong>{group.listingCount}</strong>
                    </div>
                  </div>
                  {group.outlierCount > 0 && (
                    <p className="market-note">
                      {group.outlierCount} unusually priced listing{group.outlierCount === 1 ? " was" : "s were"} left out of the summary.
                    </p>
                  )}
                  <div className="market-listings">
                    {group.listings.map((listing) => {
                      const listingContents = (
                        <>
                          {listing.imageUrl ? (
                            <img src={listing.imageUrl} alt="" />
                          ) : (
                            <span className="market-listing-placeholder">No photo</span>
                          )}
                          <span className="market-listing-copy">
                            <strong>{listing.title}</strong>
                            {listing.confirmedReference && (
                              <span className="market-reference-badge">
                                Confirmed during identification
                              </span>
                            )}
                            {listing.matchTier === "broader" && (
                              <span className="market-broader-badge">
                                Broader comparison
                              </span>
                            )}
                            <small>{listing.condition ?? "Condition not provided"}</small>
                            <em>
                              {formatPrice(listing.totalPriceCents, listing.currency)} total shown
                            </em>
                            <small>
                              {formatPrice(listing.itemPriceCents, listing.currency)} item
                              {listing.shippingCostCents !== null
                                ? ` + ${formatPrice(listing.shippingCostCents, listing.currency)} shipping`
                                : "; shipping not included in the API result"}
                            </small>
                          </span>
                        </>
                      );
                      return listing.itemWebUrl ? (
                        <a
                          className="market-listing"
                          href={listing.itemWebUrl}
                          key={listing.itemId}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {listingContents}
                        </a>
                      ) : (
                        <div className="market-listing" key={listing.itemId}>
                          {listingContents}
                        </div>
                      );
                    })}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="valuation-loading">
              No close fixed-price matches were found. More complete card details can improve the search.
            </div>
          )}

          <p className="valuation-disclaimer">
            {snapshot.disclaimer} Raw and graded cards are summarized separately.
          </p>
        </>
      ) : error ? null : (
        <div className="valuation-loading">
          No active-market snapshot has been loaded.
        </div>
      )}
    </section>
  );
}

function SoldCompsPanel({
  card,
  snapshot,
  isLoading,
  error,
  onRetry,
}: {
  card: SavedCollectionCard;
  snapshot: SoldCompsSnapshot | null;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const coverageLabel = snapshot?.coverage.from || snapshot?.coverage.to
    ? `${snapshot.coverage.from ?? "earliest available"} to ${snapshot.coverage.to ?? "latest available"}`
    : "Provider lookback window not reported";
  return (
    <section
      className="valuation-panel sold-comps-panel"
      aria-labelledby={`sold-comps-${card.collectionId}`}
    >
      <div className="valuation-heading">
        <div>
          <span className="step-label">Completed marketplace sales</span>
          <h3 id={`sold-comps-${card.collectionId}`}>Comparable sold cards</h3>
        </div>
        <span className="valuation-source">The Card API</span>
      </div>

      {error && (
        <div className="valuation-error" role="alert">
          <strong>Completed sales are unavailable.</strong>
          <span>{error}</span>
          <button type="button" onClick={onRetry}>Try again</button>
        </div>
      )}

      {isLoading ? (
        <div className="valuation-loading" role="status">
          <span className="spinner" /> Finding closely matching completed sales...
        </div>
      ) : snapshot ? (
        <>
          <div className="market-summary sold-summary">
            <div>
              <span>Search used</span>
              <strong>{snapshot.query}</strong>
            </div>
            <div className="valuation-meta">
              <span>{snapshot.conditionProfile.label}</span>
              <span>{snapshot.exactMatchedCount} exact sold matches</span>
              {snapshot.broaderMatchedCount > 0 && (
                <span>{snapshot.broaderMatchedCount} broader sold comparisons</span>
              )}
              <span>{snapshot.excludedCount} records excluded</span>
              <span>Coverage: {coverageLabel}</span>
              <span>Checked {new Date(snapshot.searchedAt).toLocaleString()}</span>
            </div>
          </div>

          {snapshot.broaderMatchedCount > 0 && (
            <div className="market-fallback-note">
              <strong>Broader sold comparisons are shown separately.</strong>
              <span>
                Exact sold records were scarce. These lower-confidence results
                tolerate missing title details while rejecting known conflicts,
                and they never change the exact-match median.
              </span>
            </div>
          )}

          {snapshot.groups.length > 0 ? (
            <div className="market-groups">
              {snapshot.groups.map((group) => (
                <article className="market-group sold-group" key={`${group.id}-${group.currency}`}>
                  <div className="market-group-heading">
                    <div>
                      <span>{group.matchTier === "exact" ? "Exact completed sales" : "Broader completed sales"}</span>
                      <h4>{group.platform}</h4>
                    </div>
                    <span className={`market-confidence market-confidence-${group.confidence}`}>
                      {confidenceLabel(group.confidence)}
                    </span>
                  </div>
                  <div className="valuation-prices">
                    <div>
                      <span>Median sold price</span>
                      <strong>{formatPrice(group.medianSalePriceCents, group.currency)}</strong>
                    </div>
                    <div>
                      <span>Typical sold range</span>
                      <strong>
                        {formatPrice(group.typicalRange.lowAmountCents, group.currency)}–
                        {formatPrice(group.typicalRange.highAmountCents, group.currency)}
                      </strong>
                    </div>
                    <div>
                      <span>Sales used</span>
                      <strong>{group.saleCount}</strong>
                    </div>
                  </div>
                  {group.outlierCount > 0 && (
                    <p className="market-note">
                      {group.outlierCount} unusually priced sale{group.outlierCount === 1 ? " was" : "s were"} left out of the summary.
                    </p>
                  )}
                  <div className="market-listings">
                    {group.sales.map((sale) => {
                      const saleContents = (
                        <>
                          {sale.imageUrl ? (
                            <img src={sale.imageUrl} alt="" />
                          ) : (
                            <span className="market-listing-placeholder">No photo</span>
                          )}
                          <span className="market-listing-copy">
                            <strong>{sale.title}</strong>
                            {sale.matchTier === "broader" && (
                              <span className="market-broader-badge">Broader comparison</span>
                            )}
                            <small>{listingTypeLabel(sale.listingType)} · {saleDateLabel(sale.soldAt ?? sale.saleDate)}</small>
                            <em>{formatPrice(sale.salePriceCents, sale.currency)} sold price</em>
                            <small>
                              {sale.condition ?? "Condition not provided"}
                              {sale.bids !== null ? ` · ${sale.bids} bids` : ""}
                            </small>
                          </span>
                        </>
                      );
                      return sale.listingUrl ? (
                        <a
                          className="market-listing sold-listing"
                          href={sale.listingUrl}
                          key={sale.id}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {saleContents}
                        </a>
                      ) : (
                        <div className="market-listing sold-listing" key={sale.id}>
                          {saleContents}
                        </div>
                      );
                    })}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="valuation-loading sold-empty">
              No qualifying completed sales were found in the provider's current
              lookback window. That does not mean the card has no value.
            </div>
          )}

          <p className="valuation-disclaimer">{snapshot.disclaimer}</p>
        </>
      ) : error ? null : (
        <div className="valuation-loading">No sold-comparison search has been loaded.</div>
      )}
    </section>
  );
}

export function CollectionView({
  cards,
  isLoading,
  error,
  onCardsChange,
  onScanCard,
}: {
  cards: SavedCollectionCard[];
  isLoading: boolean;
  error: string | null;
  onCardsChange: (cards: SavedCollectionCard[]) => void;
  onScanCard: () => void;
}) {
  const [query, setQuery] = useState("");
  const [sport, setSport] = useState("all");
  const [filter, setFilter] = useState<CollectionFilter>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<FieldKey, FieldValue> | null>(null);
  const [gradingDraft, setGradingDraft] = useState<GradingProfile | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [marketCardId, setMarketCardId] = useState<string | null>(null);
  const [marketSnapshot, setMarketSnapshot] =
    useState<ActiveMarketSnapshot | null>(null);
  const [marketBusy, setMarketBusy] = useState(false);
  const [marketError, setMarketError] = useState<string | null>(null);
  const marketRequestIdRef = useRef(0);
  const [soldCardId, setSoldCardId] = useState<string | null>(null);
  const [soldSnapshot, setSoldSnapshot] = useState<SoldCompsSnapshot | null>(null);
  const [soldBusy, setSoldBusy] = useState(false);
  const [soldError, setSoldError] = useState<string | null>(null);
  const soldRequestIdRef = useRef(0);

  const sports = useMemo(
    () =>
      Array.from(
        new Set(
          cards
            .map((card) => card.fields.sport)
            .filter((value): value is string => typeof value === "string"),
        ),
      ).sort(),
    [cards],
  );

  const filteredCards = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return cards.filter(
      (card) =>
        (!normalizedQuery || searchableText(card).includes(normalizedQuery)) &&
        (sport === "all" || card.fields.sport === sport) &&
        matchesFilter(card, filter),
    );
  }, [cards, filter, query, sport]);

  const beginEdit = (card: SavedCollectionCard) => {
    marketRequestIdRef.current += 1;
    setMarketCardId(null);
    setMarketSnapshot(null);
    setMarketBusy(false);
    setMarketError(null);
    soldRequestIdRef.current += 1;
    setSoldCardId(null);
    setSoldSnapshot(null);
    setSoldBusy(false);
    setSoldError(null);
    setEditingId(card.collectionId);
    setDraft(createDraft(card));
    setGradingDraft({ ...card.grading });
    setActionError(null);
  };

  const loadActiveMarket = async (card: SavedCollectionCard) => {
    if (marketBusy || soldBusy) return;
    soldRequestIdRef.current += 1;
    setSoldCardId(null);
    setSoldSnapshot(null);
    setSoldBusy(false);
    setSoldError(null);
    const requestId = ++marketRequestIdRef.current;
    setMarketCardId(card.collectionId);
    setMarketSnapshot(null);
    setMarketError(null);
    setMarketBusy(true);
    try {
      const response = await fetch(
        `/api/collection/${encodeURIComponent(card.collectionId)}/active-market`,
      );
      const payload = (await response.json().catch(() => null)) as
        | (ActiveMarketSnapshot & { error?: string })
        | { error?: string }
        | null;
      if (requestId !== marketRequestIdRef.current) return;
      if (!response.ok || !payload || !("groups" in payload)) {
        throw new Error(
          payload?.error ?? "CardPilot could not search active eBay listings.",
        );
      }
      setMarketSnapshot(payload);
    } catch (caughtError) {
      if (requestId !== marketRequestIdRef.current) return;
      setMarketError(
        caughtError instanceof Error
          ? caughtError.message
          : "CardPilot could not search active eBay listings.",
      );
    } finally {
      if (requestId === marketRequestIdRef.current) {
        setMarketBusy(false);
      }
    }
  };

  const toggleActiveMarket = (card: SavedCollectionCard) => {
    if (marketBusy || soldBusy) return;
    if (marketCardId === card.collectionId) {
      marketRequestIdRef.current += 1;
      setMarketCardId(null);
      setMarketSnapshot(null);
      setMarketError(null);
    } else {
      void loadActiveMarket(card);
    }
  };

  const loadSoldComps = async (card: SavedCollectionCard) => {
    if (soldBusy || marketBusy) return;
    marketRequestIdRef.current += 1;
    setMarketCardId(null);
    setMarketSnapshot(null);
    setMarketBusy(false);
    setMarketError(null);
    const requestId = ++soldRequestIdRef.current;
    setSoldCardId(card.collectionId);
    setSoldSnapshot(null);
    setSoldError(null);
    setSoldBusy(true);
    try {
      const response = await fetch(
        `/api/collection/${encodeURIComponent(card.collectionId)}/sold-comps`,
      );
      const payload = (await response.json().catch(() => null)) as
        | (SoldCompsSnapshot & { error?: string })
        | { error?: string }
        | null;
      if (requestId !== soldRequestIdRef.current) return;
      if (!response.ok || !payload || !("groups" in payload)) {
        throw new Error(
          payload?.error ?? "CardPilot could not search completed sales.",
        );
      }
      setSoldSnapshot(payload);
    } catch (caughtError) {
      if (requestId !== soldRequestIdRef.current) return;
      setSoldError(
        caughtError instanceof Error
          ? caughtError.message
          : "CardPilot could not search completed sales.",
      );
    } finally {
      if (requestId === soldRequestIdRef.current) setSoldBusy(false);
    }
  };

  const toggleSoldComps = (card: SavedCollectionCard) => {
    if (soldBusy || marketBusy) return;
    if (soldCardId === card.collectionId) {
      soldRequestIdRef.current += 1;
      setSoldCardId(null);
      setSoldSnapshot(null);
      setSoldError(null);
    } else {
      void loadSoldComps(card);
    }
  };

  const saveEdit = async (card: SavedCollectionCard) => {
    if (!draft || !gradingDraft || busyId) return;
    if (
      gradingDraft.isGraded &&
      (!gradingDraft.company?.trim() || !gradingDraft.grade?.trim())
    ) {
      setActionError(
        "Choose the grading company and enter the grade before saving.",
      );
      return;
    }
    setBusyId(card.collectionId);
    setActionError(null);
    try {
      const response = await fetch(
        `/api/collection/${encodeURIComponent(card.collectionId)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fields: draft, grading: gradingDraft }),
        },
      );
      const payload = (await response.json().catch(() => null)) as
        | { card?: SavedCollectionCard; error?: string }
        | null;
      if (!response.ok || !payload?.card) {
        throw new Error(payload?.error ?? "CardPilot could not update this card.");
      }
      onCardsChange(
        cards.map((item) =>
          item.collectionId === payload.card?.collectionId ? payload.card : item,
        ),
      );
      setEditingId(null);
      setDraft(null);
      setGradingDraft(null);
    } catch (caughtError) {
      setActionError(
        caughtError instanceof Error
          ? caughtError.message
          : "CardPilot could not update this card.",
      );
    } finally {
      setBusyId(null);
    }
  };

  const removeCard = async (card: SavedCollectionCard) => {
    if (
      busyId ||
      !window.confirm(`Remove ${card.title} from your CardPilot collection?`)
    ) {
      return;
    }

    setBusyId(card.collectionId);
    setActionError(null);
    try {
      const response = await fetch(
        `/api/collection/${encodeURIComponent(card.collectionId)}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error ?? "CardPilot could not remove this card.");
      }
      onCardsChange(
        cards.filter((item) => item.collectionId !== card.collectionId),
      );
    } catch (caughtError) {
      setActionError(
        caughtError instanceof Error
          ? caughtError.message
          : "CardPilot could not remove this card.",
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="collection-section" aria-labelledby="collection-title">
      <div className="collection-heading">
        <div>
          <span className="step-label">My Collection</span>
          <h1 id="collection-title">Your cards, ready when you are.</h1>
          <p>
            Search confirmed details, review card photos, and keep numbered,
            rookie, and autograph cards easy to find.
          </p>
        </div>
        <button className="secondary-button" type="button" onClick={onScanCard}>
          Scan another card
        </button>
      </div>

      <div className="collection-summary" aria-label="Collection summary">
        <div><strong>{cards.length}</strong><span>Total cards</span></div>
        <div><strong>{cards.filter((card) => card.fields.serialNumber).length}</strong><span>Numbered</span></div>
        <div><strong>{cards.filter((card) => card.fields.autograph === true).length}</strong><span>Autographs</span></div>
        <div><strong>{cards.filter((card) => card.fields.rookieStatus === true).length}</strong><span>Rookies</span></div>
      </div>

      <div className="collection-toolbar">
        <label>
          <span>Search collection</span>
          <input
            type="search"
            value={query}
            placeholder="Player, year, set, card number..."
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label>
          <span>Sport</span>
          <select value={sport} onChange={(event) => setSport(event.target.value)}>
            <option value="all">All sports</option>
            {sports.map((value) => <option key={value}>{value}</option>)}
          </select>
        </label>
        <label>
          <span>Card type</span>
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value as CollectionFilter)}
          >
            <option value="all">All cards</option>
            <option value="numbered">Numbered cards</option>
            <option value="autograph">Autographs</option>
            <option value="rookie">Rookies</option>
          </select>
        </label>
      </div>

      {(error || actionError) && (
        <div className="error-banner" role="alert">
          <strong>Collection action interrupted.</strong>
          <span>{actionError ?? error}</span>
        </div>
      )}

      {isLoading ? (
        <div className="collection-empty"><span className="spinner" /> Loading your collection...</div>
      ) : cards.length === 0 ? (
        <div className="collection-empty">
          <strong>Your collection is ready for its first card.</strong>
          <span>Choose a card photo, review the identification, and confirm it.</span>
          <button className="secondary-button" type="button" onClick={onScanCard}>Scan a card</button>
        </div>
      ) : filteredCards.length === 0 ? (
        <div className="collection-empty">
          <strong>No cards match those filters.</strong>
          <span>Try a broader search or choose All cards.</span>
        </div>
      ) : (
        <div className="collection-grid">
          {filteredCards.map((card) => {
            const isEditing = editingId === card.collectionId && draft;
            const isMarketOpen = marketCardId === card.collectionId;
            const isSoldOpen = soldCardId === card.collectionId;
            return (
              <article
                className={`collection-card${isMarketOpen || isSoldOpen ? " collection-card-expanded" : ""}`}
                key={card.collectionId}
              >
                <div className="collection-card-image">
                  <img src={card.images.frontUrl} alt={`Front of ${card.title}`} />
                  {card.fields.serialNumber && <span>Numbered {card.fields.serialNumber}</span>}
                </div>
                {isEditing ? (
                  <div className="collection-editor">
                    <h2>Edit saved card</h2>
                    <div className="collection-editor-grid">
                      {fieldDefinitions.map((definition) => (
                        <label key={definition.key}>
                          <span>{definition.label}</span>
                          {definition.kind === "boolean" ? (
                            <select
                              value={draft[definition.key] === null ? "unknown" : String(draft[definition.key])}
                              onChange={(event) =>
                                setDraft({
                                  ...draft,
                                  [definition.key]: event.target.value === "unknown" ? null : event.target.value === "true",
                                })
                              }
                            >
                              <option value="unknown">Unknown</option>
                              <option value="true">Yes</option>
                              <option value="false">No</option>
                            </select>
                          ) : (
                            <input
                              value={String(draft[definition.key] ?? "")}
                              placeholder="Unknown"
                              onChange={(event) =>
                                setDraft({
                                  ...draft,
                                  [definition.key]: event.target.value.trimStart() || null,
                                })
                              }
                            />
                          )}
                        </label>
                      ))}
                    </div>
                    {gradingDraft && (
                      <section className="grading-editor" aria-labelledby={`grading-${card.collectionId}`}>
                        <div className="grading-editor-heading">
                          <div>
                            <span>Condition profile</span>
                            <h3 id={`grading-${card.collectionId}`}>
                              {gradingDraft.isGraded ? "Graded card" : "Raw / ungraded"}
                            </h3>
                            <p>
                              Most cards stay raw. Turn this on only when the card is in a grading-company slab.
                            </p>
                          </div>
                          <button
                            type="button"
                            className={`grading-toggle${gradingDraft.isGraded ? " grading-toggle-on" : ""}`}
                            aria-pressed={gradingDraft.isGraded}
                            onClick={() =>
                              setGradingDraft(
                                gradingDraft.isGraded
                                  ? {
                                      isGraded: false,
                                      company: null,
                                      grade: null,
                                      certificationNumber: null,
                                    }
                                  : {
                                      isGraded: true,
                                      company: null,
                                      grade: null,
                                      certificationNumber: null,
                                    },
                              )
                            }
                          >
                            <span aria-hidden="true" />
                            {gradingDraft.isGraded ? "Graded on" : "This card is graded"}
                          </button>
                        </div>
                        {gradingDraft.isGraded && (
                          <div className="grading-fields">
                            <label>
                              <span>Grading company</span>
                              <select
                                value={gradingDraft.company ?? ""}
                                onChange={(event) =>
                                  setGradingDraft({
                                    ...gradingDraft,
                                    company: event.target.value || null,
                                  })
                                }
                              >
                                <option value="">Choose company</option>
                                <option value="PSA">PSA</option>
                                <option value="BGS">BGS / Beckett</option>
                                <option value="SGC">SGC</option>
                                <option value="CGC">CGC</option>
                                <option value="CSG">CSG</option>
                                <option value="TAG">TAG</option>
                                <option value="HGA">HGA</option>
                                <option value="Other">Other</option>
                              </select>
                            </label>
                            <label>
                              <span>Grade</span>
                              <input
                                value={gradingDraft.grade ?? ""}
                                placeholder="Example: 10"
                                inputMode="decimal"
                                maxLength={20}
                                onChange={(event) =>
                                  setGradingDraft({
                                    ...gradingDraft,
                                    grade: event.target.value.trimStart() || null,
                                  })
                                }
                              />
                            </label>
                            <label>
                              <span>Certification number (optional)</span>
                              <input
                                value={gradingDraft.certificationNumber ?? ""}
                                placeholder="Slab certification number"
                                maxLength={80}
                                onChange={(event) =>
                                  setGradingDraft({
                                    ...gradingDraft,
                                    certificationNumber:
                                      event.target.value.trimStart() || null,
                                  })
                                }
                              />
                            </label>
                          </div>
                        )}
                      </section>
                    )}
                    <div className="collection-card-actions">
                      <button type="button" disabled={busyId !== null} onClick={() => void saveEdit(card)}>
                        {busyId === card.collectionId ? "Saving..." : "Save changes"}
                      </button>
                      <button type="button" onClick={() => { setEditingId(null); setDraft(null); setGradingDraft(null); }}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="collection-card-body">
                    <div>
                      <span>{card.fields.sport ?? "Sports card"}</span>
                      <h2>{card.title}</h2>
                    </div>
                    <dl>
                      <div><dt>Card number</dt><dd>{formatFieldValue(card.fields.cardNumber)}</dd></div>
                      <div><dt>Parallel</dt><dd>{formatFieldValue(card.fields.parallel)}</dd></div>
                      <div><dt>Numbered card</dt><dd>{card.fields.serialNumber ? "Yes" : "No"}</dd></div>
                      <div><dt>Serial</dt><dd>{formatFieldValue(card.fields.serialNumber)}</dd></div>
                      <div>
                        <dt>Condition</dt>
                        <dd>
                          {card.grading.isGraded
                            ? `${card.grading.company} ${card.grading.grade}`
                            : "Raw / ungraded"}
                        </dd>
                      </div>
                    </dl>
                    <div className="collection-card-flags">
                      {card.fields.rookieStatus === true && <span>Rookie</span>}
                      {card.fields.autograph === true && <span>Autograph</span>}
                      {card.fields.memorabilia === true && <span>Memorabilia</span>}
                    </div>
                    <small>Updated {new Date(card.updatedAt).toLocaleDateString()}</small>
                    <div className="collection-card-actions">
                      <button type="button" onClick={() => beginEdit(card)}>Edit details</button>
                      <button
                        type="button"
                        disabled={marketBusy || soldBusy}
                        onClick={() => toggleActiveMarket(card)}
                      >
                        {isMarketOpen ? "Close market" : "Check active market"}
                      </button>
                      <button
                        type="button"
                        disabled={soldBusy || marketBusy}
                        onClick={() => toggleSoldComps(card)}
                      >
                        {isSoldOpen ? "Close sold comps" : "Check sold comps"}
                      </button>
                      <button type="button" disabled={busyId !== null} onClick={() => void removeCard(card)}>
                        {busyId === card.collectionId ? "Removing..." : "Remove"}
                      </button>
                    </div>
                  </div>
                )}
                {isMarketOpen && !isEditing && (
                  <ActiveMarketPanel
                    card={card}
                    snapshot={marketSnapshot}
                    isLoading={marketBusy}
                    error={marketError}
                    onRetry={() => void loadActiveMarket(card)}
                  />
                )}
                {isSoldOpen && !isEditing && (
                  <SoldCompsPanel
                    card={card}
                    snapshot={soldSnapshot}
                    isLoading={soldBusy}
                    error={soldError}
                    onRetry={() => void loadSoldComps(card)}
                  />
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
