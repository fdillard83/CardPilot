import assert from "node:assert/strict";
import test from "node:test";
import {
  applyEvidenceConsensus,
  buildMarketConsensusProfile,
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
