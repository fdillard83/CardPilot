import assert from "node:assert/strict";
import test from "node:test";
import {
  listingHealth,
  optimizedListingDetails,
  optimizedListingTitle,
} from "./listing-health.mjs";

const card = {
  title: "Example card",
  fields: {
    year: "2025",
    manufacturer: "Topps",
    product: "Topps Chrome",
    setOrInsert: "Wrecking Crew",
    player: "Fernando Tatis Jr.",
    cardNumber: "WC-7",
    parallel: "Refractor",
    rookieStatus: false,
    autograph: false,
    memorabilia: false,
  },
  grading: { isGraded: false },
};

test("optimized titles prioritize searchable identity without duplicate brands", () => {
  const title = optimizedListingTitle(card);
  assert.equal(title, "2025 Topps Chrome Wrecking Crew Fernando Tatis Jr. #WC-7 Refractor");
  assert.equal(title.length <= 80, true);
  assert.doesNotMatch(title, /Topps Topps/i);
});

test("optimized details correct mapped aspects and include an available back image", () => {
  const optimized = optimizedListingDetails(card, {
    title: "Fernando Tatis Jr. Topps Wrecking Crew",
    aspects: { "Player/Athlete": ["Wrong Player"], Note: ["Keep this"] },
    listingImages: ["front"],
  }, [
    { name: "Player/Athlete", required: true, recommended: false },
    { name: "Card Number", required: false, recommended: true },
  ], { backAvailable: true });
  assert.deepEqual(optimized.aspects["Player/Athlete"], ["Fernando Tatis Jr."]);
  assert.deepEqual(optimized.aspects.Note, ["Keep this"]);
  assert.deepEqual(optimized.listingImages, ["front", "back"]);
  assert.deepEqual(optimized.changes.aspects.sort(), ["Card Number", "Player/Athlete"]);
});

test("health separates missing exposure from weak click-through", () => {
  const base = {
    card,
    definitions: [],
    backAvailable: false,
    now: Date.parse("2026-08-20T12:00:00Z"),
    draft: {
      title: optimizedListingTitle(card),
      aspects: {},
      listingImages: ["front"],
      publishedAt: "2026-08-18T12:00:00Z",
    },
  };
  const notShown = listingHealth({ ...base, engagement: { impressionCount: 0, viewCount: 0, watcherCount: 0 } });
  assert.equal(notShown.diagnosis, "Not being shown");
  assert.equal(notShown.hasChanges, false);
  assert.equal(notShown.needsAttention, true);
  const clicked = listingHealth({ ...base, engagement: { impressionCount: 200, viewCount: 1, watcherCount: 0 } });
  assert.equal(clicked.diagnosis, "Shown but rarely opened");
  assert.equal(clicked.clickThroughRate, 0.005);
});
