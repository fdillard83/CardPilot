import type {
  SavedCollectionCard,
  ValuationRecommendationSnapshot,
} from "../identification/types";

function formatPrice(amountCents: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(amountCents / 100);
}

function sourceStatusLabel(
  status: ValuationRecommendationSnapshot["evidence"]["sold"]["status"],
) {
  if (status === "available") return "Checked";
  if (status === "rate_limited") return "Request limit reached";
  if (status === "not_configured") return "Not connected";
  return "Temporarily unavailable";
}

export function CardValuationPanel({
  card,
  snapshot,
  isLoading,
  isSaving,
  error,
  showingPrevious,
  amountInput,
  currency,
  confidence,
  onAmountChange,
  onConfidenceChange,
  onSave,
  onClear,
  onRetry,
  onClose,
  excludedComparisonCount,
  onRestoreComparisons,
}: {
  card: SavedCollectionCard;
  snapshot: ValuationRecommendationSnapshot | null;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  showingPrevious: boolean;
  amountInput: string;
  currency: string;
  confidence: "low" | "medium" | "high";
  onAmountChange: (value: string) => void;
  onConfidenceChange: (value: "low" | "medium" | "high") => void;
  onSave: () => void;
  onClear: () => void;
  onRetry: () => void;
  onClose: () => void;
  excludedComparisonCount: number;
  onRestoreComparisons: () => void;
}) {
  const recommendation = snapshot?.recommendation ?? null;
  return (
    <section
      className="valuation-panel card-value-panel"
      aria-labelledby={`card-value-${card.collectionId}`}
    >
      <div className="valuation-heading">
        <div>
          <span className="step-label">CardPilot decision support</span>
          <h3 id={`card-value-${card.collectionId}`}>Estimated card value</h3>
        </div>
        <div className="card-value-heading-actions">
          <span className="valuation-source">Review before saving</span>
          <button type="button" disabled={isSaving} onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      {excludedComparisonCount > 0 && (
        <div className="variant-anchor-controls" role="status">
          <span>
            {excludedComparisonCount} comparison
            {excludedComparisonCount === 1 ? " is" : "s are"} excluded from
            this recommendation for the current card.
          </span>
          <button
            type="button"
            disabled={isLoading || isSaving}
            onClick={onRestoreComparisons}
          >
            Restore all and recalculate
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="valuation-loading" role="status">
          <span className="spinner" /> Checking sold evidence and active market
          support...
        </div>
      ) : (
        <>
          {error && (
            <div className="valuation-error" role="alert">
              <strong>
                {snapshot
                  ? "Refresh failed—showing the previously retrieved estimate."
                  : "The estimate could not be refreshed."}
              </strong>
              <span>{error}</span>
              <button type="button" onClick={onRetry}>Try again</button>
            </div>
          )}

          {snapshot && (
            <div
              className={`pricing-snapshot-status${showingPrevious ? " pricing-snapshot-status-previous" : ""}`}
              role="status"
            >
              <strong>
                {showingPrevious ? "Previously retrieved estimate" : "Latest estimate"}
              </strong>
              <span>
                Combined pricing · Last successful update{" "}
                {new Date(snapshot.generatedAt).toLocaleString()}
              </span>
            </div>
          )}

          {recommendation ? (
            <div className="card-value-recommendation">
              <div className="card-value-hero">
                <span>CardPilot recommended value</span>
                <strong>
                  {formatPrice(
                    recommendation.amountCents,
                    recommendation.currency,
                  )}
                </strong>
                <small>
                  Modeled range {formatPrice(
                    recommendation.typicalRange.lowAmountCents,
                    recommendation.currency,
                  )} to {formatPrice(
                    recommendation.typicalRange.highAmountCents,
                    recommendation.currency,
                  )}
                </small>
                {recommendation.pricePointAdjustment.applied && (
                  <small>
                    Rounded up from {formatPrice(
                      recommendation.pricePointAdjustment.originalAmountCents,
                      recommendation.currency,
                    )} to the next CardPilot price point ending in .25, .50,
                    or .95.
                  </small>
                )}
              </div>
              <div className="card-value-basis">
                <span
                  className={`market-confidence market-confidence-${recommendation.confidence}`}
                >
                  {recommendation.confidence} confidence
                </span>
                <strong>{recommendation.methodLabel}</strong>
                <p>{recommendation.rationale}</p>
              </div>
              {recommendation.blend && (
                <div className="card-value-blend">
                  <div>
                    <span>Current active listings</span>
                    <strong>
                      {Math.round(recommendation.blend.activeWeight * 100)}% ·{" "}
                      {formatPrice(
                        recommendation.blend.activeAmountCents,
                        recommendation.currency,
                      )}
                    </strong>
                    <small>
                      {recommendation.blend.activeCount} current asking-price
                      observation
                      {recommendation.blend.activeCount === 1 ? "" : "s"}
                    </small>
                  </div>
                  <div>
                    <span>Completed sales</span>
                    <strong>
                      {Math.round(
                        recommendation.blend.completedSalesWeight * 100,
                      )}% ·{" "}
                      {formatPrice(
                        recommendation.blend.completedSalesAmountCents,
                        recommendation.currency,
                      )}
                    </strong>
                    <small>
                      {recommendation.blend.completedSalesCount} completed sale
                      {recommendation.blend.completedSalesCount === 1 ? "" : "s"}
                    </small>
                  </div>
                </div>
              )}
              {snapshot?.activeAskingReference &&
                recommendation.method.includes("sold") && (
                  <div className="card-value-active-reference">
                    <span>{snapshot.activeAskingReference.label}</span>
                    <strong>
                      {formatPrice(
                        snapshot.activeAskingReference.amountCents,
                        snapshot.activeAskingReference.currency,
                      )}
                    </strong>
                    <small>
                      {snapshot.activeAskingReference.listingCount} active listing
                      {snapshot.activeAskingReference.listingCount === 1 ? "" : "s"}
                    </small>
                  </div>
                )}
              {recommendation.warnings.map((warning) => (
                <div className="card-value-warning" role="note" key={warning.code}>
                  <strong>Review this single-sale estimate carefully</strong>
                  <span>
                    Only one completed sale contributes to the recommendation. The
                    variant-adjusted active asking estimate is {formatPrice(
                      warning.activeAmountCents,
                      warning.activeCurrency,
                    )}, which is substantially {warning.direction}. Review both
                    before confirming a value.
                  </span>
                </div>
              ))}
            </div>
          ) : (
            !error && (
              <div className="card-value-empty">
                <strong>No reliable pricing estimate was available.</strong>
                <span>
                  You can still enter a collector-confirmed value below and refresh
                  the pricing later.
                </span>
              </div>
            )
          )}

          {snapshot && (
            <div className="valuation-evidence-grid">
              <div>
                <span>The Card API sold comps</span>
                <strong>{sourceStatusLabel(snapshot.evidence.sold.status)}</strong>
                <small>
                  {snapshot.evidence.sold.exactCount} exact, {snapshot.evidence.sold.broaderCount} broader, {snapshot.evidence.sold.variantEstimateCount} modeled
                </small>
              </div>
              <div>
                <span>eBay active market</span>
                <strong>{sourceStatusLabel(snapshot.evidence.active.status)}</strong>
                <small>
                  {snapshot.evidence.active.exactCount} exact, {snapshot.evidence.active.broaderCount} broader, {snapshot.evidence.active.variantEstimateCount} modeled
                </small>
              </div>
            </div>
          )}

          <div className="confirmed-value-editor">
            <div className="confirmed-value-editor-heading">
              <div>
                <span>Collector confirmation</span>
                <strong>Confirm or adjust this card's value</strong>
              </div>
              <span>{currency}</span>
            </div>
            <div className="confirmed-value-fields">
              <label>
                <span>Confirmed value</span>
                <div className="money-input">
                  <span>{currency === "USD" ? "$" : currency}</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={amountInput}
                    placeholder="0.00"
                    onChange={(event) => onAmountChange(event.target.value)}
                  />
                </div>
              </label>
              <label>
                <span>Confidence</span>
                <select
                  value={confidence}
                  onChange={(event) =>
                    onConfidenceChange(
                      event.target.value as "low" | "medium" | "high",
                    )
                  }
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </label>
            </div>
            <p>
              You can replace an automatically saved value with your own amount at
              any time. Saving stores only the confirmed value, confidence,
              valuation method, and date. Provider listings and sales are not added
              to the collection record.
            </p>
            <div className="confirmed-value-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={isSaving || amountInput.trim() === ""}
                onClick={onSave}
              >
                {isSaving ? "Saving value..." : "Save confirmed value"}
              </button>
              {card.confirmedValuation && (
                <button
                  type="button"
                  className="clear-confirmed-value"
                  disabled={isSaving}
                  onClick={onClear}
                >
                  Clear saved value
                </button>
              )}
            </div>
          </div>

          {snapshot && <p className="valuation-disclaimer">{snapshot.disclaimer}</p>}
        </>
      )}
    </section>
  );
}

