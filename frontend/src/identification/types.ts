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
  disclaimer: string;
};

export type SavedCollectionCard = {
  collectionId: string;
  identificationId: string;
  title: string;
  fields: Record<FieldKey, FieldValue>;
  overallConfidence: number;
  decision: DecisionAction;
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
