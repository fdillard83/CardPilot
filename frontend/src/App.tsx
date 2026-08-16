import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import "./App.css";
import {
  AccountGate,
  type AccountSession,
  type AccountUser,
} from "./accounts/AccountGate";
import { AccountSettings } from "./accounts/AccountSettings";
import {
  defaultAccountPreferences,
  type AccountPreferences,
} from "./accounts/preferences";
import { CollectionView } from "./collection/CollectionView";
import { AdminDashboard } from "./admin/AdminDashboard";
import {
  createCardDetailImages,
  prepareCardPhoto,
} from "./imaging/card-photo";
import { ConfirmationEditor } from "./identification/ConfirmationEditor";
import {
  cardKindFromFields,
  fieldDefinitions,
  fieldDefinitionsFor,
  fieldLabelFor,
  formatFieldValue,
  type CardIdentification,
  type Correction,
  type EbayImageSearchCandidate,
  type EbayImageSearchResult,
  type EbayItemDetails,
  type FieldKey,
  type FieldValue,
  type PokemonCatalogCandidate,
  type PokemonCatalogSearchResult,
  type SavedCollectionCard,
} from "./identification/types";

type ImageSide = "front" | "back";
type Resolution = "auto" | "confirmed" | "override" | null;
type LocalImportStatus = {
  enabled: boolean;
  localCount: number;
  readyCount: number;
  alreadyImportedCount?: number;
};

const MAX_FILE_SIZE = 12 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

function isUnsupportedIdentification(identification: CardIdentification) {
  return (
    identification.status === "not_sports_card" ||
    identification.status === "not_trading_card"
  );
}

