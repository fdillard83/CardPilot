import { randomUUID } from "node:crypto";
import { readFile, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  CandidateValuesSchema,
  DecisionActionSchema,
} from "./identification/contracts.mjs";
import {
  deriveValuationProfile,
  valuationFeatureTypes,
} from "./valuation/variant-adjustment.mjs";
import { valuationMethods } from "./valuation/recommendation.mjs";
import {
  cardIdentity,
  isPokemonCard,
} from "./card-category.mjs";

const imageDataUrl = z
  .string()
  .regex(/^data:image\/(jpeg|png|webp|gif);base64,[a-z0-9+/=\r\n]+$/i);

const EbayReferenceSchema = z
  .object({
    itemId: z.string().min(1).max(200),
    title: z.string().min(1).max(500),
    itemWebUrl: z.string().url().nullable(),
  })
  .strict();

const PokemonCatalogReferenceSchema = z
  .object({
    cardId: z.string().min(1).max(200),
    label: z.string().min(1).max(500),
    imageUrl: z.string().url().nullable(),
    catalogUrl: z.string().url().nullable(),
  })
  .strict();

const rawGradingProfile = Object.freeze({
  isGraded: false,
  company: null,
  grade: null,
  certificationNumber: null,
});

export const GradingProfileSchema = z
  .object({
    isGraded: z.boolean(),
    company: z.string().trim().min(1).max(50).nullable(),
    grade: z.string().trim().min(1).max(20).nullable(),
    certificationNumber: z.string().trim().min(1).max(80).nullable(),
  })
  .strict()
  .superRefine((profile, context) => {
    if (profile.isGraded && (!profile.company || !profile.grade)) {
      context.addIssue({
        code: "custom",
        message: "Graded cards require a grading company and grade.",
      });
    }
    if (
      !profile.isGraded &&
      (profile.company || profile.grade || profile.certificationNumber)
    ) {
      context.addIssue({
        code: "custom",
        message: "Raw cards cannot include grading details.",
      });
    }
  });

export const ValuationProfileSchema = z
  .object({
    featureType: z.enum(valuationFeatureTypes),
    source: z.enum(["derived", "user_confirmed"]),
  })
  .strict();

export const ConfirmedValuationInputSchema = z
  .object({
    amountCents: z.number().int().min(0).max(100_000_000_000),
    currency: z.string().trim().regex(/^[A-Z]{3}$/),
    confidence: z.enum(["low", "medium", "high"]),
    method: z.enum(valuationMethods),
    userAdjusted: z.boolean().default(false),
  })
  .strict();

const ConfirmedValuationSchema = ConfirmedValuationInputSchema.extend({
  valuedAt: z.string().datetime(),
}).strict();

export const CollectionCreateSchema = z
  .object({
    identificationId: z.string().min(1).max(200),
    fields: CandidateValuesSchema,
    overallConfidence: z.number().min(0).max(1),
    decision: DecisionActionSchema,
    frontImage: imageDataUrl,
    backImage: imageDataUrl.nullable().default(null),
    ebayReference: EbayReferenceSchema.nullable().default(null),
    pokemonCatalogReference: PokemonCatalogReferenceSchema.nullable().default(null),
    grading: GradingProfileSchema.default(rawGradingProfile),
    valuationProfile: ValuationProfileSchema.optional(),
  })
  .strict();

export const CollectionUpdateSchema = z
  .object({
    fields: CandidateValuesSchema,
    grading: GradingProfileSchema.optional(),
    valuationProfile: ValuationProfileSchema.optional(),
    ebayReference: EbayReferenceSchema.nullable().optional(),
    pokemonCatalogReference: PokemonCatalogReferenceSchema.nullable().optional(),
  })
  .strict();

export function gradingFromRecord(record) {
  const parsed = GradingProfileSchema.safeParse(record.grading);
  return parsed.success ? parsed.data : { ...rawGradingProfile };
}

export function valuationProfileFromRecord(record) {
  const parsed = ValuationProfileSchema.safeParse(record.valuationProfile);
  return parsed.success
    ? parsed.data
    : deriveValuationProfile(fieldsFromRecord(record));
}

export function fieldsFromRecord(record) {
  return CandidateValuesSchema.parse(record.fields);
}

