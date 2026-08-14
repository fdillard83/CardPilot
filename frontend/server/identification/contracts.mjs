import { z } from "zod";

export const fieldKeys = [
  "category",
  "player",
  "character",
  "sport",
  "team",
  "year",
  "manufacturer",
  "product",
  "brand",
  "setOrInsert",
  "cardNumber",
  "language",
  "rarity",
  "raritySymbol",
  "finish",
  "promo",
  "rookieStatus",
  "parallel",
  "serialNumber",
  "autograph",
  "memorabilia",
  "imageVariation",
];

export const FieldKeySchema = z.enum(fieldKeys);
export const IdentificationStatusSchema = z.enum([
  "identified",
  "partial",
  "not_sports_card",
  "not_trading_card",
]);
export const DecisionActionSchema = z.enum([
  "auto_accept",
  "confirm",
  "review",
]);

const confidence = z.number().min(0).max(1);
const EvidenceReferenceSchema = z.string().min(1);
const inferenceSource = z.enum([
  "visible",
  "catalog",
  "candidate",
  "mixed",
  "unknown",
  "user_correction",
]);

const fieldResult = (valueSchema) =>
  z
    .object({
      value: valueSchema.nullable(),
      confidence,
      evidenceIds: z.array(EvidenceReferenceSchema),
      inferenceSource,
      missingEvidence: z.array(z.string()),
    })
    .strict();

export const StringFieldResultSchema = fieldResult(z.string());
export const BooleanFieldResultSchema = fieldResult(z.boolean());
const unknownStringField = {
  value: null,
  confidence: 0,
  evidenceIds: [],
  inferenceSource: "unknown",
  missingEvidence: [],
};
const unknownBooleanField = { ...unknownStringField };

export const IdentificationFieldsSchema = z
  .object({
    category: StringFieldResultSchema.default(unknownStringField),
    player: StringFieldResultSchema,
    character: StringFieldResultSchema.default(unknownStringField),
    sport: StringFieldResultSchema,
    team: StringFieldResultSchema,
    year: StringFieldResultSchema,
    manufacturer: StringFieldResultSchema,
    product: StringFieldResultSchema,
    brand: StringFieldResultSchema,
    setOrInsert: StringFieldResultSchema,
    cardNumber: StringFieldResultSchema,
    language: StringFieldResultSchema.default(unknownStringField),
    rarity: StringFieldResultSchema.default(unknownStringField),
    raritySymbol: StringFieldResultSchema.default(unknownStringField),
    finish: StringFieldResultSchema.default(unknownStringField),
    promo: BooleanFieldResultSchema.default(unknownBooleanField),
    rookieStatus: BooleanFieldResultSchema,
    parallel: StringFieldResultSchema,
    serialNumber: StringFieldResultSchema,
    autograph: BooleanFieldResultSchema,
    memorabilia: BooleanFieldResultSchema,
    imageVariation: BooleanFieldResultSchema,
  })
  .strict();

export const EvidenceItemSchema = z
  .object({
    id: z.string().min(1),
    field: FieldKeySchema,
    source: z.enum([
      "front_image",
      "back_image",
      "model_knowledge",
      "catalog",
      "user_correction",
    ]),
    observation: z.string().min(1),
    location: z.string().nullable(),
    strength: confidence,
  })
  .strict();

export const MissingEvidenceSchema = z
  .object({
    field: FieldKeySchema,
    description: z.string().min(1),
    suggestedSource: z.enum([
      "back_image",
      "front_retake",
      "catalog",
      "user_review",
    ]),
    expectedConfidenceGain: confidence,
  })
  .strict();

