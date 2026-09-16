import assert from "node:assert/strict";
import test from "node:test";
import {
  applyEvidenceConsensus,
  buildMarketConsensusProfile,
  reconcileBackwardEvidence,
} from "./evidence-consensus.mjs";

function visible(value, confidence = 0.7) {
  return {
    value,
    confidence,
    evidenceIds: [],
    inferenceSource: "visible",
    missingEvidence: [],
  };
}

test("exact matching pages strengthen independently extracted identity fields", () => {
  const extraction = {
    fields: {
      player: visible("Nick Kurtz"),
      year: visible("2025"),
      cardNumber: visible("PP-30"),
      parallel: visible(null, 0),
    },
    evidence: [],
  };
  const result = applyEvidenceConsensus(extraction, [{
    provider: "google_web_detection",
    status: "completed",
    signals: [
      {
        type: "full_matching_page",
        text: "2025 Topps Nick Kurtz Power Players #PP-30",
        url: "https://example.com/nick-kurtz-pp-30",
        imageUrl: "https://example.com/nick-kurtz.jpg",
        strength: 0.95,
      },
      {
        type: "matching_page",
        text: "Nick Kurtz 2025 PP-30",
        url: null,
        imageUrl: null,
        strength: 0.7,
      },
    ],
  }]);

  assert.ok(result.fields.player.confidence > extraction.fields.player.confidence);
  assert.ok(result.fields.year.confidence > extraction.fields.year.confidence);
  assert.ok(result.fields.cardNumber.confidence > extraction.fields.cardNumber.confidence);
  assert.equal(result.fields.player.inferenceSource, "mixed");
  assert.equal(result.evidence.every((item) => item.source === "web"), true);
  assert.equal(result.fields.parallel.value, null);
});

test("general or conflicting web labels cannot invent or boost a field", () => {
  const extraction = {
    fields: { player: visible("Nick Kurtz"), year: visible(null, 0) },
    evidence: [],
  };
  const result = applyEvidenceConsensus(extraction, [{
    provider: "google_web_detection",
    status: "completed",
    signals: [{
      type: "web_entity",
      text: "Baseball trading card",
      url: null,
      imageUrl: null,
      strength: 0.8,
    }],
  }]);
  assert.deepEqual(result, extraction);
});

test("repeated Google full-image page matches correct a tentative year", () => {
  const extraction = {
    fields: { player: visible("Nick Kurtz", 0.95), year: visible("2026", 0.72) },
    evidence: [],
  };
  const result = applyEvidenceConsensus(extraction, [{
    provider: "google_web_detection",
    status: "completed",
    signals: [
      {
        type: "full_matching_page",
        text: "2025 Topps Chrome Nick Kurtz Gold Refractor #99",
        url: "https://example.com/2025-topps-chrome-nick-kurtz",
        imageUrl: "https://example.com/card-a.jpg",
        strength: 0.96,
      },
      {
        type: "full_matching_page",
        text: "2025 Nick Kurtz Topps Chrome Gold Refractor #99",
        url: "https://example.org/nick-kurtz-2025-card",
        imageUrl: "https://example.org/card-b.jpg",
        strength: 0.94,
      },
    ],
  }]);
  assert.equal(result.fields.year.value, "2025");
  assert.equal(result.fields.year.inferenceSource, "web");
  assert.ok(result.fields.year.confidence > extraction.fields.year.confidence);
  assert.match(result.evidence[0].observation, /2025 instead of the tentative 2026/);
});

test("explicit sports seasons outrank unrelated page years and retain both season years", () => {
  const extraction = {
    fields: { player: visible("Victor Wembanyama", 0.96), year: visible("2026", 0.65) },
    evidence: [],
  };
  const result = applyEvidenceConsensus(extraction, [{
    provider: "google_web_detection",
    status: "completed",
    signals: [
      {
        type: "full_matching_page",
        text: "2024-25 Panini Prizm Victor Wembanyama Silver — updated 2026",
        url: "https://example.com/2024-25-prizm-wembanyama",
        imageUrl: null,
        strength: 0.96,
      },
      {
        type: "full_matching_page",
        text: "Victor Wembanyama 2024/2025 Panini Prizm Silver sale 2026",
        url: "https://example.org/wembanyama-prizm",
        imageUrl: null,
        strength: 0.94,
      },
    ],
  }]);

  assert.equal(result.fields.year.value, "2024-25");
  assert.equal(result.fields.year.inferenceSource, "web");
});

