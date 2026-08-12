import { zodTextFormat } from "openai/helpers/zod";
import {
  fieldKeys,
  ModelEvidenceExtractionSchema,
} from "./contracts.mjs";

const evidenceExtractionFormat = zodTextFormat(
  ModelEvidenceExtractionSchema,
  "card_evidence_extraction",
);

const evidencePrompt = `Extract visible evidence from sports-card photographs, then separately propose up to three plausible card candidates. Evidence extraction must finish before candidate generation, and model knowledge must never be reported as visible evidence.

Rules:
- Treat pixels as the primary source of truth. Transcribe useful words and digits exactly as printed and say where each observation appears.
- Before assigning semantic fields, list literal visibleMarks and classify each mark by its printed role. A commemorative or anniversary logo is not an issue year, product, set, insert, or card number.
- Record visualFeatures such as border color, foil pattern, frame layout, and reflective finish without naming a parallel unless the evidence supports that name.
- Inspect every short numeric mark character by character, especially anniversary logos, years, card numbers, and serial numbering. Record each character independently in numericReadings before interpreting what the number means.
- When a serial stamp is visible, transcribe the collector's exact numerator and denominator, including leading zeroes (for example, 023/099). If only a print-run denominator such as /99 is supported, preserve it as incomplete and never invent the missing numerator.
- Compare the full image with every supplied detail crop. The crop is an enlarged view of the same card, not a separate card.
- Distinguish 75 from 70 and 50 by the actual second-character shape. Never use anniversary arithmetic, a familiar issue year, or a known slogan to decide which digit is printed. If character shape remains ambiguous, list the alternatives and lower confidence.
- A field may be null. Never invent obscured text, a parallel, rookie designation, autograph, memorabilia feature, image variation, or serial number.
- Treat a facsimile signature as printed design, not an autograph.
- Do not add generic uncertainty for serial numbering, autographs, memorabilia, or image variations when nothing in the image suggests that feature. Add missing evidence for those high-impact fields only when a visible clue makes the feature plausible but unresolved.
- Confidence measures support in the supplied images only. Clear exact text can be high confidence; design recognition alone cannot.
- For each uncertain field, identify the missing evidence and estimate how much that specific evidence could improve overall confidence.
- A back photo is optional. Suggest it only as a possible evidence source; never describe it as required.
- Candidate suggestions are unverified search leads. They must preserve exact numericReadings, return alternatives when the issue is ambiguous, keep unsupported values null, and set catalogRecordId to null because no checklist was queried.
- A shiny surface alone is not evidence of a named parallel. Candidate plausibility is only a ranking hint, not final confidence.
- If the image is not a sports trading card, return not_sports_card.
- Keep observations, candidate bases, and the summary concise.`;

function createUserContent(intake) {
  const content = [
    {
      type: "input_text",
      text: intake.backImage
        ? "Extract evidence. The first image is the card front and the second is the card back."
        : "Extract all reliable evidence from this card front. Record what remains uncertain without assuming a back image is required.",
    },
    {
      type: "input_image",
      image_url: intake.frontImage,
      detail: "original",
    },
  ];

  for (const detailImage of intake.frontDetailImages) {
    content.push(
      {
        type: "input_text",
        text: `Enlarged ${detailImage.label} crop of the same card front. Use it to verify small text and digits character by character.`,
      },
      {
        type: "input_image",
        image_url: detailImage.image,
        detail: "original",
      },
    );
  }

  if (intake.backImage) {
    content.push({
      type: "input_image",
      image_url: intake.backImage,
      detail: "original",
    });
  }

  return content;
}

export class OpenAIEvidenceEngine {
  constructor({ openai, model, fastModel = model }) {
    this.openai = openai;
    this.model = model;
    this.fastModel = fastModel;
  }

  modelFor(intake) {
    return intake.backImage ? this.model : this.fastModel;
  }

  async extract(intake) {
    const selectedModel = this.modelFor(intake);
    const response = await this.openai.responses.parse({
      model: selectedModel,
      store: false,
      reasoning: { effort: intake.backImage ? "medium" : "none" },
      max_output_tokens: intake.backImage ? 6_000 : 3_500,
      input: [
        { role: "system", content: evidencePrompt },
        { role: "user", content: createUserContent(intake) },
      ],
      text: { format: evidenceExtractionFormat, verbosity: "low" },
    });

    if (!response.output_parsed) {
      throw new Error(
        "The card evidence could not be read. Try a brighter, sharper photo of the full card.",
      );
    }

    return normalizeEvidence(response.output_parsed);
  }
}

