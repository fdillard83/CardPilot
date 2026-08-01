import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import dotenv from "dotenv";
import express from "express";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

const serverFile = fileURLToPath(import.meta.url);
const currentDirectory = path.dirname(serverFile);
dotenv.config({ path: path.resolve(currentDirectory, "../.env") });

const app = express();
const port = Number(process.env.PORT) || 8787;
const model = process.env.OPENAI_MODEL || "gpt-5.6-sol";
const supportedDataUrl = /^data:image\/(jpeg|png|webp|gif);base64,[a-z0-9+/=\r\n]+$/i;

const CardIdentification = z.object({
  status: z.enum(["identified", "partial", "not_sports_card"]),
  sport: z.string().nullable(),
  playerName: z.string().nullable(),
  team: z.string().nullable(),
  year: z.string().nullable(),
  manufacturer: z.string().nullable(),
  brand: z.string().nullable(),
  setName: z.string().nullable(),
  cardNumber: z.string().nullable(),
  parallelOrVariant: z.string().nullable(),
  serialNumber: z.string().nullable(),
  rookieCard: z.boolean().nullable(),
  autographed: z.boolean().nullable(),
  memorabilia: z.boolean().nullable(),
  confidence: z.number().int().min(0).max(100),
  summary: z.string(),
  visibleEvidence: z.array(z.string()).max(8),
  needsBackImage: z.boolean(),
  followUpHint: z.string().nullable(),
});

const cardIdentificationFormat = zodTextFormat(
  CardIdentification,
  "sports_card_identification",
);

const systemPrompt = `You identify sports trading cards from user-supplied photographs.

Success means:
- identify the card only as specifically as the visible evidence supports
- extract the player, sport, team, season/year, manufacturer, brand, set, card number, parallel or variant, printed serial number, and visible special features
- use both front and back images when supplied
- state uncertainty honestly and request a back image when it could resolve the match

Important constraints:
- Treat the pixels as the primary source of truth. Never replace visible wording or digits with a historically familiar slogan, anniversary, year, set, or design from memory.
- Before identifying the issue, transcribe every useful visible word and number exactly as printed. Inspect short numeric marks character-by-character, especially anniversary logos, years, card numbers, and serial numbering. For example, distinguish 75 from 50 instead of normalizing it to a known Topps anniversary.
- Before returning the result, compare the proposed year, set, variant, summary, and every visibleEvidence item against that exact transcription. Remove or qualify any claim that conflicts with the visible text.
- visibleEvidence must quote or closely transcribe what is actually visible and say where it appears. Do not use visibleEvidence for facts inferred only from card history.
- Never invent obscured text or claim an exact set, year, card number, parallel, rookie designation, autograph, or memorabilia feature without visual support.
- Distinguish a printed copyright year from the card's advertised season when possible.
- A graded holder label is evidence, but still note inconsistencies visible on the card.
- Treat facsimile signatures as printed design, not autographs.
- Do not estimate condition, grade, authenticity, or market value.
- If the image is not a sports trading card, set status to not_sports_card.
- Confidence must reflect evidence completeness, not familiarity. Use 90 or above only when the exact issue is supported by clear visible text or a confirming back image. Use 70-89 when the player, team, and brand are clear but the exact year, set, number, or variant is not fully verified. Use below 70 when important digits or text remain ambiguous.
- Keep the summary and evidence concise and useful to a collector.`;

app.disable("x-powered-by");
app.use(express.json({ limit: "30mb" }));

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, configured: Boolean(process.env.OPENAI_API_KEY) });
});

app.post("/api/identify-card", async (request, response) => {
  if (!process.env.OPENAI_API_KEY) {
    response.status(503).json({
      error: "Card identification is not configured yet. Add OPENAI_API_KEY to frontend/.env and restart CardPilot.",
    });
    return;
  }

  const { frontImage, backImage = null } = request.body ?? {};

  if (typeof frontImage !== "string" || !supportedDataUrl.test(frontImage)) {
    response.status(400).json({ error: "A valid JPG, PNG, WebP, or GIF front image is required." });
    return;
  }

  if (backImage !== null && (typeof backImage !== "string" || !supportedDataUrl.test(backImage))) {
    response.status(400).json({ error: "The back image must be a JPG, PNG, WebP, or GIF." });
    return;
  }

  const userContent = [
    {
      type: "input_text",
      text: backImage
        ? "Identify this sports card. The first image is the front and the second image is the back."
        : "Identify this sports card from its front image. Say when the back is needed for a more specific match.",
    },
    { type: "input_image", image_url: frontImage, detail: "original" },
  ];

  if (backImage) {
    userContent.push({ type: "input_image", image_url: backImage, detail: "original" });
  }

  try {
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 90_000,
      maxRetries: 1,
    });

    const result = await openai.responses.parse({
      model,
      store: false,
      reasoning: { effort: "medium" },
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      text: {
        format: cardIdentificationFormat,
      },
    });

    if (!result.output_parsed) {
      response.status(422).json({
        error: "The card could not be read confidently. Try a brighter, sharper photo of the full card.",
      });
      return;
    }

    response.json({ identification: result.output_parsed });
  } catch (error) {
    console.error("Card identification failed", error);

    if (error instanceof OpenAI.AuthenticationError) {
      response.status(503).json({ error: "The OpenAI API key is invalid. Update frontend/.env and restart CardPilot." });
      return;
    }

    if (error instanceof OpenAI.RateLimitError) {
      const quotaCodes = new Set([
        "insufficient_quota",
        "credit_balance_exhausted",
        "organization_spend_limit_exceeded",
        "project_spend_limit_exceeded",
        "organization_usage_limit_exceeded",
      ]);

      if (quotaCodes.has(error.code)) {
        response.status(429).json({
          error: "Your OpenAI API account has no available quota. Add API billing or credits, then try again.",
        });
        return;
      }

      response.status(429).json({ error: "The identification service is busy. Wait a moment and try again." });
      return;
    }

    response.status(502).json({
      error: "CardPilot could not reach the identification service. Please try again.",
    });
  }
});

const distDirectory = path.resolve(currentDirectory, "../dist");

if (existsSync(distDirectory)) {
  app.use(express.static(distDirectory));
  app.use((request, response, next) => {
    if (request.method !== "GET" || request.path.startsWith("/api/")) {
      next();
      return;
    }

    response.sendFile(path.join(distDirectory, "index.html"));
  });
}

app.use((error, _request, response, _next) => {
  if (error?.type === "entity.too.large") {
    response.status(413).json({ error: "The selected images are too large. Use images smaller than 12 MB each." });
    return;
  }

  console.error("Unexpected server error", error);
  response.status(500).json({ error: "CardPilot encountered an unexpected error." });
});

export { app };

if (process.argv[1] && path.resolve(process.argv[1]) === serverFile) {
  app.listen(port, () => {
    console.log(`CardPilot server listening on http://localhost:${port}`);
    if (!process.env.OPENAI_API_KEY) {
      console.log("OPENAI_API_KEY is not set; the app will show setup guidance when identification is requested.");
    }
  });
}
