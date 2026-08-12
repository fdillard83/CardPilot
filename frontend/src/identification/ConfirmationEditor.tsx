import { useState } from "react";
import type { FormEvent } from "react";
import {
  fieldDefinitions,
  type CardIdentification,
  type FieldKey,
  type FieldValue,
} from "./types";

type DraftValues = Record<FieldKey, FieldValue>;

function createDraft(
  identification: CardIdentification,
  initialValues: Partial<DraftValues>,
): DraftValues {
  return Object.fromEntries(
    fieldDefinitions.map(({ key }) => [
      key,
      Object.prototype.hasOwnProperty.call(initialValues, key)
        ? initialValues[key]
        : identification.fields[key].value,
    ]),
  ) as DraftValues;
}

export function ConfirmationEditor({
  identification,
  initialValues = {},
  eyebrow = "Edit result",
  title = "Correct any field",
  description =
    "Your correction is logged as an unverified example, not global truth.",
  referenceTitle = null,
  submitLabel = "Save corrections",
  onCancel,
  onSave,
}: {
  identification: CardIdentification;
  initialValues?: Partial<DraftValues>;
  eyebrow?: string;
  title?: string;
  description?: string;
  referenceTitle?: string | null;
  submitLabel?: string;
  onCancel: () => void;
  onSave: (values: DraftValues) => Promise<void>;
}) {
  const [draft, setDraft] = useState(() =>
    createDraft(identification, initialValues),
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateValue = (field: FieldKey, value: FieldValue) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      await onSave(draft);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "CardPilot could not save these changes.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form className="editor-panel" onSubmit={submit}>
      <div className="editor-heading">
        <div>
          <span className="step-label">{eyebrow}</span>
          <h3>{title}</h3>
        </div>
        <p>{description}</p>
      </div>

      {referenceTitle && (
        <div className="editor-reference">
          <strong>Selected visual reference</strong>
          <span>{referenceTitle}</span>
        </div>
      )}

      <div className="editor-grid">
        {fieldDefinitions.map((definition) => (
          <label className="editor-field" key={definition.key}>
            <span>{definition.label}</span>
            {definition.kind === "boolean" ? (
              <select
                value={
                  draft[definition.key] === null
                    ? "unknown"
                    : String(draft[definition.key])
                }
                onChange={(event) =>
                  updateValue(
                    definition.key,
                    event.target.value === "unknown"
                      ? null
                      : event.target.value === "true",
                  )
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
                  updateValue(
                    definition.key,
                    event.target.value.trimStart() || null,
                  )
                }
              />
            )}
          </label>
        ))}
      </div>

      {error && (
        <div className="error-banner" role="alert">
          <strong>Changes were not saved.</strong>
          <span>{error}</span>
        </div>
      )}

      <div className="editor-actions">
        <button className="secondary-button" type="submit" disabled={isSaving}>
          {isSaving ? "Saving..." : submitLabel}
        </button>
        <button className="text-button" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