test("one seller page cannot overwrite a tentative year", () => {
  const extraction = {
    fields: { player: visible("Nick Kurtz", 0.95), year: visible("2026", 0.72) },
    evidence: [],
  };
  const result = applyEvidenceConsensus(extraction, [{
    provider: "google_web_detection",
    status: "completed",
    signals: [{
      type: "full_matching_page",
      text: "2025 Topps Chrome Nick Kurtz Gold Refractor #99",
      url: "https://example.com/2025-topps-chrome-nick-kurtz",
      imageUrl: "https://example.com/card.jpg",
      strength: 0.99,
    }],
  }]);
  assert.equal(result.fields.year.value, "2026");
  assert.equal(result.fields.year.inferenceSource, "visible");
});

test("visually similar images alone cannot overwrite a year", () => {
  const extraction = {
    fields: { year: visible("2026", 0.72) },
    evidence: [],
  };
  const result = applyEvidenceConsensus(extraction, [{
    provider: "google_web_detection",
    status: "completed",
    signals: [{
      type: "visually_similar_image",
      text: "https://example.com/2025-similar-card.jpg",
      url: null,
      imageUrl: "https://example.com/2025-similar-card.jpg",
      strength: 0.9,
    }],
  }]);
  assert.deepEqual(result, extraction);
});

test("near-certain visible year evidence is not overwritten by the web", () => {
  const extraction = {
    fields: { year: visible("2026", 0.95) },
    evidence: [],
  };
  const result = applyEvidenceConsensus(extraction, [{
    provider: "google_web_detection",
    status: "completed",
    signals: [{
      type: "full_matching_page",
      text: "2025 card",
      url: "https://example.com/2025-card",
      imageUrl: null,
      strength: 0.98,
    }],
  }]);
  assert.deepEqual(result, extraction);
});

test("market consensus profiles retain only web-supported saved identity fields", () => {
  const profile = buildMarketConsensusProfile(
    {
      player: "Nick Kurtz",
      year: "2025",
      cardNumber: "PP-30",
      parallel: "Gold",
      rookieStatus: true,
    },
    [{
      provider: "google_web_detection",
      status: "completed",
      signals: [{
        type: "full_matching_page",
        text: "2025 Nick Kurtz Power Players #PP-30",
        url: "https://example.com/nick-kurtz",
        imageUrl: null,
        strength: 0.94,
      }],
    }],
  );

  assert.deepEqual(Object.keys(profile).sort(), ["cardNumber", "player", "year"]);
  assert.deepEqual(profile.year, { strength: 0.94, resultCount: 1 });
  assert.equal(profile.parallel, undefined);
  assert.equal(profile.rookieStatus, undefined);
});

test("clear Google OCR from the card back fills a missing year", () => {
  const extraction = {
    fields: { player: visible("Nick Kurtz", 0.95), year: visible(null, 0) },
    evidence: [],
  };
  const result = applyEvidenceConsensus(extraction, [{
    provider: "google_web_detection",
    status: "completed",
    signals: [{
      type: "printed_card_text",
      text: "Nick Kurtz PP-30 © 2025 The Topps Company",
      url: null,
      imageUrl: null,
      imageSide: "back",
      imageLabel: "back lower detail band detail",
      strength: 0.92,
    }],
  }]);

  assert.equal(result.fields.year.value, "2025");
  assert.equal(result.fields.year.inferenceSource, "web");
  assert.ok(result.fields.year.confidence >= 0.74);
});

test("front OCR needs an independent matching result before filling a year", () => {
  const extraction = {
    fields: { player: visible("Nick Kurtz", 0.95), year: visible(null, 0) },
    evidence: [],
  };
  const ocr = {
    type: "printed_card_text",
    text: "2025 Nick Kurtz",
    url: null,
    imageUrl: null,
    imageSide: "front",
    imageLabel: "front card",
    strength: 0.88,
  };
  const uncorroborated = applyEvidenceConsensus(extraction, [{
    provider: "google_web_detection",
    status: "completed",
    signals: [ocr],
  }]);
  assert.equal(uncorroborated.fields.year.value, null);

  const corroborated = applyEvidenceConsensus(extraction, [{
    provider: "google_web_detection",
    status: "completed",
    signals: [ocr, {
      type: "full_matching_page",
      text: "2025 Topps Nick Kurtz PP-30",
      url: "https://example.com/2025-nick-kurtz",
      imageUrl: null,
      strength: 0.94,
    }],
  }]);
  assert.equal(corroborated.fields.year.value, "2025");
});