export type BulkValuationResult = {
  card: SavedCollectionCard;
  snapshot: ValuationRecommendationSnapshot | null;
  error: string | null;
};

export function BulkValuationReview({
  results,
  selectedIds,
  completedCount,
  totalCount,
  isRefreshing,
  isApplying,
  error,
  onToggle,
  onApply,
  onDismiss,
}: {
  results: BulkValuationResult[];
  selectedIds: string[];
  completedCount: number;
  totalCount: number;
  isRefreshing: boolean;
  isApplying: boolean;
  error: string | null;
  onToggle: (cardId: string) => void;
  onApply: () => void;
  onDismiss: () => void;
}) {
  const recommendedCount = results.filter(
    (result) => result.snapshot?.recommendation,
  ).length;
  return (
    <section className="bulk-valuation" aria-labelledby="bulk-valuation-title">
      <div className="bulk-valuation-heading">
        <div>
          <span className="step-label">Collection pricing review</span>
          <h2 id="bulk-valuation-title">Refresh collection values</h2>
          <p>
            CardPilot checks one card at a time to reduce provider pressure. No
            values are saved until you approve the selected recommendations.
          </p>
        </div>
        <span>{completedCount} of {totalCount} checked</span>
      </div>

      {isRefreshing && (
        <div className="bulk-valuation-progress" role="status">
          <span className="spinner" /> Preparing fresh recommendations...
          <progress value={completedCount} max={Math.max(totalCount, 1)} />
        </div>
      )}

      {error && (
        <div className="market-fallback-note" role="alert">
          <strong>Collection refresh paused.</strong>
          <span>{error}</span>
        </div>
      )}

      {results.length > 0 && (
        <div className="bulk-valuation-list">
          {results.map((result) => {
            const recommendation = result.snapshot?.recommendation ?? null;
            return (
              <label
                className={`bulk-valuation-row${recommendation ? "" : " bulk-valuation-row-unavailable"}`}
                key={result.card.collectionId}
              >
                <input
                  type="checkbox"
                  checked={selectedIds.includes(result.card.collectionId)}
                  disabled={!recommendation || isApplying}
                  onChange={() => onToggle(result.card.collectionId)}
                />
                <img src={result.card.images.frontUrl} alt="" />
                <span className="bulk-valuation-card-copy">
                  <strong>{result.card.title}</strong>
                  <small>
                    Current: {result.card.confirmedValuation
                      ? formatPrice(
                          result.card.confirmedValuation.amountCents,
                          result.card.confirmedValuation.currency,
                        )
                      : "Not valued"}
                  </small>
                  {result.error && <em>{result.error}</em>}
                </span>
                <span className="bulk-valuation-recommendation">
                  {recommendation ? (
                    <>
                      <strong>
                        {formatPrice(
                          recommendation.amountCents,
                          recommendation.currency,
                        )}
                      </strong>
                      <small>{recommendation.methodLabel}</small>
                      <em>{recommendation.confidence} confidence</em>
                    </>
                  ) : (
                    <small>Manual value needed</small>
                  )}
                </span>
              </label>
            );
          })}
        </div>
      )}

      {!isRefreshing && (
        <div className="bulk-valuation-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={selectedIds.length === 0 || isApplying}
            onClick={onApply}
          >
            {isApplying
              ? "Saving selected values..."
              : `Save ${selectedIds.length} selected value${selectedIds.length === 1 ? "" : "s"}`}
          </button>
          <button type="button" disabled={isApplying} onClick={onDismiss}>
            {recommendedCount === 0 ? "Close" : "Not now"}
          </button>
        </div>
      )}
    </section>
  );
}
