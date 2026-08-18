import { useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { createCardDetailImages, prepareCardPhoto } from "../imaging/card-photo";
import { MAX_GROUP_CARDS, splitGroupCardPhoto } from "../imaging/group-card-photo";
import {
  fieldDefinitions,
  type CardIdentification,
  type FieldKey,
  type FieldValue,
  type SavedCollectionCard,
} from "../identification/types";

const MAX_BATCH_PHOTOS = 10;
const MAX_PARALLEL_IDENTIFICATIONS = 3;
const supportedTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

type BatchMode = "photos" | "group";
type BatchItem = {
  id: string;
  file: File;
  previewUrl: string;
  status: "ready" | "preparing" | "identifying" | "saving" | "saved" | "failed";
  confidence: number | null;
  title: string | null;
  error: string | null;
  savedCard: SavedCollectionCard | null;
};

async function pooledMap<T>(items: T[], concurrency: number, operation: (item: T) => Promise<void>) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await operation(items[index]);
    }
  });
  await Promise.all(workers);
}

function valuesFrom(identification: CardIdentification) {
  return Object.fromEntries(fieldDefinitions.map(({ key }) => [
    key,
    identification.fields[key].value,
  ])) as Record<FieldKey, FieldValue>;
}

function itemFromFile(file: File, index: number): BatchItem {
  return {
    id: `${file.name}-${file.lastModified}-${index}`,
    file,
    previewUrl: URL.createObjectURL(file),
    status: "ready",
    confidence: null,
    title: null,
    error: null,
    savedCard: null,
  };
}

