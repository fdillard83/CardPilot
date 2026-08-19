import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { isVisualMismatch, VisualImageMatcher, visualImageInternals } from "./visual-image-matcher.mjs";

async function cardImage({ border, panel, stripe, subjectX = 240 }) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="680">
    <rect width="480" height="680" fill="${border}"/>
    <rect x="42" y="48" width="396" height="584" rx="12" fill="${panel}"/>
    <rect x="70" y="${stripe}" width="340" height="42" fill="white"/>
    <circle cx="${subjectX}" cy="340" r="120" fill="#334455"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

function dataUrl(buffer) {
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

async function framedCard(card, {
  width = 900,
  height = 980,
  left = 210,
  top = 150,
  background = "#f7f7f7",
} = {}) {
  return sharp({ create: { width, height, channels: 3, background } })
    .composite([{ input: card, left, top }])
    .png()
    .toBuffer();
}

async function slabbedCard(card) {
  const inner = await sharp(card).resize(420, 595).png().toBuffer();
  const slab = await sharp({ create: { width: 600, height: 900, channels: 3, background: "#e9eef2" } })
    .composite([
      { input: Buffer.from('<svg width="500" height="120"><rect width="500" height="120" rx="8" fill="#ffffff"/><rect x="25" y="25" width="260" height="20" fill="#222222"/><rect x="25" y="65" width="180" height="14" fill="#777777"/></svg>'), left: 50, top: 35 },
      { input: inner, left: 90, top: 230 },
    ])
    .png()
    .toBuffer();
  return framedCard(slab, { width: 820, height: 1100, left: 110, top: 80, background: "#ffffff" });
}

test("independent visual matcher separates matching borders and layouts", async () => {
  const source = await cardImage({ border: "#c61f35", panel: "#e4c98c", stripe: 90 });
  const same = await cardImage({ border: "#c61f35", panel: "#e4c98c", stripe: 90 });
  const different = await cardImage({
    border: "#1769aa",
    panel: "#d8e6ef",
    stripe: 500,
    subjectX: 105,
  });
  const matcher = new VisualImageMatcher({
    fetchImpl: async (url) => new Response(
      String(url).includes("same") ? same : different,
      { status: 200, headers: { "Content-Type": "image/png" } },
    ),
  });
  const candidates = await matcher.rank({
    sourceImageDataUrl: dataUrl(source),
    candidates: [
      { itemId: "same", imageUrl: "https://i.ebayimg.com/images/g/same/s-l500.jpg" },
      { itemId: "different", imageUrl: "https://i.ebayimg.com/images/g/different/s-l500.jpg" },
    ],
  });
  assert.ok(candidates[0].visualMatch.score > candidates[1].visualMatch.score);
  assert.ok(candidates[0].visualMatch.borderScore > candidates[1].visualMatch.borderScore);
  assert.ok(candidates[0].visualMatch.layoutScore > candidates[1].visualMatch.layoutScore);
  assert.ok(candidates[0].visualMatch.structureScore > candidates[1].visualMatch.structureScore);
  assert.ok(candidates[0].visualMatch.score > 0.95);
  assert.equal(isVisualMismatch(candidates[0].visualMatch), false);
  assert.equal(isVisualMismatch(candidates[1].visualMatch), true);
});

test("visual matcher finds the same card inside marketplace framing and a slab", async () => {
  const source = await cardImage({ border: "#c61f35", panel: "#e4c98c", stripe: 90 });
  const different = await cardImage({ border: "#1769aa", panel: "#d8e6ef", stripe: 500, subjectX: 105 });
  const framed = await framedCard(source);
  const slabbed = await slabbedCard(source);
  const framedDifferent = await framedCard(different);
  const matcher = new VisualImageMatcher({
    fetchImpl: async (url) => {
      const value = String(url);
      const image = value.includes("slab") ? slabbed : value.includes("different") ? framedDifferent : framed;
      return new Response(image, { status: 200, headers: { "Content-Type": "image/png" } });
    },
  });
  const candidates = await matcher.rank({
    sourceImageDataUrl: dataUrl(source),
    candidates: [
      { itemId: "framed", imageUrl: "https://i.ebayimg.com/framed.jpg" },
      { itemId: "slab", imageUrl: "https://i.ebayimg.com/slab.jpg" },
      { itemId: "different", imageUrl: "https://i.ebayimg.com/different.jpg" },
    ],
  });
  assert.equal(isVisualMismatch(candidates[0].visualMatch), false);
  assert.equal(isVisualMismatch(candidates[1].visualMatch), false, JSON.stringify(candidates[1].visualMatch));
  assert.equal(isVisualMismatch(candidates[2].visualMatch), true);
  assert.ok(candidates[0].visualMatch.score > candidates[2].visualMatch.score);
  assert.ok(candidates[1].visualMatch.score > candidates[2].visualMatch.score);
  assert.notEqual(candidates[0].visualMatch.normalization, "card_aspect");
});

test("visual matcher marks candidates outside its inspection budget", async () => {
  const source = await cardImage({ border: "#c61f35", panel: "#e4c98c", stripe: 90 });
  const matcher = new VisualImageMatcher({
    fetchImpl: async () => new Response(source, { status: 200 }),
  });
  const candidates = await matcher.rank({
    sourceImageDataUrl: dataUrl(source),
    candidates: [
      { itemId: "checked", imageUrl: "https://i.ebayimg.com/checked.jpg" },
      { itemId: "skipped", imageUrl: "https://i.ebayimg.com/skipped.jpg" },
    ],
    limit: 1,
  });
  assert.equal(candidates[0].visualMatchStatus, "matched");
  assert.equal(candidates[1].visualMatchStatus, "not_evaluated");
  assert.equal(isVisualMismatch(null, candidates[1].visualMatchStatus), true);
  assert.equal(isVisualMismatch(null, "unavailable"), true);
});

test("visual matcher accepts only approved marketplace and sold-provider image hosts", () => {
  assert.equal(visualImageInternals.safeCandidateUrl("https://example.com/card.jpg"), null);
  assert.equal(visualImageInternals.safeCandidateUrl("http://i.ebayimg.com/card.jpg"), null);
  assert.equal(visualImageInternals.safeCandidateUrl("https://i.ebayimg.com/card.jpg")?.hostname, "i.ebayimg.com");
  assert.equal(visualImageInternals.safeCandidateUrl("https://www.thecardapi.com/card.jpg")?.hostname, "www.thecardapi.com");
});
