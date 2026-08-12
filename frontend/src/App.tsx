import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import "./App.css";
import { CollectionView } from "./collection/CollectionView";
import { ConfirmationEditor } from "./identification/ConfirmationEditor";
import {
  fieldDefinitions,
  formatFieldValue,
  type CardIdentification,
  type Correction,
  type EbayImageSearchCandidate,
  type EbayImageSearchResult,
  type EbayItemDetails,
  type FieldKey,
  type FieldValue,
  type SavedCollectionCard,
} from "./identification/types";

type ImageSide = "front" | "back";
type Resolution = "auto" | "confirmed" | "override" | null;
type FrontDetailImage = { label: string; image: string };

const MAX_FILE_SIZE = 12 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8.25 5.5 9.5 3.75h5L15.75 5.5H19a2.5 2.5 0 0 1 2.5 2.5v9A2.5 2.5 0 0 1 19 19.5H5A2.5 2.5 0 0 1 2.5 17V8A2.5 2.5 0 0 1 5 5.5h3.25Z" />
      <circle cx="12" cy="12.5" r="3.75" />
    </svg>
  );
}

function SparkIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2.5c.6 4.9 3.1 7.4 8 8-4.9.6-7.4 3.1-8 8-.6-4.9-3.1-7.4-8-8 4.9-.6 7.4-3.1 8-8Z" />
      <path d="M19 16.5c.2 2 1.2 3 3 3.3-1.8.2-2.8 1.2-3 3.2-.3-2-1.3-3-3.2-3.2 1.9-.3 2.9-1.3 3.2-3.3Z" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12h13M14 7l5 5-5 5" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m5 12.5 4.2 4.2L19 7" />
    </svg>
  );
}

function usePreviewUrl(file: File | null) {
  const url = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);

  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);

  return url;
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("The selected image could not be read."));
    };
    reader.onerror = () =>
      reject(new Error("The selected image could not be read."));
    reader.readAsDataURL(file);
  });
}

async function fileToOptimizedDataUrl(file: File, maxDimension = 2400) {
  if (typeof createImageBitmap !== "function" || file.type === "image/gif") {
    return fileToDataUrl(file);
  }

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 2.5 * 1024 * 1024) {
      return fileToDataUrl(file);
    }

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) return fileToDataUrl(file);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.92);
  } catch {
    return fileToDataUrl(file);
  } finally {
    bitmap?.close();
  }
}

async function createFrontDetailImages(file: File): Promise<FrontDetailImage[]> {
  if (typeof createImageBitmap !== "function") return [];

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
    const cropWidth = Math.max(1, Math.round(bitmap.width * 0.55));
    const cropHeight = Math.max(1, Math.round(bitmap.height * 0.55));
    const zones = [
      { label: "top-left", x: 0, y: 0 },
      { label: "top-right", x: bitmap.width - cropWidth, y: 0 },
      { label: "bottom-left", x: 0, y: bitmap.height - cropHeight },
      {
        label: "bottom-right",
        x: bitmap.width - cropWidth,
        y: bitmap.height - cropHeight,
      },
    ];

    return zones.flatMap((zone) => {
      const scale = Math.min(2, 960 / Math.max(cropWidth, cropHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(cropWidth * scale));
      canvas.height = Math.max(1, Math.round(cropHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) return [];

      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(
        bitmap as ImageBitmap,
        zone.x,
        zone.y,
        cropWidth,
        cropHeight,
        0,
        0,
        canvas.width,
        canvas.height,
      );

      return [
        {
          label: zone.label,
          image: canvas.toDataURL("image/jpeg", 0.88),
        },
      ];
    });
  } catch {
    return [];
  } finally {
    bitmap?.close();
  }
}

function validateImage(file: File) {
  if (!SUPPORTED_IMAGE_TYPES.has(file.type)) {
    return "Use a JPG, PNG, WebP, or GIF image.";
  }
  if (file.size > MAX_FILE_SIZE) {
    return "Choose an image smaller than 12 MB.";
  }
  return null;
}

function formatListingPrice(
  price: EbayImageSearchCandidate["price"],
) {
  if (!price) return "Price not listed";
  const numericValue = Number(price.value);
  if (!price.currency || !Number.isFinite(numericValue)) {
    return [price.currency, price.value].filter(Boolean).join(" ");
  }

  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: price.currency,
    }).format(numericValue);
  } catch {
    return `${price.currency} ${price.value}`;
  }
}

function isExactSerialNumber(value: FieldValue) {
  return typeof value === "string" && /^\d{1,5}\/\d{1,5}$/.test(value.trim());
}

function isPrintRunOnly(value: FieldValue) {
  return typeof value === "string" && /^\/\d{1,5}$/.test(value.trim());
}

