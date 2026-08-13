import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import dotenv from "dotenv";
import express from "express";
import OpenAI from "openai";
import { ZodError } from "zod";
import { EbayImageSearchClient } from "./ebay/image-search.mjs";
import { EbayApiError, EbayOAuthClient } from "./ebay/oauth-client.mjs";
import { CatalogCandidateGenerator } from "./identification/candidate-generator.mjs";
import { OpenAIEvidenceEngine } from "./identification/evidence-engine.mjs";
import { IdentificationEngine } from "./identification/identification-engine.mjs";
import {
  ImageIntakeError,
  parseImageIntake,
} from "./identification/image-intake.mjs";
import { createCorrectionLogger } from "./correction-log.mjs";
import { CollectionStore } from "./collection-store.mjs";
import { ActiveMarketService } from "./valuation/active-market.mjs";
import { ValuationRecommendationService } from "./valuation/recommendation.mjs";
import {
  TheCardApiClient,
  TheCardApiError,
} from "./sold-comps/the-card-api-client.mjs";
import { SoldCompsService } from "./sold-comps/sold-comps.mjs";

const serverFile = fileURLToPath(import.meta.url);
const currentDirectory = path.dirname(serverFile);
dotenv.config({ path: path.resolve(currentDirectory, "../.env") });

const app = express();
const port = Number(process.env.PORT) || 8787;
const accuracyModel = process.env.OPENAI_MODEL || "gpt-5.6-sol";
const fastModel = process.env.OPENAI_FAST_MODEL || "gpt-5.4-mini";
const ebayClientId = process.env.EBAY_CLIENT_ID?.trim();
const ebayClientSecret = process.env.EBAY_CLIENT_SECRET?.trim();
const ebayConfigured = Boolean(ebayClientId && ebayClientSecret);
const ebayMarketplaceId =
  process.env.EBAY_MARKETPLACE_ID?.trim() || "EBAY_US";
const ebayImageSearch = ebayConfigured
  ? new EbayImageSearchClient({
      oauthClient: new EbayOAuthClient({
        clientId: ebayClientId,
        clientSecret: ebayClientSecret,
      }),
      marketplaceId: ebayMarketplaceId,
    })
  : null;
const activeMarket = ebayImageSearch
  ? new ActiveMarketService({ ebayClient: ebayImageSearch })
  : null;
const theCardApiKey = process.env.THE_CARD_API_KEY?.trim();
const soldComps = theCardApiKey
  ? new SoldCompsService({
      cardApiClient: new TheCardApiClient({ apiKey: theCardApiKey }),
    })
  : null;
const valuationRecommendations = new ValuationRecommendationService({
  soldComps,
  activeMarket,
});
const correctionLogger = createCorrectionLogger({
  filePath: path.resolve(currentDirectory, "../.data/corrections.jsonl"),
});
const collectionStore = new CollectionStore({
  recordsFile: path.resolve(currentDirectory, "../.data/collection.json"),
  imagesDirectory: path.resolve(currentDirectory, "../.data/collection-images"),
});

app.disable("x-powered-by");
app.use(express.json({ limit: "30mb" }));

function excludedObservationIds(request, queryName = "exclude") {
  const raw = request.query[queryName];
  if (raw === undefined) return [];
  const values = Array.isArray(raw) ? raw : [raw];
  if (
    values.length > 50 ||
    values.some(
      (value) =>
        typeof value !== "string" || value.length < 1 || value.length > 500,
    )
  ) {
    throw new TypeError("The removed pricing anchors are invalid.");
  }
  return [...new Set(values)];
}

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    configured: Boolean(process.env.OPENAI_API_KEY),
    services: {
      openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
      ebayConfigured,
      activeMarketConfigured: ebayConfigured,
      soldCompsConfigured: Boolean(soldComps),
    },
  });
});

app.get("/api/collection", async (_request, response) => {
  try {
    response.json({ cards: await collectionStore.list() });
  } catch (error) {
    console.error("Collection loading failed", error);
    response.status(500).json({
      error: "CardPilot could not load the collection. Please try again.",
    });
  }
});

app.post("/api/collection", async (request, response) => {
  try {
    const card = await collectionStore.create(request.body);
    response.status(201).json({ card });
  } catch (error) {
    if (error instanceof ZodError || error instanceof TypeError) {
      response.status(400).json({
        error: "The saved card details or images are incomplete or invalid.",
      });
      return;
    }

    console.error("Collection save failed", error);
    response.status(500).json({
      error: "CardPilot could not save this card. Please try again.",
    });
  }
});