export function normalizeEvidence(raw) {
  const evidence = [];
  const fields = {};
  const numericReadings = raw.numericReadings.map(normalizeNumericReading);

  for (const field of fieldKeys) {
    const extracted = raw.fields[field];
    const fieldNumericReadings = numericReadings.filter(
      (reading) => reading.field === field,
    );
    const reconciledValue = fieldNumericReadings.reduce(
      (value, reading) => reconcileNumericText(value, reading),
      extracted.value,
    );
    const fieldEvidence = extracted.observations.map((observation, index) => {
      const reconciledObservation = fieldNumericReadings.reduce(
        (value, reading) => reconcileNumericText(value, reading),
        observation.observation,
      );
      const item = {
        id: `ev-${field}-${index + 1}`,
        field,
        source:
          observation.imageSide === "back" ? "back_image" : "front_image",
        observation: reconciledObservation,
        location: observation.location,
        strength: observation.strength,
      };
      evidence.push(item);
      return item.id;
    });

    for (const [index, reading] of fieldNumericReadings.entries()) {
      const item = {
        id: `ev-${field}-numeric-${index + 1}`,
        field,
        source: reading.imageSide === "back" ? "back_image" : "front_image",
        observation: `“${reading.value}” read character by character (${reading.characters.map((character) => character.character).join(" · ")}).`,
        location: reading.location,
        strength: reading.confidence,
      };
      evidence.push(item);
      fieldEvidence.push(item.id);
    }

    fields[field] = {
      value: reconciledValue,
      confidence:
        reconciledValue === null
          ? 0
          : Math.min(
              extracted.confidence,
              ...fieldNumericReadings.map((reading) => reading.confidence),
              1,
            ),
      evidenceIds: fieldEvidence,
      inferenceSource: fieldEvidence.length > 0 ? "visible" : "unknown",
      missingEvidence: raw.missingEvidence
        .filter((missing) => missing.field === field)
        .map((missing) => missing.description),
    };
  }

  return {
    status: raw.status,
    fields,
    evidence,
    missingEvidence: raw.missingEvidence,
    numericReadings,
    visibleMarks: raw.visibleMarks.map((mark) => ({ ...mark })),
    visualFeatures: raw.visualFeatures.map((feature) => ({ ...feature })),
    candidateSuggestions: raw.candidateSuggestions.map((candidate, index) => {
      const hadReconciledNumber = numericReadings.some(
        (reading) => reading.reportedValue !== reading.value,
      );
      return {
        id: `candidate-${index + 1}`,
        label: numericReadings.reduce(
          (value, reading) => reconcileNumericText(value, reading),
          candidate.label,
        ),
        source: "model_knowledge",
        catalogRecordId: null,
        values: Object.fromEntries(
          fieldKeys.map((field) => [
            field,
            numericReadings
              .filter((reading) => reading.field === field)
              .reduce(
                (value, reading) => reconcileNumericText(value, reading),
                candidate.values[field],
              ),
          ]),
        ),
        plausibility: hadReconciledNumber
          ? Math.min(candidate.plausibility, 0.55)
          : candidate.plausibility,
        basis: numericReadings.reduce(
          (value, reading) => reconcileNumericText(value, reading),
          candidate.basis,
        ),
      };
    }),
    summary: numericReadings.reduce(
      (value, reading) => reconcileNumericText(value, reading),
      raw.summary,
    ),
  };
}

export function normalizeNumericReading(reading) {
  const characters = [...reading.characters].sort(
    (left, right) => left.position - right.position,
  );
  const characterValue = characters.map((item) => item.character).join("");
  const confidence = Math.min(
    reading.confidence,
    ...characters.map((item) => item.confidence),
    1,
  );

  return {
    ...reading,
    reportedValue: reading.value,
    value: characterValue || reading.value,
    characters,
    confidence: Number(confidence.toFixed(3)),
  };
}

function reconcileNumericText(value, reading) {
  if (
    typeof value !== "string" ||
    reading.reportedValue === reading.value ||
    !value.includes(reading.reportedValue)
  ) {
    return value;
  }

  return value.replaceAll(reading.reportedValue, reading.value);
}
