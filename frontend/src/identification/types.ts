export const fieldDefinitions = [
  { key: "player", label: "Player", kind: "string" },
  { key: "sport", label: "Sport", kind: "string" },
  { key: "team", label: "Team", kind: "string" },
  { key: "year", label: "Year / season", kind: "string" },
  { key: "manufacturer", label: "Manufacturer", kind: "string" },
  { key: "product", label: "Product", kind: "string" },
  { key: "brand", label: "Brand", kind: "string" },
  { key: "setOrInsert", label: "Set / insert", kind: "string" },
  { key: "cardNumber", label: "Card number", kind: "string" },
  { key: "rookieStatus", label: "Rookie status", kind: "boolean" },
  { key: "parallel", label: "Parallel", kind: "string" },
  {
    key: "serialNumber",
    label: "Numbered Card Serial Number",
    kind: "string",
  },
  { key: "autograph", label: "Autograph", kind: "boolean" },
  { key: "memorabilia", label: "Memorabilia", kind: "boolean" },
  { key: "imageVariation", label: "Image variation", kind: "boolean" },
] as const;

export type FieldKey = (typeof fieldDefinitions)[number]["key"];
export type FieldValue = string | boolean | null;
export type DecisionAction = "auto_accept" | "confirm" | "review";

export const valuationFeatureOptions = [
  { value: "ordinary", label: "Ordinary non-auto / non-relic" },
  { value: "player_worn_relic", label: "Player-worn relic / jersey swatch" },
  { value: "game_used_relic", label: "Game-used single-color relic" },
  { value: "multi_color_patch", label: "Multi-color patch" },
  { value: "premium_game_used_patch", label: "Premium game-used patch" },
  { value: "sticker_autograph", label: "Sticker autograph" },
  { value: "on_card_autograph", label: "On-card autograph" },
  { value: "rookie_autograph", label: "Rookie autograph" },
  { value: "patch_autograph", label: "Patch + autograph" },
  { value: "rookie_patch_autograph", label: "Rookie Patch Auto (RPA)" },
  {
    value: "logo_shield_tag_autograph",
    label: "Logo / shield / tag + autograph",
  },
  { value: "relic_unspecified", label: "Relic / patch type not confirmed" },
  { value: "autograph_unspecified", label: "Autograph type not confirmed" },
  {
    value: "autograph_relic_unspecified",
    label: "Autograph + memorabilia type not confirmed",
  },
] as const;

export type ValuationFeatureType =
  (typeof valuationFeatureOptions)[number]["value"];

export type ValuationProfile = {
  featureType: ValuationFeatureType;
  source: "derived" | "user_confirmed";
};

export function deriveValuationProfile(
  fields: Record<FieldKey, FieldValue>,
): ValuationProfile {
  if (fields.autograph === true && fields.memorabilia === true) {
    return {
      featureType: "autograph_relic_unspecified",
      source: "derived",
    };
  }
  if (fields.autograph === true && fields.rookieStatus === true) {
    return { featureType: "rookie_autograph", source: "derived" };
  }
  if (fields.autograph === true) {
    return { featureType: "autograph_unspecified", source: "derived" };
  }
  if (fields.memorabilia === true) {
    return { featureType: "relic_unspecified", source: "derived" };
  }
  return { featureType: "ordinary", source: "derived" };
}

export type IdentificationField = {
  value: FieldValue;
  confidence: number;
  evidenceIds: string[];
  inferenceSource:
    | "visible"
    | "catalog"
    | "candidate"
    | "mixed"
    | "unknown"
    | "user_correction";
  missingEvidence: string[];
};

export type CardIdentification = {
  schemaVersion: "1.0";
  identificationId: string;
  status: "identified" | "partial" | "not_sports_card";
  fields: Record<FieldKey, IdentificationField>;
  evidence: Array<{
    id: string;
    field: FieldKey;
    source:
      | "front_image"
      | "back_image"
      | "model_knowledge"
      | "catalog"
      | "user_correction";
    observation: string;
    location: string | null;
    strength: number;
  }>;
  missingEvidence: Array<{
    field: FieldKey;
    description: string;
    suggestedSource:
      | "back_image"
      | "front_retake"
      | "catalog"
      | "user_review";
    expectedConfidenceGain: number;
  }>;
  candidateMatches: Array<{
    id: string;
    label: string;
    source: "model_knowledge" | "catalog" | "provisional";
    catalogRecordId: string | null;
    values: Record<FieldKey, FieldValue>;
    matchConfidence: number;
    supportingFields: FieldKey[];
    conflictingFields: FieldKey[];
    basis: string;
  }>;
  overallConfidence: number;
  decision: {
    action: DecisionAction;
    reviewRequired: boolean;
    reviewRequirement: "none" | "confirmation" | "full_review";
    reasons: string[];
    blockers: string[];
  };
  backPhoto: {
    provided: boolean;
    suggested: boolean;
    expectedConfidenceGain: number;
    reason: string | null;
  };
  summary: string;
  pipeline: {
    model: string;
    totalDurationMs: number;
    stages: Array<{
      name: string;
      status: "completed" | "degraded";
      durationMs: number;
    }>;
  };
  createdAt: string;
};

