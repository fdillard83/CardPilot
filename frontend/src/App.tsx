import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, ReactNode } from "react";
import "./App.css";

type CardIdentification = {
  status: "identified" | "partial" | "not_sports_card";
  sport: string | null;
  playerName: string | null;
  team: string | null;
  year: string | null;
  manufacturer: string | null;
  brand: string | null;
  setName: string | null;
  cardNumber: string | null;
  parallelOrVariant: string | null;
  serialNumber: string | null;
  rookieCard: boolean | null;
  autographed: boolean | null;
  memorabilia: boolean | null;
  confidence: number;
  summary: string;
  visibleEvidence: string[];
  needsBackImage: boolean;
  followUpHint: string | null;
};

type ImageSide = "front" | "back";

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
    reader.onerror = () => reject(new Error("The selected image could not be read."));
    reader.readAsDataURL(file);
  });
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

function Detail({ label, value }: { label: string; value: ReactNode }) {
  if (value === null || value === "") return null;

  return (
    <div className="detail-item">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function App() {
  const frontInputRef = useRef<HTMLInputElement>(null);
  const backInputRef = useRef<HTMLInputElement>(null);
  const [frontFile, setFrontFile] = useState<File | null>(null);
  const [backFile, setBackFile] = useState<File | null>(null);
  const [identification, setIdentification] = useState<CardIdentification | null>(null);
  const [isIdentifying, setIsIdentifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const frontPreview = usePreviewUrl(frontFile);
  const backPreview = usePreviewUrl(backFile);

  const openPicker = (side: ImageSide) => {
    if (side === "front") frontInputRef.current?.click();
    else backInputRef.current?.click();
  };

  const handleFileChange = (side: ImageSide) => (event: ChangeEvent<HTMLInputElement>) => {
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

    if (side === "front") {
      setFrontFile(file);
      setBackFile(null);
    } else {
      setBackFile(file);
    }
  };

  const identifyCard = async (event: FormEvent) => {
    event.preventDefault();
    if (!frontFile || isIdentifying) return;

    setIsIdentifying(true);
    setError(null);
    setIdentification(null);

    try {
      const [frontImage, backImage] = await Promise.all([
        fileToDataUrl(frontFile),
        backFile ? fileToDataUrl(backFile) : Promise.resolve(null),
      ]);

      const response = await fetch("/api/identify-card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frontImage, backImage }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { identification?: CardIdentification; error?: string }
        | null;

      if (!response.ok || !payload?.identification) {
        throw new Error(payload?.error ?? "CardPilot could not identify this card.");
      }

      setIdentification(payload.identification);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "CardPilot could not identify this card.",
      );
    } finally {
      setIsIdentifying(false);
    }
  };

  const resetScan = () => {
    setFrontFile(null);
    setBackFile(null);
    setIdentification(null);
    setError(null);
  };

  const confidenceTone = identification
    ? identification.confidence >= 80
      ? "high"
      : identification.confidence >= 55
        ? "medium"
        : "low"
    : "low";

  const resultTitle = identification
    ? identification.status === "not_sports_card"
      ? "Sports card not confirmed"
      : [identification.year, identification.brand ?? identification.manufacturer, identification.playerName]
          .filter(Boolean)
          .join(" ") || "Sports card identified"
    : "";

  const cardFlags = identification
    ? [
        identification.rookieCard ? "Rookie card" : null,
        identification.autographed ? "Autographed" : null,
        identification.memorabilia ? "Memorabilia" : null,
      ].filter(Boolean)
    : [];

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="CardPilot home">
          <span className="brand-mark">CP</span>
          <span>CardPilot</span>
        </a>
        <span className="prototype-badge">Sports beta</span>
      </header>

      <main id="top">
        <section className="hero-section">
          <div className="hero-copy">
            <div className="eyebrow">
              <span className="eyebrow-icon"><SparkIcon /></span>
              AI-assisted sports card ID
            </div>
            <h1>Know what’s in the sleeve.</h1>
            <p className="hero-lede">
              Photograph a sports card and CardPilot will pull out the player,
              year, set, card number, and other visible details in seconds.
            </p>

            <div className="trust-row" aria-label="How CardPilot works">
              <span><CheckIcon /> Front photo required</span>
              <span><CheckIcon /> Back photo improves accuracy</span>
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

            <form onSubmit={identifyCard}>
              <input
                className="visually-hidden"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                capture="environment"
                ref={frontInputRef}
                onChange={handleFileChange("front")}
              />
              <input
                className="visually-hidden"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                capture="environment"
                ref={backInputRef}
                onChange={handleFileChange("back")}
              />

              {!frontPreview ? (
                <button
                  className="capture-zone"
                  type="button"
                  onClick={() => openPicker("front")}
                >
                  <span className="camera-disc"><CameraIcon /></span>
                  <strong>Take or choose a photo</strong>
                  <span>Center the full front of the card in the frame</span>
                  <small>JPG, PNG, WebP or GIF · up to 12 MB</small>
                </button>
              ) : (
                <div className="photo-stage">
                  <div className="primary-photo">
                    <img src={frontPreview} alt="Selected front of sports card" />
                    <span className="photo-label">Front</span>
                    <button
                      className="change-photo"
                      type="button"
                      onClick={() => openPicker("front")}
                    >
                      Change
                    </button>
                  </div>

                  {backPreview ? (
                    <div className="back-photo">
                      <img src={backPreview} alt="Selected back of sports card" />
                      <span>Back added</span>
                      <button type="button" onClick={() => setBackFile(null)}>
                        Remove
                      </button>
                    </div>
                  ) : (
                    <button
                      className="add-back"
                      type="button"
                      onClick={() => openPicker("back")}
                    >
                      <span>+</span>
                      <span><strong>Add card back</strong><small>Optional, recommended</small></span>
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

              <button
                className="identify-button"
                type="submit"
                disabled={!frontFile || isIdentifying}
              >
                {isIdentifying ? (
                  <><span className="spinner" /> Reading the card…</>
                ) : (
                  <><SparkIcon /> Identify this card <ArrowIcon /></>
                )}
              </button>
            </form>
          </section>
        </section>

        {identification && (
          <section className="result-card" aria-labelledby="result-title" aria-live="polite">
            <div className="result-topline">
              <div>
                <span className="step-label">Step 02 · Review</span>
                <h2 id="result-title">{resultTitle}</h2>
                <p>{identification.summary}</p>
              </div>
              <div className={`confidence confidence-${confidenceTone}`}>
                <strong>{identification.confidence}%</strong>
                <span>confidence</span>
              </div>
            </div>

            {cardFlags.length > 0 && (
              <div className="flag-row">
                {cardFlags.map((flag) => <span key={flag}>{flag}</span>)}
              </div>
            )}

            <div className="result-grid">
              <dl className="details-grid">
                <Detail label="Player" value={identification.playerName} />
                <Detail label="Sport" value={identification.sport} />
                <Detail label="Team" value={identification.team} />
                <Detail label="Year / season" value={identification.year} />
                <Detail label="Manufacturer" value={identification.manufacturer} />
                <Detail label="Brand" value={identification.brand} />
                <Detail label="Set" value={identification.setName} />
                <Detail label="Card number" value={identification.cardNumber} />
                <Detail label="Parallel / variant" value={identification.parallelOrVariant} />
                <Detail label="Serial number" value={identification.serialNumber} />
              </dl>

              <aside className="evidence-panel">
                <h3>What CardPilot could see</h3>
                {identification.visibleEvidence.length > 0 ? (
                  <ul>
                    {identification.visibleEvidence.map((clue) => (
                      <li key={clue}><CheckIcon /> {clue}</li>
                    ))}
                  </ul>
                ) : (
                  <p>No reliable visual clues were extracted.</p>
                )}
              </aside>
            </div>

            {(identification.needsBackImage || identification.followUpHint) && (
              <div className="follow-up-note">
                <strong>{identification.needsBackImage ? "A back photo could improve this match." : "Identification note"}</strong>
                <span>{identification.followUpHint ?? "Scan the card back to reveal its number, copyright line, and set details."}</span>
              </div>
            )}

            <div className="result-actions">
              {identification.needsBackImage && !backFile && (
                <button className="secondary-button" type="button" onClick={() => openPicker("back")}>
                  Add back photo
                </button>
              )}
              <button className="text-button" type="button" onClick={resetScan}>
                Scan another card
              </button>
            </div>

            <p className="review-disclaimer">
              AI-assisted identification can be wrong. Verify the card number, set,
              and variant before buying, selling, or grading.
            </p>
          </section>
        )}
      </main>

      <footer>
        <span>CardPilot</span>
        <span>Built for collectors who want a faster first look.</span>
      </footer>
    </div>
  );
}

export default App;
