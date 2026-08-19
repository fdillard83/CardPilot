import { useEffect, useMemo, useRef, useState } from "react";
import type { AccountPreferences } from "../accounts/preferences";
import { EbayListingDraft } from "../selling/EbayListingDraft";
import { EbayListingQueue } from "../selling/EbayListingQueue";
import {
  cardCategoryLabel,
  cardKindFromFields,
  deriveValuationProfile,
  fieldDefinitionsFor,
  fieldLabelFor,
  formatFieldValue,
  valuationFeatureOptions,
  type ActiveMarketSnapshot,
  type ActiveMarketListing,
  type EbayItemDetails,
  type FieldKey,
  type FieldValue,
  type GradingProfile,
  type SavedCollectionCard,
  type SoldCompsSnapshot,
  type SoldComparable,
  type ValuationProfile,
  type ValuationMethod,
  type ValuationRecommendationSnapshot,
  type VariantAdjustedEstimate,
} from "../identification/types";
import {
  BulkValuationReview,
  CardValuationPanel,
  type BulkValuationResult,
} from "./ValuationWorkflow";
import {
  valuationIsStale,
  valuationMethodLabel,
} from "./valuation-utils";
import {
  fetchJsonWithTransientRetry,
  pricingCacheContext,
  readPricingSnapshot,
  writePricingSnapshot,
} from "./pricing-resilience";

type CollectionFilter =
  | "all"
  | "numbered"
  | "autograph"
  | "rookie"
  | "listed"
  | "sold"
  | "unvalued"
  | "stale";
type CollectionSort = "newest" | "oldest" | "value-high" | "value-low" | "title-az" | "title-za";

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
  if (filter === "listed") return card.selling?.status === "published";
  if (filter === "sold") return card.selling?.status === "sold";
  if (filter === "unvalued") return card.confirmedValuation === null;
  if (filter === "stale") return valuationIsStale(card);
  return true;
}