export type EbayImageSearchCandidate = {
  id: string;
  source: "ebay_browse";
  rank: number;
  itemId: string;
  title: string;
  itemWebUrl: string | null;
  imageUrl: string | null;
  price: {
    value: string;
    currency: string | null;
  } | null;
  shippingCost: {
    value: string;
    currency: string | null;
  } | null;
  condition: string | null;
  conditionId: string | null;
  buyingOptions: string[];
  categories: Array<{
    categoryId: string;
    categoryName: string | null;
  }>;
};

export type EbayImageSearchResult = {
  marketplaceId: string;
  total: number;
  candidates: EbayImageSearchCandidate[];
};

export type EbayItemDetails = {
  itemId: string;
  title: string;
  itemWebUrl: string | null;
  imageUrl: string | null;
  aspects: Array<{
    name: string;
    values: string[];
  }>;
  suggestions: {
    year: string | null;
    cardNumber: string | null;
    parallel: string | null;
    serialNumber: string | null;
  };
};

export type Correction = {
  field: FieldKey;
  originalValue: FieldValue;
  originalConfidence: number;
  correctedValue: FieldValue;
};

export type ActiveMarketListing = {
  itemId: string;
  title: string;
  itemWebUrl: string | null;
  imageUrl: string | null;
  condition: string | null;
  itemPriceCents: number;
  shippingCostCents: number | null;
  totalPriceCents: number;
  currency: string;
  matchScore: number;
  matchedSignals: string[];
  matchTier: "confirmed" | "strict" | "broader";
  confirmedReference: boolean;
};

export type ActiveMarketGroup = {
  id: string;
  label: string;
  classification: "raw" | "graded";
  matchTier: "exact" | "broader";
  currency: string;
  listingCount: number;
  medianAmountCents: number;
  typicalRange: {
    lowAmountCents: number;
    highAmountCents: number;
  };
  outlierCount: number;
  confidence: "low" | "medium" | "high";
  listings: ActiveMarketListing[];
};

export type ActiveMarketSnapshot = {
  schemaVersion: "1.0";
  kind: "active_asking_snapshot";
  source: {
    provider: "ebay_browse";
    displayName: "eBay Buy It Now";
    supportsSoldHistory: false;
  };
  marketplaceId: string;
  query: string;
  searchedAt: string;
  candidateCount: number;
  matchedCount: number;
  exactMatchedCount: number;
  broaderMatchedCount: number;
  excludedCount: number;
  groups: ActiveMarketGroup[];
  valuationProfile: ValuationProfile;
  variantEstimates: VariantAdjustedEstimate[];
  disclaimer: string;
};

export type SoldComparable = {
  id: string;
  title: string;
  platform: string;
  listingType: string | null;
  saleDate: string | null;
  soldAt: string | null;
  salePriceCents: number;
  originalPriceCents: number | null;
  shippingPriceCents: number | null;
  currency: string;
  bids: number | null;
  imageUrl: string | null;
  listingUrl: string | null;
  condition: string | null;
  grader: string | null;
  grade: string | null;
  matchScore: number;
  matchedSignals: string[];
  matchTier: "exact" | "broader";
};

export type SoldCompsGroup = {
  id: string;
  label: string;
  platform: string;
  matchTier: "exact" | "broader";
  currency: string;
  saleCount: number;
  medianSalePriceCents: number;
  typicalRange: {
    lowAmountCents: number;
    highAmountCents: number;
  };
  outlierCount: number;
  confidence: "low" | "medium" | "high";
  sales: SoldComparable[];
};

export type SoldCompsSnapshot = {
  schemaVersion: "1.0";
  kind: "sold_comparables";
  source: {
    provider: "the_card_api";
    displayName: "The Card API";
  };
  query: string;
  queriesUsed: string[];
  searchedAt: string;
  coverage: {
    from: string | null;
    to: string | null;
    platforms: string[];
  };
  conditionProfile: {
    classification: "raw" | "graded";
    label: string;
  };
  valuationProfile: ValuationProfile;
  candidateCount: number;
  confirmedPriceCount: number;
  exactMatchedCount: number;
  broaderMatchedCount: number;
  excludedCount: number;
  groups: SoldCompsGroup[];
  variantEstimates: VariantAdjustedEstimate[];
  disclaimer: string;
};

