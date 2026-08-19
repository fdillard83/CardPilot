import {
  buildActiveMarketQuery,
  buildPokemonDiscoveryQueries,
  evaluateCardTitleMatch,
} from "../valuation/active-market.mjs";
import {
  buildVariantAdjustedEstimates,
  buildVariantDiscoveryQuery,
  deriveValuationProfile,
} from "../valuation/variant-adjustment.mjs";
import { isPokemonCard } from "../card-category.mjs";
import { suggestionsFromListingTitle } from "../ebay/image-search.mjs";

const soldCompsDisclaimer =
  "Completed-sale records are supplied by The Card API and are informational comparisons, not an appraisal or guaranteed value. Exact and broader title matches remain separate, and marketplace fee or buyer-premium treatment can differ by platform.";

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function cents(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0
    ? Math.round(number * 100)
    : null;
}

function quantile(sorted, percentile) {
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * percentile;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return Math.round(
    sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower),
  );
}

function statistics(sales) {
  const sorted = [...sales].sort(
    (left, right) => left.salePriceCents - right.salePriceCents,
  );
  let included = sorted;
  if (sorted.length >= 5) {
    const prices = sorted.map((sale) => sale.salePriceCents);
    const firstQuartile = quantile(prices, 0.25);
    const thirdQuartile = quantile(prices, 0.75);
    const range = thirdQuartile - firstQuartile;
    const low = Math.max(0, firstQuartile - range * 1.5);
    const high = thirdQuartile + range * 1.5;
    included = sorted.filter(
      (sale) => sale.salePriceCents >= low && sale.salePriceCents <= high,
    );
  }
  const prices = included.map((sale) => sale.salePriceCents);
  return {
    included,
    medianSalePriceCents: quantile(prices, 0.5),
    typicalRange: {
      lowAmountCents: quantile(prices, included.length >= 4 ? 0.25 : 0),
      highAmountCents: quantile(prices, included.length >= 4 ? 0.75 : 1),
    },
    outlierCount: sorted.length - included.length,
    confidence:
      included.length >= 5
        ? "high"
        : included.length >= 3
          ? "medium"
          : "low",
  };
}

function saleId(sale, index) {
  return (
    sale.id ??
    `${sale.platform}:${sale.listingUrl ?? sale.title}:${sale.soldAt ?? sale.saleDate ?? index}`
  );
}

function mergeCoverage(results) {
  const from = results
    .map((result) => result.coverage.from)
    .filter(Boolean)
    .sort()[0] ?? null;
  const to = results
    .map((result) => result.coverage.to)
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;
  return {
    from,
    to,
    platforms: [
      ...new Set(results.flatMap((result) => result.coverage.platforms)),
    ],
  };
}