function ebayCardActionLabel(card: SavedCollectionCard) {
  if (card.selling?.status === "published") return "View / edit eBay listing";
  if (card.selling?.status === "sold") return "View sold eBay listing";
  if (card.selling?.status === "ended") return "View ended eBay listing";
  if (card.selling?.status === "draft") return "Review eBay draft";
  return "Sell on eBay";
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

function pricingSnapshotUrl(path: string, excludedAnchorIds: string[]) {
  if (excludedAnchorIds.length === 0) return path;
  const params = new URLSearchParams();
  excludedAnchorIds.forEach((id) => params.append("exclude", id));
  return `${path}?${params.toString()}`;
}

function amountInputFromCents(amountCents: number) {
  return (amountCents / 100).toFixed(2);
}

function amountCentsFromInput(value: string) {
  if (!value.trim()) return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.round(amount * 100);
}

function waitForNextPricingRequest(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function fetchValuationRecommendation(
  card: SavedCollectionCard,
  {
    soldExcludedObservationIds = [],
    activeExcludedObservationIds = [],
  }: {
    soldExcludedObservationIds?: string[];
    activeExcludedObservationIds?: string[];
  } = {},
) {
  const params = new URLSearchParams();
  soldExcludedObservationIds.forEach((id) => params.append("excludeSold", id));
  activeExcludedObservationIds.forEach((id) =>
    params.append("excludeActive", id),
  );
  const query = params.toString();
  const { response, payload } = await fetchJsonWithTransientRetry<
    | (ValuationRecommendationSnapshot & { error?: string })
    | { error?: string }
  >(
    `/api/collection/${encodeURIComponent(card.collectionId)}/valuation${query ? `?${query}` : ""}`,
  );
  if (
    !response.ok ||
    !payload ||
    !("kind" in payload) ||
    payload.kind !== "card_valuation_recommendation"
  ) {
    throw new Error(
      payload?.error ?? "CardPilot could not prepare a valuation recommendation.",
    );
  }
  return payload;
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

function featureProfileLabel(profile: ValuationProfile) {
  return (
    valuationFeatureOptions.find(
      (option) => option.value === profile.featureType,
    )?.label ?? "Feature profile not confirmed"
  );
}

function formatFactor(value: number) {
  if (value >= 10) return `${Math.round(value)}×`;
  if (value >= 1) return `${value.toFixed(1).replace(/\.0$/, "")}×`;
  return `${value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}×`;
}

function isExactSerialNumber(value: FieldValue) {
  return typeof value === "string" && /^\s*\d{1,3}\s*\/\s*\d{1,5}\s*$/.test(value);
}

function soldSuggestionFields(card: SavedCollectionCard, sale: SoldComparable) {
  const fields: Partial<Record<FieldKey, FieldValue>> = {};
  const suggestions = sale.suggestions ?? {
    character: null,
    setOrInsert: null,
    year: null,
    cardNumber: null,
    parallel: null,
    serialNumber: null,
    language: null,
    rarity: null,
    finish: null,
    promo: null,
  };
  const supported: Array<[FieldKey, FieldValue]> = [
    ["character", suggestions.character],
    ["setOrInsert", suggestions.setOrInsert],
    ["year", suggestions.year],
    ["cardNumber", suggestions.cardNumber],
    ["parallel", suggestions.parallel],
    ["language", suggestions.language],
    ["rarity", suggestions.rarity],
    ["finish", suggestions.finish],
    ["promo", suggestions.promo],
  ];
  for (const [key, value] of supported) {
    if (value !== null) fields[key] = value;
  }
  if (
    suggestions.serialNumber &&
    !isExactSerialNumber(card.fields.serialNumber)
  ) {
    fields.serialNumber = suggestions.serialNumber;
  }
  return fields;
}

function ebaySuggestionFields(
  card: SavedCollectionCard,
  details: EbayItemDetails | null,
) {
  const fields: Partial<Record<FieldKey, FieldValue>> = {};
  if (!details) return fields;
  const supported: Array<[FieldKey, FieldValue]> = [
    ["character", details.suggestions.character],
    ["setOrInsert", details.suggestions.setOrInsert],
    ["year", details.suggestions.year],
    ["cardNumber", details.suggestions.cardNumber],
    ["parallel", details.suggestions.parallel],
    ["language", details.suggestions.language],
    ["rarity", details.suggestions.rarity],
    ["finish", details.suggestions.finish],
    ["promo", details.suggestions.promo],
  ];
  for (const [key, value] of supported) {
    if (value !== null) fields[key] = value;
  }
  if (
    details.suggestions.serialNumber &&
    !isExactSerialNumber(card.fields.serialNumber)
  ) {
    fields.serialNumber = details.suggestions.serialNumber;
  }
  return fields;
}

function PricingExclusionControls({
  excludedCount,
  onRestore,
}: {
  excludedCount: number;
  onRestore: () => void;
}) {
  if (excludedCount === 0) return null;
  return (
    <div className="variant-anchor-controls" role="status">
      <span>
        {excludedCount} comparison{excludedCount === 1 ? " is" : "s are"}
        excluded from these pricing results for the current session.
      </span>
      <button type="button" onClick={onRestore}>
        Restore all
      </button>
    </div>
  );
}

function PricingSnapshotStatus({
  provider,
  timestamp,
  showingPrevious,
}: {
  provider: string;
  timestamp: string;
  showingPrevious: boolean;
}) {
  return (
    <div
      className={`pricing-snapshot-status${showingPrevious ? " pricing-snapshot-status-previous" : ""}`}
      role="status"
    >
      <strong>{showingPrevious ? "Previously retrieved result" : "Latest result"}</strong>
      <span>
        {provider} · Last successful update {new Date(timestamp).toLocaleString()}
      </span>
    </div>
  );
}

function UpdatedRecommendationNotice({
  excludedCount,
  snapshot,
  isLoading,
  error,
  onReview,
}: {
  excludedCount: number;
  snapshot: ValuationRecommendationSnapshot | null;
  isLoading: boolean;
  error: string | null;
  onReview: () => void;
}) {
  if (excludedCount === 0) return null;
  const recommendation = snapshot?.recommendation ?? null;
  return (
    <div className="updated-recommendation" aria-live="polite">
      {isLoading ? (
        <span><span className="spinner" /> Recalculating the CardPilot recommendation...</span>
      ) : error ? (
        <span>The comparison results were updated, but the recommendation could not be recalculated: {error}</span>
      ) : recommendation ? (
        <>
          <div>
            <span>Updated CardPilot recommendation</span>
            <strong>
              {formatPrice(recommendation.amountCents, recommendation.currency)}
            </strong>
            <small>
              {recommendation.methodLabel} · {recommendation.confidence} confidence
            </small>
          </div>
          <button type="button" onClick={onReview}>Review and confirm</button>
        </>
      ) : (
        <span>No reliable estimate remains after the selected comparisons were excluded.</span>
      )}
    </div>
  );
}

function VariantEstimateSection({
  estimates,
  context,
  onExcludeAnchor,
}: {
  estimates: VariantAdjustedEstimate[];
  context: "sold" | "active";
  onExcludeAnchor: (observationId: string) => void;
}) {
  if (estimates.length === 0) return null;
  return (
    <section className="variant-estimates" aria-label="Variant-adjusted estimates">
      <div className="variant-estimate-intro">
        <div>
          <span>CardPilot fallback model</span>
          <h4>Variant-adjusted estimate</h4>
        </div>
        <span>Modeled, not an exact comp</span>
      </div>
      <p>
        Exact pricing is scarce, so CardPilot adjusted comparable {context === "sold" ? "completed sales" : "active asking prices"} using the serial-tier and card-feature ranges you supplied.
      </p>
      <div className="variant-estimate-grid">
        {estimates.map((estimate, index) => (
          <article className="variant-estimate" key={estimate.id}>
            <div className="variant-estimate-heading">
              <div>
                <span>{index === 0 ? "Best available anchor" : "Additional anchor"}</span>
                <strong>
                  {estimate.sourceProfile.serialLabel} · {estimate.sourceProfile.featureLabel}
                </strong>
              </div>
              <span className={`market-confidence market-confidence-${estimate.confidence}`}>
                {estimate.confidence === "medium" ? "Useful estimate" : "Limited estimate"}
              </span>
            </div>
            <div className="variant-lineage-evidence">
              <span>
                Same player <strong>{estimate.lineageEvidence.player}</strong>
              </span>
              <span>
                Matched card family <strong>{estimate.lineageEvidence.familyLabel}</strong>
              </span>
            </div>
            <div className="variant-estimate-price">
              <span>Estimated {estimate.targetProfile.serialLabel} value</span>
              <strong>{formatPrice(estimate.estimatedAmountCents, estimate.currency)}</strong>
              <small>
                Modeled range {formatPrice(estimate.estimatedRange.lowAmountCents, estimate.currency)}–{formatPrice(estimate.estimatedRange.highAmountCents, estimate.currency)}
              </small>
            </div>
            <div className="variant-thumbnail-row" aria-label="Source card photos">
              {estimate.sourceObservations.slice(0, 4).map((observation) =>
                observation.imageUrl ? (
                  <img
                    src={observation.imageUrl}
                    alt=""
                    key={observation.id}
                  />
                ) : (
                  <span
                    className="variant-thumbnail-placeholder"
                    aria-hidden="true"
                    key={observation.id}
                  >
                    No photo
                  </span>
                ),
              )}
            </div>
            <div className="variant-estimate-source">
              <span>
                Based on {estimate.sourceCount} {estimate.platform} {context === "sold" ? "sale" : "listing"}{estimate.sourceCount === 1 ? "" : "s"}
              </span>
              <strong>
                Source median {formatPrice(estimate.sourceMedianAmountCents, estimate.currency)}
              </strong>
            </div>
            <div className="variant-calculation">
              <span>How CardPilot calculated it</span>
              <strong>
                {formatPrice(estimate.sourceMedianAmountCents, estimate.currency)}
                {" × "}
                {estimate.combinedFactor.midpoint.toFixed(2)}
                {" = "}
                {formatPrice(estimate.estimatedAmountCents, estimate.currency)}
              </strong>
              <small>
                {estimate.direction === "up"
                  ? "Adjusted upward"
                  : estimate.direction === "down"
                    ? "Adjusted downward"
                    : "Similar-value adjustment"}
                {` from ${estimate.sourceProfile.serialLabel} to ${estimate.targetProfile.serialLabel}`}
              </small>
            </div>
            <div className="variant-adjustments">
              {estimate.appliedAdjustments.map((adjustment) => (
                <div key={adjustment.dimension}>
                  <span>{adjustment.dimension === "serial" ? "Serial adjustment" : "Feature adjustment"}</span>
                  <strong>{adjustment.sourceLabel} → {adjustment.targetLabel}</strong>
                  <small>
                    Central {formatFactor(adjustment.midpointFactor)} · modeled range {formatFactor(adjustment.lowFactor)}–{formatFactor(adjustment.highFactor)}
                  </small>
                </div>
              ))}
            </div>
            <div className="variant-sources">
              <div className="variant-sources-heading">
                <strong>Pricing anchors used</strong>
                <span>Remove any source that does not match your card.</span>
              </div>
              <div>
                {estimate.sourceObservations.map((observation) => {
                  return (
                    <div className="variant-source-item" key={observation.id}>
                      {observation.imageUrl ? (
                        <img src={observation.imageUrl} alt="" />
                      ) : (
                        <span className="variant-source-placeholder" aria-hidden="true">
                          No photo
                        </span>
                      )}
                      <span className="variant-source-copy">
                        {observation.url ? (
                          <a
                            className="variant-source-title"
                            href={observation.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <strong>{observation.title}</strong>
                          </a>
                        ) : (
                          <strong>{observation.title}</strong>
                        )}
                        <em>{formatPrice(observation.amountCents, observation.currency)}</em>
                      </span>
                      <button
                        type="button"
                        className="variant-remove-anchor"
                        onClick={() => onExcludeAnchor(observation.id)}
                        aria-label={`Remove ${observation.title} as a pricing anchor`}
                      >
                        Remove anchor
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </article>
        ))}
      </div>
      <p className="variant-estimate-warning">
        Parallel design, player demand, condition, and marketplace behavior can outweigh these general multipliers. Verify the source cards before using an estimate to buy or sell.
      </p>
    </section>
  );
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
  showingPrevious,
  onRetry,
  excludedAnchorCount,
  onExcludeAnchor,
  onRestoreAnchors,
  updatedRecommendation,
  isRecommendationUpdating,
  recommendationError,
  onReviewRecommendation,
  selectedMatchId,
  confirmedMatchId,
  isLoadingMatch,
  isConfirmingMatch,
  matchError,
  matchDetails,
  onSelectMatch,
  onConfirmMatch,
}: {
  card: SavedCollectionCard;
  snapshot: ActiveMarketSnapshot | null;
  isLoading: boolean;
  error: string | null;
  showingPrevious: boolean;
  onRetry: () => void;
  excludedAnchorCount: number;
  onExcludeAnchor: (observationId: string) => void;
  onRestoreAnchors: () => void;
  updatedRecommendation: ValuationRecommendationSnapshot | null;
  isRecommendationUpdating: boolean;
  recommendationError: string | null;
  onReviewRecommendation: () => void;
  selectedMatchId: string | null;
  confirmedMatchId: string | null;
  isLoadingMatch: boolean;
  isConfirmingMatch: boolean;
  matchError: string | null;
  matchDetails: EbayItemDetails | null;
  onSelectMatch: (listing: ActiveMarketListing | null) => void;
  onConfirmMatch: (listing: ActiveMarketListing) => void;
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
          <strong>
            {snapshot
              ? "eBay refresh failed—showing previously retrieved listings."
              : "eBay active listings are unavailable."}
          </strong>
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
          <PricingSnapshotStatus
            provider="eBay active market"
            timestamp={snapshot.searchedAt}
            showingPrevious={showingPrevious}
          />
          <div className="market-summary">
            <div>
              <span>{snapshot.queriesUsed.length > 1 ? "Searches used" : "Search used"}</span>
              <strong>{snapshot.queriesUsed.join(" · ")}</strong>
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

          <PricingExclusionControls
            excludedCount={excludedAnchorCount}
            onRestore={onRestoreAnchors}
          />

          <UpdatedRecommendationNotice
            excludedCount={excludedAnchorCount}
            snapshot={updatedRecommendation}
            isLoading={isRecommendationUpdating}
            error={recommendationError}
            onReview={onReviewRecommendation}
          />

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

          <VariantEstimateSection
            estimates={snapshot.variantEstimates}
            context="active"
            onExcludeAnchor={onExcludeAnchor}
          />

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
                      const isSelected = selectedMatchId === listing.itemId;
                      const isConfirmed = confirmedMatchId === listing.itemId;
                      const suggestedFields = isSelected
                        ? ebaySuggestionFields(card, matchDetails)
                        : {};
                      const suggestionEntries = Object.entries(suggestedFields) as Array<
                        [FieldKey, FieldValue]
                      >;
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
                      return (
                        <div className="market-listing-shell" key={listing.itemId}>
                          {listing.itemWebUrl ? (
                            <a
                              className="market-listing"
                              href={listing.itemWebUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {listingContents}
                            </a>
                          ) : (
                            <div className="market-listing">{listingContents}</div>
                          )}
                          <button
                            type="button"
                            className="market-remove-anchor"
                            onClick={() => onExcludeAnchor(listing.itemId)}
                            aria-label={`Exclude ${listing.title} from pricing results`}
                          >
                            Exclude from pricing
                          </button>
                          {!isConfirmed && (
                            <button
                              type="button"
                              className="market-match-card"
                              disabled={isConfirmingMatch}
                              onClick={() => onSelectMatch(isSelected ? null : listing)}
                            >
                              {isSelected ? "Cancel selection" : "This looks like my card"}
                            </button>
                          )}
                          {isSelected && !isConfirmed && (
                            <div className="market-match-confirmation">
                              <strong>Confirm this active listing matches your card?</strong>
                              {isLoadingMatch ? (
                                <span>Loading the seller-provided card details...</span>
                              ) : matchError ? (
                                <span>{matchError}</span>
                              ) : suggestionEntries.length > 0 ? (
                                <>
                                  <span>CardPilot will update these details:</span>
                                  <div className="ebay-suggestions">
                                    {suggestionEntries.map(([key, value]) => (
                                      <span key={key}>
                                        {fieldLabelFor(key, card.fields)}: {formatFieldValue(value)}
                                      </span>
                                    ))}
                                  </div>
                                </>
                              ) : (
                                <span>The listing confirms the visual match, but has no additional safe details to apply.</span>
                              )}
                              <button
                                type="button"
                                disabled={isLoadingMatch || isConfirmingMatch || Boolean(matchError)}
                                onClick={() => onConfirmMatch(listing)}
                              >
                                {isConfirmingMatch ? "Updating card..." : "Confirm match and update card"}
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="valuation-loading">
              {snapshot.variantEstimates.length > 0
                ? "No exact active matches were found. The modeled estimate above uses other versions of the same card family."
                : "No close fixed-price matches were found. More complete card details can improve the search."}
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
  showingPrevious,
  onRetry,
  excludedAnchorCount,
  onExcludeAnchor,
  onRestoreAnchors,
  updatedRecommendation,
  isRecommendationUpdating,
  recommendationError,
  onReviewRecommendation,
  selectedMatchId,
  confirmedMatchId,
  isConfirmingMatch,
  onSelectMatch,
  onConfirmMatch,
}: {
  card: SavedCollectionCard;
  snapshot: SoldCompsSnapshot | null;
  isLoading: boolean;
  error: string | null;
  showingPrevious: boolean;
  onRetry: () => void;
  excludedAnchorCount: number;
  onExcludeAnchor: (observationId: string) => void;
  onRestoreAnchors: () => void;
  updatedRecommendation: ValuationRecommendationSnapshot | null;
  isRecommendationUpdating: boolean;
  recommendationError: string | null;
  onReviewRecommendation: () => void;
  selectedMatchId: string | null;
  confirmedMatchId: string | null;
  isConfirmingMatch: boolean;
  onSelectMatch: (sale: SoldComparable | null) => void;
  onConfirmMatch: (sale: SoldComparable) => void;
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
          <strong>
            {snapshot
              ? "The Card API refresh failed—showing previously retrieved sales."
              : "The Card API completed sales are unavailable."}
          </strong>
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
          <PricingSnapshotStatus
            provider="The Card API sold comps"
            timestamp={snapshot.searchedAt}
            showingPrevious={showingPrevious}
          />
          <div className="market-summary sold-summary">
            <div>
              <span>{snapshot.queriesUsed.length > 1 ? "Searches used" : "Search used"}</span>
              <strong>{snapshot.queriesUsed.join(" · ")}</strong>
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

          <PricingExclusionControls
            excludedCount={excludedAnchorCount}
            onRestore={onRestoreAnchors}
          />

          <UpdatedRecommendationNotice
            excludedCount={excludedAnchorCount}
            snapshot={updatedRecommendation}
            isLoading={isRecommendationUpdating}
            error={recommendationError}
            onReview={onReviewRecommendation}
          />

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

          <VariantEstimateSection
            estimates={snapshot.variantEstimates}
            context="sold"
            onExcludeAnchor={onExcludeAnchor}
          />

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
                      const isSelected = selectedMatchId === sale.id;
                      const isConfirmed = confirmedMatchId === sale.id;
                      const suggestedFields = soldSuggestionFields(card, sale);
                      const suggestionEntries = Object.entries(suggestedFields) as Array<
                        [FieldKey, FieldValue]
                      >;
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
                            {sale.matchTier === "exact" && sale.visualMatchStatus && sale.visualMatchStatus !== "matched" && (
                              <span className="market-broader-badge">Exact text match · photo not verified</span>
                            )}
                            {isConfirmed && (
                              <span className="market-reference-badge">Confirmed as your card</span>
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
                      return (
                        <div className="market-listing-shell" key={sale.id}>
                          {sale.listingUrl ? (
                            <a
                              className="market-listing sold-listing"
                              href={sale.listingUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {saleContents}
                            </a>
                          ) : (
                            <div className="market-listing sold-listing">
                              {saleContents}
                            </div>
                          )}
                          <button
                            type="button"
                            className="market-remove-anchor"
                            onClick={() => onExcludeAnchor(sale.id)}
                            aria-label={`Exclude ${sale.title} from pricing results`}
                          >
                            Exclude from pricing
                          </button>
                          {!isConfirmed && (
                            <button
                              type="button"
                              className="market-match-card"
                              disabled={isConfirmingMatch}
                              onClick={() => onSelectMatch(isSelected ? null : sale)}
                            >
                              {isSelected ? "Cancel selection" : "This looks like my card"}
                            </button>
                          )}
                          {isSelected && !isConfirmed && (
                            <div className="market-match-confirmation">
                              <strong>Confirm this completed sale matches your card?</strong>
                              {suggestionEntries.length > 0 ? (
                                <>
                                  <span>CardPilot will update these details:</span>
                                  <div className="ebay-suggestions">
                                    {suggestionEntries.map(([key, value]) => (
                                      <span key={key}>
                                        {fieldLabelFor(key, card.fields)}: {formatFieldValue(value)}
                                      </span>
                                    ))}
                                  </div>
                                </>
                              ) : (
                                <span>
                                  The sale confirms the visual match, but its title has no additional safe details to apply.
                                </span>
                              )}
                              <button
                                type="button"
                                disabled={isConfirmingMatch}
                                onClick={() => onConfirmMatch(sale)}
                              >
                                {isConfirmingMatch ? "Updating card..." : "Confirm match and update card"}
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="valuation-loading sold-empty">
              {snapshot.variantEstimates.length > 0
                ? "No exact completed sales were found. The modeled estimate above uses other versions of the same card family."
                : "No qualifying completed sales were found in the provider's current lookback window. That does not mean the card has no value."}
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
  accountPreferences,
}: {
  cards: SavedCollectionCard[];
  isLoading: boolean;
  error: string | null;
  onCardsChange: (cards: SavedCollectionCard[]) => void;
  onScanCard: () => void;
  accountPreferences: AccountPreferences;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [filter, setFilter] = useState<CollectionFilter>("all");
  const [sort, setSort] = useState<CollectionSort>("newest");
  const [expandedDetailIds, setExpandedDetailIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<FieldKey, FieldValue> | null>(null);
  const [gradingDraft, setGradingDraft] = useState<GradingProfile | null>(null);
  const [valuationDraft, setValuationDraft] =
    useState<ValuationProfile | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [automaticValueStatus, setAutomaticValueStatus] = useState<string | null>(null);
  const [expandedImageCard, setExpandedImageCard] =
    useState<SavedCollectionCard | null>(null);
  const [sellingCard, setSellingCard] = useState<SavedCollectionCard | null>(null);
  const [listingQueueOpen, setListingQueueOpen] = useState(false);
  const [marketCardId, setMarketCardId] = useState<string | null>(null);
  const [marketSnapshot, setMarketSnapshot] =
    useState<ActiveMarketSnapshot | null>(null);
  const [marketBusy, setMarketBusy] = useState(false);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [marketShowingPrevious, setMarketShowingPrevious] = useState(false);
  const [marketExcludedAnchorIds, setMarketExcludedAnchorIds] = useState<
    string[]
  >([]);
  const [selectedActiveMatchId, setSelectedActiveMatchId] = useState<string | null>(null);
  const [confirmedActiveMatchId, setConfirmedActiveMatchId] = useState<string | null>(null);
  const [activeMatchDetails, setActiveMatchDetails] = useState<EbayItemDetails | null>(null);
  const [activeMatchBusy, setActiveMatchBusy] = useState(false);
  const [activeMatchError, setActiveMatchError] = useState<string | null>(null);
  const marketRequestIdRef = useRef(0);
  const [soldCardId, setSoldCardId] = useState<string | null>(null);
  const [soldSnapshot, setSoldSnapshot] = useState<SoldCompsSnapshot | null>(null);
  const [soldBusy, setSoldBusy] = useState(false);
  const [soldError, setSoldError] = useState<string | null>(null);
  const [soldShowingPrevious, setSoldShowingPrevious] = useState(false);
  const [soldExcludedAnchorIds, setSoldExcludedAnchorIds] = useState<string[]>(
    [],
  );
  const [selectedSoldMatchId, setSelectedSoldMatchId] = useState<string | null>(null);
  const [confirmedSoldMatchId, setConfirmedSoldMatchId] = useState<string | null>(null);
  const [confirmingSoldMatchId, setConfirmingSoldMatchId] = useState<string | null>(null);
  const soldRequestIdRef = useRef(0);
  const [pricingSessionCardId, setPricingSessionCardId] = useState<
    string | null
  >(null);
  const [valuationCardId, setValuationCardId] = useState<string | null>(null);
  const [valuationSnapshot, setValuationSnapshot] =
    useState<ValuationRecommendationSnapshot | null>(null);
  const [valuationBusy, setValuationBusy] = useState(false);
  const [valuationSaving, setValuationSaving] = useState(false);
  const [valuationError, setValuationError] = useState<string | null>(null);
  const [valuationShowingPrevious, setValuationShowingPrevious] =
    useState(false);
  const [valuationAmountInput, setValuationAmountInput] = useState("");
  const [valuationCurrency, setValuationCurrency] = useState("USD");
  const [valuationConfidence, setValuationConfidence] = useState<
    "low" | "medium" | "high"
  >("low");
  const valuationRequestIdRef = useRef(0);
  const [bulkValuationResults, setBulkValuationResults] = useState<
    BulkValuationResult[]
  >([]);
  const [bulkSelectedIds, setBulkSelectedIds] = useState<string[]>([]);
  const [bulkCompletedCount, setBulkCompletedCount] = useState(0);
  const [bulkRefreshing, setBulkRefreshing] = useState(false);
  const [bulkApplying, setBulkApplying] = useState(false);
  const [bulkValuationError, setBulkValuationError] = useState<string | null>(
    null,
  );

  const refreshCollectionAfterSelling = async () => {
    setSellingCard(null);
    try {
      const response = await fetch("/api/collection");
      const payload = (await response.json().catch(() => null)) as { cards?: SavedCollectionCard[] } | null;
      if (response.ok && payload?.cards) onCardsChange(payload.cards);
    } catch {
      // The next normal collection refresh will reconcile eBay lifecycle labels.
    }
  };

  useEffect(() => {
    if (!expandedImageCard) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpandedImageCard(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [expandedImageCard]);

  const categories = useMemo(
    () =>
      Array.from(
        new Set(cards.map((card) => cardCategoryLabel(card.fields))),
      ).sort(),
    [cards],
  );

  const collectionValuation = useMemo(() => {
    const valuedCards = cards.filter((card) => card.confirmedValuation);
    const currencies = new Set(
      valuedCards.map((card) => card.confirmedValuation?.currency),
    );
    const currency = currencies.size === 1 ? [...currencies][0] : null;
    const totalAmountCents = valuedCards.reduce(
      (total, card) => total + (card.confirmedValuation?.amountCents ?? 0),
      0,
    );
    return {
      valuedCount: valuedCards.length,
      unvaluedCount: cards.length - valuedCards.length,
      staleCount: cards.filter((card) => valuationIsStale(card)).length,
      listedCount: cards.filter((card) => card.selling?.status === "published").length,
      soldCount: cards.filter((card) => card.selling?.status === "sold").length,
      soldTotalLabel: formatPrice(cards.reduce((total, card) => total + (card.selling?.soldAmountCents ?? 0), 0), "USD"),
      totalLabel:
        valuedCards.length === 0
          ? formatPrice(0, "USD")
          : currency
            ? formatPrice(totalAmountCents, currency)
            : "Mixed currencies",
    };
  }, [cards]);

  const filteredCards = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const matching = cards.filter(
      (card) =>
        (!normalizedQuery || searchableText(card).includes(normalizedQuery)) &&
        (category === "all" || cardCategoryLabel(card.fields) === category) &&
        matchesFilter(card, filter),
    );
    return matching.sort((left, right) => {
      if (sort === "oldest") return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
      if (sort === "title-az") return left.title.localeCompare(right.title);
      if (sort === "title-za") return right.title.localeCompare(left.title);
      if (sort === "value-high" || sort === "value-low") {
        const leftValue = left.confirmedValuation?.amountCents;
        const rightValue = right.confirmedValuation?.amountCents;
        if (leftValue == null && rightValue == null) return left.title.localeCompare(right.title);
        if (leftValue == null) return 1;
        if (rightValue == null) return -1;
        return sort === "value-high" ? rightValue - leftValue : leftValue - rightValue;
      }
      return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
    });
  }, [cards, category, filter, query, sort]);

  const closeValuationPanel = () => {
    valuationRequestIdRef.current += 1;
    setValuationCardId(null);
    setValuationSnapshot(null);
    setValuationBusy(false);
    setValuationSaving(false);
    setValuationError(null);
    setValuationShowingPrevious(false);
    setValuationAmountInput("");
    setValuationCurrency("USD");
    setValuationConfidence("low");
  };

  const hideValuationPanel = () => {
    valuationRequestIdRef.current += 1;
    setValuationCardId(null);
    setValuationBusy(false);
    setValuationSaving(false);
  };

  const beginEdit = (card: SavedCollectionCard) => {
    if (
      marketBusy ||
      soldBusy ||
      valuationBusy ||
      valuationSaving ||
      bulkRefreshing ||
      bulkApplying
    ) {
      return;
    }
    marketRequestIdRef.current += 1;
    setMarketCardId(null);
    setMarketSnapshot(null);
    setMarketBusy(false);
    setMarketError(null);
    setMarketShowingPrevious(false);
    setMarketExcludedAnchorIds([]);
    setSelectedActiveMatchId(null);
    setConfirmedActiveMatchId(null);
    setActiveMatchDetails(null);
    setActiveMatchBusy(false);
    setActiveMatchError(null);
    soldRequestIdRef.current += 1;
    setSoldCardId(null);
    setSoldSnapshot(null);
    setSoldBusy(false);
    setSoldError(null);
    setSoldShowingPrevious(false);
    setSoldExcludedAnchorIds([]);
    setSelectedSoldMatchId(null);
    setConfirmedSoldMatchId(null);
    setConfirmingSoldMatchId(null);
    setPricingSessionCardId(null);
    closeValuationPanel();
    setEditingId(card.collectionId);
    setDraft(createDraft(card));
    setGradingDraft({ ...card.grading });
    setValuationDraft({ ...card.valuationProfile });
    setActionError(null);
  };

  const loadActiveMarket = async (
    card: SavedCollectionCard,
    excludedAnchorIds = marketExcludedAnchorIds,
  ) => {
    if (marketBusy || soldBusy || valuationBusy || valuationSaving) return;
    const cacheContext = pricingCacheContext(excludedAnchorIds);
    const cached = readPricingSnapshot<ActiveMarketSnapshot>(
      "active",
      card.collectionId,
      cacheContext,
    );
    const previousSnapshot =
      marketCardId === card.collectionId && marketSnapshot
        ? marketSnapshot
        : cached?.snapshot?.kind === "active_asking_snapshot"
          ? cached.snapshot
          : null;
    hideValuationPanel();
    soldRequestIdRef.current += 1;
    setSoldCardId(null);
    setSoldSnapshot(null);
    setSoldBusy(false);
    setSoldError(null);
    setSoldShowingPrevious(false);
    const requestId = ++marketRequestIdRef.current;
    setMarketCardId(card.collectionId);
    setMarketSnapshot(previousSnapshot);
    setMarketShowingPrevious(Boolean(previousSnapshot));
    setMarketError(null);
    setMarketBusy(true);
    try {
      const { response, payload } = await fetchJsonWithTransientRetry<
        | (ActiveMarketSnapshot & { error?: string })
        | { error?: string }
      >(
        pricingSnapshotUrl(
          `/api/collection/${encodeURIComponent(card.collectionId)}/active-market`,
          excludedAnchorIds,
        ),
      );
      if (requestId !== marketRequestIdRef.current) return;
      if (!response.ok || !payload || !("groups" in payload)) {
        throw new Error(
          payload?.error ?? "CardPilot could not search active eBay listings.",
        );
      }
      setMarketSnapshot(payload);
      setMarketShowingPrevious(false);
      writePricingSnapshot(
        "active",
        card.collectionId,
        cacheContext,
        payload,
      );
    } catch (caughtError) {
      if (requestId !== marketRequestIdRef.current) return;
      setMarketShowingPrevious(Boolean(previousSnapshot));
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
    if (marketBusy || soldBusy || valuationBusy || valuationSaving) return;
    if (marketCardId === card.collectionId) {
      marketRequestIdRef.current += 1;
      setMarketCardId(null);
      setMarketSnapshot(null);
      setMarketError(null);
      setMarketShowingPrevious(false);
      setSelectedActiveMatchId(null);
      setActiveMatchDetails(null);
      setActiveMatchError(null);
    } else {
      const samePricingSession = pricingSessionCardId === card.collectionId;
      if (!samePricingSession) {
        setPricingSessionCardId(card.collectionId);
        setMarketExcludedAnchorIds([]);
        setSoldExcludedAnchorIds([]);
        setValuationSnapshot(null);
        setValuationError(null);
        setValuationShowingPrevious(false);
      }
      void loadActiveMarket(
        card,
        samePricingSession ? marketExcludedAnchorIds : [],
      );
    }
  };

  const selectActiveMarketMatch = async (listing: ActiveMarketListing | null) => {
    if (!listing) {
      setSelectedActiveMatchId(null);
      setActiveMatchDetails(null);
      setActiveMatchError(null);
      return;
    }
    setSelectedActiveMatchId(listing.itemId);
    setActiveMatchDetails(null);
    setActiveMatchError(null);
    setActiveMatchBusy(true);
    try {
      const response = await fetch(`/api/ebay/items/${encodeURIComponent(listing.itemId)}`);
      const payload = (await response.json().catch(() => null)) as
        | { item?: EbayItemDetails; error?: string }
        | null;
      if (!response.ok || !payload?.item) {
        throw new Error(payload?.error ?? "CardPilot could not load that listing's details.");
      }
      setActiveMatchDetails(payload.item);
    } catch (caughtError) {
      setActiveMatchError(
        caughtError instanceof Error
          ? caughtError.message
          : "CardPilot could not load that listing's details.",
      );
    } finally {
      setActiveMatchBusy(false);
    }
  };

  const confirmActiveMarketMatch = async (
    card: SavedCollectionCard,
    listing: ActiveMarketListing,
  ) => {
    if (activeMatchBusy || busyId) return;
    const suggestions = ebaySuggestionFields(card, activeMatchDetails);
    const updatedFields = { ...card.fields, ...suggestions };
    setActiveMatchBusy(true);
    setActionError(null);
    try {
      const response = await fetch(
        `/api/collection/${encodeURIComponent(card.collectionId)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fields: updatedFields,
            grading: card.grading,
            valuationProfile:
              card.valuationProfile.source === "derived"
                ? deriveValuationProfile(updatedFields)
                : card.valuationProfile,
            ebayReference: {
              itemId: listing.itemId,
              title: listing.title,
              itemWebUrl: listing.itemWebUrl,
            },
          }),
        },
      );
      const payload = (await response.json().catch(() => null)) as
        | { card?: SavedCollectionCard; error?: string }
        | null;
      if (!response.ok || !payload?.card) {
        throw new Error(payload?.error ?? "CardPilot could not update this card from the active listing.");
      }
      onCardsChange(
        cards.map((item) =>
          item.collectionId === payload.card?.collectionId ? payload.card : item,
        ),
      );
      setSelectedActiveMatchId(null);
      setConfirmedActiveMatchId(listing.itemId);
      setActiveMatchDetails(null);
    } catch (caughtError) {
      setActionError(
        caughtError instanceof Error
          ? caughtError.message
          : "CardPilot could not update this card from the active listing.",
      );
    } finally {
      setActiveMatchBusy(false);
    }
  };

  const excludeActiveMarketAnchor = (
    card: SavedCollectionCard,
    observationId: string,
  ) => {
    if (
      marketBusy ||
      valuationBusy ||
      marketExcludedAnchorIds.includes(observationId)
    ) return;
    const nextExcludedAnchorIds = [
      ...marketExcludedAnchorIds,
      observationId,
    ];
    setMarketExcludedAnchorIds(nextExcludedAnchorIds);
    void loadActiveMarket(card, nextExcludedAnchorIds);
    void refreshValuationSnapshot(
      card,
      soldExcludedAnchorIds,
      nextExcludedAnchorIds,
    );
  };

  const restoreActiveMarketAnchors = (card: SavedCollectionCard) => {
    if (marketBusy || valuationBusy) return;
    setMarketExcludedAnchorIds([]);
    setSoldExcludedAnchorIds([]);
    void loadActiveMarket(card, []);
    void refreshValuationSnapshot(card, [], []);
  };

  const loadSoldComps = async (
    card: SavedCollectionCard,
    excludedAnchorIds = soldExcludedAnchorIds,
  ) => {
    if (soldBusy || marketBusy || valuationBusy || valuationSaving) return;
    const cacheContext = pricingCacheContext(excludedAnchorIds);
    const cached = readPricingSnapshot<SoldCompsSnapshot>(
      "sold",
      card.collectionId,
      cacheContext,
    );
    const previousSnapshot =
      soldCardId === card.collectionId && soldSnapshot
        ? soldSnapshot
        : cached?.snapshot?.kind === "sold_comparables"
          ? cached.snapshot
          : null;
    hideValuationPanel();
    marketRequestIdRef.current += 1;
    setMarketCardId(null);
    setMarketSnapshot(null);
    setMarketBusy(false);
    setMarketError(null);
    setMarketShowingPrevious(false);
    const requestId = ++soldRequestIdRef.current;
    setSoldCardId(card.collectionId);
    setSoldSnapshot(previousSnapshot);
    setSoldShowingPrevious(Boolean(previousSnapshot));
    setSoldError(null);
    setSoldBusy(true);
    try {
      const { response, payload } = await fetchJsonWithTransientRetry<
        | (SoldCompsSnapshot & { error?: string })
        | { error?: string }
      >(
        pricingSnapshotUrl(
          `/api/collection/${encodeURIComponent(card.collectionId)}/sold-comps`,
          excludedAnchorIds,
        ),
      );
      if (requestId !== soldRequestIdRef.current) return;
      if (!response.ok || !payload || !("groups" in payload)) {
        throw new Error(
          payload?.error ?? "CardPilot could not search completed sales.",
        );
      }
      setSoldSnapshot(payload);
      setSoldShowingPrevious(false);
      writePricingSnapshot(
        "sold",
        card.collectionId,
        cacheContext,
        payload,
      );
    } catch (caughtError) {
      if (requestId !== soldRequestIdRef.current) return;
      setSoldShowingPrevious(Boolean(previousSnapshot));
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
    if (soldBusy || marketBusy || valuationBusy || valuationSaving) return;
    if (soldCardId === card.collectionId) {
      soldRequestIdRef.current += 1;
      setSoldCardId(null);
      setSoldSnapshot(null);
      setSoldError(null);
      setSoldShowingPrevious(false);
      setSelectedSoldMatchId(null);
    } else {
      const samePricingSession = pricingSessionCardId === card.collectionId;
      if (!samePricingSession) {
        setPricingSessionCardId(card.collectionId);
        setMarketExcludedAnchorIds([]);
        setSoldExcludedAnchorIds([]);
        setValuationSnapshot(null);
        setValuationError(null);
        setValuationShowingPrevious(false);
        setConfirmedSoldMatchId(null);
      }
      setSelectedSoldMatchId(null);
      void loadSoldComps(
        card,
        samePricingSession ? soldExcludedAnchorIds : [],
      );
    }
  };

  const excludeSoldCompAnchor = (
    card: SavedCollectionCard,
    observationId: string,
  ) => {
    if (
      soldBusy ||
      valuationBusy ||
      soldExcludedAnchorIds.includes(observationId)
    ) return;
    const nextExcludedAnchorIds = [...soldExcludedAnchorIds, observationId];
    setSoldExcludedAnchorIds(nextExcludedAnchorIds);
    void loadSoldComps(card, nextExcludedAnchorIds);
    void refreshValuationSnapshot(
      card,
      nextExcludedAnchorIds,
      marketExcludedAnchorIds,
    );
  };

  const restoreSoldCompAnchors = (card: SavedCollectionCard) => {
    if (soldBusy || valuationBusy) return;
    setMarketExcludedAnchorIds([]);
    setSoldExcludedAnchorIds([]);
    void loadSoldComps(card, []);
    void refreshValuationSnapshot(card, [], []);
  };

  const confirmSoldCompMatch = async (
    card: SavedCollectionCard,
    sale: SoldComparable,
  ) => {
    if (confirmingSoldMatchId || busyId) return;
    const suggestions = soldSuggestionFields(card, sale);
    const updatedFields = { ...card.fields, ...suggestions };
    setConfirmingSoldMatchId(sale.id);
    setActionError(null);
    try {
      const response = await fetch(
        `/api/collection/${encodeURIComponent(card.collectionId)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fields: updatedFields,
            grading: card.grading,
            valuationProfile:
              card.valuationProfile.source === "derived"
                ? deriveValuationProfile(updatedFields)
                : card.valuationProfile,
          }),
        },
      );
      const payload = (await response.json().catch(() => null)) as
        | { card?: SavedCollectionCard; error?: string }
        | null;
      if (!response.ok || !payload?.card) {
        throw new Error(
          payload?.error ?? "CardPilot could not update this card from the completed sale.",
        );
      }
      onCardsChange(
        cards.map((item) =>
          item.collectionId === payload.card?.collectionId ? payload.card : item,
        ),
      );
      setSelectedSoldMatchId(null);
      setConfirmedSoldMatchId(sale.id);
    } catch (caughtError) {
      setActionError(
        caughtError instanceof Error
          ? caughtError.message
          : "CardPilot could not update this card from the completed sale.",
      );
    } finally {
      setConfirmingSoldMatchId(null);
    }
  };

  const saveAutomaticRecommendation = async (
    card: SavedCollectionCard,
    recommendation: NonNullable<ValuationRecommendationSnapshot["recommendation"]>,
  ) => {
    const response = await fetch(
      `/api/collection/${encodeURIComponent(card.collectionId)}/valuation`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountCents: recommendation.amountCents,
          currency: recommendation.currency,
          confidence: recommendation.confidence,
          method: recommendation.method,
          userAdjusted: false,
        }),
      },
    );
    const payload = (await response.json().catch(() => null)) as
      | { card?: SavedCollectionCard; error?: string }
      | null;
    if (!response.ok || !payload?.card) {
      throw new Error(
        payload?.error ?? "CardPilot could not automatically save this value.",
      );
    }
    return payload.card;
  };

  const refreshValuationSnapshot = async (
    card: SavedCollectionCard,
    soldExcludedObservationIds: string[],
    activeExcludedObservationIds: string[],
    openPanel = false,
  ) => {
    const cacheContext = pricingCacheContext(
      soldExcludedObservationIds,
      activeExcludedObservationIds,
    );
    const cached = readPricingSnapshot<ValuationRecommendationSnapshot>(
      "valuation",
      card.collectionId,
      cacheContext,
    );
    const previousSnapshot =
      pricingSessionCardId === card.collectionId && valuationSnapshot
        ? valuationSnapshot
        : cached?.snapshot?.kind === "card_valuation_recommendation"
          ? cached.snapshot
          : null;
    const requestId = ++valuationRequestIdRef.current;
    if (openPanel) setValuationCardId(card.collectionId);
    setValuationSnapshot(previousSnapshot);
    setValuationShowingPrevious(Boolean(previousSnapshot));
    setValuationError(null);
    if (openPanel) {
      setValuationAmountInput(
        card.confirmedValuation
          ? amountInputFromCents(card.confirmedValuation.amountCents)
          : "",
      );
      setValuationCurrency(card.confirmedValuation?.currency ?? "USD");
      setValuationConfidence(card.confirmedValuation?.confidence ?? "low");
    }
    setValuationBusy(true);
    try {
      const snapshot = await fetchValuationRecommendation(card, {
        soldExcludedObservationIds,
        activeExcludedObservationIds,
      });
      if (requestId !== valuationRequestIdRef.current) return;
      setValuationSnapshot(snapshot);
      setValuationShowingPrevious(false);
      writePricingSnapshot(
        "valuation",
        card.collectionId,
        cacheContext,
        snapshot,
      );
      if (snapshot.recommendation) {
        setValuationAmountInput(
          amountInputFromCents(snapshot.recommendation.amountCents),
        );
        setValuationCurrency(snapshot.recommendation.currency);
        setValuationConfidence(snapshot.recommendation.confidence);
        const limit = accountPreferences.autoValueMaxCents;
        if (
          accountPreferences.autoValueEnabled &&
          !openPanel &&
          !card.confirmedValuation?.userAdjusted &&
          limit !== null &&
          snapshot.recommendation.amountCents <= limit
        ) {
          const savedCard = await saveAutomaticRecommendation(
            card,
            snapshot.recommendation,
          );
          onCardsChange(
            cards.map((item) =>
              item.collectionId === savedCard.collectionId ? savedCard : item,
            ),
          );
          setAutomaticValueStatus(
            `${card.title} was automatically valued at ${formatPrice(
              snapshot.recommendation.amountCents,
              snapshot.recommendation.currency,
            )}.`,
          );
          if (openPanel) closeValuationPanel();
        }
      }
    } catch (caughtError) {
      if (requestId !== valuationRequestIdRef.current) return;
      setValuationShowingPrevious(Boolean(previousSnapshot));
      setValuationError(
        caughtError instanceof Error
          ? caughtError.message
          : "CardPilot could not prepare a valuation recommendation.",
      );
    } finally {
      if (requestId === valuationRequestIdRef.current) setValuationBusy(false);
    }
  };

  const loadValuationRecommendation = async (card: SavedCollectionCard) => {
    if (
      marketBusy ||
      soldBusy ||
      valuationBusy ||
      valuationSaving ||
      bulkRefreshing ||
      bulkApplying
    ) {
      return;
    }
    marketRequestIdRef.current += 1;
    setMarketCardId(null);
    setMarketSnapshot(null);
    setMarketBusy(false);
    setMarketError(null);
    setMarketShowingPrevious(false);
    soldRequestIdRef.current += 1;
    setSoldCardId(null);
    setSoldSnapshot(null);
    setSoldBusy(false);
    setSoldError(null);
    setSoldShowingPrevious(false);
    const samePricingSession = pricingSessionCardId === card.collectionId;
    const activeExcludedObservationIds = samePricingSession
      ? marketExcludedAnchorIds
      : [];
    const soldExcludedObservationIds = samePricingSession
      ? soldExcludedAnchorIds
      : [];
    if (!samePricingSession) {
      setPricingSessionCardId(card.collectionId);
      setMarketExcludedAnchorIds([]);
      setSoldExcludedAnchorIds([]);
    }
    await refreshValuationSnapshot(
      card,
      soldExcludedObservationIds,
      activeExcludedObservationIds,
      true,
    );
  };

  const reviewUpdatedRecommendation = (card: SavedCollectionCard) => {
    if (valuationBusy || !valuationSnapshot) return;
    marketRequestIdRef.current += 1;
    setMarketCardId(null);
    setMarketSnapshot(null);
    setMarketBusy(false);
    setMarketError(null);
    setMarketShowingPrevious(false);
    soldRequestIdRef.current += 1;
    setSoldCardId(null);
    setSoldSnapshot(null);
    setSoldBusy(false);
    setSoldError(null);
    setSoldShowingPrevious(false);
    setValuationCardId(card.collectionId);
  };

  const restoreAllPricingComparisons = (card: SavedCollectionCard) => {
    if (valuationBusy || valuationSaving) return;
    setMarketExcludedAnchorIds([]);
    setSoldExcludedAnchorIds([]);
    void refreshValuationSnapshot(card, [], [], true);
  };

  const toggleValuationRecommendation = (card: SavedCollectionCard) => {
    if (valuationCardId === card.collectionId) {
      closeValuationPanel();
      return;
    }
    void loadValuationRecommendation(card);
  };

  const saveConfirmedValuation = async (card: SavedCollectionCard) => {
    const amountCents = amountCentsFromInput(valuationAmountInput);
    if (amountCents === null || valuationSaving) {
      setValuationError("Enter a valid card value of zero or more.");
      return;
    }
    const recommendation = valuationSnapshot?.recommendation ?? null;
    const method: ValuationMethod = recommendation?.method ?? "manual";
    const userAdjusted = Boolean(
      !recommendation ||
        amountCents !== recommendation.amountCents ||
          valuationCurrency !== recommendation.currency ||
          valuationConfidence !== recommendation.confidence,
    );
    setValuationSaving(true);
    setValuationError(null);
    try {
      const response = await fetch(
        `/api/collection/${encodeURIComponent(card.collectionId)}/valuation`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amountCents,
            currency: valuationCurrency,
            confidence: valuationConfidence,
            method,
            userAdjusted,
          }),
        },
      );
      const payload = (await response.json().catch(() => null)) as
        | { card?: SavedCollectionCard; error?: string }
        | null;
      if (!response.ok || !payload?.card) {
        throw new Error(payload?.error ?? "CardPilot could not save this value.");
      }
      onCardsChange(
        cards.map((item) =>
          item.collectionId === payload.card?.collectionId ? payload.card : item,
        ),
      );
      closeValuationPanel();
    } catch (caughtError) {
      setValuationError(
        caughtError instanceof Error
          ? caughtError.message
          : "CardPilot could not save this value.",
      );
    } finally {
      setValuationSaving(false);
    }
  };

  const clearConfirmedValuation = async (card: SavedCollectionCard) => {
    if (
      valuationSaving ||
      !window.confirm(`Clear the saved value for ${card.title}?`)
    ) {
      return;
    }
    setValuationSaving(true);
    setValuationError(null);
    try {
      const response = await fetch(
        `/api/collection/${encodeURIComponent(card.collectionId)}/valuation`,
        { method: "DELETE" },
      );
      const payload = (await response.json().catch(() => null)) as
        | { card?: SavedCollectionCard; error?: string }
        | null;
      if (!response.ok || !payload?.card) {
        throw new Error(payload?.error ?? "CardPilot could not clear this value.");
      }
      onCardsChange(
        cards.map((item) =>
          item.collectionId === payload.card?.collectionId ? payload.card : item,
        ),
      );
      closeValuationPanel();
    } catch (caughtError) {
      setValuationError(
        caughtError instanceof Error
          ? caughtError.message
          : "CardPilot could not clear this value.",
      );
    } finally {
      setValuationSaving(false);
    }
  };

  const dismissBulkValuation = () => {
    if (bulkRefreshing || bulkApplying) return;
    setBulkValuationResults([]);
    setBulkSelectedIds([]);
    setBulkCompletedCount(0);
    setBulkValuationError(null);
  };

  const refreshAllValuations = async () => {
    if (
      cards.length === 0 ||
      bulkRefreshing ||
      bulkApplying ||
      marketBusy ||
      soldBusy ||
      valuationBusy ||
      valuationSaving
    ) {
      return;
    }
    if (
      !window.confirm(
        `Check current pricing for ${cards.length} card${cards.length === 1 ? "" : "s"}? CardPilot will search one card at a time to limit provider usage.`,
      )
    ) {
      return;
    }
    marketRequestIdRef.current += 1;
    setMarketCardId(null);
    setMarketSnapshot(null);
    setMarketError(null);
    setMarketShowingPrevious(false);
    setMarketExcludedAnchorIds([]);
    soldRequestIdRef.current += 1;
    setSoldCardId(null);
    setSoldSnapshot(null);
    setSoldError(null);
    setSoldShowingPrevious(false);
    setSoldExcludedAnchorIds([]);
    setPricingSessionCardId(null);
    closeValuationPanel();
    setBulkValuationResults([]);
    setBulkSelectedIds([]);
    setBulkCompletedCount(0);
    setBulkValuationError(null);
    setBulkRefreshing(true);
    const results: BulkValuationResult[] = [];
    const automaticUpdates = new Map<string, SavedCollectionCard>();
    try {
      for (let index = 0; index < cards.length; index += 1) {
        const card = cards[index];
        try {
          const snapshot = await fetchValuationRecommendation(card);
          writePricingSnapshot(
            "valuation",
            card.collectionId,
            pricingCacheContext([], []),
            snapshot,
          );
          let resultCard = card;
          const recommendation = snapshot.recommendation;
          const limit = accountPreferences.autoValueMaxCents;
          if (
            recommendation &&
            accountPreferences.autoValueEnabled &&
            !card.confirmedValuation?.userAdjusted &&
            limit !== null &&
            recommendation.amountCents <= limit
          ) {
            resultCard = await saveAutomaticRecommendation(card, recommendation);
            automaticUpdates.set(resultCard.collectionId, resultCard);
          }
          results.push({ card: resultCard, snapshot, error: null });
          setBulkValuationResults([...results]);
          setBulkCompletedCount(results.length);
          if (
            snapshot.evidence.sold.status === "rate_limited" ||
            snapshot.evidence.active.status === "rate_limited"
          ) {
            setBulkValuationError(
              "A pricing provider reached its request limit. CardPilot stopped before checking more cards; the recommendations already prepared remain available for review.",
            );
            break;
          }
        } catch (caughtError) {
          const cached = readPricingSnapshot<ValuationRecommendationSnapshot>(
            "valuation",
            card.collectionId,
            pricingCacheContext([], []),
          );
          results.push({
            card,
            snapshot:
              cached?.snapshot?.kind === "card_valuation_recommendation"
                ? cached.snapshot
                : null,
            error:
              caughtError instanceof Error
                ? cached
                  ? `Refresh failed; showing the previously retrieved estimate. ${caughtError.message}`
                  : caughtError.message
                : "Pricing could not be checked.",
          });
          setBulkValuationResults([...results]);
          setBulkCompletedCount(results.length);
        }
        if (index < cards.length - 1) {
          await waitForNextPricingRequest(250);
        }
      }
      setBulkSelectedIds(
        results
          .filter(
            (result) =>
              result.snapshot?.recommendation &&
              !result.error &&
              !automaticUpdates.has(result.card.collectionId),
          )
          .map((result) => result.card.collectionId),
      );
      if (automaticUpdates.size > 0) {
        onCardsChange(
          cards.map((card) => automaticUpdates.get(card.collectionId) ?? card),
        );
        setAutomaticValueStatus(
          `${automaticUpdates.size} lower-value card${automaticUpdates.size === 1 ? " was" : "s were"} valued automatically.`,
        );
      }
    } finally {
      setBulkRefreshing(false);
    }
  };

  const toggleBulkValuation = (collectionId: string) => {
    setBulkSelectedIds((current) =>
      current.includes(collectionId)
        ? current.filter((id) => id !== collectionId)
        : [...current, collectionId],
    );
  };

  const applyBulkValuations = async () => {
    if (bulkApplying || bulkSelectedIds.length === 0) return;
    setBulkApplying(true);
    setBulkValuationError(null);
    const updatedCards = new Map<string, SavedCollectionCard>();
    const failedIds = new Set<string>();
    try {
      for (const result of bulkValuationResults) {
        const recommendation = result.snapshot?.recommendation;
        if (!recommendation || !bulkSelectedIds.includes(result.card.collectionId)) {
          continue;
        }
        try {
          const response = await fetch(
            `/api/collection/${encodeURIComponent(result.card.collectionId)}/valuation`,
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                amountCents: recommendation.amountCents,
                currency: recommendation.currency,
                confidence: recommendation.confidence,
                method: recommendation.method,
                userAdjusted: false,
              }),
            },
          );
          const payload = (await response.json().catch(() => null)) as
            | { card?: SavedCollectionCard; error?: string }
            | null;
          if (!response.ok || !payload?.card) {
            throw new Error(payload?.error ?? "The value could not be saved.");
          }
          updatedCards.set(payload.card.collectionId, payload.card);
        } catch {
          failedIds.add(result.card.collectionId);
        }
      }
      if (updatedCards.size > 0) {
        onCardsChange(
          cards.map((card) => updatedCards.get(card.collectionId) ?? card),
        );
      }
      if (failedIds.size > 0) {
        setBulkSelectedIds([...failedIds]);
        setBulkValuationError(
          `${failedIds.size} selected value${failedIds.size === 1 ? " was" : "s were"} not saved. Try applying the remaining selection again.`,
        );
      } else {
        setBulkValuationResults([]);
        setBulkSelectedIds([]);
        setBulkCompletedCount(0);
      }
    } finally {
      setBulkApplying(false);
    }
  };

  const saveEdit = async (card: SavedCollectionCard) => {
    if (!draft || !gradingDraft || !valuationDraft || busyId) return;
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
          body: JSON.stringify({
            fields: draft,
            grading: gradingDraft,
            valuationProfile:
              valuationDraft.source === "derived"
                ? deriveValuationProfile(draft)
                : valuationDraft,
          }),
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
      setValuationDraft(null);
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
            Search confirmed details, review card photos, and manage sports and
            Pokémon cards in one collection.
          </p>
        </div>
        <div className="collection-heading-actions">
          <button
            className="outline-button"
            type="button"
            disabled={
              cards.length === 0 ||
              bulkRefreshing ||
              bulkApplying ||
              marketBusy ||
              soldBusy ||
              valuationBusy ||
              valuationSaving
            }
            onClick={() => void refreshAllValuations()}
          >
            {bulkRefreshing
              ? `Checking ${bulkCompletedCount} of ${cards.length}`
              : "Refresh all values"}
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={bulkRefreshing || bulkApplying}
            onClick={onScanCard}
          >
            Scan another card
          </button>
        </div>
      </div>

      <div className="collection-summary" aria-label="Collection summary">
        <div className="collection-summary-value">
          <strong>{collectionValuation.totalLabel}</strong>
          <span>Saved collection value</span>
        </div>
        <div><strong>{cards.length}</strong><span>Total cards</span></div>
        <div><strong>{collectionValuation.valuedCount}</strong><span>Valued</span></div>
        <div><strong>{collectionValuation.unvaluedCount}</strong><span>Need a value</span></div>
        <div><strong>{collectionValuation.staleCount}</strong><span>Pricing out of date</span></div>
        <div><strong>{collectionValuation.listedCount}</strong><span>Listed on eBay</span></div>
        <div><strong>{collectionValuation.soldTotalLabel}</strong><span>Total sold value</span></div>
      </div>
      <div className="ebay-queue-launch"><div><strong>eBay listings and drafts</strong><span>See drafts, scheduled listings, active listings, ended listings, and synchronized sales.</span></div><button type="button" onClick={() => setListingQueueOpen(true)}>Open Listings and drafts</button></div>

      {(bulkRefreshing || bulkValuationResults.length > 0) && (
        <BulkValuationReview
          results={bulkValuationResults}
          selectedIds={bulkSelectedIds}
          completedCount={bulkCompletedCount}
          totalCount={cards.length}
          isRefreshing={bulkRefreshing}
          isApplying={bulkApplying}
          error={bulkValuationError}
          onToggle={toggleBulkValuation}
          onApply={() => void applyBulkValuations()}
          onDismiss={dismissBulkValuation}
        />
      )}

      <div className="collection-toolbar">
        <label>
          <span>Search collection</span>
          <input
            type="search"
            value={query}
            placeholder="Player, Pokémon, year, set, card number..."
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label>
          <span>Category / sport</span>
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="all">All categories</option>
            {categories.map((value) => <option key={value}>{value}</option>)}
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
            <option value="listed">Listed on eBay</option>
            <option value="sold">Sold on eBay</option>
            <option value="unvalued">Needs a value</option>
            <option value="stale">Pricing out of date</option>
          </select>
        </label>
        <label>
          <span>Sort order</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as CollectionSort)}>
            <option value="newest">Newest added</option>
            <option value="oldest">Oldest added</option>
            <option value="value-high">Value: high to low</option>
            <option value="value-low">Value: low to high</option>
            <option value="title-az">Title: A to Z</option>
            <option value="title-za">Title: Z to A</option>
          </select>
        </label>
      </div>

      {(error || actionError) && (
        <div className="error-banner" role="alert">
          <strong>Collection action interrupted.</strong>
          <span>{actionError ?? error}</span>
        </div>
      )}
      {automaticValueStatus && (
        <div className="collection-status-banner" role="status">
          <span>{automaticValueStatus}</span>
          <button type="button" onClick={() => setAutomaticValueStatus(null)}>Dismiss</button>
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
            const isValuationOpen = valuationCardId === card.collectionId;
            const isDetailsExpanded = expandedDetailIds.includes(card.collectionId);
            return (
              <article
                className={`collection-card${isMarketOpen || isSoldOpen || isValuationOpen ? " collection-card-expanded" : ""}`}
                key={card.collectionId}
              >
                <div className="collection-card-image">
                  <button
                    className="collection-card-image-button"
                    type="button"
                    onClick={() => setExpandedImageCard(card)}
                    aria-label={`View the full image of ${card.title}`}
                  >
                    <img src={card.images.frontUrl} alt={`Front of ${card.title}`} />
                    <span className="collection-image-view-label">View full card</span>
                  </button>
                  {card.fields.serialNumber && <span>Numbered {card.fields.serialNumber}</span>}
                </div>
                {isEditing ? (
                  <div className="collection-editor">
                    <h2>Edit saved card</h2>
                    <div className="collection-editor-grid">
                      {fieldDefinitionsFor(draft).map((definition) => (
                        <label key={definition.key}>
                          <span>{definition.label}</span>
                          {definition.key === "category" ? (
                            <select
                              value={String(draft.category ?? "")}
                              onChange={(event) =>
                                setDraft({
                                  ...draft,
                                  category: event.target.value || null,
                                  ...(event.target.value === "Pokémon"
                                    ? {
                                        player: null,
                                        sport: null,
                                        team: null,
                                        rookieStatus: null,
                                        serialNumber: null,
                                        autograph: null,
                                        memorabilia: null,
                                        imageVariation: null,
                                      }
                                    : event.target.value === "Sports"
                                      ? {
                                          character: null,
                                          language: null,
                                          rarity: null,
                                          raritySymbol: null,
                                          finish: null,
                                          promo: null,
                                        }
                                      : {}),
                                })
                              }
                            >
                              <option value="">Unknown</option>
                              <option value="Sports">Sports</option>
                              <option value="Pokémon">Pokémon</option>
                            </select>
                          ) : definition.kind === "boolean" ? (
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
                    {valuationDraft && cardKindFromFields(draft) !== "pokemon" && (
                      <section
                        className="valuation-profile-editor"
                        aria-labelledby={`valuation-profile-${card.collectionId}`}
                      >
                        <div>
                          <span>Variant-adjustment profile</span>
                          <h3 id={`valuation-profile-${card.collectionId}`}>
                            Card feature premium
                          </h3>
                          <p>
                            Choose one primary profile only. Composite choices such as RPA already include the rookie, patch, and autograph premiums and are never multiplied again.
                          </p>
                        </div>
                        <label>
                          <span>Feature profile</span>
                          <select
                            value={
                              valuationDraft.source === "derived"
                                ? "automatic"
                                : valuationDraft.featureType
                            }
                            onChange={(event) => {
                              if (event.target.value === "automatic") {
                                setValuationDraft(deriveValuationProfile(draft));
                                return;
                              }
                              setValuationDraft({
                                featureType: event.target.value as ValuationProfile["featureType"],
                                source: "user_confirmed",
                              });
                            }}
                          >
                            <option value="automatic">
                              Automatic — {featureProfileLabel(deriveValuationProfile(draft))}
                            </option>
                            {valuationFeatureOptions.map((option) => (
                              <option value={option.value} key={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                          <small>
                            {valuationDraft.source === "derived"
                              ? "CardPilot is using the confirmed autograph, memorabilia, and rookie details. Choose a specific type when you know it."
                              : "User confirmed. This profile will be used for upward or downward feature adjustments."}
                          </small>
                        </label>
                      </section>
                    )}
                    <div className="collection-card-actions">
                      <button type="button" disabled={busyId !== null} onClick={() => void saveEdit(card)}>
                        {busyId === card.collectionId ? "Saving..." : "Save changes"}
                      </button>
                      <button type="button" onClick={() => { setEditingId(null); setDraft(null); setGradingDraft(null); setValuationDraft(null); }}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="collection-card-body">
                    <div>
                      <span>{cardCategoryLabel(card.fields)}</span>
                      <h2>{card.title}</h2>
                    </div>
                    {card.confirmedValuation ? (
                      <div className="collection-card-value">
                        <div>
                          <span>Saved value</span>
                          <strong>
                            {formatPrice(
                              card.confirmedValuation.amountCents,
                              card.confirmedValuation.currency,
                            )}
                          </strong>
                        </div>
                        {isDetailsExpanded && <div>
                          <span
                            className={`market-confidence market-confidence-${card.confirmedValuation.confidence}`}
                          >
                            {card.confirmedValuation.confidence} confidence
                          </span>
                          {valuationIsStale(card) && (
                            <span className="stale-value-badge">Refresh recommended</span>
                          )}
                        </div>}
                        {isDetailsExpanded && <small>
                          {valuationMethodLabel(card.confirmedValuation.method)}
                          {card.confirmedValuation.userAdjusted ? " · Adjusted by collector" : ""}
                          {` · Saved ${new Date(card.confirmedValuation.valuedAt).toLocaleDateString()}`}
                        </small>}
                      </div>
                    ) : (
                      <div className="collection-card-value collection-card-value-empty">
                        <div>
                          <span>Saved value</span>
                          <strong>Not valued yet</strong>
                        </div>
                        {isDetailsExpanded && <small>Check current pricing and confirm a value.</small>}
                      </div>
                    )}
                    {card.selling && card.selling.status !== "draft" && (
                      <div className="collection-card-value">
                        <div><span>eBay status</span><strong>{card.selling.status === "published" ? "Active" : card.selling.status[0].toUpperCase() + card.selling.status.slice(1)}</strong></div>
                        {isDetailsExpanded && card.selling.status === "published" && card.selling.publishedAt && <small>Active since {new Date(card.selling.publishedAt).toLocaleString()}</small>}
                        {isDetailsExpanded && card.selling.status === "published" && (card.selling.viewCount != null || card.selling.watcherCount != null) && <small>{card.selling.viewCount ?? "—"} views · {card.selling.watcherCount ?? "—"} watchers{card.selling.impressionCount != null ? ` · ${card.selling.impressionCount} impressions` : ""}</small>}
                        {isDetailsExpanded && card.selling.status === "sold" && card.selling.soldAmountCents !== null && <small>Sold for {formatPrice(card.selling.soldAmountCents, card.selling.soldCurrency ?? "USD")}</small>}
                        {isDetailsExpanded && card.selling.listingUrl && <a href={card.selling.listingUrl} target="_blank" rel="noreferrer">View on eBay</a>}
                      </div>
                    )}
                    <button
                      className="collection-card-details-toggle"
                      type="button"
                      aria-expanded={isDetailsExpanded}
                      onClick={() => setExpandedDetailIds((current) => current.includes(card.collectionId)
                        ? current.filter((id) => id !== card.collectionId)
                        : [...current, card.collectionId])}
                    >
                      {isDetailsExpanded ? "Hide card details" : "View card details and actions"}
                    </button>
                    {isDetailsExpanded && <>
                    <dl>
                      {cardKindFromFields(card.fields) === "pokemon" ? (
                        <>
                          <div><dt>Pokémon</dt><dd>{formatFieldValue(card.fields.character)}</dd></div>
                          <div><dt>Set</dt><dd>{formatFieldValue(card.fields.setOrInsert)}</dd></div>
                          <div><dt>Collector number</dt><dd>{formatFieldValue(card.fields.cardNumber)}</dd></div>
                          <div><dt>Rarity</dt><dd>{formatFieldValue(card.fields.rarity)}</dd></div>
                          <div><dt>Rarity symbol</dt><dd>{formatFieldValue(card.fields.raritySymbol)}</dd></div>
                          <div><dt>Finish</dt><dd>{formatFieldValue(card.fields.finish)}</dd></div>
                          <div><dt>Variant</dt><dd>{formatFieldValue(card.fields.parallel)}</dd></div>
                        </>
                      ) : (
                        <>
                          <div><dt>Card number</dt><dd>{formatFieldValue(card.fields.cardNumber)}</dd></div>
                          <div><dt>Parallel</dt><dd>{formatFieldValue(card.fields.parallel)}</dd></div>
                          <div><dt>Numbered card</dt><dd>{card.fields.serialNumber ? "Yes" : "No"}</dd></div>
                          <div><dt>Serial</dt><dd>{formatFieldValue(card.fields.serialNumber)}</dd></div>
                        </>
                      )}
                      <div>
                        <dt>Condition</dt>
                        <dd>
                          {card.grading.isGraded
                            ? `${card.grading.company} ${card.grading.grade}`
                            : "Raw / ungraded"}
                        </dd>
                      </div>
                      {cardKindFromFields(card.fields) !== "pokemon" && (
                        <div>
                          <dt>Feature profile</dt>
                          <dd>{featureProfileLabel(card.valuationProfile)}</dd>
                        </div>
                      )}
                    </dl>
                    <div className="collection-card-flags">
                      {card.fields.promo === true && <span>Promo</span>}
                      {card.fields.language && <span>{card.fields.language}</span>}
                      {card.fields.rookieStatus === true && <span>Rookie</span>}
                      {card.fields.autograph === true && <span>Autograph</span>}
                      {card.fields.memorabilia === true && <span>Memorabilia</span>}
                    </div>
                    <small>Updated {new Date(card.updatedAt).toLocaleDateString()}</small>
                    <div className="collection-card-actions">
                      <button
                        type="button"
                        disabled={marketBusy || soldBusy || valuationBusy || valuationSaving || bulkRefreshing || bulkApplying}
                        onClick={() => setSellingCard(card)}
                      >
                        {ebayCardActionLabel(card)}
                      </button>
                      <button
                        type="button"
                        disabled={
                          marketBusy ||
                          soldBusy ||
                          valuationBusy ||
                          valuationSaving ||
                          bulkRefreshing ||
                          bulkApplying
                        }
                        onClick={() => beginEdit(card)}
                      >
                        Edit details
                      </button>
                      <button
                        type="button"
                        disabled={
                          marketBusy ||
                          soldBusy ||
                          valuationBusy ||
                          valuationSaving ||
                          bulkRefreshing ||
                          bulkApplying
                        }
                        onClick={() => toggleValuationRecommendation(card)}
                      >
                        {isValuationOpen
                          ? "Close value"
                          : card.confirmedValuation
                            ? "Set / revise value"
                            : "Estimate or set value"}
                      </button>
                      <button
                        type="button"
                        disabled={
                          marketBusy ||
                          soldBusy ||
                          valuationBusy ||
                          valuationSaving ||
                          bulkRefreshing ||
                          bulkApplying
                        }
                        onClick={() => toggleActiveMarket(card)}
                      >
                        {isMarketOpen ? "Close market" : "Check active market"}
                      </button>
                      <button
                        type="button"
                        disabled={
                          soldBusy ||
                          marketBusy ||
                          valuationBusy ||
                          valuationSaving ||
                          bulkRefreshing ||
                          bulkApplying
                        }
                        onClick={() => toggleSoldComps(card)}
                      >
                        {isSoldOpen ? "Close sold comps" : "Check sold comps"}
                      </button>
                      <button
                        type="button"
                        disabled={
                          busyId !== null ||
                          valuationBusy ||
                          valuationSaving ||
                          bulkRefreshing ||
                          bulkApplying
                        }
                        onClick={() => void removeCard(card)}
                      >
                        {busyId === card.collectionId ? "Removing..." : "Remove"}
                      </button>
                    </div>
                    </>}
                  </div>
                )}
                {isMarketOpen && !isEditing && (
                  <ActiveMarketPanel
                    card={card}
                    snapshot={marketSnapshot}
                    isLoading={marketBusy}
                    error={marketError}
                    showingPrevious={marketShowingPrevious}
                    onRetry={() => void loadActiveMarket(card)}
                    excludedAnchorCount={
                      marketExcludedAnchorIds.length + soldExcludedAnchorIds.length
                    }
                    onExcludeAnchor={(observationId) =>
                      excludeActiveMarketAnchor(card, observationId)
                    }
                    onRestoreAnchors={() => restoreActiveMarketAnchors(card)}
                    updatedRecommendation={valuationSnapshot}
                    isRecommendationUpdating={valuationBusy}
                    recommendationError={valuationError}
                    onReviewRecommendation={() =>
                      reviewUpdatedRecommendation(card)
                    }
                    selectedMatchId={selectedActiveMatchId}
                    confirmedMatchId={confirmedActiveMatchId}
                    isLoadingMatch={activeMatchBusy && selectedActiveMatchId !== null}
                    isConfirmingMatch={activeMatchBusy && activeMatchDetails !== null}
                    matchError={activeMatchError}
                    matchDetails={activeMatchDetails}
                    onSelectMatch={(listing) => void selectActiveMarketMatch(listing)}
                    onConfirmMatch={(listing) => void confirmActiveMarketMatch(card, listing)}
                  />
                )}
                {isSoldOpen && !isEditing && (
                  <SoldCompsPanel
                    card={card}
                    snapshot={soldSnapshot}
                    isLoading={soldBusy}
                    error={soldError}
                    showingPrevious={soldShowingPrevious}
                    onRetry={() => void loadSoldComps(card)}
                    excludedAnchorCount={
                      marketExcludedAnchorIds.length + soldExcludedAnchorIds.length
                    }
                    onExcludeAnchor={(observationId) =>
                      excludeSoldCompAnchor(card, observationId)
                    }
                    onRestoreAnchors={() => restoreSoldCompAnchors(card)}
                    updatedRecommendation={valuationSnapshot}
                    isRecommendationUpdating={valuationBusy}
                    recommendationError={valuationError}
                    onReviewRecommendation={() =>
                      reviewUpdatedRecommendation(card)
                    }
                    selectedMatchId={selectedSoldMatchId}
                    confirmedMatchId={confirmedSoldMatchId}
                    isConfirmingMatch={confirmingSoldMatchId !== null}
                    onSelectMatch={(sale) =>
                      setSelectedSoldMatchId(sale?.id ?? null)
                    }
                    onConfirmMatch={(sale) =>
                      void confirmSoldCompMatch(card, sale)
                    }
                  />
                )}
                {isValuationOpen && !isEditing && (
                  <CardValuationPanel
                    card={card}
                    snapshot={valuationSnapshot}
                    isLoading={valuationBusy}
                    isSaving={valuationSaving}
                    error={valuationError}
                    showingPrevious={valuationShowingPrevious}
                    amountInput={valuationAmountInput}
                    currency={valuationCurrency}
                    confidence={valuationConfidence}
                    onAmountChange={setValuationAmountInput}
                    onConfidenceChange={setValuationConfidence}
                    onSave={() => void saveConfirmedValuation(card)}
                    onClear={() => void clearConfirmedValuation(card)}
                    onRetry={() => void loadValuationRecommendation(card)}
                    onClose={closeValuationPanel}
                    excludedComparisonCount={
                      marketExcludedAnchorIds.length + soldExcludedAnchorIds.length
                    }
                    onRestoreComparisons={() =>
                      restoreAllPricingComparisons(card)
                    }
                  />
                )}
              </article>
            );
          })}
        </div>
      )}
      {expandedImageCard && (
        <div
          className="collection-image-viewer"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setExpandedImageCard(null);
          }}
        >
          <section role="dialog" aria-modal="true" aria-label={`Full image of ${expandedImageCard.title}`}>
            <header>
              <strong>{expandedImageCard.title}</strong>
              <button type="button" onClick={() => setExpandedImageCard(null)}>Close</button>
            </header>
            <img
              src={expandedImageCard.images.frontUrl}
              alt={`Full front of ${expandedImageCard.title}`}
            />
          </section>
        </div>
      )}
      {sellingCard && <EbayListingDraft card={sellingCard} onClose={() => void refreshCollectionAfterSelling()} />}
      {listingQueueOpen && <EbayListingQueue cards={cards} onClose={() => setListingQueueOpen(false)} onOpenDraft={(card) => { setListingQueueOpen(false); setSellingCard(card); }} />}
    </section>
  );
}