export type VariantAdjustedEstimate = {
  id: string;
  kind: "variant_adjusted_estimate";
  observationType: "completed_sale" | "active_asking";
  platform: string;
  currency: string;
  sourceProfile: {
    serialLabel: string;
    printRun: number | null;
    featureType: ValuationFeatureType;
    featureLabel: string;
  };
  targetProfile: {
    serialLabel: string;
    printRun: number | null;
    featureType: ValuationFeatureType;
    featureLabel: string;
    featureSource: "derived" | "user_confirmed";
  };
  lineageEvidence: {
    player: string;
    familyMatchType:
      | "set_or_insert"
      | "card_number"
      | "confirmed_visual_design";
    familyLabel: string;
  };
  sourceCount: number;
  sourceMedianAmountCents: number;
  estimatedAmountCents: number;
  estimatedRange: {
    lowAmountCents: number;
    highAmountCents: number;
  };
  combinedFactor: {
    low: number;
    midpoint: number;
    high: number;
  };
  direction: "up" | "down" | "similar";
  confidence: "low" | "medium";
  appliedAdjustments: Array<{
    dimension: "serial" | "feature";
    sourceLabel: string;
    targetLabel: string;
    lowFactor: number;
    midpointFactor: number;
    highFactor: number;
  }>;
  outlierCount: number;
  methodologyVersion: "1.1";
  sourceObservations: Array<{
    id: string;
    title: string;
    amountCents: number;
    currency: string;
    platform: string;
    imageUrl: string | null;
    url: string | null;
    date: string | null;
  }>;
};

export type ValuationMethod =
  | "blended_exact_market"
  | "blended_broader_market"
  | "blended_variant_market"
  | "exact_sold"
  | "broader_sold"
  | "variant_sold"
  | "exact_active"
  | "broader_active"
  | "variant_active"
  | "manual";

export type ConfirmedValuation = {
  amountCents: number;
  currency: string;
  confidence: "low" | "medium" | "high";
  method: ValuationMethod;
  userAdjusted: boolean;
  valuedAt: string;
};

export type ValuationRecommendationSnapshot = {
  schemaVersion: "1.0";
  kind: "card_valuation_recommendation";
  generatedAt: string;
  recommendation: {
    amountCents: number;
    currency: string;
    typicalRange: {
      lowAmountCents: number;
      highAmountCents: number;
    };
    confidence: "low" | "medium" | "high";
    method: Exclude<ValuationMethod, "manual">;
    methodLabel: string;
    sampleCount: number;
    rationale: string;
    warnings: Array<{
      code: "single_sale_active_disagreement";
      activeAmountCents: number;
      activeCurrency: string;
      activeListingCount: number;
      direction: "higher" | "lower";
    }>;
    blend: {
      activeWeight: number;
      completedSalesWeight: number;
      activeAmountCents: number;
      completedSalesAmountCents: number;
      activeCount: number;
      completedSalesCount: number;
    } | null;
  } | null;
  evidence: {
    sold: {
      status: "available" | "not_configured" | "rate_limited" | "unavailable";
      exactCount: number;
      broaderCount: number;
      variantEstimateCount: number;
    };
    active: {
      status: "available" | "not_configured" | "rate_limited" | "unavailable";
      exactCount: number;
      broaderCount: number;
      variantEstimateCount: number;
    };
  };
  activeAskingReference: {
    amountCents: number;
    currency: string;
    label: string;
    listingCount: number;
  } | null;
  disclaimer: string;
};

export type GradingProfile = {
  isGraded: boolean;
  company: string | null;
  grade: string | null;
  certificationNumber: string | null;
};

export type SavedCollectionCard = {
  collectionId: string;
  identificationId: string;
  title: string;
  fields: Record<FieldKey, FieldValue>;
  overallConfidence: number;
  decision: DecisionAction;
  grading: GradingProfile;
  valuationProfile: ValuationProfile;
  confirmedValuation: ConfirmedValuation | null;
  ebayReference: {
    itemId: string;
    title: string;
    itemWebUrl: string | null;
  } | null;
  createdAt: string;
  updatedAt: string;
  images: {
    frontUrl: string;
    backUrl: string | null;
  };
};

export function formatFieldValue(value: FieldValue) {
  if (value === null || value === "") return "Unknown";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return value;
}