const candidateValuesShape = {
  category: z.string().nullable().default(null),
  player: z.string().nullable(),
  character: z.string().nullable().default(null),
  sport: z.string().nullable(),
  team: z.string().nullable(),
  year: z.string().nullable(),
  manufacturer: z.string().nullable(),
  product: z.string().nullable(),
  brand: z.string().nullable(),
  setOrInsert: z.string().nullable(),
  cardNumber: z.string().nullable(),
  language: z.string().nullable().default(null),
  rarity: z.string().nullable().default(null),
  raritySymbol: z.string().nullable().default(null),
  finish: z.string().nullable().default(null),
  promo: z.boolean().nullable().default(null),
  rookieStatus: z.boolean().nullable(),
  parallel: z.string().nullable(),
  serialNumber: z.string().nullable(),
  autograph: z.boolean().nullable(),
  memorabilia: z.boolean().nullable(),
  imageVariation: z.boolean().nullable(),
};

export const CandidateValuesSchema = z.object(candidateValuesShape).strict();

export const CandidateMatchSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    source: z.enum(["model_knowledge", "catalog", "provisional"]),
    catalogRecordId: z.string().nullable(),
    values: CandidateValuesSchema,
    matchConfidence: confidence,
    supportingFields: z.array(FieldKeySchema),
    conflictingFields: z.array(FieldKeySchema),
    basis: z.string(),
  })
  .strict();

export const TrustDecisionSchema = z
  .object({
    action: DecisionActionSchema,
    reviewRequired: z.boolean(),
    reviewRequirement: z.enum(["none", "confirmation", "full_review"]),
    reasons: z.array(z.string()),
    blockers: z.array(z.string()),
  })
  .strict();

export const BackPhotoGuidanceSchema = z
  .object({
    provided: z.boolean(),
    suggested: z.boolean(),
    expectedConfidenceGain: confidence,
    reason: z.string().nullable(),
  })
  .strict();

export const PipelineStageSchema = z
  .object({
    name: z.enum([
      "image_intake",
      "evidence_extraction",
      "semantic_normalization",
      "candidate_generation",
      "verification",
      "confidence_scoring",
      "overall_decision",
    ]),
    status: z.enum(["completed", "degraded"]),
    durationMs: z.number().int().min(0),
  })
  .strict();

export const CardIdentificationResultSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    identificationId: z.string().min(1),
    status: IdentificationStatusSchema,
    fields: IdentificationFieldsSchema,
    evidence: z.array(EvidenceItemSchema),
    missingEvidence: z.array(MissingEvidenceSchema),
    candidateMatches: z.array(CandidateMatchSchema).max(5),
    overallConfidence: confidence,
    decision: TrustDecisionSchema,
    backPhoto: BackPhotoGuidanceSchema,
    summary: z.string(),
    pipeline: z
      .object({
        model: z.string(),
        totalDurationMs: z.number().int().min(0),
        stages: z.array(PipelineStageSchema),
      })
      .strict(),
    createdAt: z.string(),
  })
  .strict();

export const scalarValueSchema = z.union([z.string(), z.boolean(), z.null()]);
const booleanCorrectionFields = new Set([
  "promo",
  "rookieStatus",
  "autograph",
  "memorabilia",
  "imageVariation",
]);
const CorrectionItemSchema = z
  .object({
    field: FieldKeySchema,
    originalValue: scalarValueSchema,
    originalConfidence: confidence,
    correctedValue: scalarValueSchema,
  })
  .strict()
  .superRefine((correction, context) => {
    const expectsBoolean = booleanCorrectionFields.has(correction.field);
    const values = [correction.originalValue, correction.correctedValue];
    const valuesHaveExpectedType = values.every(
      (value) =>
        value === null ||
        (expectsBoolean ? typeof value === "boolean" : typeof value === "string"),
    );

    if (!valuesHaveExpectedType) {
      context.addIssue({
        code: "custom",
        message: expectsBoolean
          ? "This field requires a boolean or null value."
          : "This field requires a string or null value.",
      });
    }
  });

export const CorrectionSubmissionSchema = z
  .object({
    identificationId: z.string().min(1),
    schemaVersion: z.literal("1.0"),
    corrections: z.array(CorrectionItemSchema).min(1),
    metadata: z
      .object({
        overallConfidence: confidence,
        decision: DecisionActionSchema,
        backPhotoProvided: z.boolean(),
        source: z.literal("editable_confirmation"),
      })
      .strict(),
  })
  .strict();