export function buildSoldCompsSnapshot({
  fields,
  grading,
  valuationProfile = deriveValuationProfile(fields),
  query,
  queriesUsed = [query],
  results,
  excludedObservationIds = [],
  searchedAt = new Date().toISOString(),
  identityConsensus = {},
}) {
  const uniqueSales = new Map();
  results.flatMap((result) => result.sales).forEach((sale, index) => {
    uniqueSales.set(saleId(sale, index), sale);
  });
  const candidates = [...uniqueSales.values()];
  const excludedObservationIdSet = new Set(excludedObservationIds);
  const eligible = candidates.filter(
    (sale, index) =>
      !excludedObservationIdSet.has(saleId(sale, index)) &&
      sale.priceConfirmed === true &&
      cents(sale.price) !== null &&
      Boolean(cleanText(sale.currency)),
  );

  function fromMatch(sale, match, matchTier, index) {
    return {
      id: saleId(sale, index),
      title: sale.title,
      platform: sale.platform,
      listingType: sale.listingType,
      saleDate: sale.saleDate,
      soldAt: sale.soldAt,
      salePriceCents: cents(sale.price),
      originalPriceCents: cents(sale.originalPrice),
      shippingPriceCents: cents(sale.shippingPrice),
      currency: sale.currency,
      bids: sale.bids,
      imageUrl: sale.imageUrl,
      listingUrl: sale.listingUrl,
      condition: sale.condition,
      grader: sale.grader,
      grade: sale.grade,
      matchScore: match.score,
      matchedSignals: match.matchedSignals,
      matchTier,
      suggestions: suggestionsFromListingTitle(sale.title),
    };
  }

  const exactSales = eligible.flatMap((sale, index) => {
    const match = evaluateCardTitleMatch(sale.title, fields, {
      identityConsensus,
      visualMatch: sale.visualMatch,
    });
    return match ? [fromMatch(sale, match, "exact", index)] : [];
  });
  const exactIds = new Set(exactSales.map((sale) => sale.id));
  const broaderSales =
    exactSales.length < 3
      ? eligible.flatMap((sale, index) => {
          if (exactIds.has(saleId(sale, index))) return [];
          const match = evaluateCardTitleMatch(sale.title, fields, {
            broader: true,
            identityConsensus,
            visualMatch: sale.visualMatch,
          });
          return match ? [fromMatch(sale, match, "broader", index)] : [];
        })
      : [];

  const buckets = new Map();
  for (const sale of [...exactSales, ...broaderSales]) {
    const key = `${sale.matchTier}:${sale.platform}:${sale.currency}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(sale);
  }
  const groups = [...buckets.values()]
    .map((sales) => {
      const summary = statistics(sales);
      const { platform, currency, matchTier } = sales[0];
      return {
        id: `${matchTier}_${platform.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
        label: `${platform} ${matchTier === "broader" ? "broader" : "exact"} sold comps`,
        platform,
        matchTier,
        currency,
        saleCount: summary.included.length,
        medianSalePriceCents: summary.medianSalePriceCents,
        typicalRange: summary.typicalRange,
        outlierCount: summary.outlierCount,
        confidence: matchTier === "broader" ? "low" : summary.confidence,
        sales: summary.included
          .sort((left, right) => {
            const scoreDifference = right.matchScore - left.matchScore;
            if (scoreDifference !== 0) return scoreDifference;
            return (right.soldAt ?? right.saleDate ?? "").localeCompare(
              left.soldAt ?? left.saleDate ?? "",
            );
          })
          .slice(0, 10),
      };
    })
    .sort((left, right) => {
      if (left.matchTier !== right.matchTier) {
        return left.matchTier === "exact" ? -1 : 1;
      }
      return right.saleCount - left.saleCount;
    });

  const variantEstimates =
    exactSales.length < 3 && !isPokemonCard(fields)
      ? buildVariantAdjustedEstimates({
          fields,
          valuationProfile,
          observationType: "completed_sale",
          observations: eligible.map((sale, index) => ({
            id: saleId(sale, index),
            title: sale.title,
            amountCents: cents(sale.price),
            currency: sale.currency,
            platform: sale.platform,
            imageUrl: sale.imageUrl,
            url: sale.listingUrl,
            date: sale.soldAt ?? sale.saleDate,
            printRun: sale.printRun,
            features: sale.features,
          })),
          excludedObservationIds: [
            ...exactSales.map((sale) => sale.id),
            ...broaderSales.map((sale) => sale.id),
            ...excludedObservationIds,
          ],
        })
      : [];

  return {
    schemaVersion: "1.0",
    kind: "sold_comparables",
    source: {
      provider: "the_card_api",
      displayName: "The Card API",
    },
    query,
    queriesUsed,
    searchedAt,
    coverage: mergeCoverage(results),
    conditionProfile: grading.isGraded
      ? {
          classification: "graded",
          label: `${grading.company} ${grading.grade}`,
        }
      : { classification: "raw", label: "Raw / ungraded" },
    valuationProfile,
    candidateCount: candidates.length,
    confirmedPriceCount: eligible.length,
    exactMatchedCount: exactSales.length,
    broaderMatchedCount: broaderSales.length,
    excludedCount: candidates.length - exactSales.length - broaderSales.length,
    groups,
    variantEstimates,
    identityConsensusFields: Object.keys(identityConsensus),
    disclaimer: soldCompsDisclaimer,
  };
}

