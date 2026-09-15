import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import {
  isReflectiveFinish,
  isVisualMismatch,
  VisualImageMatcher,
  visualImageInternals,
} from "./visual-image-matcher.mjs";

async function cardImage({ border, panel, stripe, subjectX = 240 }) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="680">
    <rect width="480" height="680" fill="${border}"/>
    <rect x="42" y="48" width="396" height="584" rx="12" fill="${panel}"/>
    <rect x="70" y="${stripe}" width="340" height="42" fill="white"/>
    <circle cx="${subjectX}" cy="340" r="120" fill="#334455"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function foilPatternCard(pattern) {
  const overlay = pattern === "wave"
    ? `<g fill="none" stroke="#f5fbff" stroke-width="7" opacity="0.72">
        <path d="M20 110 Q120 35 220 110 T460 110"/>
        <path d="M20 210 Q120 135 220 210 T460 210"/>
        <path d="M20 310 Q120 235 220 310 T460 310"/>
        <path d="M20 410 Q120 335 220 410 T460 410"/>
        <path d="M20 510 Q120 435 220 510 T460 510"/>
      </g>`
    : `<g fill="none" stroke="#f5fbff" stroke-width="6" opacity="0.72">
        <path d="M30 70 L180 20 L250 160 L90 245 Z"/>
        <path d="M250 160 L450 65 L420 270 L265 335 Z"/>
        <path d="M90 245 L265 335 L155 510 L25 410 Z"/>
        <path d="M265 335 L420 270 L465 510 L300 625 L155 510 Z"/>
      </g>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="680">
    <rect width="480" height="680" fill="#2866a8"/>
    <rect x="42" y="48" width="396" height="584" rx="12" fill="#4f92ba"/>
    <circle cx="240" cy="340" r="115" fill="#334455"/>
    ${overlay}
    <rect x="70" y="560" width="340" height="42" fill="white"/>
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
  assert.ok(candidates[0].visualMatch.poseScore > candidates[1].visualMatch.poseScore);
  assert.ok(candidates[0].visualMatch.score > 0.95);
  assert.equal(isVisualMismatch(candidates[0].visualMatch), false);
  assert.equal(isVisualMismatch(candidates[1].visualMatch), true);
});

test("player pose contributes independently when card colors and layout match", async () => {
  const source = await cardImage({ border: "#c61f35", panel: "#e4c98c", stripe: 90, subjectX: 240 });
  const samePose = await cardImage({ border: "#c61f35", panel: "#e4c98c", stripe: 90, subjectX: 240 });
  const differentPose = await cardImage({ border: "#c61f35", panel: "#e4c98c", stripe: 90, subjectX: 105 });
  const matcher = new VisualImageMatcher({
    fetchImpl: async (url) => new Response(
      String(url).includes("same-pose") ? samePose : differentPose,
      { status: 200 },
    ),
  });
  const candidates = await matcher.rank({
    sourceImageDataUrl: dataUrl(source),
    candidates: [
      { itemId: "same-pose", imageUrl: "https://i.ebayimg.com/same-pose.jpg" },
      { itemId: "different-pose", imageUrl: "https://i.ebayimg.com/different-pose.jpg" },
    ],
  });

  assert.equal(candidates[0].itemId, "same-pose");
  assert.ok(candidates[0].visualMatch.poseScore > candidates[1].visualMatch.poseScore);
  assert.ok(candidates[0].visualMatch.score > candidates[1].visualMatch.score);
});

test("foil geometry contributes independently when color, layout, and pose match", async () => {
  const source = await foilPatternCard("wave");
  const samePattern = await foilPatternCard("wave");
  const differentPattern = await foilPatternCard("cracked");
  const matcher = new VisualImageMatcher({
    fetchImpl: async (url) => new Response(
      String(url).includes("same-pattern") ? samePattern : differentPattern,
      { status: 200 },
    ),
  });
  const candidates = await matcher.rank({
    sourceImageDataUrl: dataUrl(source),
    candidates: [
      { itemId: "same-pattern", imageUrl: "https://i.ebayimg.com/same-pattern.jpg" },
      { itemId: "different-pattern", imageUrl: "https://i.ebayimg.com/different-pattern.jpg" },
    ],
  });

  assert.equal(candidates[0].itemId, "same-pattern");
  assert.ok(candidates[0].visualMatch.patternScore > candidates[1].visualMatch.patternScore);
  assert.ok(candidates[0].visualMatch.score > candidates[1].visualMatch.score);
});

test("reflective cards favor grayscale geometry when lighting changes hue", async () => {
  const source = await foilPatternCard("wave");
  const hueShifted = await sharp(source).modulate({ hue: 135 }).png().toBuffer();
  const colorMatchWrongDesign = await cardImage({
    border: "#2866a8",
    panel: "#4f92ba",
    stripe: 90,
    subjectX: 95,
  });
  const matcher = new VisualImageMatcher({
    fetchImpl: async (url) => new Response(
      String(url).includes("hue-shifted") ? hueShifted : colorMatchWrongDesign,
      { status: 200 },
    ),
  });
  const candidates = await matcher.rank({
    sourceImageDataUrl: dataUrl(source),
    candidates: [
      { itemId: "hue-shifted", imageUrl: "https://i.ebayimg.com/hue-shifted.jpg" },
      { itemId: "wrong-design", imageUrl: "https://i.ebayimg.com/wrong-design.jpg" },
    ],
    reflectiveFinish: true,
  });

  assert.equal(candidates[0].itemId, "hue-shifted");
  assert.equal(candidates[0].visualMatch.scoreMode, "reflective_grayscale");
  assert.equal(candidates[0].visualMatch.score, candidates[0].visualMatch.reflectiveScore);
  assert.ok(candidates[0].visualMatch.grayscaleScore > candidates[1].visualMatch.grayscaleScore);
});

test("reflective finish detection is limited to foil and refraction terms", () => {
  assert.equal(isReflectiveFinish({ finish: "Holofoil", parallel: null }), true);
  assert.equal(isReflectiveFinish({ finish: null, parallel: "Green RayWave" }), true);
  assert.equal(isReflectiveFinish({ finish: null, parallel: "Gold" }), false);
  assert.equal(isReflectiveFinish({ finish: null, parallel: null, product: "Topps Chrome" }), false);
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
  assert.equal(isVisualMismatch(null, candidates[1].visualMatchStatus), false);
  assert.equal(isVisualMismatch(null, "unavailable"), false);
});

test("visual rejection requires a confident measured mismatch", () => {
  assert.equal(isVisualMismatch({ score: 0.48, structureScore: 0.22 }, "matched"), true);
  assert.equal(isVisualMismatch({ score: 0.52, structureScore: 0.62 }, "matched"), false);
  assert.equal(isVisualMismatch({ score: 0.72, structureScore: 0.18 }, "matched"), true);
});

test("visual matcher accepts only approved marketplace and sold-provider image hosts", () => {
  assert.equal(visualImageInternals.safeCandidateUrl("https://example.com/card.jpg"), null);
  assert.equal(visualImageInternals.safeCandidateUrl("http://i.ebayimg.com/card.jpg"), null);
  assert.equal(visualImageInternals.safeCandidateUrl("https://i.ebayimg.com/card.jpg")?.hostname, "i.ebayimg.com");
  assert.equal(visualImageInternals.safeCandidateUrl("https://www.thecardapi.com/card.jpg")?.hostname, "www.thecardapi.com");
});
