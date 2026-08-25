import { randomUUID } from "node:crypto";
import {
  CollectionCreateSchema,
  CollectionUpdateSchema,
  ConfirmedValuationInputSchema,
  decodeImage,
  gradingFromRecord,
  publicRecord,
  titleFromFields,
  valuationProfileFromRecord,
} from "../collection-store.mjs";
import { deriveValuationProfile } from "../valuation/variant-adjustment.mjs";
import { encodeBackupThumbnail } from "../account-backup-image.mjs";

const BACKUP_CARD_CONCURRENCY = 6;

async function mapWithConcurrency(items, concurrency, operation) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await operation(items[index]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

function databaseError(operation, error) {
  const wrapped = new Error(`Supabase ${operation} failed.`);
  wrapped.cause = error;
  return wrapped;
}

export class SupabaseCollectionRepository {
  constructor({
    client,
    bucket = "card-images",
    now = () => new Date(),
    backupImageEncoder = encodeBackupThumbnail,
  }) {
    this.client = client;
    this.bucket = bucket;
    this.now = now;
    this.backupImageEncoder = backupImageEncoder;
    this.mode = "supabase";
  }

  async list(userId) {
    const { data, error } = await this.client
      .from("collection_cards")
      .select("record")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });
    if (error) throw databaseError("collection list", error);
    return (data ?? []).map(({ record }) => publicRecord(record));
  }

  async get(userId, collectionId) {
    const record = await this.#record(userId, collectionId);
    return record ? publicRecord(record) : null;
  }

  async create(userId, input) {
    const validated = CollectionCreateSchema.parse(input);
    const collectionId = randomUUID();
    const timestamp = this.now().toISOString();
    const front = decodeImage(validated.frontImage);
    const back = validated.backImage ? decodeImage(validated.backImage) : null;
    const frontPath = `${userId}/${collectionId}/front.${front.extension}`;
    const backPath = back
      ? `${userId}/${collectionId}/back.${back.extension}`
      : null;

    await this.#upload(frontPath, front);
    try {
      if (back && backPath) await this.#upload(backPath, back);
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
          front: { objectPath: frontPath, mimeType: front.mimeType },
          back:
            back && backPath
              ? { objectPath: backPath, mimeType: back.mimeType }
              : null,
        },
      };
      const { error } = await this.client.from("collection_cards").insert({
        collection_id: collectionId,
        user_id: userId,
        record,
        created_at: timestamp,
        updated_at: timestamp,
      });
      if (error) throw databaseError("collection insert", error);
      return publicRecord(record);
    } catch (error) {
      await this.#removeObjects([frontPath, backPath]);
      throw error;
    }
  }

  async update(userId, collectionId, input) {
    const validated = CollectionUpdateSchema.parse(input);
    const record = await this.#record(userId, collectionId);
    if (!record) return null;
    const currentValuationProfile = valuationProfileFromRecord(record);
    const updatedAt = this.now().toISOString();
    const updated = {
      ...record,
      title: titleFromFields(validated.fields),
      fields: validated.fields,
      grading: validated.grading ?? gradingFromRecord(record),
      valuationProfile:
        validated.valuationProfile ??
        (currentValuationProfile.source === "derived"
          ? deriveValuationProfile(validated.fields)
          : currentValuationProfile),
      ebayReference:
        validated.ebayReference === undefined
          ? record.ebayReference
          : validated.ebayReference,
      pokemonCatalogReference:
        validated.pokemonCatalogReference === undefined
          ? record.pokemonCatalogReference ?? null
          : validated.pokemonCatalogReference,
      updatedAt,
    };
    await this.#updateRecord(userId, collectionId, updated, updatedAt);
    return publicRecord(updated);
  }

  async remove(userId, collectionId) {
    const record = await this.#record(userId, collectionId);
    if (!record) return false;
    const { error } = await this.client
      .from("collection_cards")
      .delete()
      .eq("collection_id", collectionId)
      .eq("user_id", userId);
    if (error) throw databaseError("collection delete", error);
    await this.#removeObjects([
      record.images?.front?.objectPath,
      record.images?.back?.objectPath,
    ]);
    return true;
  }

  async updateConfirmedValuation(userId, collectionId, input) {
    const validated = ConfirmedValuationInputSchema.parse(input);
    const record = await this.#record(userId, collectionId);
    if (!record) return null;
    const updatedAt = this.now().toISOString();
    const updated = {
      ...record,
      confirmedValuation: { ...validated, valuedAt: updatedAt },
      updatedAt,
    };
    await this.#updateRecord(userId, collectionId, updated, updatedAt);
    return publicRecord(updated);
  }

  async clearConfirmedValuation(userId, collectionId) {
    const record = await this.#record(userId, collectionId);
    if (!record) return null;
    const updatedAt = this.now().toISOString();
    const updated = { ...record, confirmedValuation: null, updatedAt };
    await this.#updateRecord(userId, collectionId, updated, updatedAt);
    return publicRecord(updated);
  }

  async image(userId, collectionId, side) {
    const record = await this.#record(userId, collectionId);
    const image = record?.images?.[side] ?? null;
    if (!image?.objectPath) return null;
    const { data, error } = await this.client.storage
      .from(this.bucket)
      .createSignedUrl(image.objectPath, 300);
    if (error || !data?.signedUrl) {
      throw databaseError("private image link", error);
    }
    return { signedUrl: data.signedUrl, mimeType: image.mimeType };
  }

  async export(userId) {
    const { data, error } = await this.client
      .from("collection_cards")
      .select("record")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });
    if (error) throw databaseError("collection export", error);
    return mapWithConcurrency(
      data ?? [],
      BACKUP_CARD_CONCURRENCY,
      async ({ record }) => {
        const imageWarnings = [];
        const encode = async (image, side) => {
          if (!image?.objectPath) return null;
          let lastError = null;
          for (let attempt = 0; attempt < 3; attempt += 1) {
            const { data: blob, error: downloadError } = await this.client.storage
              .from(this.bucket)
              .download(image.objectPath);
            if (!downloadError && blob) {
              try {
                return await this.backupImageEncoder(blob, image.mimeType);
              } catch (encodingError) {
                lastError = encodingError;
                break;
              }
            }
            lastError = downloadError;
          }
          console.warn("A private card image could not be included in an account backup", {
            collectionId: record.collectionId,
            side,
            error: lastError?.message ?? lastError,
          });
          imageWarnings.push(
            `${side} image was unavailable when this backup was created.`,
          );
          return null;
        };
        return {
          ...publicRecord(record),
          images: {
            front: await encode(record.images?.front, "Front"),
            back: await encode(record.images?.back, "Back"),
          },
          ...(imageWarnings.length ? { imageWarnings } : {}),
        };
      },
    );
  }

  async removeAllForUser(userId) {
    const { data, error } = await this.client
      .from("collection_cards")
      .select("record")
      .eq("user_id", userId);
    if (error) throw databaseError("account collection lookup", error);
    const paths = (data ?? []).flatMap(({ record }) => [
      record.images?.front?.objectPath,
      record.images?.back?.objectPath,
    ]).filter(Boolean);
    if (paths.length > 0) {
      const { error: storageError } = await this.client.storage
        .from(this.bucket)
        .remove(paths);
      if (storageError) throw databaseError("account image removal", storageError);
    }
    const { error: deleteError } = await this.client
      .from("collection_cards")
      .delete()
      .eq("user_id", userId);
    if (deleteError) throw databaseError("account collection removal", deleteError);
    return { cardCount: data?.length ?? 0, imageCount: paths.length };
  }

  async #record(userId, collectionId) {
    const { data, error } = await this.client
      .from("collection_cards")
      .select("record")
      .eq("collection_id", collectionId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw databaseError("collection lookup", error);
    return data?.record ?? null;
  }

  async #updateRecord(userId, collectionId, record, updatedAt) {
    const { data, error } = await this.client
      .from("collection_cards")
      .update({ record, updated_at: updatedAt })
      .eq("collection_id", collectionId)
      .eq("user_id", userId)
      .select("collection_id");
    if (error) throw databaseError("collection update", error);
    if (!data || data.length !== 1) {
      throw databaseError("collection update", new Error("Card not found."));
    }
  }

  async #upload(objectPath, image) {
    const { error } = await this.client.storage
      .from(this.bucket)
      .upload(objectPath, image.buffer, {
        contentType: image.mimeType,
        cacheControl: "3600",
        upsert: false,
      });
    if (error) throw databaseError("private image upload", error);
  }

  async #removeObjects(paths) {
    const validPaths = paths.filter(Boolean);
    if (validPaths.length === 0) return;
    const { error } = await this.client.storage.from(this.bucket).remove(validPaths);
    if (error) console.error("Supabase image cleanup failed", { message: error.message });
  }
}