app.put("/api/collection/:collectionId", async (request, response) => {
  try {
    const card = await collectionStore.update(
      request.params.collectionId,
      request.body,
    );
    if (!card) {
      response.status(404).json({ error: "That saved card was not found." });
      return;
    }
    response.json({ card });
  } catch (error) {
    if (error instanceof ZodError) {
      response.status(400).json({ error: "The card details are invalid." });
      return;
    }

    console.error("Collection update failed", error);
    response.status(500).json({
      error: "CardPilot could not update this card. Please try again.",
    });
  }
});

app.delete("/api/collection/:collectionId", async (request, response) => {
  try {
    const removed = await collectionStore.remove(request.params.collectionId);
    if (!removed) {
      response.status(404).json({ error: "That saved card was not found." });
      return;
    }
    response.status(204).end();
  } catch (error) {
    console.error("Collection removal failed", error);
    response.status(500).json({
      error: "CardPilot could not remove this card. Please try again.",
    });
  }
});

app.get(
  "/api/collection/:collectionId/valuation",
  async (request, response) => {
    try {
      const card = await collectionStore.get(request.params.collectionId);
      if (!card) {
        response.status(404).json({ error: "That saved card was not found." });
        return;
      }
      response.json(
        await valuationRecommendations.snapshot(card, {
          soldExcludedObservationIds: excludedObservationIds(
            request,
            "excludeSold",
          ),
          activeExcludedObservationIds: excludedObservationIds(
            request,
            "excludeActive",
          ),
        }),
      );
    } catch (error) {
      console.error("Card valuation recommendation failed", error);
      response.status(500).json({
        error: "CardPilot could not prepare this valuation. Please try again.",
      });
    }
  },
);

app.put(
  "/api/collection/:collectionId/valuation",
  async (request, response) => {
    try {
      const card = await collectionStore.updateConfirmedValuation(
        request.params.collectionId,
        request.body,
      );
      if (!card) {
        response.status(404).json({ error: "That saved card was not found." });
        return;
      }
      response.json({ card });
    } catch (error) {
      if (error instanceof ZodError) {
        response.status(400).json({
          error: "Enter a valid confirmed value and confidence level.",
        });
        return;
      }
      console.error("Confirmed card valuation save failed", error);
      response.status(500).json({
        error: "CardPilot could not save this value. Please try again.",
      });
    }
  },
);

app.delete(
  "/api/collection/:collectionId/valuation",
  async (request, response) => {
    try {
      const card = await collectionStore.clearConfirmedValuation(
        request.params.collectionId,
      );
      if (!card) {
        response.status(404).json({ error: "That saved card was not found." });
        return;
      }
      response.json({ card });
    } catch (error) {
      console.error("Confirmed card valuation removal failed", error);
      response.status(500).json({
        error: "CardPilot could not clear this value. Please try again.",
      });
    }
  },
);

app.get(
  "/api/collection/:collectionId/images/:side",
  async (request, response) => {
    if (!new Set(["front", "back"]).has(request.params.side)) {
      response.status(404).end();
      return;
    }

    try {
      const image = await collectionStore.image(
        request.params.collectionId,
        request.params.side,
      );
      if (!image) {
        response.status(404).end();
        return;
      }
      const contents = await readFile(image.filePath);
      response.type(image.mimeType).send(contents);
    } catch (error) {
      if (error?.code === "ENOENT") {
        response.status(404).end();
        return;
      }
      console.error("Collection image loading failed", error);
      response.status(500).end();
    }
  },
);