export function BatchScanner({
  onCardsSaved,
  onOpenCollection,
}: {
  onCardsSaved: (cards: SavedCollectionCard[]) => void;
  onOpenCollection: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<BatchMode>("photos");
  const [items, setItems] = useState<BatchItem[]>([]);
  const [isSplitting, setIsSplitting] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const updateItem = (id: string, update: Partial<BatchItem>) => {
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...update } : item));
  };

  const replaceItems = (files: File[]) => {
    setItems((current) => {
      current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      return files.map(itemFromFile);
    });
  };

  const chooseMode = (nextMode: BatchMode) => {
    if (isRunning || isSplitting) return;
    setMode(nextMode);
    replaceItems([]);
    setError(null);
  };

  const handleFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const selected = [...(event.target.files ?? [])];
    event.target.value = "";
    if (!selected.length) return;
    const invalid = selected.find((file) => !supportedTypes.has(file.type) || file.size > 12 * 1024 * 1024);
    if (invalid) {
      setError("Each photo must be a JPG, PNG, WebP, or GIF no larger than 12 MB.");
      return;
    }
    setError(null);
    if (mode === "photos") {
      if (selected.length > MAX_BATCH_PHOTOS) {
        setError(`Choose no more than ${MAX_BATCH_PHOTOS} photos in one batch.`);
        return;
      }
      replaceItems(selected);
      return;
    }
    setIsSplitting(true);
    try {
      replaceItems(await splitGroupCardPhoto(selected[0]));
    } catch (caughtError) {
      replaceItems([]);
      setError(caughtError instanceof Error ? caughtError.message : "CardPilot could not split that group photo.");
    } finally {
      setIsSplitting(false);
    }
  };

  const processItem = async (item: BatchItem) => {
    try {
      updateItem(item.id, { status: "preparing", error: null });
      const prepared = await prepareCardPhoto(item.file);
      const frontDetailImages = await createCardDetailImages(prepared.image);
      updateItem(item.id, { status: "identifying" });
      const identifyResponse = await fetch("/api/identify-card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frontImage: prepared.image, backImage: null, frontDetailImages }),
      });
      const identifyPayload = await identifyResponse.json().catch(() => null) as
        | { identification?: CardIdentification; error?: string }
        | null;
      if (!identifyResponse.ok || !identifyPayload?.identification) {
        throw new Error(identifyPayload?.error ?? "This card could not be identified.");
      }
      const identification = identifyPayload.identification;
      if (identification.status === "not_sports_card" || identification.status === "not_trading_card") {
        throw new Error("CardPilot did not recognize a supported trading card in this crop.");
      }
      updateItem(item.id, {
        status: "saving",
        confidence: identification.overallConfidence,
        title: identification.summary,
      });
      const saveResponse = await fetch("/api/collection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identificationId: identification.identificationId,
          fields: valuesFrom(identification),
          overallConfidence: identification.overallConfidence,
          decision: identification.decision.action,
          frontImage: prepared.image,
          backImage: null,
          ebayReference: null,
          pokemonCatalogReference: null,
        }),
      });
      const savePayload = await saveResponse.json().catch(() => null) as
        | { card?: SavedCollectionCard; error?: string }
        | null;
      if (!saveResponse.ok || !savePayload?.card) {
        throw new Error(savePayload?.error ?? "This card could not be saved.");
      }
      updateItem(item.id, {
        status: "saved",
        confidence: identification.overallConfidence,
        title: savePayload.card.title,
        savedCard: savePayload.card,
      });
      return savePayload.card;
    } catch (caughtError) {
      updateItem(item.id, {
        status: "failed",
        error: caughtError instanceof Error ? caughtError.message : "This card could not be processed.",
      });
      return null;
    }
  };

  const startBatch = async () => {
    if (!items.length || isRunning) return;
    setIsRunning(true);
    setError(null);
    const saved: SavedCollectionCard[] = [];
    await pooledMap(items, MAX_PARALLEL_IDENTIFICATIONS, async (item) => {
      const card = await processItem(item);
      if (card) saved.push(card);
    });
    if (saved.length) onCardsSaved(saved);
    setIsRunning(false);
  };

  const completed = items.filter((item) => item.status === "saved").length;
  const failed = items.filter((item) => item.status === "failed").length;
  const finished = items.length > 0 && completed + failed === items.length;
  const progress = items.length ? Math.round(((completed + failed) / items.length) * 100) : 0;

  return (
    <section className="batch-scanner" aria-labelledby="batch-scanner-title">
      <div className="batch-heading">
        <div>
          <span className="step-label">Faster intake</span>
          <h2 id="batch-scanner-title">Add a batch of cards</h2>
          <p>Use separate photos for the best accuracy, or let CardPilot split a carefully arranged group photo.</p>
        </div>
        <span className="batch-limit">Up to {mode === "photos" ? MAX_BATCH_PHOTOS : MAX_GROUP_CARDS} cards</span>
      </div>
      <div className="batch-mode-picker" role="group" aria-label="Batch photo type">
        <button type="button" className={mode === "photos" ? "active" : ""} onClick={() => chooseMode("photos")}>Multiple card photos</button>
        <button type="button" className={mode === "group" ? "active" : ""} onClick={() => chooseMode("group")}>One group photo</button>
      </div>
      <input
        ref={inputRef}
        className="visually-hidden"
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        multiple={mode === "photos"}
        onChange={(event) => void handleFiles(event)}
      />
      <button className="batch-picker" type="button" disabled={isRunning || isSplitting} onClick={() => inputRef.current?.click()}>
        <strong>{isSplitting ? "Finding individual cards…" : mode === "photos" ? "Choose up to 10 photos" : "Choose one group photo"}</strong>
        <span>{mode === "photos" ? "Each photo should show one complete card front." : "Arrange 2–9 cards on a plain contrasting surface with visible space between them."}</span>
      </button>
      {error && <div className="error-banner" role="alert"><strong>Batch needs attention.</strong><span>{error}</span></div>}
      {items.length > 0 && (
        <>
          <div className="batch-grid">
            {items.map((item, index) => (
              <article className={`batch-item batch-item-${item.status}`} key={item.id}>
                <img src={item.previewUrl} alt={`Batch card ${index + 1}`} />
                <div>
                  <strong>Card {index + 1}</strong>
                  <span>{item.status === "ready" ? "Ready" : item.status === "preparing" ? "Preparing image" : item.status === "identifying" ? "Identifying" : item.status === "saving" ? "Saving" : item.status === "saved" ? `${Math.round((item.confidence ?? 0) * 100)}% confidence` : "Needs attention"}</span>
                  {item.title && <small>{item.title}</small>}
                  {item.error && <small className="batch-item-error">{item.error}</small>}
                  {item.status === "saved" && (item.confidence ?? 0) < 0.8 && <small className="batch-review-flag">Review details in your collection</small>}
                </div>
              </article>
            ))}
          </div>
          {isRunning && (
            <div className="batch-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
              <span style={{ width: `${Math.max(4, progress)}%` }} />
            </div>
          )}
          <div className="batch-actions">
            {!finished ? (
              <button className="primary-action" type="button" disabled={isRunning} onClick={() => void startBatch()}>
                {isRunning ? `Processing ${completed + failed + 1} of ${items.length}…` : `Identify and save ${items.length} cards`}
              </button>
            ) : (
              <button className="primary-action" type="button" onClick={onOpenCollection}>View batch in My Collection</button>
            )}
            {!isRunning && <small>{finished ? `${completed} saved${failed ? ` · ${failed} need another photo` : ""}` : "Cards save independently, so one difficult photo will not stop the rest."}</small>}
          </div>
        </>
      )}
    </section>
  );
}