test("anniversary wording cannot turn an old design year into the issue year", () => {
  const extraction = {
    fields: { player: visible("Nick Kurtz", 0.95), year: visible(null, 0) },
    evidence: [],
  };
  const result = applyEvidenceConsensus(extraction, [{
    provider: "google_web_detection",
    status: "completed",
    signals: [{
      type: "printed_card_text",
      text: "Nick Kurtz 1952 design anniversary",
      url: null,
      imageUrl: null,
      imageSide: "back",
      imageLabel: "back card",
      strength: 0.9,
    }],
  }]);
  assert.equal(result.fields.year.value, null);
});

test("backward reconciliation restores a repeated Google year consensus", () => {
  const originalExtraction = {
    fields: { year: visible("2026", 0.62) },
    evidence: [],
  };
  const forwardExtraction = {
    fields: {
      year: {
        ...visible("2025", 0.84),
        inferenceSource: "web",
        evidenceIds: ["ev-forward-year"],
      },
    },
    evidence: [{
      id: "ev-forward-year",
      field: "year",
      source: "web",
      observation: "Repeated Google matches support 2025.",
      location: null,
      strength: 0.95,
    }],
  };
  const verification = {
    fields: {
      year: {
        ...visible("2026", 0.7),
        inferenceSource: "catalog",
      },
    },
    candidateMatches: [],
  };
  const providerResults = [{
    provider: "google_web_detection",
    status: "completed",
    signals: [
      {
        type: "full_matching_page",
        text: "2025 card",
        url: "https://example.com/2025-card-one",
        imageUrl: null,
        strength: 0.96,
      },
      {
        type: "full_matching_page",
        text: "2025 trading card",
        url: "https://example.org/2025-card-two",
        imageUrl: null,
        strength: 0.94,
      },
    ],
  }];

  const result = reconcileBackwardEvidence({
    originalExtraction,
    forwardExtraction,
    verification,
    providerResults,
  });

  assert.equal(result.fields.year.value, "2025");
  assert.equal(result.fields.year.inferenceSource, "web");
  assert.ok(result.evidence.length > forwardExtraction.evidence.length);
});

test("independent Google and catalog support strengthen a late field", () => {
  const originalExtraction = {
    fields: { product: visible("Topps", 0.55) },
    evidence: [],
  };
  const forwardExtraction = structuredClone(originalExtraction);
  const verification = {
    fields: {
      product: {
        ...visible("Topps Chrome", 0.68),
        inferenceSource: "catalog",
      },
    },
    candidateMatches: [{
      source: "catalog",
      matchConfidence: 0.82,
      values: { product: "Topps Chrome" },
    }],
  };
  const providerResults = [{
    provider: "google_web_detection",
    status: "completed",
    signals: [{
      type: "full_matching_page",
      text: "Topps Chrome baseball card",
      url: "https://example.com/topps-chrome",
      imageUrl: null,
      strength: 0.94,
    }],
  }];

  const result = reconcileBackwardEvidence({
    originalExtraction,
    forwardExtraction,
    verification,
    providerResults,
  });

  assert.equal(result.fields.product.value, "Topps Chrome");
  assert.equal(result.fields.product.inferenceSource, "mixed");
  assert.ok(result.fields.product.confidence >= 0.82);
  assert.equal(result.evidence.some((item) => item.field === "product"), true);
});

test("near-certain original visible text remains the final anchor", () => {
  const originalExtraction = {
    fields: { cardNumber: visible("PP-30", 0.96) },
    evidence: [],
  };
  const forwardExtraction = structuredClone(originalExtraction);
  const verification = {
    fields: {
      cardNumber: {
        ...visible("PP-80", 0.71),
        inferenceSource: "catalog",
      },
    },
    candidateMatches: [],
  };

  const result = reconcileBackwardEvidence({
    originalExtraction,
    forwardExtraction,
    verification,
    providerResults: [{
      provider: "google_web_detection",
      status: "completed",
      signals: [],
    }],
  });

  assert.equal(result.fields.cardNumber.value, "PP-30");
  assert.match(result.fields.cardNumber.missingEvidence.at(-1), /original image evidence/);
});