app.get(
  "/api/collection/:collectionId/active-market",
  async (request, response) => {
    try {
      const card = await collectionStore.get(request.params.collectionId);
      if (!card) {
        response.status(404).json({ error: "That saved card was not found." });
        return;
      }
      if (!activeMarket) {
        response.status(503).json({
          error:
            "Active eBay market search is not configured yet. Add the Production eBay credentials and restart CardPilot.",
        });
        return;
      }
      response.json(
        await activeMarket.snapshot(card.fields, {
          confirmedReferenceItemId: card.ebayReference?.itemId ?? null,
          grading: card.grading,
          valuationProfile: card.valuationProfile,
          excludedObservationIds: excludedObservationIds(request),
        }),
      );
    } catch (error) {
      if (error instanceof TypeError) {
        response.status(422).json({ error: error.message });
        return;
      }
      if (error instanceof EbayApiError) {
        console.error("eBay active-market search failed", {
          service: error.service,
          status: error.status,
          code: error.code,
        });
        if (error.status === 429) {
          response.status(429).json({
            error: "eBay market search is busy. Wait a moment and try again.",
          });
          return;
        }
        if (
          error.service === "oauth" ||
          error.status === 401 ||
          error.status === 403
        ) {
          response.status(503).json({
            error:
              "eBay Browse API access was rejected. Verify the Production credentials and Buy API access.",
          });
          return;
        }
      } else {
        console.error("eBay active-market search failed", error);
      }
      response.status(502).json({
        error: "CardPilot could not reach eBay market search. Please try again.",
      });
    }
  },
);

app.get(
  "/api/collection/:collectionId/sold-comps",
  async (request, response) => {
    try {
      const card = await collectionStore.get(request.params.collectionId);
      if (!card) {
        response.status(404).json({ error: "That saved card was not found." });
        return;
      }
      if (!soldComps) {
        response.status(503).json({
          error:
            "Completed-sales search is not configured yet. Add THE_CARD_API_KEY to frontend/.env and restart CardPilot.",
        });
        return;
      }
      response.json(
        await soldComps.snapshot(
          card.fields,
          card.grading,
          card.valuationProfile,
          { excludedObservationIds: excludedObservationIds(request) },
        ),
      );
    } catch (error) {
      if (error instanceof TypeError) {
        response.status(422).json({ error: error.message });
        return;
      }
      if (error instanceof TheCardApiError) {
        console.error("The Card API sold-comps search failed", {
          status: error.status,
          code: error.code,
        });
        if (error.status === 429) {
          response.status(429).json({
            error:
              "Completed-sales search has reached its current request limit. Wait and try again later.",
          });
          return;
        }
        if (error.status === 401 || error.status === 403) {
          response.status(503).json({
            error:
              "The Card API key was rejected. Verify THE_CARD_API_KEY and restart CardPilot.",
          });
          return;
        }
      } else {
        console.error("The Card API sold-comps search failed", error);
      }
      response.status(502).json({
        error:
          "CardPilot could not reach the completed-sales provider. Please try again.",
      });
    }
  },
);

app.post("/api/identify-card", async (request, response) => {
  if (!process.env.OPENAI_API_KEY) {
    response.status(503).json({
      error:
        "Card identification is not configured yet. Add OPENAI_API_KEY to frontend/.env and restart CardPilot.",
    });
    return;
  }

  try {
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 60_000,
      maxRetries: 0,
    });
    const identificationEngine = new IdentificationEngine({
      evidenceEngine: new OpenAIEvidenceEngine({
        openai,
        model: accuracyModel,
        fastModel,
      }),
      candidateGenerator: new CatalogCandidateGenerator(),
      model: accuracyModel,
    });
    const identification = await identificationEngine.identify(request.body);
    console.info(
      "Card identification completed",
      JSON.stringify({
        identificationId: identification.identificationId,
        model: identification.pipeline.model,
        totalDurationMs: identification.pipeline.totalDurationMs,
        stages: identification.pipeline.stages,
      }),
    );
    response.json({ identification });
  } catch (error) {
    if (error instanceof ImageIntakeError) {
      response.status(error.status).json({ error: error.message });
      return;
    }

    console.error("Card identification failed", error);

    if (error instanceof OpenAI.AuthenticationError) {
      response.status(503).json({
        error:
          "The OpenAI API key is invalid. Update frontend/.env and restart CardPilot.",
      });
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
          error:
            "Your OpenAI API account has no available quota. Add API billing or credits, then try again.",
        });
        return;
      }

      response.status(429).json({
        error:
          "The identification service is busy. Wait a moment and try again.",
      });
      return;
    }

    response.status(502).json({
      error:
        error instanceof Error && error.message.startsWith("The card evidence")
          ? error.message
          : "CardPilot could not reach the identification service. Please try again.",
    });
  }
});