export class SoldCompsService {
  constructor({
    cardApiClient,
    visualMatcher = null,
    now = () => Date.now(),
    cacheDurationMs = 10 * 60 * 1000,
  }) {
    if (!cardApiClient) throw new TypeError("A The Card API client is required.");
    this.cardApiClient = cardApiClient;
    this.visualMatcher = visualMatcher;
    this.now = now;
    this.cacheDurationMs = cacheDurationMs;
    this.cache = new Map();
  }

  async snapshot(
    fields,
    grading,
    valuationProfile = deriveValuationProfile(fields),
    {
      excludedObservationIds = [],
      identityConsensus = {},
      identityConsensusPromise = null,
      sourceImageDataUrl = null,
    } = {},
  ) {
    const query = buildActiveMarketQuery(fields);
    if (!query) {
      throw new TypeError(
        "Add a player or Pokémon name, year, set, or card number before checking sold comparisons.",
      );
    }
    const profile = grading?.isGraded
      ? `${grading.company ?? ""}:${grading.grade ?? ""}`
      : "raw";
    const cacheKey = `${query.toLowerCase()}|${profile.toLowerCase()}|${valuationProfile.featureType}:${valuationProfile.source}`;
    const cached = this.cache.get(cacheKey);
    const resolvedIdentityConsensus = identityConsensusPromise
      ? await identityConsensusPromise
      : identityConsensus;
    const normalizedGrading = grading?.isGraded
      ? grading
      : {
          isGraded: false,
          company: null,
          grade: null,
          certificationNumber: null,
        };
    const snapshotFrom = ({ results, queriesUsed, searchedAt }) =>
      buildSoldCompsSnapshot({
        fields,
        grading: normalizedGrading,
        valuationProfile,
        query,
        queriesUsed,
        results,
        excludedObservationIds,
        searchedAt,
        identityConsensus: resolvedIdentityConsensus,
      });
    if (cached && cached.expiresAt > this.now()) return snapshotFrom(cached);

    const searchOptions = grading?.isGraded
      ? {
          graded: true,
          grader: grading.company,
          grade: grading.grade,
        }
      : { graded: false };
    let primary = await this.cardApiClient.searchSales({
      query,
      ...searchOptions,
      limit: 100,
    });
    primary = await this.#rankResult(primary, sourceImageDataUrl);
    const results = [primary];
    const queriesUsed = [query];
    const searchedAt = new Date(this.now()).toISOString();
    let snapshot = buildSoldCompsSnapshot({
      fields,
      grading: normalizedGrading,
      valuationProfile,
      query,
      queriesUsed,
      results,
      searchedAt,
      identityConsensus: resolvedIdentityConsensus,
    });
    const discoveryQueries = isPokemonCard(fields)
      ? buildPokemonDiscoveryQueries(fields)
      : [buildVariantDiscoveryQuery(fields)].filter(Boolean);
    for (const discoveryQuery of discoveryQueries) {
      if (
        snapshot.exactMatchedCount + snapshot.broaderMatchedCount >= 3 ||
        discoveryQuery === query
      ) {
        break;
      }
      results.push(
        await this.#rankResult(
          await this.cardApiClient.searchSales({
            query: discoveryQuery,
            ...searchOptions,
            limit: 100,
          }),
          sourceImageDataUrl,
        ),
      );
      queriesUsed.push(discoveryQuery);
      snapshot = buildSoldCompsSnapshot({
        fields,
        grading: normalizedGrading,
        valuationProfile,
        query,
        queriesUsed,
        results,
        searchedAt,
        identityConsensus: resolvedIdentityConsensus,
      });
    }
    this.cache.set(cacheKey, {
      results,
      queriesUsed,
      searchedAt,
      expiresAt: this.now() + this.cacheDurationMs,
    });
    return snapshotFrom({ results, queriesUsed, searchedAt });
  }

  async #rankResult(result, sourceImageDataUrl) {
    if (!sourceImageDataUrl || !this.visualMatcher || !result?.sales?.length) {
      return result;
    }
    const candidates = result.sales.map((sale, index) => ({
      ...sale,
      id: saleId(sale, index),
    }));
    const ranked = await this.visualMatcher.rank({
      sourceImageDataUrl,
      candidates,
      limit: 20,
    });
    return { ...result, sales: ranked };
  }
}

export { soldCompsDisclaimer };