export function confirmedValuationFromRecord(record) {
  const parsed = ConfirmedValuationSchema.safeParse(record.confirmedValuation);
  return parsed.success ? parsed.data : null;
}

export function titleFromFields(fields) {
  const identity = cardIdentity(fields);
  if (isPokemonCard(fields)) {
    return (
      [
        fields.year,
        identity,
        fields.setOrInsert ?? fields.product,
        fields.cardNumber ? `#${fields.cardNumber}` : null,
      ]
        .filter(Boolean)
        .join(" ") || "Saved Pokémon card"
    );
  }
  return (
    [fields.year, identity, fields.setOrInsert ?? fields.product]
      .filter(Boolean)
      .join(" ") || "Saved sports card"
  );
}
export function decodeImage(dataUrl) {
  const match = dataUrl.match(
    /^data:image\/(jpeg|png|webp|gif);base64,([a-z0-9+/=\r\n]+)$/i,
  );
  if (!match) throw new TypeError("A valid card image is required.");

  const subtype = match[1].toLowerCase();
  const mimeType = subtype === "jpg" ? "image/jpeg" : `image/${subtype}`;
  const extension = subtype === "jpeg" ? "jpg" : subtype;
  const buffer = Buffer.from(match[2].replace(/[\r\n]/g, ""), "base64");
  if (buffer.length === 0 || buffer.length > 12 * 1024 * 1024) {
    throw new TypeError("Saved card images must be between 1 byte and 12 MB.");
  }
  return { buffer, extension, mimeType };
}

export function publicRecord(record) {
  const fields = fieldsFromRecord(record);
  return {
    collectionId: record.collectionId,
    identificationId: record.identificationId,
    title: record.title,
    fields,
    overallConfidence: record.overallConfidence,
    decision: record.decision,
    ebayReference: record.ebayReference ?? null,
    pokemonCatalogReference: record.pokemonCatalogReference ?? null,
    grading: gradingFromRecord(record),
    valuationProfile: valuationProfileFromRecord(record),
    confirmedValuation: confirmedValuationFromRecord(record),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    images: {
      frontUrl: `/api/collection/${encodeURIComponent(record.collectionId)}/images/front`,
      backUrl: record.images.back
        ? `/api/collection/${encodeURIComponent(record.collectionId)}/images/back`
        : null,
    },
  };
}

export class CollectionStore {
  constructor({ recordsFile, imagesDirectory, now = () => new Date() }) {
    this.recordsFile = recordsFile;
    this.imagesDirectory = imagesDirectory;
    this.now = now;
    this.mutation = Promise.resolve();
  }

  async list() {
    await this.mutation;
    const records = await this.readRecords();
    return records
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map(publicRecord);
  }

  async get(collectionId) {
    await this.mutation;
    const records = await this.readRecords();
    const record = records.find((item) => item.collectionId === collectionId);
    return record ? publicRecord(record) : null;
  }

  async create(input) {
    const validated = CollectionCreateSchema.parse(input);
    return this.enqueue(async () => {
      const collectionId = randomUUID();
      const timestamp = this.now().toISOString();
      const front = decodeImage(validated.frontImage);
      const back = validated.backImage ? decodeImage(validated.backImage) : null;
      const frontFileName = `${collectionId}-front.${front.extension}`;
      const backFileName = back
        ? `${collectionId}-back.${back.extension}`
        : null;

      await mkdir(this.imagesDirectory, { recursive: true });
      await writeFile(path.join(this.imagesDirectory, frontFileName), front.buffer);
      if (back && backFileName) {
        await writeFile(path.join(this.imagesDirectory, backFileName), back.buffer);
      }

      try {
        const records = await this.readRecords();
        const record = {
          collectionId,
          identificationId: validated.identificationId,
          title: titleFromFields(validated.fields),
          fields: validated.fields,
          overallConfidence: validated.overallConfidence,
          decision: validated.decision,
          ebayReference: validated.ebayReference,
          pokemonCatalogReference: validated.pokemonCatalogReference,
          grading: validated.grading,
          valuationProfile:
            validated.valuationProfile ?? deriveValuationProfile(validated.fields),
          confirmedValuation: null,
          createdAt: timestamp,
          updatedAt: timestamp,
          images: {
            front: { fileName: frontFileName, mimeType: front.mimeType },
            back:
              back && backFileName
                ? { fileName: backFileName, mimeType: back.mimeType }
                : null,
          },
        };
        records.push(record);
        await this.writeRecords(records);
        return publicRecord(record);
      } catch (error) {
        await Promise.allSettled([
          rm(path.join(this.imagesDirectory, frontFileName), { force: true }),
          ...(backFileName
            ? [rm(path.join(this.imagesDirectory, backFileName), { force: true })]
            : []),
        ]);
        throw error;
      }
    });
  }