function EbayMatchCard({
  candidate,
  isSelected,
  isLoadingDetails,
  isInteractionLocked,
  isConfirming,
  isConfirmed,
  suggestions,
  detailsError,
  updatedFieldLabels,
  onSelect,
  onConfirm,
  onReview,
}: {
  candidate: EbayImageSearchCandidate;
  isSelected: boolean;
  isLoadingDetails: boolean;
  isInteractionLocked: boolean;
  isConfirming: boolean;
  isConfirmed: boolean;
  suggestions: Partial<Record<FieldKey, FieldValue>>;
  detailsError: string | null;
  updatedFieldLabels: string[];
  onSelect: () => void;
  onConfirm: () => void;
  onReview: () => void;
}) {
  const suggestionCount = Object.keys(suggestions).length;

  return (
    <article
      className={`ebay-match-card${isSelected ? " ebay-match-card-selected" : ""}`}
    >
      <div className="ebay-match-image">
        {candidate.imageUrl ? (
          <img src={candidate.imageUrl} alt="" loading="lazy" />
        ) : (
          <span>No listing image</span>
        )}
        <span className="ebay-match-rank">Match {candidate.rank}</span>
      </div>
      <div className="ebay-match-body">
        <h4>{candidate.title}</h4>
        <div className="ebay-match-meta">
          <strong>{formatListingPrice(candidate.price)}</strong>
          {candidate.condition && <span>{candidate.condition}</span>}
        </div>
        {isSelected ? (
          <div className="ebay-inline-selection" role="status">
            <div className="ebay-inline-selection-heading">
              <CheckIcon />
              <strong>
                {isConfirmed ? "Same card confirmed" : "Closest match selected"}
              </strong>
            </div>

            {isLoadingDetails ? (
              <small>Checking seller-provided card details...</small>
            ) : detailsError ? (
              <small className="ebay-inline-error">{detailsError}</small>
            ) : suggestionCount > 0 ? (
              <>
                <small>CardPilot can use these listing details:</small>
                <div className="ebay-suggestions">
                  {suggestions.cardNumber && (
                    <span>Card number: {suggestions.cardNumber}</span>
                  )}
                  {suggestions.year && <span>Year: {suggestions.year}</span>}
                  {suggestions.parallel && (
                    <span>Parallel: {suggestions.parallel}</span>
                  )}
                  {suggestions.serialNumber && (
                    <span>Print run: {suggestions.serialNumber}</span>
                  )}
                </div>
              </>
            ) : (
              <small>
                This listing does not include extra year, card-number,
                parallel, or print-run details. You can still confirm the visual
                match.
              </small>
            )}

            {isConfirmed && (
              <small className="ebay-update-result">
                {updatedFieldLabels.length > 0
                  ? `Updated CardPilot: ${updatedFieldLabels.join(", ")}.`
                  : suggestionCount > 0
                    ? "CardPilot's details already matched the available listing details."
                    : "No additional listing details were available to update."}
              </small>
            )}

            <div className="ebay-inline-actions">
              {isConfirmed ? (
                <button type="button" onClick={onReview}>
                  Review card details
                </button>
              ) : (
                <button
                  type="button"
                  disabled={isLoadingDetails || isConfirming}
                  onClick={onConfirm}
                >
                  {isConfirming
                    ? "Updating CardPilot..."
                    : "Confirm same card & update details"}
                </button>
              )}
              <button
                type="button"
                disabled={isConfirming}
                onClick={onSelect}
              >
                {isConfirmed ? "Choose a different match" : "Clear selection"}
              </button>
            </div>
          </div>
        ) : (
          <button
            className="ebay-select-button"
            type="button"
            onClick={onSelect}
            disabled={isInteractionLocked}
          >
            This looks like my card
          </button>
        )}
        {candidate.itemWebUrl && (
          <a
            href={candidate.itemWebUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={`View ${candidate.title} on eBay`}
          >
            View active listing <ArrowIcon />
          </a>
        )}
      </div>
    </article>
  );
}

function FieldCard({
  fieldKey,
  identification,
  onEdit,
}: {
  fieldKey: FieldKey;
  identification: CardIdentification;
  onEdit: () => void;
}) {
  const definition = fieldDefinitions.find(({ key }) => key === fieldKey);
  const field = identification.fields[fieldKey];
  if (!definition) return null;

  return (
    <div className="detail-item">
      <div className="detail-label-row">
        <dt>{definition.label}</dt>
        <button type="button" onClick={onEdit} aria-label={`Edit ${definition.label}`}>
          Edit
        </button>
      </div>
      <dd>{formatFieldValue(field.value)}</dd>
      <small>
        {field.inferenceSource === "user_correction"
          ? "User edited"
          : `${Math.round(field.confidence * 100)}% field confidence`}
      </small>
    </div>
  );
}

function NumberedCardField({
  identification,
  onEdit,
}: {
  identification: CardIdentification;
  onEdit: () => void;
}) {
  const serialNumber = identification.fields.serialNumber.value;
  const isNumbered =
    typeof serialNumber === "string" && serialNumber.trim().length > 0;

  return (
    <div className="detail-item">
      <div className="detail-label-row">
        <dt>Numbered card</dt>
        <button type="button" onClick={onEdit} aria-label="Edit numbered card">
          Edit
        </button>
      </div>
      <dd>{isNumbered ? "Yes" : "No"}</dd>
      <small>
        {isNumbered
          ? `Derived from serial number ${serialNumber}`
          : "No serial number recorded"}
      </small>
    </div>
  );
}

function App() {
  const frontInputRef = useRef<HTMLInputElement>(null);
  const backInputRef = useRef<HTMLInputElement>(null);
  const originalIdentificationRef = useRef<CardIdentification | null>(null);
  const preparedImagesRef = useRef<{
    frontImage: string;
    backImage: string | null;
  } | null>(null);
  const ebayRequestIdRef = useRef(0);
  const ebayItemRequestIdRef = useRef(0);
  const identificationRequestIdRef = useRef(0);
  const [frontFile, setFrontFile] = useState<File | null>(null);
  const [backFile, setBackFile] = useState<File | null>(null);
  const [identification, setIdentification] =
    useState<CardIdentification | null>(null);
  const [isIdentifying, setIsIdentifying] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [resolution, setResolution] = useState<Resolution>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [applyingCandidateId, setApplyingCandidateId] = useState<string | null>(null);
  const [ebaySearch, setEbaySearch] =
    useState<EbayImageSearchResult | null>(null);
  const [isSearchingEbay, setIsSearchingEbay] = useState(false);
  const [ebayError, setEbayError] = useState<string | null>(null);
  const [selectedEbayCandidateId, setSelectedEbayCandidateId] = useState<
    string | null
  >(null);
  const [selectedEbayDetails, setSelectedEbayDetails] =
    useState<EbayItemDetails | null>(null);
  const [isLoadingEbayDetails, setIsLoadingEbayDetails] = useState(false);
  const [ebayDetailsError, setEbayDetailsError] = useState<string | null>(null);
  const [editorInitialValues, setEditorInitialValues] = useState<
    Partial<Record<FieldKey, FieldValue>>
  >({});
  const [confirmedEbayCandidateId, setConfirmedEbayCandidateId] = useState<
    string | null
  >(null);
  const [isConfirmingEbayMatch, setIsConfirmingEbayMatch] = useState(false);
  const [confirmedEbayUpdatedFields, setConfirmedEbayUpdatedFields] = useState<
    FieldKey[]
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"scan" | "collection">("scan");
  const [collectionCards, setCollectionCards] = useState<SavedCollectionCard[]>([]);
  const [isLoadingCollection, setIsLoadingCollection] = useState(true);
  const [collectionError, setCollectionError] = useState<string | null>(null);
  const [savedCollectionId, setSavedCollectionId] = useState<string | null>(null);
  const [isSavingCollection, setIsSavingCollection] = useState(false);
  const [identificationProgress, setIdentificationProgress] = useState("");
  const [identificationElapsedSeconds, setIdentificationElapsedSeconds] = useState(0);

  const frontPreview = usePreviewUrl(frontFile);
  const backPreview = usePreviewUrl(backFile);

  useEffect(() => {
    let isCurrent = true;
    void fetch("/api/collection")
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as
          | { cards?: SavedCollectionCard[]; error?: string }
          | null;
        if (!response.ok || !Array.isArray(payload?.cards)) {
          throw new Error(payload?.error ?? "CardPilot could not load your collection.");
        }
        if (isCurrent) setCollectionCards(payload.cards);
      })
      .catch((caughtError) => {
        if (isCurrent) {
          setCollectionError(
            caughtError instanceof Error
              ? caughtError.message
              : "CardPilot could not load your collection.",
          );
        }
      })
      .finally(() => {
        if (isCurrent) setIsLoadingCollection(false);
      });
    return () => {
      isCurrent = false;
    };
  }, []);

  useEffect(() => {
    if (!isIdentifying) return;

    const startedAt = Date.now();
    const updateProgress = () => {
      const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
      setIdentificationElapsedSeconds(elapsedSeconds);
      setIdentificationProgress(
        elapsedSeconds < 3
          ? "Preparing card photos"
          : elapsedSeconds < 10
            ? "Reading visible text and numbers"
            : elapsedSeconds < 22
              ? "Verifying card details"
              : "Finishing the evidence review",
      );
    };
    const timer = window.setInterval(updateProgress, 1000);
    return () => window.clearInterval(timer);
  }, [isIdentifying]);

  const openPicker = (side: ImageSide) => {
    if (isIdentifying) return;
    if (side === "front") frontInputRef.current?.click();
    else backInputRef.current?.click();
  };

  const handleFileChange = (
    side: ImageSide,
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const validationError = validateImage(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    setIdentification(null);
    originalIdentificationRef.current = null;
    preparedImagesRef.current = null;
    setIsEditing(false);
    setResolution(null);
    setSelectedCandidateId(null);
    setApplyingCandidateId(null);
    ebayRequestIdRef.current += 1;
    setEbaySearch(null);
    setIsSearchingEbay(false);
    setEbayError(null);
    ebayItemRequestIdRef.current += 1;
    setSelectedEbayCandidateId(null);
    setSelectedEbayDetails(null);
    setIsLoadingEbayDetails(false);
    setEbayDetailsError(null);
    setEditorInitialValues({});
    setConfirmedEbayCandidateId(null);
    setIsConfirmingEbayMatch(false);
    setConfirmedEbayUpdatedFields([]);
    setSavedCollectionId(null);

    if (side === "front") {
      setFrontFile(file);
      setBackFile(null);
      void identifyCard(file, null);
    } else {
      setBackFile(file);
      if (frontFile) void identifyCard(frontFile, file);
    }
  };

  const loadEbayCandidates = async (frontImage: string) => {
    const requestId = ++ebayRequestIdRef.current;
    setIsSearchingEbay(true);
    setEbaySearch(null);
    setEbayError(null);
    ebayItemRequestIdRef.current += 1;
    setSelectedEbayCandidateId(null);
    setSelectedEbayDetails(null);
    setIsLoadingEbayDetails(false);
    setEbayDetailsError(null);
    setConfirmedEbayCandidateId(null);
    setIsConfirmingEbayMatch(false);
    setConfirmedEbayUpdatedFields([]);

    try {
      const response = await fetch("/api/ebay/image-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frontImage, limit: 6 }),
      });
      const payload = (await response.json().catch(() => null)) as
        | (Partial<EbayImageSearchResult> & { error?: string })
        | null;

      if (!response.ok || !Array.isArray(payload?.candidates)) {
        throw new Error(
          payload?.error ?? "CardPilot could not load eBay image matches.",
        );
      }

      if (requestId !== ebayRequestIdRef.current) return;
      setEbaySearch({
        marketplaceId: payload.marketplaceId ?? "EBAY_US",
        total: payload.total ?? payload.candidates.length,
        candidates: payload.candidates,
      });
    } catch (caughtError) {
      if (requestId !== ebayRequestIdRef.current) return;
      setEbayError(
        caughtError instanceof Error
          ? caughtError.message
          : "CardPilot could not load eBay image matches.",
      );
    } finally {
      if (requestId === ebayRequestIdRef.current) {
        setIsSearchingEbay(false);
      }
    }
  };

  const identifyCard = async (
    selectedFrontFile: File,
    selectedBackFile: File | null,
  ) => {
    if (isIdentifying) return;
    const requestId = ++identificationRequestIdRef.current;

    setIdentificationProgress("Preparing card photos");
    setIdentificationElapsedSeconds(0);
    setIsIdentifying(true);
    setError(null);
    setIdentification(null);
    setResolution(null);
    setSelectedCandidateId(null);
    setApplyingCandidateId(null);
    ebayRequestIdRef.current += 1;
    setEbaySearch(null);
    setIsSearchingEbay(false);
    setEbayError(null);
    ebayItemRequestIdRef.current += 1;
    setSelectedEbayCandidateId(null);
    setSelectedEbayDetails(null);
    setIsLoadingEbayDetails(false);
    setEbayDetailsError(null);
    setEditorInitialValues({});
    setConfirmedEbayCandidateId(null);
    setIsConfirmingEbayMatch(false);
    setConfirmedEbayUpdatedFields([]);
    setSavedCollectionId(null);

    try {
      const [frontImage, backImage, frontDetailImages] = await Promise.all([
        fileToOptimizedDataUrl(selectedFrontFile),
        selectedBackFile
          ? fileToOptimizedDataUrl(selectedBackFile)
          : Promise.resolve(null),
        createFrontDetailImages(selectedFrontFile),
      ]);
      if (requestId !== identificationRequestIdRef.current) return;
      preparedImagesRef.current = { frontImage, backImage };
      void loadEbayCandidates(frontImage);
      const response = await fetch("/api/identify-card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frontImage, backImage, frontDetailImages }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { identification?: CardIdentification; error?: string }
        | null;

      if (requestId !== identificationRequestIdRef.current) return;

      if (!response.ok || !payload?.identification) {
        throw new Error(
          payload?.error ??
            (response.status >= 500
              ? "CardPilot's local service was interrupted. Your photo is still selected—try identification again."
              : "CardPilot could not identify this card."),
        );
      }

      originalIdentificationRef.current = payload.identification;
      setIdentification(payload.identification);
      setResolution(null);
      if (payload.identification.status === "not_sports_card") {
        ebayRequestIdRef.current += 1;
        setEbaySearch(null);
        setIsSearchingEbay(false);
      }
    } catch (caughtError) {
      if (requestId !== identificationRequestIdRef.current) return;
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "CardPilot could not identify this card.",
      );
    } finally {
      if (requestId === identificationRequestIdRef.current) {
        setIsIdentifying(false);
      }
    }
  };

  const resetScan = () => {
    identificationRequestIdRef.current += 1;
    setFrontFile(null);
    setBackFile(null);
    setIdentification(null);
    originalIdentificationRef.current = null;
    preparedImagesRef.current = null;
    setIsEditing(false);
    setResolution(null);
    setSelectedCandidateId(null);
    setApplyingCandidateId(null);
    ebayRequestIdRef.current += 1;
    setEbaySearch(null);
    setIsSearchingEbay(false);
    setEbayError(null);
    ebayItemRequestIdRef.current += 1;
    setSelectedEbayCandidateId(null);
    setSelectedEbayDetails(null);
    setIsLoadingEbayDetails(false);
    setEbayDetailsError(null);
    setEditorInitialValues({});
    setConfirmedEbayCandidateId(null);
    setIsConfirmingEbayMatch(false);
    setConfirmedEbayUpdatedFields([]);
    setSavedCollectionId(null);
    setIsIdentifying(false);
    setIdentificationProgress("");
    setIdentificationElapsedSeconds(0);
    setError(null);
  };

  const startNewScan = () => {
    resetScan();
    setView("scan");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const removeBackPhoto = () => {
    if (!frontFile || isIdentifying) return;
    setBackFile(null);
    void identifyCard(frontFile, null);
  };

  const clearSelectedEbayMatch = () => {
    ebayItemRequestIdRef.current += 1;
    setSelectedEbayCandidateId(null);
    setSelectedEbayDetails(null);
    setIsLoadingEbayDetails(false);
    setEbayDetailsError(null);
    setConfirmedEbayCandidateId(null);
    setIsConfirmingEbayMatch(false);
    setConfirmedEbayUpdatedFields([]);
  };

  const selectEbayCandidate = async (candidate: EbayImageSearchCandidate) => {
    if (isConfirmingEbayMatch) return;

    if (selectedEbayCandidateId === candidate.id) {
      clearSelectedEbayMatch();
      return;
    }

    const requestId = ++ebayItemRequestIdRef.current;
    setSelectedEbayCandidateId(candidate.id);
    setSelectedEbayDetails(null);
    setIsLoadingEbayDetails(true);
    setEbayDetailsError(null);
    setConfirmedEbayCandidateId(null);
    setConfirmedEbayUpdatedFields([]);

    try {
      const response = await fetch(
        `/api/ebay/items/${encodeURIComponent(candidate.itemId)}`,
      );
      const payload = (await response.json().catch(() => null)) as
        | { item?: EbayItemDetails; error?: string }
        | null;

      if (!response.ok || !payload?.item) {
        throw new Error(
          payload?.error ?? "CardPilot could not load that listing's details.",
        );
      }

      if (requestId !== ebayItemRequestIdRef.current) return;
      setSelectedEbayDetails(payload.item);
    } catch (caughtError) {
      if (requestId !== ebayItemRequestIdRef.current) return;
      setEbayDetailsError(
        caughtError instanceof Error
          ? caughtError.message
          : "CardPilot could not load that listing's details.",
      );
    } finally {
      if (requestId === ebayItemRequestIdRef.current) {
        setIsLoadingEbayDetails(false);
      }
    }
  };

  const retryEbaySearch = async () => {
    if (!frontFile || isSearchingEbay) return;

    try {
      const frontImage = await fileToOptimizedDataUrl(frontFile);
      await loadEbayCandidates(frontImage);
    } catch (caughtError) {
      setEbayError(
        caughtError instanceof Error
          ? caughtError.message
          : "The selected image could not be read.",
      );
    }
  };

  const saveCorrections = async (values: Record<FieldKey, FieldValue>) => {
    if (!identification) {
      throw new Error("There is no identified card to update.");
    }
    const baseline = originalIdentificationRef.current ?? identification;
    const corrections: Correction[] = fieldDefinitions.flatMap(({ key }) => {
      const original = baseline.fields[key];
      const correctedValue = values[key];
      return Object.is(original.value, correctedValue)
        ? []
        : [
            {
              field: key,
              originalValue: original.value,
              originalConfidence: original.confidence,
              correctedValue,
            },
          ];
    });

    if (corrections.length > 0) {
      const response = await fetch("/api/corrections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identificationId: baseline.identificationId,
          schemaVersion: baseline.schemaVersion,
          corrections,
          metadata: {
            overallConfidence: baseline.overallConfidence,
            decision: baseline.decision.action,
            backPhotoProvided: baseline.backPhoto.provided,
            source: "editable_confirmation",
          },
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? "CardPilot could not save this correction.");
      }
    }

    const fields = { ...identification.fields };
    for (const { key } of fieldDefinitions) {
      if (!Object.is(identification.fields[key].value, values[key])) {
        fields[key] = {
          ...identification.fields[key],
          value: values[key],
          inferenceSource: "user_correction",
        };
      }
    }
    const updatedIdentification = { ...identification, fields };
    setIdentification(updatedIdentification);
    setIsEditing(false);
    setEditorInitialValues({});
    setResolution("confirmed");
    return updatedIdentification;
  };

  const saveIdentificationToCollection = async (
    cardIdentification: CardIdentification,
    ebayCandidateId: string | null = confirmedEbayCandidateId,
  ) => {
    if (cardIdentification.status === "not_sports_card") {
      throw new Error("Confirm a sports card identification before adding it.");
    }
    if (!frontFile) {
      throw new Error("Choose a card photo before adding it to your collection.");
    }
    if (isSavingCollection) {
      throw new Error("This card is already being added to your collection.");
    }

    setIsSavingCollection(true);
    setError(null);
    try {
      const fields = Object.fromEntries(
        fieldDefinitions.map(({ key }) => [
          key,
          cardIdentification.fields[key].value,
        ]),
      ) as Record<FieldKey, FieldValue>;
      let requestBody: object = { fields };
      let requestUrl = "/api/collection";
      let method = "POST";

      if (savedCollectionId) {
        requestUrl = `/api/collection/${encodeURIComponent(savedCollectionId)}`;
        method = "PUT";
      } else {
        const preparedImages =
          preparedImagesRef.current ?? {
            frontImage: await fileToOptimizedDataUrl(frontFile),
            backImage: backFile
              ? await fileToOptimizedDataUrl(backFile)
              : null,
        };
        preparedImagesRef.current = preparedImages;
        const confirmedEbayCandidate = ebaySearch?.candidates.find(
          (candidate) => candidate.id === ebayCandidateId,
        );
        requestBody = {
          identificationId: cardIdentification.identificationId,
          fields,
          overallConfidence: cardIdentification.overallConfidence,
          decision: cardIdentification.decision.action,
          frontImage: preparedImages.frontImage,
          backImage: preparedImages.backImage,
          ebayReference: confirmedEbayCandidate
            ? {
                itemId: confirmedEbayCandidate.itemId,
                title: confirmedEbayCandidate.title,
                itemWebUrl: confirmedEbayCandidate.itemWebUrl,
              }
            : null,
        };
      }

      const response = await fetch(requestUrl, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      const payload = (await response.json().catch(() => null)) as
        | { card?: SavedCollectionCard; error?: string }
        | null;
      if (!response.ok || !payload?.card) {
        throw new Error(payload?.error ?? "CardPilot could not save this card.");
      }

      setSavedCollectionId(payload.card.collectionId);
      setCollectionCards((current) => [
        payload.card as SavedCollectionCard,
        ...current.filter(
          (card) => card.collectionId !== payload.card?.collectionId,
        ),
      ]);
      setView("collection");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return payload.card;
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : "CardPilot could not save this card.";
      setError(message);
      throw caughtError instanceof Error ? caughtError : new Error(message);
    } finally {
      setIsSavingCollection(false);
    }
  };

  const confirmCardAndCollect = async () => {
    if (!identification || identification.status === "not_sports_card") return;
    setResolution("confirmed");
    try {
      await saveIdentificationToCollection(identification);
    } catch {
      // The save helper keeps the result on screen and displays the error.
    }
  };

  const saveCorrectionsAndCollect = async (
    values: Record<FieldKey, FieldValue>,
  ) => {
    const updatedIdentification = await saveCorrections(values);
    await saveIdentificationToCollection(updatedIdentification);
  };

  const applyCandidate = async (
    candidate: CardIdentification["candidateMatches"][number],
  ) => {
    if (!identification) return;
    const values = Object.fromEntries(
      fieldDefinitions.map(({ key }) => [
        key,
        candidate.values[key] ?? identification.fields[key].value,
      ]),
    ) as Record<FieldKey, FieldValue>;

    try {
      setError(null);
      setApplyingCandidateId(candidate.id);
      const updatedIdentification = await saveCorrections(values);
      setSelectedCandidateId(candidate.id);
      await saveIdentificationToCollection(updatedIdentification);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "CardPilot could not apply this catalog match.",
      );
    } finally {
      setApplyingCandidateId(null);
    }
  };

  const confidenceTone = identification
    ? identification.overallConfidence >= 0.95
      ? "high"
      : identification.overallConfidence >= 0.8
        ? "medium"
        : "low"
    : "low";

  const resultTitle = identification
    ? identification.status === "not_sports_card"
      ? "Sports card not confirmed"
      : [
          identification.fields.year.value,
          identification.fields.product.value ??
            identification.fields.brand.value ??
            identification.fields.manufacturer.value,
          identification.fields.player.value,
        ]
          .filter(Boolean)
          .join(" ") || "Sports card identified"
    : "";

  const decisionLabel = identification
    ? confirmedEbayCandidateId
      ? "eBay visual match confirmed"
      : selectedCandidateId
      ? "Catalog match selected"
      : resolution === "confirmed"
        ? "Corrections saved"
      : resolution === "override"
        ? "Using result as-is"
        : identification.decision.action === "auto_accept"
          ? "High confidence - ready"
          : identification.decision.action === "confirm"
            ? "One-tap confirmation"
            : "Review recommended"
    : "";

  const unresolvedDetailLabels = identification
    ? [
        identification.fields.cardNumber.value === null ? "card number" : null,
        identification.fields.parallel.value === null ? "parallel" : null,
        isPrintRunOnly(identification.fields.serialNumber.value)
          ? "exact serial number"
          : null,
      ].filter((value): value is string => Boolean(value))
    : [];
  const ebaySuggestedValues: Partial<Record<FieldKey, FieldValue>> = {};
  if (selectedEbayDetails?.suggestions.year) {
    ebaySuggestedValues.year = selectedEbayDetails.suggestions.year;
  }
  if (selectedEbayDetails?.suggestions.cardNumber) {
    ebaySuggestedValues.cardNumber =
      selectedEbayDetails.suggestions.cardNumber;
  }
  if (selectedEbayDetails?.suggestions.parallel) {
    ebaySuggestedValues.parallel = selectedEbayDetails.suggestions.parallel;
  }
  if (
    selectedEbayDetails?.suggestions.serialNumber &&
    !isExactSerialNumber(identification?.fields.serialNumber.value ?? null)
  ) {
    ebaySuggestedValues.serialNumber =
      selectedEbayDetails.suggestions.serialNumber;
  }
  const confirmedEbayUpdatedFieldLabels = confirmedEbayUpdatedFields.map(
    (key) =>
      fieldDefinitions.find((definition) => definition.key === key)?.label ?? key,
  );

  const openEditor = (
    initialValues: Partial<Record<FieldKey, FieldValue>> = {},
  ) => {
    setEditorInitialValues(initialValues);
    setIsEditing(true);
  };

  const confirmSelectedEbayMatch = async () => {
    if (
      !identification ||
      !selectedEbayCandidateId ||
      isLoadingEbayDetails ||
      isConfirmingEbayMatch
    ) {
      return;
    }

    const candidateId = selectedEbayCandidateId;
    const suggestedFields = Object.keys(ebaySuggestedValues) as FieldKey[];
    const updatedFields = suggestedFields.filter(
      (key) =>
        !Object.is(
          identification.fields[key].value,
          ebaySuggestedValues[key],
        ),
    );
    const values = Object.fromEntries(
      fieldDefinitions.map(({ key }) => [
        key,
        Object.prototype.hasOwnProperty.call(ebaySuggestedValues, key)
          ? ebaySuggestedValues[key]
          : identification.fields[key].value,
      ]),
    ) as Record<FieldKey, FieldValue>;

    setIsConfirmingEbayMatch(true);
    setEbayDetailsError(null);
    try {
      const updatedIdentification = await saveCorrections(values);
      setConfirmedEbayCandidateId(candidateId);
      setConfirmedEbayUpdatedFields(updatedFields);
      await saveIdentificationToCollection(updatedIdentification, candidateId);
    } catch (caughtError) {
      setEbayDetailsError(
        caughtError instanceof Error
          ? caughtError.message
          : "CardPilot could not confirm and add this card.",
      );
    } finally {
      setIsConfirmingEbayMatch(false);
    }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <button
          className="brand"
          type="button"
          aria-label="Open CardPilot scanner"
          onClick={startNewScan}
        >
          <span className="brand-mark">CP</span>
          <span>CardPilot</span>
        </button>
        <nav className="topbar-nav" aria-label="CardPilot sections">
          <button
            className={view === "scan" ? "active" : ""}
            type="button"
            onClick={startNewScan}
          >
            Identify
          </button>
          <button
            className={view === "collection" ? "active" : ""}
            type="button"
            onClick={() => setView("collection")}
          >
            My Collection <span>{collectionCards.length}</span>
          </button>
        </nav>
      </header>

      <main id="top">
        {view === "collection" ? (
          <CollectionView
            cards={collectionCards}
            isLoading={isLoadingCollection}
            error={collectionError}
            onCardsChange={setCollectionCards}
            onScanCard={startNewScan}
          />
        ) : (
          <>
        <section className="hero-section">
          <div className="hero-copy">
            <div className="eyebrow">
              <span className="eyebrow-icon"><SparkIcon /></span>
              Evidence-first sports card ID
            </div>
            <h1>Know what's in the sleeve.</h1>
            <p className="hero-lede">
              Start with one front photo. CardPilot asks for more evidence only when
              it could materially improve the match.
            </p>
            <div className="trust-row" aria-label="How CardPilot works">
              <span><CheckIcon /> Front photo is the default</span>
              <span><CheckIcon /> Back photo is always optional</span>
            </div>
          </div>

          <section className="scanner-card" aria-labelledby="scanner-title">
            <div className="scanner-heading">
              <div>
                <span className="step-label">Step 01</span>
                <h2 id="scanner-title">Scan your card</h2>
              </div>
              <span className="live-pill"><span /> Ready</span>
            </div>

            <div className="scanner-flow">
              <input className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp,image/gif" capture="environment" ref={frontInputRef} onChange={(event) => handleFileChange("front", event)} />
              <input className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp,image/gif" capture="environment" ref={backInputRef} onChange={(event) => handleFileChange("back", event)} />

              {!frontPreview ? (
                <button className="capture-zone" type="button" disabled={isIdentifying} onClick={() => openPicker("front")}>
                  <span className="camera-disc"><CameraIcon /></span>
                  <strong>Take or choose a photo</strong>
                  <span>Center the full front of the card in the frame</span>
                  <small>JPG, PNG, WebP or GIF - up to 12 MB</small>
                </button>
              ) : (
                <div className="photo-stage">
                  <div className="primary-photo">
                    <img src={frontPreview} alt="Selected front of sports card" />
                    <span className="photo-label">Front</span>
                    <button className="change-photo" type="button" disabled={isIdentifying} onClick={() => openPicker("front")}>Change</button>
                  </div>
                  {backPreview ? (
                    <div className="back-photo">
                      <img src={backPreview} alt="Selected back of sports card" />
                      <span>Optional back added</span>
                      <button type="button" disabled={isIdentifying} onClick={removeBackPhoto}>Remove</button>
                    </div>
                  ) : (
                    <button className="add-back" type="button" disabled={isIdentifying} onClick={() => openPicker("back")}>
                      <span>+</span>
                      <span><strong>Add card back</strong><small>Optional evidence booster</small></span>
                    </button>
                  )}
                </div>
              )}

              {error && (
                <div className="error-banner" role="alert">
                  <strong>We hit a snag.</strong>
                  <span>{error}</span>
                </div>
              )}

              {isIdentifying ? (
                <>
                  <div className="identify-button identify-button-status" role="status">
                    <span className="spinner" /> {identificationProgress} ({identificationElapsedSeconds}s)
                  </div>
                  <p className="scan-progress-note">
                    Identification started automatically. Image matching is running alongside it.
                  </p>
                </>
              ) : error && frontFile && !identification ? (
                <button
                  className="identify-button"
                  type="button"
                  onClick={() => void identifyCard(frontFile, backFile)}
                >
                  <SparkIcon /> Try identification again <ArrowIcon />
                </button>
              ) : null}
            </div>
          </section>
        </section>

        {identification && (
          <section className="result-card" aria-labelledby="result-title" aria-live="polite">
            <div className="result-topline">
              <div>
                <span className="step-label">Step 02 - {decisionLabel}</span>
                <h2 id="result-title">{resultTitle}</h2>
                <p>{identification.summary}</p>
              </div>
              <div className={`confidence confidence-${confidenceTone}`}>
                <strong>{Math.round(identification.overallConfidence * 100)}%</strong>
                <span>overall</span>
              </div>
            </div>

            {selectedCandidateId && (
              <div className="catalog-selection" role="status">
                <CheckIcon />
                <span>
                  <strong>Catalog match applied</strong>
                  {
                    identification.candidateMatches.find(
                      (candidate) => candidate.id === selectedCandidateId,
                    )?.label
                  }
                </span>
              </div>
            )}

            {identification.decision.blockers.length > 0 && (
              <div className="flag-row warning-flags">
                {identification.decision.blockers.map((blocker) => <span key={blocker}>{blocker}</span>)}
              </div>
            )}

            {isEditing ? (
              <ConfirmationEditor
                identification={identification}
                initialValues={editorInitialValues}
                onCancel={() => {
                  setIsEditing(false);
                  setEditorInitialValues({});
                }}
                submitLabel="Save and add to collection"
                onSave={saveCorrectionsAndCollect}
              />
            ) : (
              <div className="result-grid">
                <dl className="details-grid">
                  {fieldDefinitions.flatMap(({ key }) => [
                    ...(key === "serialNumber"
                      ? [
                          <NumberedCardField
                            key="numberedCard"
                            identification={identification}
                            onEdit={() => openEditor()}
                          />,
                        ]
                      : []),
                    <FieldCard
                      key={key}
                      fieldKey={key}
                      identification={identification}
                      onEdit={() => openEditor()}
                    />,
                  ])}
                </dl>

                <aside className="evidence-panel">
                  <h3>Why CardPilot chose this</h3>
                  {identification.evidence.length > 0 ? (
                    <ul>
                      {identification.evidence.slice(0, 8).map((clue) => (
                        <li key={clue.id}><CheckIcon /> <span>{clue.observation}<small>{clue.source === "back_image" ? "Card back" : "Card front"}</small></span></li>
                      ))}
                    </ul>
                  ) : (
                    <p>No reliable visual clues were extracted.</p>
                  )}

                  {identification.missingEvidence.length > 0 && (
                    <div className="missing-evidence">
                      <h4>Still uncertain</h4>
                      {identification.missingEvidence.slice(0, 4).map((missing) => (
                        <p key={`${missing.field}-${missing.description}`}>{missing.description}</p>
                      ))}
                    </div>
                  )}

                  {identification.candidateMatches.length > 0 && (
                    <div className="candidate-list">
                      <h4>
                        {identification.candidateMatches.some(
                          (candidate) => candidate.source === "catalog",
                        )
                          ? "Possible catalog matches"
                          : "Possible matches"}
                      </h4>
                      {identification.candidateMatches.slice(0, 3).map((candidate) => {
                        const isSelected = selectedCandidateId === candidate.id;
                        const isApplying = applyingCandidateId === candidate.id;
                        return (
                        <div
                          className={`candidate-card${isSelected ? " candidate-card-selected" : ""}`}
                          key={candidate.id}
                        >
                          <div className="candidate-heading">
                            <strong>{candidate.label}</strong>
                            {candidate.source === "catalog" && (
                              <em>{isSelected ? "Selected" : "Catalog"}</em>
                            )}
                          </div>
                          <span>{Math.round(candidate.matchConfidence * 100)}% evidence match</span>
                          <p>{candidate.basis}</p>
                          {candidate.source === "catalog" && (
                            <button
                              type="button"
                              disabled={isSelected || applyingCandidateId !== null}
                              onClick={() => void applyCandidate(candidate)}
                            >
                              {isSelected
                                ? "Match applied"
                                : isApplying
                                  ? "Applying..."
                                  : "Use this match"}
                            </button>
                          )}
                        </div>
                      )})}
                    </div>
                  )}
                </aside>
              </div>
            )}

            {!isEditing && unresolvedDetailLabels.length > 0 && (
              <div className="unknown-resolution">
                <div>
                  <strong>
                    Help resolve {unresolvedDetailLabels.join(" and ")}
                  </strong>
                  <span>
                    {!backFile
                      ? "These details are often printed on the card back. Add it and identify again, enter them manually, or optionally choose the closest visual match below."
                      : "These details were not readable from the photos. Enter them manually or optionally choose the closest visual match below."}
                  </span>
                </div>
                <div className="unknown-resolution-actions">
                  {!backFile && (
                    <button type="button" onClick={() => openPicker("back")}>
                      Add card back
                    </button>
                  )}
                  <button type="button" onClick={() => openEditor()}>
                    Enter details manually
                  </button>
                </div>
              </div>
            )}

            {!isEditing && identification.status !== "not_sports_card" && (
              <section
                className="ebay-results"
                aria-labelledby="ebay-results-title"
                aria-live="polite"
              >
                <div className="ebay-results-heading">
                  <div>
                    <span className="ebay-source-badge">eBay Browse</span>
                    <h3 id="ebay-results-title">Visually similar active listings</h3>
                    <p>
                      Compare listing photos and titles before choosing an exact
                      card, parallel, or variation.
                    </p>
                  </div>
                  {ebaySearch && ebaySearch.candidates.length > 0 && (
                    <span className="ebay-result-count">
                      {ebaySearch.candidates.length} visual matches
                    </span>
                  )}
                </div>

                {isSearchingEbay ? (
                  <div className="ebay-status" role="status">
                    <span className="spinner" /> Searching active eBay listings...
                  </div>
                ) : ebayError ? (
                  <div className="ebay-status ebay-status-error">
                    <span>{ebayError}</span>
                    <button type="button" onClick={() => void retryEbaySearch()}>
                      Try eBay again
                    </button>
                  </div>
                ) : ebaySearch?.candidates.length ? (
                  <>
                    <div className="ebay-match-grid">
                      {ebaySearch.candidates.map((candidate) => (
                        <EbayMatchCard
                          key={candidate.id}
                          candidate={candidate}
                          isSelected={selectedEbayCandidateId === candidate.id}
                          isLoadingDetails={
                            isLoadingEbayDetails &&
                            selectedEbayCandidateId === candidate.id
                          }
                          isInteractionLocked={
                            isLoadingEbayDetails || isConfirmingEbayMatch
                          }
                          isConfirming={
                            isConfirmingEbayMatch &&
                            selectedEbayCandidateId === candidate.id
                          }
                          isConfirmed={
                            confirmedEbayCandidateId === candidate.id
                          }
                          suggestions={
                            selectedEbayCandidateId === candidate.id
                              ? ebaySuggestedValues
                              : {}
                          }
                          detailsError={
                            selectedEbayCandidateId === candidate.id
                              ? ebayDetailsError
                              : null
                          }
                          updatedFieldLabels={
                            confirmedEbayCandidateId === candidate.id
                              ? confirmedEbayUpdatedFieldLabels
                              : []
                          }
                          onSelect={() => void selectEbayCandidate(candidate)}
                          onConfirm={() => void confirmSelectedEbayMatch()}
                          onReview={() => openEditor()}
                        />
                      ))}
                    </div>
                    <p className="ebay-disclaimer">
                      Active listing prices are seller asking prices, not verified
                      sales or appraisals. Seller titles are search leads and do not
                      overwrite CardPilot's visible-evidence identification.
                    </p>
                  </>
                ) : ebaySearch ? (
                  <div className="ebay-status">
                    No visually similar active listings were found for this photo.
                  </div>
                ) : null}
              </section>
            )}

            {identification.backPhoto.suggested && !backFile && (
              <div className="follow-up-note">
                <strong>A back photo could materially improve this match.</strong>
                <span>{identification.backPhoto.reason} Estimated gain: +{Math.round(identification.backPhoto.expectedConfidenceGain * 100)} points.</span>
              </div>
            )}

            {!isEditing && (
              <div className="result-actions">
                {identification.backPhoto.suggested && !backFile && (
                  <button className="secondary-button" type="button" onClick={() => openPicker("back")}>Take back photo</button>
                )}
                {identification.status !== "not_sports_card" && (
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={isSavingCollection}
                    onClick={() => void confirmCardAndCollect()}
                  >
                    {isSavingCollection ? "Adding to collection..." : "Confirm card"}
                  </button>
                )}
                <button className="outline-button" type="button" onClick={() => openEditor()}>Edit result</button>
                <button className="text-button" type="button" onClick={startNewScan}>Scan another card</button>
              </div>
            )}

            <p className="review-disclaimer">
              AI-assisted identification can be wrong. Verify card number, set, and variant before buying, selling, grading, or listing.
            </p>
          </section>
        )}
          </>
        )}
      </main>

      <footer>
        <span>CardPilot</span>
        <span>Fast by default. Extra evidence only when it matters.</span>
      </footer>
    </div>
  );
}

export default App;
