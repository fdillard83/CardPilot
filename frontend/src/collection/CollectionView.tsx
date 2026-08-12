import { useMemo, useState } from "react";
import {
  fieldDefinitions,
  formatFieldValue,
  type FieldKey,
  type FieldValue,
  type SavedCollectionCard,
} from "../identification/types";

type CollectionFilter = "all" | "numbered" | "autograph" | "rookie";

function searchableText(card: SavedCollectionCard) {
  return Object.values(card.fields)
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
}
function matchesFilter(card: SavedCollectionCard, filter: CollectionFilter) {
  if (filter === "numbered") return Boolean(card.fields.serialNumber);
  if (filter === "autograph") return card.fields.autograph === true;
  if (filter === "rookie") return card.fields.rookieStatus === true;
  return true;
}

function createDraft(card: SavedCollectionCard) {
  return { ...card.fields };
}

export function CollectionView({
  cards,
  isLoading,
  error,
  onCardsChange,
  onScanCard,
}: {
  cards: SavedCollectionCard[];
  isLoading: boolean;
  error: string | null;
  onCardsChange: (cards: SavedCollectionCard[]) => void;
  onScanCard: () => void;
}) {
  const [query, setQuery] = useState("");
  const [sport, setSport] = useState("all");
  const [filter, setFilter] = useState<CollectionFilter>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<FieldKey, FieldValue> | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const sports = useMemo(
    () =>
      Array.from(
        new Set(
          cards
            .map((card) => card.fields.sport)
            .filter((value): value is string => typeof value === "string"),
        ),
      ).sort(),
    [cards],
  );

  const filteredCards = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return cards.filter(
      (card) =>
        (!normalizedQuery || searchableText(card).includes(normalizedQuery)) &&
        (sport === "all" || card.fields.sport === sport) &&
        matchesFilter(card, filter),
    );
  }, [cards, filter, query, sport]);

  const beginEdit = (card: SavedCollectionCard) => {
    setEditingId(card.collectionId);
    setDraft(createDraft(card));
    setActionError(null);
  };

  const saveEdit = async (card: SavedCollectionCard) => {
    if (!draft || busyId) return;
    setBusyId(card.collectionId);
    setActionError(null);
    try {
      const response = await fetch(
        `/api/collection/${encodeURIComponent(card.collectionId)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fields: draft }),
        },
      );
      const payload = (await response.json().catch(() => null)) as
        | { card?: SavedCollectionCard; error?: string }
        | null;
      if (!response.ok || !payload?.card) {
        throw new Error(payload?.error ?? "CardPilot could not update this card.");
      }
      onCardsChange(
        cards.map((item) =>
          item.collectionId === payload.card?.collectionId ? payload.card : item,
        ),
      );
      setEditingId(null);
      setDraft(null);
    } catch (caughtError) {
      setActionError(
        caughtError instanceof Error
          ? caughtError.message
          : "CardPilot could not update this card.",
      );
    } finally {
      setBusyId(null);
    }
  };

  const removeCard = async (card: SavedCollectionCard) => {
    if (
      busyId ||
      !window.confirm(`Remove ${card.title} from your CardPilot collection?`)
    ) {
      return;
    }

    setBusyId(card.collectionId);
    setActionError(null);
    try {
      const response = await fetch(
        `/api/collection/${encodeURIComponent(card.collectionId)}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error ?? "CardPilot could not remove this card.");
      }
      onCardsChange(
        cards.filter((item) => item.collectionId !== card.collectionId),
      );
    } catch (caughtError) {
      setActionError(
        caughtError instanceof Error
          ? caughtError.message
          : "CardPilot could not remove this card.",
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="collection-section" aria-labelledby="collection-title">
      <div className="collection-heading">
        <div>
          <span className="step-label">My Collection</span>
          <h1 id="collection-title">Your cards, ready when you are.</h1>
          <p>
            Search confirmed details, review card photos, and keep numbered,
            rookie, and autograph cards easy to find.
          </p>
        </div>
        <button className="secondary-button" type="button" onClick={onScanCard}>
          Scan another card
        </button>
      </div>

      <div className="collection-summary" aria-label="Collection summary">
        <div><strong>{cards.length}</strong><span>Total cards</span></div>
        <div><strong>{cards.filter((card) => card.fields.serialNumber).length}</strong><span>Numbered</span></div>
        <div><strong>{cards.filter((card) => card.fields.autograph === true).length}</strong><span>Autographs</span></div>
        <div><strong>{cards.filter((card) => card.fields.rookieStatus === true).length}</strong><span>Rookies</span></div>
      </div>

      <div className="collection-toolbar">
        <label>
          <span>Search collection</span>
          <input
            type="search"
            value={query}
            placeholder="Player, year, set, card number..."
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label>
          <span>Sport</span>
          <select value={sport} onChange={(event) => setSport(event.target.value)}>
            <option value="all">All sports</option>
            {sports.map((value) => <option key={value}>{value}</option>)}
          </select>
        </label>
        <label>
          <span>Card type</span>
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value as CollectionFilter)}
          >
            <option value="all">All cards</option>
            <option value="numbered">Numbered cards</option>
            <option value="autograph">Autographs</option>
            <option value="rookie">Rookies</option>
          </select>
        </label>
      </div>

      {(error || actionError) && (
        <div className="error-banner" role="alert">
          <strong>Collection action interrupted.</strong>
          <span>{actionError ?? error}</span>
        </div>
      )}

      {isLoading ? (
        <div className="collection-empty"><span className="spinner" /> Loading your collection...</div>
      ) : cards.length === 0 ? (
        <div className="collection-empty">
          <strong>Your collection is ready for its first card.</strong>
          <span>Choose a card photo, review the identification, and confirm it.</span>
          <button className="secondary-button" type="button" onClick={onScanCard}>Scan a card</button>
        </div>
      ) : filteredCards.length === 0 ? (
        <div className="collection-empty">
          <strong>No cards match those filters.</strong>
          <span>Try a broader search or choose All cards.</span>
        </div>
      ) : (
        <div className="collection-grid">
          {filteredCards.map((card) => {
            const isEditing = editingId === card.collectionId && draft;
            return (
              <article className="collection-card" key={card.collectionId}>
                <div className="collection-card-image">
                  <img src={card.images.frontUrl} alt={`Front of ${card.title}`} />
                  {card.fields.serialNumber && <span>Numbered {card.fields.serialNumber}</span>}
                </div>
                {isEditing ? (
                  <div className="collection-editor">
                    <h2>Edit saved card</h2>
                    <div className="collection-editor-grid">
                      {fieldDefinitions.map((definition) => (
                        <label key={definition.key}>
                          <span>{definition.label}</span>
                          {definition.kind === "boolean" ? (
                            <select
                              value={draft[definition.key] === null ? "unknown" : String(draft[definition.key])}
                              onChange={(event) =>
                                setDraft({
                                  ...draft,
                                  [definition.key]: event.target.value === "unknown" ? null : event.target.value === "true",
                                })
                              }
                            >
                              <option value="unknown">Unknown</option>
                              <option value="true">Yes</option>
                              <option value="false">No</option>
                            </select>
                          ) : (
                            <input
                              value={String(draft[definition.key] ?? "")}
                              placeholder="Unknown"
                              onChange={(event) =>
                                setDraft({
                                  ...draft,
                                  [definition.key]: event.target.value.trimStart() || null,
                                })
                              }
                            />
                          )}
                        </label>
                      ))}
                    </div>
                    <div className="collection-card-actions">
                      <button type="button" disabled={busyId !== null} onClick={() => void saveEdit(card)}>
                        {busyId === card.collectionId ? "Saving..." : "Save changes"}
                      </button>
                      <button type="button" onClick={() => { setEditingId(null); setDraft(null); }}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="collection-card-body">
                    <div>
                      <span>{card.fields.sport ?? "Sports card"}</span>
                      <h2>{card.title}</h2>
                    </div>
                    <dl>
                      <div><dt>Card number</dt><dd>{formatFieldValue(card.fields.cardNumber)}</dd></div>
                      <div><dt>Parallel</dt><dd>{formatFieldValue(card.fields.parallel)}</dd></div>
                      <div><dt>Numbered card</dt><dd>{card.fields.serialNumber ? "Yes" : "No"}</dd></div>
                      <div><dt>Serial</dt><dd>{formatFieldValue(card.fields.serialNumber)}</dd></div>
                    </dl>
                    <div className="collection-card-flags">
                      {card.fields.rookieStatus === true && <span>Rookie</span>}
                      {card.fields.autograph === true && <span>Autograph</span>}
                      {card.fields.memorabilia === true && <span>Memorabilia</span>}
                    </div>
                    <small>Updated {new Date(card.updatedAt).toLocaleDateString()}</small>
                    <div className="collection-card-actions">
                      <button type="button" onClick={() => beginEdit(card)}>Edit details</button>
                      <button type="button" disabled={busyId !== null} onClick={() => void removeCard(card)}>
                        {busyId === card.collectionId ? "Removing..." : "Remove"}
                      </button>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
