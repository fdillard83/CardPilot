import type {
  AccountPreferences,
} from "../accounts/preferences";
import type {
  SavedCollectionCard,
  ValuationMethod,
  ValuationRecommendationSnapshot,
} from "../identification/types";

const valuationMethodLabels: Record<ValuationMethod, string> = {
  blended_exact_market: "Blended exact market evidence",
  blended_broader_market: "Blended broader market evidence",
  blended_variant_market: "Blended variant-adjusted market evidence",
  exact_sold: "Exact completed sales",
  broader_sold: "Broader completed sales",
  variant_sold: "Variant-adjusted completed sales",
  exact_active: "Exact active asking prices",
  broader_active: "Broader active asking prices",
  variant_active: "Variant-adjusted active asking prices",
  active_listing: "Current eBay listing price",
  manual: "Collector-entered value",
};

const staleAfterMs = 30 * 24 * 60 * 60 * 1000;

export function valuationMethodLabel(method: ValuationMethod) {
  return valuationMethodLabels[method];
}

export function valuationIsStale(
  card: SavedCollectionCard,
  now = Date.now(),
) {
  const valuation = card.confirmedValuation;
  if (!valuation) return false;
  const valuedAt = Date.parse(valuation.valuedAt);
  const updatedAt = Date.parse(card.updatedAt);
  if (!Number.isFinite(valuedAt)) return true;
  return (
    now - valuedAt > staleAfterMs ||
    (Number.isFinite(updatedAt) && updatedAt > valuedAt)
  );
}

export function recommendationForStrategy(
  snapshot: ValuationRecommendationSnapshot,
  strategy: AccountPreferences["valuationStrategy"],
) {
  const recommendation = snapshot.recommendation;
  if (!recommendation) return null;
  return {
    ...recommendation,
    amountCents:
      snapshot.saleStrategyOptions?.[strategy]?.amountCents ??
      recommendation.amountCents,
  };
}