  async update(collectionId, input) {
    const validated = CollectionUpdateSchema.parse(input);
    return this.enqueue(async () => {
      const records = await this.readRecords();
      const index = records.findIndex(
        (record) => record.collectionId === collectionId,
      );
      if (index < 0) return null;

      const currentValuationProfile = valuationProfileFromRecord(records[index]);
      records[index] = {
        ...records[index],
        title: titleFromFields(validated.fields),
        fields: validated.fields,
        grading: validated.grading ?? gradingFromRecord(records[index]),
        valuationProfile:
          validated.valuationProfile ??
          (currentValuationProfile.source === "derived"
            ? deriveValuationProfile(validated.fields)
            : currentValuationProfile),
        ebayReference:
          validated.ebayReference === undefined
            ? records[index].ebayReference
            : validated.ebayReference,
        pokemonCatalogReference:
          validated.pokemonCatalogReference === undefined
            ? records[index].pokemonCatalogReference ?? null
            : validated.pokemonCatalogReference,
        updatedAt: this.now().toISOString(),
      };
      await this.writeRecords(records);
      return publicRecord(records[index]);
    });
  }

  async remove(collectionId) {
    return this.enqueue(async () => {
      const records = await this.readRecords();
      const record = records.find((item) => item.collectionId === collectionId);
      if (!record) return false;

      await this.writeRecords(
        records.filter((item) => item.collectionId !== collectionId),
      );
      await Promise.allSettled(
        [record.images.front, record.images.back]
          .filter(Boolean)
          .map((image) =>
            rm(path.join(this.imagesDirectory, image.fileName), { force: true }),
          ),
      );
      return true;
    });
  }

  async updateConfirmedValuation(collectionId, input) {
    const validated = ConfirmedValuationInputSchema.parse(input);
    return this.enqueue(async () => {
      const records = await this.readRecords();
      const index = records.findIndex(
        (record) => record.collectionId === collectionId,
      );
      if (index < 0) return null;
      const timestamp = this.now().toISOString();
      records[index] = {
        ...records[index],
        confirmedValuation: { ...validated, valuedAt: timestamp },
        updatedAt: timestamp,
      };
      await this.writeRecords(records);
      return publicRecord(records[index]);
    });
  }

  async clearConfirmedValuation(collectionId) {
    return this.enqueue(async () => {
      const records = await this.readRecords();
      const index = records.findIndex(
        (record) => record.collectionId === collectionId,
      );
      if (index < 0) return null;
      records[index] = {
        ...records[index],
        confirmedValuation: null,
        updatedAt: this.now().toISOString(),
      };
      await this.writeRecords(records);
      return publicRecord(records[index]);
    });
  }

  async image(collectionId, side) {
    await this.mutation;
    const records = await this.readRecords();
    const record = records.find((item) => item.collectionId === collectionId);
    const image = record?.images?.[side] ?? null;
    if (!image) return null;
    return {
      filePath: path.join(this.imagesDirectory, image.fileName),
      mimeType: image.mimeType,
    };
  }

  enqueue(operation) {
    const next = this.mutation.then(operation, operation);
    this.mutation = next.catch(() => undefined);
    return next;
  }

  async readRecords() {
    try {
      const contents = await readFile(this.recordsFile, "utf8");
      const records = JSON.parse(contents);
      return Array.isArray(records) ? records : [];
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
  }

  async writeRecords(records) {
    await mkdir(path.dirname(this.recordsFile), { recursive: true });
    await writeFile(this.recordsFile, `${JSON.stringify(records, null, 2)}\n`, "utf8");
  }
}