app.post("/api/ebay/image-search", async (request, response) => {
  if (!ebayImageSearch) {
    response.status(503).json({
      error:
        "eBay image search is not configured yet. Add the Production eBay credentials to frontend/.env and restart CardPilot.",
    });
    return;
  }

  const limit = request.body?.limit ?? 10;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    response.status(400).json({
      error: "The eBay image-search limit must be an integer from 1 through 50.",
    });
    return;
  }

  try {
    const intake = parseImageIntake(request.body);
    const result = await ebayImageSearch.searchByImage({
      imageDataUrl: intake.frontImage,
      limit,
    });
    console.info(
      "eBay image search completed",
      JSON.stringify({
        marketplaceId: result.marketplaceId,
        candidateCount: result.candidates.length,
        total: result.total,
      }),
    );
    response.json(result);
  } catch (error) {
    if (error instanceof ImageIntakeError) {
      response.status(error.status).json({ error: error.message });
      return;
    }

    if (error instanceof EbayApiError) {
      console.error("eBay image search failed", {
        service: error.service,
        status: error.status,
        code: error.code,
      });

      if (error.status === 429) {
        response.status(429).json({
          error: "eBay image search is busy. Wait a moment and try again.",
        });
        return;
      }

      if (
        error.service === "oauth" ||
        error.status === 401 ||
        error.status === 403
      ) {
        response.status(503).json({
          error:
            "eBay Browse API access was rejected. Verify the Production client credentials and Browse API access.",
        });
        return;
      }

      if (error.service === "browse" && error.status === 400) {
        response.status(422).json({
          error:
            "eBay could not search this image. Try a clear, tightly cropped photo of the card.",
        });
        return;
      }
    } else {
      console.error("eBay image search failed", error);
    }

    response.status(502).json({
      error: "CardPilot could not reach eBay image search. Please try again.",
    });
  }
});

app.get("/api/ebay/items/:itemId", async (request, response) => {
  if (!ebayImageSearch) {
    response.status(503).json({
      error:
        "eBay item details are not configured yet. Add the Production eBay credentials to frontend/.env and restart CardPilot.",
    });
    return;
  }

  const itemId = request.params.itemId;
  if (!itemId || itemId.length > 200) {
    response.status(400).json({ error: "A valid eBay item ID is required." });
    return;
  }

  try {
    const item = await ebayImageSearch.getItemDetails(itemId);
    response.json({ item });
  } catch (error) {
    if (error instanceof EbayApiError) {
      console.error("eBay item lookup failed", {
        service: error.service,
        status: error.status,
        code: error.code,
      });

      if (error.status === 404) {
        response.status(404).json({
          error: "That eBay listing is no longer available.",
        });
        return;
      }

      if (error.status === 429) {
        response.status(429).json({
          error: "eBay item details are busy. Wait a moment and try again.",
        });
        return;
      }

      if (
        error.service === "oauth" ||
        error.status === 401 ||
        error.status === 403
      ) {
        response.status(503).json({
          error:
            "eBay Browse API access was rejected. Verify the Production client credentials and Browse API access.",
        });
        return;
      }
    } else {
      console.error("eBay item lookup failed", error);
    }

    response.status(502).json({
      error: "CardPilot could not load this eBay listing. Please try again.",
    });
  }
});

app.post("/api/corrections", async (request, response) => {
  try {
    const record = await correctionLogger.log(request.body);
    response.status(201).json({ correctionId: record.correctionId });
  } catch (error) {
    if (error instanceof ZodError) {
      response.status(400).json({
        error: "The correction data is incomplete or invalid.",
      });
      return;
    }

    console.error("Correction logging failed", error);
    response.status(500).json({
      error: "CardPilot could not save this correction. Please try again.",
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
    response.status(413).json({
      error: "The selected images are too large. Use images smaller than 12 MB each.",
    });
    return;
  }

  console.error("Unexpected server error", error);
  response.status(500).json({
    error: "CardPilot encountered an unexpected error.",
  });
});

export { app };

if (process.argv[1] && path.resolve(process.argv[1]) === serverFile) {
  app.listen(port, () => {
    console.log(`CardPilot server listening on http://localhost:${port}`);
    if (!process.env.OPENAI_API_KEY) {
      console.log(
        "OPENAI_API_KEY is not set; the app will show setup guidance when identification is requested.",
      );
    }
    if (!ebayConfigured) {
      console.log(
        "EBAY_CLIENT_ID or EBAY_CLIENT_SECRET is not set; eBay image search is disabled.",
      );
    }
    if (!soldComps) {
      console.log(
        "THE_CARD_API_KEY is not set; completed-sales comparisons are disabled.",
      );
    }
  });
}