function identificationValues(identification: CardIdentification) {
  return Object.fromEntries(
    fieldDefinitions.map(({ key }) => [key, identification.fields[key].value]),
  ) as Record<FieldKey, FieldValue>;
}

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
  isPokemon,
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
  isPokemon: boolean;
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
                  {suggestions.character && (
                    <span>Pokémon: {suggestions.character}</span>
                  )}
                  {suggestions.setOrInsert && (
                    <span>Set: {suggestions.setOrInsert}</span>
                  )}
                  {suggestions.cardNumber && (
                    <span>
                      {isPokemon ? "Collector number" : "Card number"}: {suggestions.cardNumber}
                    </span>
                  )}
                  {suggestions.year && <span>Year: {suggestions.year}</span>}
                  {suggestions.parallel && (
                    <span>{isPokemon ? "Variant" : "Parallel"}: {suggestions.parallel}</span>
                  )}
                  {suggestions.serialNumber && (
                    <span>Print run: {suggestions.serialNumber}</span>
                  )}
                  {suggestions.language && (
                    <span>Language: {suggestions.language}</span>
                  )}
                  {suggestions.rarity && (
                    <span>Rarity: {suggestions.rarity}</span>
                  )}
                  {suggestions.finish && (
                    <span>Finish: {suggestions.finish}</span>
                  )}
                  {suggestions.promo === true && <span>Promo card: Yes</span>}
                </div>
              </>
            ) : (
              <small>
                This listing does not include extra identity or variant details.
                You can still confirm the visual match.
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

function PokemonCatalogMatchCard({
  candidate,
  isSelected,
  isInteractionLocked,
  isConfirming,
  isConfirmed,
  updatedFieldLabels,
  error,
  onSelect,
  onConfirm,
  onReview,
}: {
  candidate: PokemonCatalogCandidate;
  isSelected: boolean;
  isInteractionLocked: boolean;
  isConfirming: boolean;
  isConfirmed: boolean;
  updatedFieldLabels: string[];
  error: string | null;
  onSelect: () => void;
  onConfirm: () => void;
  onReview: () => void;
}) {
  return (
    <article
      className={`ebay-match-card pokemon-match-card${isSelected ? " ebay-match-card-selected" : ""}`}
    >
      <div className="ebay-match-image pokemon-match-image">
        {candidate.imageUrl ? (
          <img src={candidate.imageUrl} alt={candidate.label} loading="lazy" />
        ) : (
          <span>No catalog image</span>
        )}
        <span className="ebay-match-rank">Catalog match {candidate.rank}</span>
      </div>
      <div className="ebay-match-body">
        <h4>{candidate.label}</h4>
        <div className="ebay-match-meta">
          <strong>{Math.round(candidate.matchScore * 100)}% match</strong>
          <span>{candidate.values.rarity ?? "Rarity not listed"}</span>
        </div>
        <p className="pokemon-match-basis">{candidate.basis}</p>
        {isSelected ? (
          <div className="ebay-inline-selection" role="status">
            <div className="ebay-inline-selection-heading">
              <CheckIcon />
              <strong>
                {isConfirmed ? "Catalog card confirmed" : "Catalog card selected"}
              </strong>
            </div>
            <small>Confirm only if the artwork and collector number match your card.</small>
            <div className="ebay-suggestions">
              {candidate.values.setOrInsert && (
                <span>Set: {candidate.values.setOrInsert}</span>
              )}
              {candidate.values.cardNumber && (
                <span>Collector number: {candidate.values.cardNumber}</span>
              )}
              {candidate.values.year && <span>Year: {candidate.values.year}</span>}
              {candidate.values.rarity && (
                <span>Rarity: {candidate.values.rarity}</span>
              )}
              {candidate.values.promo !== null && (
                <span>Promo: {candidate.values.promo ? "Yes" : "No"}</span>
              )}
            </div>
            {error && <small className="ebay-inline-error">{error}</small>}
            {isConfirmed && (
              <small className="ebay-update-result">
                {updatedFieldLabels.length > 0
                  ? `Updated CardPilot: ${updatedFieldLabels.join(", ")}.`
                  : "CardPilot's details already matched this catalog card."}
              </small>
            )}
            <div className="ebay-inline-actions">
              {isConfirmed ? (
                <button type="button" onClick={onReview}>
                  Review card details
                </button>
              ) : (
                <button type="button" disabled={isConfirming} onClick={onConfirm}>
                  {isConfirming
                    ? "Updating CardPilot..."
                    : "Confirm same card & update details"}
                </button>
              )}
              <button type="button" disabled={isConfirming} onClick={onSelect}>
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
        {candidate.catalogUrl && (
          <a
            href={candidate.catalogUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={`View ${candidate.label} catalog record`}
          >
            View catalog record <ArrowIcon />
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
        <dt>{fieldLabelFor(fieldKey, identificationValues(identification))}</dt>
        <button type="button" onClick={onEdit} aria-label={`Edit ${fieldLabelFor(fieldKey, identificationValues(identification))}`}>
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
  const pokemonCatalogRequestIdRef = useRef(0);
  const identificationRequestIdRef = useRef(0);
  const [frontFile, setFrontFile] = useState<File | null>(null);
  const [backFile, setBackFile] = useState<File | null>(null);
  const [preparedFrontPreview, setPreparedFrontPreview] = useState<string | null>(
    null,
  );
  const [preparedBackPreview, setPreparedBackPreview] = useState<string | null>(
    null,
  );
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
  const [pokemonCatalogSearch, setPokemonCatalogSearch] =
    useState<PokemonCatalogSearchResult | null>(null);
  const [isSearchingPokemonCatalog, setIsSearchingPokemonCatalog] =
    useState(false);
  const [pokemonCatalogError, setPokemonCatalogError] = useState<string | null>(
    null,
  );
  const [selectedPokemonCatalogCandidateId, setSelectedPokemonCatalogCandidateId] =
    useState<string | null>(null);
  const [confirmedPokemonCatalogCandidateId, setConfirmedPokemonCatalogCandidateId] =
    useState<string | null>(null);
  const [isConfirmingPokemonCatalogMatch, setIsConfirmingPokemonCatalogMatch] =
    useState(false);
  const [confirmedPokemonCatalogUpdatedFields, setConfirmedPokemonCatalogUpdatedFields] =
    useState<FieldKey[]>([]);
  const [pokemonCatalogConfirmationError, setPokemonCatalogConfirmationError] =
    useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"scan" | "collection" | "admin">("scan");
  const [collectionCards, setCollectionCards] = useState<SavedCollectionCard[]>([]);
  const [isLoadingCollection, setIsLoadingCollection] = useState(true);
  const [collectionError, setCollectionError] = useState<string | null>(null);
  const [savedCollectionId, setSavedCollectionId] = useState<string | null>(null);
  const [isSavingCollection, setIsSavingCollection] = useState(false);
  const [identificationProgress, setIdentificationProgress] = useState("");
  const [identificationElapsedSeconds, setIdentificationElapsedSeconds] = useState(0);
  const [accountSession, setAccountSession] = useState<AccountSession | null>(null);
  const [accountSessionError, setAccountSessionError] = useState<string | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [localImportStatus, setLocalImportStatus] =
    useState<LocalImportStatus | null>(null);
  const [isImportingLocal, setIsImportingLocal] = useState(false);
  const [localImportError, setLocalImportError] = useState<string | null>(null);
  const [isAccountSettingsOpen, setIsAccountSettingsOpen] = useState(false);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);
  const [accountPreferences, setAccountPreferences] = useState<AccountPreferences>(
    defaultAccountPreferences,
  );

  const originalFrontPreview = usePreviewUrl(frontFile);
  const originalBackPreview = usePreviewUrl(backFile);
  const frontPreview = preparedFrontPreview ?? originalFrontPreview;
  const backPreview = preparedBackPreview ?? originalBackPreview;

  useEffect(() => {
    let isCurrent = true;
    void fetch("/api/auth/session")
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as
          | AccountSession
          | { error?: string }
          | null;
        if (
          !response.ok ||
          !payload ||
          !("mode" in payload) ||
          !new Set(["local", "supabase"]).has(payload.mode)
        ) {
          throw new Error(
            payload && "error" in payload && payload.error
              ? payload.error
              : "CardPilot could not check your account session.",
          );
        }
        if (isCurrent) setAccountSession(payload);
      })
      .catch((caughtError) => {
        if (isCurrent) {
          setAccountSessionError(
            caughtError instanceof Error
              ? caughtError.message
              : "CardPilot could not check your account session.",
          );
        }
      });
    return () => {
      isCurrent = false;
    };
  }, []);

  useEffect(() => {
    if (!accountSession) return;
    if (accountSession.mode === "supabase" && !accountSession.user) {
      return;
    }
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
  }, [accountSession]);

  useEffect(() => {
    if (!accountSession?.user) return;
    let isCurrent = true;
    void fetch("/api/account/preferences")
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as
          | (AccountPreferences & { error?: string })
          | null;
        if (!response.ok || !payload) {
          throw new Error(payload?.error ?? "CardPilot could not load account preferences.");
        }
        if (isCurrent) setAccountPreferences(payload);
      })
      .catch((caughtError) => {
        if (isCurrent) {
          setAccountSessionError(
            caughtError instanceof Error
              ? caughtError.message
              : "CardPilot could not load account preferences.",
          );
        }
      });
    return () => {
      isCurrent = false;
    };
  }, [accountSession?.user]);

  useEffect(() => {
    if (accountSession?.mode !== "supabase" || !accountSession.user) return;
    let isCurrent = true;
    void fetch("/api/collection-import/status")
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as
          | LocalImportStatus
          | { error?: string }
          | null;
        if (!response.ok || !payload || !("enabled" in payload)) {
          throw new Error(
            payload && "error" in payload && payload.error
              ? payload.error
              : "CardPilot could not check the local collection.",
          );
        }
        if (isCurrent) setLocalImportStatus(payload);
      })
      .catch((caughtError) => {
        if (isCurrent) {
          setLocalImportError(
            caughtError instanceof Error
              ? caughtError.message
              : "CardPilot could not check the local collection.",
          );
        }
      });
    return () => {
      isCurrent = false;
    };
  }, [accountSession]);

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

  const clearPokemonCatalogState = () => {
    pokemonCatalogRequestIdRef.current += 1;
    setPokemonCatalogSearch(null);
    setIsSearchingPokemonCatalog(false);
    setPokemonCatalogError(null);
    setSelectedPokemonCatalogCandidateId(null);
    setConfirmedPokemonCatalogCandidateId(null);
    setIsConfirmingPokemonCatalogMatch(false);
    setConfirmedPokemonCatalogUpdatedFields([]);
    setPokemonCatalogConfirmationError(null);
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
    clearPokemonCatalogState();
    setSavedCollectionId(null);

    if (side === "front") {
      setPreparedFrontPreview(null);
      setPreparedBackPreview(null);
      setFrontFile(file);
      setBackFile(null);
      void identifyCard(file, null);
    } else {
      setPreparedBackPreview(null);
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

  const loadPokemonCatalogCandidates = async (
    cardIdentification: CardIdentification,
  ) => {
    const fields = identificationValues(cardIdentification);
    if (cardKindFromFields(fields) !== "pokemon") {
      clearPokemonCatalogState();
      return;
    }

    const requestId = ++pokemonCatalogRequestIdRef.current;
    setIsSearchingPokemonCatalog(true);
    setPokemonCatalogSearch(null);
    setPokemonCatalogError(null);
    setSelectedPokemonCatalogCandidateId(null);
    setConfirmedPokemonCatalogCandidateId(null);
    setIsConfirmingPokemonCatalogMatch(false);
    setConfirmedPokemonCatalogUpdatedFields([]);
    setPokemonCatalogConfirmationError(null);

    try {
      const response = await fetch("/api/pokemon/catalog-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields, limit: 6 }),
      });
      const payload = (await response.json().catch(() => null)) as
        | (Partial<PokemonCatalogSearchResult> & { error?: string })
        | null;

      if (!response.ok || !Array.isArray(payload?.candidates)) {
        throw new Error(
          payload?.error ?? "CardPilot could not search the Pokémon catalog.",
        );
      }
      if (requestId !== pokemonCatalogRequestIdRef.current) return;
      setPokemonCatalogSearch(payload as PokemonCatalogSearchResult);
    } catch (caughtError) {
      if (requestId !== pokemonCatalogRequestIdRef.current) return;
      setPokemonCatalogError(
        caughtError instanceof Error
          ? caughtError.message
          : "CardPilot could not search the Pokémon catalog.",
      );
    } finally {
      if (requestId === pokemonCatalogRequestIdRef.current) {
        setIsSearchingPokemonCatalog(false);
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
    clearPokemonCatalogState();
    setSavedCollectionId(null);

    try {
      const [preparedFront, preparedBack] = await Promise.all([
        prepareCardPhoto(selectedFrontFile),
        selectedBackFile
          ? prepareCardPhoto(selectedBackFile)
          : Promise.resolve(null),
      ]);
      if (requestId !== identificationRequestIdRef.current) return;
      const frontImage = preparedFront.image;
      const backImage = preparedBack?.image ?? null;
      const frontDetailImages = await createCardDetailImages(frontImage);
      if (requestId !== identificationRequestIdRef.current) return;
      setPreparedFrontPreview(frontImage);
      setPreparedBackPreview(backImage);
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
      if (isUnsupportedIdentification(payload.identification)) {
        ebayRequestIdRef.current += 1;
        setEbaySearch(null);
        setIsSearchingEbay(false);
        clearPokemonCatalogState();
      } else {
        void loadPokemonCatalogCandidates(payload.identification);
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
    setPreparedFrontPreview(null);
    setPreparedBackPreview(null);
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
    clearPokemonCatalogState();
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
    setPreparedBackPreview(null);
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
      const frontImage =
        preparedImagesRef.current?.frontImage ??
        (await prepareCardPhoto(frontFile)).image;
      await loadEbayCandidates(frontImage);
    } catch (caughtError) {
      setEbayError(
        caughtError instanceof Error
          ? caughtError.message
          : "The selected image could not be read.",
      );
    }
  };

  const clearSelectedPokemonCatalogMatch = () => {
    setSelectedPokemonCatalogCandidateId(null);
    setConfirmedPokemonCatalogCandidateId(null);
    setIsConfirmingPokemonCatalogMatch(false);
    setConfirmedPokemonCatalogUpdatedFields([]);
    setPokemonCatalogConfirmationError(null);
  };

  const selectPokemonCatalogCandidate = (
    candidate: PokemonCatalogCandidate,
  ) => {
    if (isConfirmingPokemonCatalogMatch) return;
    if (selectedPokemonCatalogCandidateId === candidate.id) {
      clearSelectedPokemonCatalogMatch();
      return;
    }
    setSelectedPokemonCatalogCandidateId(candidate.id);
    setConfirmedPokemonCatalogCandidateId(null);
    setConfirmedPokemonCatalogUpdatedFields([]);
    setPokemonCatalogConfirmationError(null);
  };

  const retryPokemonCatalogSearch = () => {
    if (!identification || isSearchingPokemonCatalog) return;
    void loadPokemonCatalogCandidates(identification);
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
    {
      ebayCandidateId = confirmedEbayCandidateId,
      pokemonCatalogCandidateId = confirmedPokemonCatalogCandidateId,
    }: {
      ebayCandidateId?: string | null;
      pokemonCatalogCandidateId?: string | null;
    } = {},
  ) => {
    if (isUnsupportedIdentification(cardIdentification)) {
      throw new Error("Confirm a supported trading card before adding it.");
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
      const confirmedEbayCandidate = ebaySearch?.candidates.find(
        (candidate) => candidate.id === ebayCandidateId,
      );
      const ebayReference = confirmedEbayCandidate
        ? {
            itemId: confirmedEbayCandidate.itemId,
            title: confirmedEbayCandidate.title,
            itemWebUrl: confirmedEbayCandidate.itemWebUrl,
          }
        : null;
      const confirmedPokemonCatalogCandidate =
        pokemonCatalogSearch?.candidates.find(
          (candidate) => candidate.id === pokemonCatalogCandidateId,
        );
      const pokemonCatalogReference = confirmedPokemonCatalogCandidate
        ? {
            cardId: confirmedPokemonCatalogCandidate.cardId,
            label: confirmedPokemonCatalogCandidate.label,
            imageUrl: confirmedPokemonCatalogCandidate.imageUrl,
            catalogUrl: confirmedPokemonCatalogCandidate.catalogUrl,
          }
        : null;
      let requestBody: object = {
        fields,
        ...(ebayCandidateId ? { ebayReference } : {}),
        ...(pokemonCatalogCandidateId ? { pokemonCatalogReference } : {}),
      };
      let requestUrl = "/api/collection";
      let method = "POST";

      if (savedCollectionId) {
        requestUrl = `/api/collection/${encodeURIComponent(savedCollectionId)}`;
        method = "PUT";
      } else {
        let preparedImages = preparedImagesRef.current;
        if (!preparedImages) {
          const [preparedFront, preparedBack] = await Promise.all([
            prepareCardPhoto(frontFile),
            backFile ? prepareCardPhoto(backFile) : Promise.resolve(null),
          ]);
          preparedImages = {
            frontImage: preparedFront.image,
            backImage: preparedBack?.image ?? null,
          };
        }
        preparedImagesRef.current = preparedImages;
        requestBody = {
          identificationId: cardIdentification.identificationId,
          fields,
          overallConfidence: cardIdentification.overallConfidence,
          decision: cardIdentification.decision.action,
          frontImage: preparedImages.frontImage,
          backImage: preparedImages.backImage,
          ebayReference,
          pokemonCatalogReference,
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
    if (!identification || isUnsupportedIdentification(identification)) return;
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

  const currentFieldValues = identification
    ? identificationValues(identification)
    : null;
  const currentCardKind = currentFieldValues
    ? cardKindFromFields(currentFieldValues)
    : "unknown";
  const isPokemon = currentCardKind === "pokemon";
  const visibleFieldDefinitions = currentFieldValues
    ? fieldDefinitionsFor(currentFieldValues)
    : [];

  const resultTitle = identification
    ? isUnsupportedIdentification(identification)
      ? "Trading card not confirmed"
      : [
          identification.fields.year.value,
          identification.fields.product.value ??
            identification.fields.brand.value ??
            identification.fields.manufacturer.value,
          isPokemon
            ? identification.fields.character.value
            : identification.fields.player.value,
        ]
          .filter(Boolean)
          .join(" ") || "Trading card identified"
    : "";

  const decisionLabel = identification
    ? confirmedPokemonCatalogCandidateId
      ? "Pokémon catalog match confirmed"
      : confirmedEbayCandidateId
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
    ? (isPokemon
        ? [
            identification.fields.cardNumber.value === null
              ? "collector number"
              : null,
            identification.fields.setOrInsert.value === null ? "set" : null,
          ]
        : [
            identification.fields.cardNumber.value === null
              ? "card number"
              : null,
            identification.fields.parallel.value === null ? "parallel" : null,
            isPrintRunOnly(identification.fields.serialNumber.value)
              ? "exact serial number"
              : null,
          ]
      ).filter((value): value is string => Boolean(value))
    : [];
  const ebaySuggestedValues: Partial<Record<FieldKey, FieldValue>> = {};
  if (selectedEbayDetails?.suggestions.year) {
    ebaySuggestedValues.year = selectedEbayDetails.suggestions.year;
  }
  if (selectedEbayDetails?.suggestions.character) {
    ebaySuggestedValues.character = selectedEbayDetails.suggestions.character;
  }
  if (selectedEbayDetails?.suggestions.setOrInsert) {
    ebaySuggestedValues.setOrInsert = selectedEbayDetails.suggestions.setOrInsert;
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
  if (selectedEbayDetails?.suggestions.language) {
    ebaySuggestedValues.language = selectedEbayDetails.suggestions.language;
  }
  if (selectedEbayDetails?.suggestions.rarity) {
    ebaySuggestedValues.rarity = selectedEbayDetails.suggestions.rarity;
  }
  if (selectedEbayDetails?.suggestions.finish) {
    ebaySuggestedValues.finish = selectedEbayDetails.suggestions.finish;
  }
  if (selectedEbayDetails?.suggestions.promo === true) {
    ebaySuggestedValues.promo = true;
  }
  const confirmedEbayUpdatedFieldLabels = confirmedEbayUpdatedFields.map(
    (key) =>
      fieldLabelFor(key, currentFieldValues ?? {}),
  );
  const selectedPokemonCatalogCandidate =
    pokemonCatalogSearch?.candidates.find(
      (candidate) => candidate.id === selectedPokemonCatalogCandidateId,
    ) ?? null;
  const pokemonCatalogSuggestedValues: Partial<Record<FieldKey, FieldValue>> =
    selectedPokemonCatalogCandidate
      ? Object.fromEntries(
          fieldDefinitions.flatMap(({ key }) => {
            const value = selectedPokemonCatalogCandidate.values[key];
            return value === null ? [] : [[key, value]];
          }),
        )
      : {};
  const confirmedPokemonCatalogUpdatedFieldLabels =
    confirmedPokemonCatalogUpdatedFields.map((key) =>
      fieldLabelFor(key, currentFieldValues ?? {}),
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
      await saveIdentificationToCollection(updatedIdentification, {
        ebayCandidateId: candidateId,
      });
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

  const confirmSelectedPokemonCatalogMatch = async () => {
    if (
      !identification ||
      !selectedPokemonCatalogCandidateId ||
      !selectedPokemonCatalogCandidate ||
      isConfirmingPokemonCatalogMatch
    ) {
      return;
    }

    const candidateId = selectedPokemonCatalogCandidateId;
    const suggestedFields = Object.keys(
      pokemonCatalogSuggestedValues,
    ) as FieldKey[];
    const updatedFields = suggestedFields.filter(
      (key) =>
        !Object.is(
          identification.fields[key].value,
          pokemonCatalogSuggestedValues[key],
        ),
    );
    const values = Object.fromEntries(
      fieldDefinitions.map(({ key }) => [
        key,
        Object.prototype.hasOwnProperty.call(
          pokemonCatalogSuggestedValues,
          key,
        )
          ? pokemonCatalogSuggestedValues[key]
          : identification.fields[key].value,
      ]),
    ) as Record<FieldKey, FieldValue>;

    setIsConfirmingPokemonCatalogMatch(true);
    setPokemonCatalogConfirmationError(null);
    try {
      const updatedIdentification = await saveCorrections(values);
      setConfirmedPokemonCatalogCandidateId(candidateId);
      setConfirmedPokemonCatalogUpdatedFields(updatedFields);
      await saveIdentificationToCollection(updatedIdentification, {
        pokemonCatalogCandidateId: candidateId,
      });
    } catch (caughtError) {
      setPokemonCatalogConfirmationError(
        caughtError instanceof Error
          ? caughtError.message
          : "CardPilot could not confirm and add this catalog card.",
      );
    } finally {
      setIsConfirmingPokemonCatalogMatch(false);
    }
  };

  const handleAuthenticated = (user: AccountUser) => {
    setIsLoadingCollection(true);
    setCollectionError(null);
    setAccountSession({ mode: "supabase", user });
    setAccountSessionError(null);
  };

  const handleRecoveryAuthenticated = (user: AccountUser) => {
    setIsLoadingCollection(true);
    setCollectionError(null);
    setAccountSession({ mode: "supabase", user });
    setAccountSessionError(null);
    setIsPasswordRecovery(true);
    setIsAccountSettingsOpen(true);
  };

  const signOut = async () => {
    setIsSigningOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      setCollectionCards([]);
      setAccountSession({ mode: "supabase", user: null });
      setView("scan");
      setIsAccountSettingsOpen(false);
      setIsPasswordRecovery(false);
      setIsSigningOut(false);
    }
  };

  const importLocalCards = async () => {
    setIsImportingLocal(true);
    setLocalImportError(null);
    try {
      const response = await fetch("/api/collection-import", { method: "POST" });
      const payload = (await response.json().catch(() => null)) as
        | { importedCount?: number; error?: string }
        | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? "CardPilot could not import the local collection.");
      }
      window.location.reload();
    } catch (caughtError) {
      setLocalImportError(
        caughtError instanceof Error
          ? caughtError.message
          : "CardPilot could not import the local collection.",
      );
      setIsImportingLocal(false);
    }
  };

  if (accountSessionError) {
    return (
      <main className="account-shell">
        <section className="account-card" role="alert">
          <div className="account-brand">
            <span className="brand-mark">CP</span>
            <span>CardPilot</span>
          </div>
          <h1>CardPilot could not start.</h1>
          <p>{accountSessionError}</p>
          <button className="primary-action" type="button" onClick={() => window.location.reload()}>
            Try again
          </button>
        </section>
      </main>
    );
  }

  if (!accountSession) {
    return (
      <main className="account-shell">
        <section className="account-card account-loading" aria-live="polite">
          <div className="account-brand">
            <span className="brand-mark">CP</span>
            <span>CardPilot</span>
          </div>
          <p>Opening CardPilot...</p>
        </section>
      </main>
    );
  }

  if (accountSession.mode === "supabase" && !accountSession.user) {
    return (
      <AccountGate
        onAuthenticated={handleAuthenticated}
        onRecoveryAuthenticated={handleRecoveryAuthenticated}
      />
    );
  }

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
          {accountSession.user?.isAdmin && <button className={view === "admin" ? "active" : ""} type="button" onClick={() => setView("admin")}>Admin</button>}
          {accountSession.user && (
            <div className="account-menu">
              <small>{accountSession.user.email}</small>
              <button type="button" onClick={() => setIsAccountSettingsOpen(true)}>
                Account
              </button>
              <button
                type="button"
                disabled={isSigningOut}
                onClick={() => void signOut()}
              >
                {isSigningOut ? "Signing out..." : "Sign out"}
              </button>
            </div>
          )}
        </nav>
      </header>

      {localImportStatus?.enabled && localImportStatus.readyCount > 0 && (
        <section className="local-import-banner" aria-labelledby="local-import-title">
          <div>
            <strong id="local-import-title">Move this computer's collection to your account</strong>
            <span>
              {localImportStatus.readyCount} local {localImportStatus.readyCount === 1 ? "card is" : "cards are"} ready to copy. The originals will remain on this computer.
            </span>
            {localImportError && <small>{localImportError}</small>}
          </div>
          <button
            className="primary-action"
            type="button"
            disabled={isImportingLocal}
            onClick={() => void importLocalCards()}
          >
            {isImportingLocal ? "Copying cards..." : "Import local collection"}
          </button>
        </section>
      )}

      <main id="top">
        {view === "admin" ? <AdminDashboard /> : view === "collection" ? (
          <CollectionView
            cards={collectionCards}
            isLoading={isLoadingCollection}
            error={collectionError}
            onCardsChange={setCollectionCards}
            onScanCard={startNewScan}
            accountPreferences={accountPreferences}
          />
        ) : (
          <>
        <section className="hero-section">
          <div className="hero-copy">
            <div className="eyebrow">
              <span className="eyebrow-icon"><SparkIcon /></span>
              Evidence-first sports and Pokémon card ID
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
                    <img src={frontPreview} alt="Selected front of trading card" />
                    <span className="photo-label">Front</span>
                    <button className="change-photo" type="button" disabled={isIdentifying} onClick={() => openPicker("front")}>Change</button>
                  </div>
                  {backPreview ? (
                    <div className="back-photo">
                      <img src={backPreview} alt="Selected back of trading card" />
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
                  {visibleFieldDefinitions.flatMap(({ key }) => [
                    ...(key === "serialNumber" && !isPokemon
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

            {!isEditing && isPokemon && !isUnsupportedIdentification(identification) && (
              <section
                className="ebay-results pokemon-catalog-results"
                aria-labelledby="pokemon-catalog-results-title"
                aria-live="polite"
              >
                <div className="ebay-results-heading">
                  <div>
                    <span className="ebay-source-badge pokemon-source-badge">
                      Pokémon catalog
                    </span>
                    <h3 id="pokemon-catalog-results-title">
                      Possible catalog records
                    </h3>
                    <p>
                      Compare the artwork, set, and collector number. CardPilot
                      changes catalog-backed details only after you confirm the
                      same card.
                    </p>
                  </div>
                  {pokemonCatalogSearch?.candidates.length ? (
                    <span className="ebay-result-count">
                      {pokemonCatalogSearch.candidates.length} catalog matches
                    </span>
                  ) : null}
                </div>

                {isSearchingPokemonCatalog ? (
                  <div className="ebay-status" role="status">
                    <span className="spinner" /> Checking the Pokémon catalog...
                  </div>
                ) : pokemonCatalogError ? (
                  <div className="ebay-status ebay-status-error">
                    <span>{pokemonCatalogError}</span>
                    <button
                      type="button"
                      onClick={retryPokemonCatalogSearch}
                    >
                      Try catalog again
                    </button>
                  </div>
                ) : pokemonCatalogSearch?.candidates.length ? (
                  <>
                    {pokemonCatalogSearch.cacheStatus === "stale" && (
                      <div className="pokemon-cache-note">
                        Showing a previously saved catalog result while the
                        provider is unavailable.
                      </div>
                    )}
                    <div className="ebay-match-grid">
                      {pokemonCatalogSearch.candidates.map((candidate) => (
                        <PokemonCatalogMatchCard
                          key={candidate.id}
                          candidate={candidate}
                          isSelected={
                            selectedPokemonCatalogCandidateId === candidate.id
                          }
                          isInteractionLocked={isConfirmingPokemonCatalogMatch}
                          isConfirming={
                            isConfirmingPokemonCatalogMatch &&
                            selectedPokemonCatalogCandidateId === candidate.id
                          }
                          isConfirmed={
                            confirmedPokemonCatalogCandidateId === candidate.id
                          }
                          updatedFieldLabels={
                            confirmedPokemonCatalogCandidateId === candidate.id
                              ? confirmedPokemonCatalogUpdatedFieldLabels
                              : []
                          }
                          error={
                            selectedPokemonCatalogCandidateId === candidate.id
                              ? pokemonCatalogConfirmationError
                              : null
                          }
                          onSelect={() =>
                            selectPokemonCatalogCandidate(candidate)
                          }
                          onConfirm={() =>
                            void confirmSelectedPokemonCatalogMatch()
                          }
                          onReview={() => openEditor()}
                        />
                      ))}
                    </div>
                    <p className="ebay-disclaimer">
                      Catalog records improve identity details but are not price
                      estimates. Confirm the printed collector number and artwork
                      before applying a match.
                    </p>
                  </>
                ) : pokemonCatalogSearch ? (
                  <div className="ebay-status">
                    No close Pokémon catalog records were found. You can still
                    confirm or edit CardPilot's identification.
                  </div>
                ) : null}
              </section>
            )}

            {!isEditing && !isUnsupportedIdentification(identification) && (
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
                          isPokemon={isPokemon}
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
                {!isUnsupportedIdentification(identification) && (
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
      {accountSession.user && isAccountSettingsOpen && (
        <AccountSettings
          user={accountSession.user}
          recoveryMode={isPasswordRecovery}
          onRecoveryComplete={() => setIsPasswordRecovery(false)}
          onClose={() => setIsAccountSettingsOpen(false)}
          onAccountDeleted={() => {
            setCollectionCards([]);
            setAccountPreferences(defaultAccountPreferences);
            setIsAccountSettingsOpen(false);
            setIsPasswordRecovery(false);
            setAccountSession({ mode: "supabase", user: null });
            setView("scan");
          }}
          preferences={accountPreferences}
          onPreferencesChange={setAccountPreferences}
        />
      )}
    </div>
  );
}

export default App;