export const modelObservationSchema = z
  .object({
    imageSide: z.enum(["front", "back"]),
    observation: z.string().min(1),
    location: z.string().nullable(),
    strength: confidence,
  })
  .strict();

const modelField = (valueSchema) =>
  z
    .object({
      value: valueSchema.nullable(),
      confidence,
      observations: z.array(modelObservationSchema).max(3),
    })
    .strict();

export const ModelCandidateSchema = z
  .object({
    label: z.string().min(1),
    values: CandidateValuesSchema,
    plausibility: confidence,
    basis: z.string(),
    catalogRecordId: z.string().nullable(),
  })
  .strict();

export const ModelNumericReadingSchema = z
  .object({
    field: FieldKeySchema,
    imageSide: z.enum(["front", "back"]),
    location: z.string(),
    value: z.string().min(1).max(20),
    confidence,
    characters: z
      .array(
        z
          .object({
            position: z.number().int().min(0),
            character: z.string().min(1).max(1),
            confidence,
            alternatives: z.array(z.string().min(1).max(1)).max(3),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();

export const ModelVisibleMarkSchema = z
  .object({
    text: z.string().min(1),
    kind: z.enum([
      "player_name",
      "character_name",
      "team_mark",
      "manufacturer_logo",
      "anniversary_mark",
      "product_title",
      "insert_title",
      "set_symbol",
      "rarity_mark",
      "language_mark",
      "card_number",
      "serial_stamp",
      "copyright_year",
      "other",
    ]),
    imageSide: z.enum(["front", "back"]),
    location: z.string().nullable(),
    confidence,
  })
  .strict();

export const ModelVisualFeatureSchema = z
  .object({
    description: z.string().min(1),
    imageSide: z.enum(["front", "back"]),
    location: z.string().nullable(),
    confidence,
  })
  .strict();

export const ModelEvidenceExtractionSchema = z
  .object({
    status: IdentificationStatusSchema,
    fields: z
      .object({
        category: modelField(z.string()).default({
          value: null,
          confidence: 0,
          observations: [],
        }),
        player: modelField(z.string()),
        character: modelField(z.string()).default({
          value: null,
          confidence: 0,
          observations: [],
        }),
        sport: modelField(z.string()),
        team: modelField(z.string()),
        year: modelField(z.string()),
        manufacturer: modelField(z.string()),
        product: modelField(z.string()),
        brand: modelField(z.string()),
        setOrInsert: modelField(z.string()),
        cardNumber: modelField(z.string()),
        language: modelField(z.string()).default({
          value: null,
          confidence: 0,
          observations: [],
        }),
        rarity: modelField(z.string()).default({
          value: null,
          confidence: 0,
          observations: [],
        }),
        raritySymbol: modelField(z.string()).default({
          value: null,
          confidence: 0,
          observations: [],
        }),
        finish: modelField(z.string()).default({
          value: null,
          confidence: 0,
          observations: [],
        }),
        promo: modelField(z.boolean()).default({
          value: null,
          confidence: 0,
          observations: [],
        }),
        rookieStatus: modelField(z.boolean()),
        parallel: modelField(z.string()),
        serialNumber: modelField(z.string()),
        autograph: modelField(z.boolean()),
        memorabilia: modelField(z.boolean()),
        imageVariation: modelField(z.boolean()),
      })
      .strict(),
    numericReadings: z.array(ModelNumericReadingSchema).max(12),
    visibleMarks: z.array(ModelVisibleMarkSchema).max(20),
    visualFeatures: z.array(ModelVisualFeatureSchema).max(12),
    candidateSuggestions: z.array(ModelCandidateSchema).max(3),
    missingEvidence: z.array(MissingEvidenceSchema).max(8),
    summary: z.string(),
  })
  .strict();

export const ModelCandidateGenerationSchema = z
  .object({
    candidates: z.array(ModelCandidateSchema).max(5),
  })
  .strict();
