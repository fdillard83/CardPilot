import { EbayApiError } from "./oauth-client.mjs";

const EBAY_PRODUCTION_IMAGE_SEARCH_URL =
  "https://api.ebay.com/buy/browse/v1/item_summary/search_by_image";
const EBAY_PRODUCTION_KEYWORD_SEARCH_URL =
  "https://api.ebay.com/buy/browse/v1/item_summary/search";
const EBAY_PRODUCTION_ITEM_URL =
  "https://api.ebay.com/buy/browse/v1/item";

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function ebayErrorCode(payload) {
  return (
    payload?.errors?.[0]?.errorId?.toString() ??
    payload?.errors?.[0]?.error?.toString() ??
    null
  );
}

function imageBase64FromDataUrl(imageDataUrl) {
  const separatorIndex = imageDataUrl.indexOf(",");
  return separatorIndex >= 0
    ? imageDataUrl.slice(separatorIndex + 1).replace(/[\r\n]/g, "")
    : imageDataUrl;
}

function optionalString(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function normalizePrice(price) {
  if (!price || typeof price.value !== "string") return null;
  return {
    value: price.value,
    currency: optionalString(price.currency),
  };
}

function normalizeShippingCost(shippingOptions) {
  if (!Array.isArray(shippingOptions)) return null;
  for (const option of shippingOptions) {
    const cost = normalizePrice(option?.shippingCost);
    if (cost) return cost;
  }
  return null;
}

function normalizeCandidate(item, index) {
  const itemId = optionalString(item?.itemId);
  if (!itemId) return null;

  return {
    id: `ebay-${itemId}`,
    source: "ebay_browse",
    rank: index + 1,
    itemId,
    title: optionalString(item.title) ?? "Untitled eBay listing",
    itemWebUrl: optionalString(item.itemWebUrl),
    imageUrl: optionalString(item.image?.imageUrl),
    price: normalizePrice(item.price),
    shippingCost: normalizeShippingCost(item.shippingOptions),
    condition: optionalString(item.condition),
    conditionId: optionalString(item.conditionId),
    buyingOptions: Array.isArray(item.buyingOptions)
      ? item.buyingOptions.filter((option) => typeof option === "string")
      : [],
    categories: Array.isArray(item.categories)
      ? item.categories
          .filter((category) => optionalString(category?.categoryId))
          .map((category) => ({
            categoryId: category.categoryId,
            categoryName: optionalString(category.categoryName),
          }))
      : [],
  };
}

function normalizeAspectName(value) {
  return typeof value === "string"
    ? value.toLowerCase().replace(/[^a-z0-9]/g, "")
    : "";
}

function normalizeAspects(aspects) {
  if (!Array.isArray(aspects)) return [];
  return aspects
    .filter(
      (aspect) =>
        optionalString(aspect?.localizedName) &&
        Array.isArray(aspect.localizedValues),
    )
    .map((aspect) => ({
      name: aspect.localizedName,
      values: aspect.localizedValues.filter(
        (value) => typeof value === "string" && value.length > 0,
      ),
    }))
    .filter((aspect) => aspect.values.length > 0);
}

function suggestedAspectValue(aspects, acceptedNames) {
  const accepted = new Set(acceptedNames.map(normalizeAspectName));
  return (
    aspects.find((aspect) => accepted.has(normalizeAspectName(aspect.name)))
      ?.values[0] ?? null
  );
}

function suggestedAspectIncludes(aspects, acceptedNames, pattern) {
  const accepted = new Set(acceptedNames.map(normalizeAspectName));
  return aspects
    .filter((aspect) => accepted.has(normalizeAspectName(aspect.name)))
    .flatMap((aspect) => aspect.values)
    .some((value) => pattern.test(value));
}

function suggestedCardNumberFromTitle(title) {
  if (typeof title !== "string") return null;
  const hashNumber = title.match(/#\s*([a-z0-9]+(?:-[a-z0-9]+)*)/i)?.[1];
  if (hashNumber) return hashNumber;

  return (
    title.match(
      /\b(?=[a-z0-9-]*[a-z])(?=[a-z0-9-]*\d)[a-z0-9]+(?:-[a-z0-9]+)+\b/i,
    )?.[0] ?? null
  );
}

function suggestedParallelFromTitle(title) {
  if (typeof title !== "string") return null;
  const descriptor =
    "green|blue|red|gold|orange|purple|black|pink|aqua|teal|silver|rainbow|crackle|wave|raywave|shimmer|speckle|mosaic|atomic|lava";
  const finish = "foil|refractor|prizm|parallel";
  const describedFinish = title.match(
    new RegExp(`\\b((?:${descriptor})(?:\\s+(?:${descriptor}))?\\s+(?:${finish}))\\b`, "i"),
  )?.[1];
  if (describedFinish) return describedFinish;

  return (
    title.match(
      /\b(superfractor|x-fractor|refractor|prizm|sapphire|sepia|negative)\b/i,
    )?.[1] ?? null
  );
}

function suggestedYearFromTitle(title) {
  if (typeof title !== "string") return null;
  return title.match(/\b(?:19|20)\d{2}\b/)?.[0] ?? null;
}

function normalizePrintRun(value, { allowBareNumber = false } = {}) {
  if (typeof value !== "string") return null;
  const compact = value.trim().replace(/\s+/g, "");
  const exactSerial = compact.match(/^\d{1,3}\/(\d{1,5})$/)?.[1];
  if (exactSerial) return `/${exactSerial}`;
  if (/^\/\d{1,5}$/.test(compact)) return compact;
  if (allowBareNumber && /^\d{1,5}$/.test(compact)) return `/${compact}`;
  return null;
}

function suggestedSerialNumberFromTitle(title) {
  if (typeof title !== "string") return null;

  const printRunOnly = title.match(/(?:^|[^\d])(\/\s*\d{1,5})\b/)?.[1];
  if (printRunOnly) return normalizePrintRun(printRunOnly);

  const exactSerial = title.match(/\b(\d{1,3}\s*\/\s*\d{1,5})\b/)?.[1];
  if (exactSerial) return normalizePrintRun(exactSerial);

  const numberedTo = title.match(
    /\b(?:numbered|number)\s+(?:to|out\s+of)\s+(\d{1,5})\b/i,
  )?.[1];
  return numberedTo
    ? normalizePrintRun(numberedTo, { allowBareNumber: true })
    : null;
}

function suggestedSerialNumberFromAspects(aspects) {
  const exactSerial = suggestedAspectValue(aspects, [
    "Serial Number",
    "Serial No",
    "Serial #",
    "Serial Numbering",
  ]);
  const normalizedExactSerial = normalizePrintRun(exactSerial);
  if (normalizedExactSerial) return normalizedExactSerial;

  const printRun = suggestedAspectValue(aspects, ["Print Run"]);
  return normalizePrintRun(printRun, { allowBareNumber: true });
}

export class EbayImageSearchClient {
  constructor({
    oauthClient,
    marketplaceId = "EBAY_US",
    fetchImpl = globalThis.fetch,
    searchUrl = EBAY_PRODUCTION_IMAGE_SEARCH_URL,
    keywordSearchUrl = EBAY_PRODUCTION_KEYWORD_SEARCH_URL,
    itemUrl = EBAY_PRODUCTION_ITEM_URL,
    timeoutMs = 15_000,
  }) {
    if (!oauthClient) {
      throw new TypeError("eBay image search requires an OAuth client.");
    }

    this.oauthClient = oauthClient;
    this.marketplaceId = marketplaceId;
    this.fetch = fetchImpl;
    this.searchUrl = searchUrl;
    this.keywordSearchUrl = keywordSearchUrl;
    this.itemUrl = itemUrl;
    this.timeoutMs = timeoutMs;
  }

  async searchByImage({ imageDataUrl, limit = 10 }) {
    const image = imageBase64FromDataUrl(imageDataUrl);
    const response = await this.authorizedRequest((accessToken) =>
      this.requestSearch({ accessToken, image, limit }),
    );

    const payload = await readJson(response);
    if (!response.ok) {
      throw new EbayApiError("eBay Browse image search failed.", {
        service: "browse",
        status: response.status,
        code: ebayErrorCode(payload),
      });
    }

    const itemSummaries = Array.isArray(payload?.itemSummaries)
      ? payload.itemSummaries
      : [];
    const candidates = itemSummaries
      .map(normalizeCandidate)
      .filter(Boolean);

    return {
      marketplaceId: this.marketplaceId,
      total: Number.isInteger(payload?.total) ? payload.total : candidates.length,
      candidates,
    };
  }

  async searchByKeywords({ query, limit = 50, categoryId = "212" }) {
    if (typeof query !== "string" || !query.trim()) {
      throw new TypeError("An eBay search description is required.");
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      throw new TypeError("The eBay search limit must be 1 through 200.");
    }

    const response = await this.authorizedRequest((accessToken) =>
      this.requestKeywordSearch({
        accessToken,
        query: query.trim(),
        limit,
        categoryId,
      }),
    );
    const payload = await readJson(response);
    if (!response.ok) {
      throw new EbayApiError("eBay Browse keyword search failed.", {
        service: "browse",
        status: response.status,
        code: ebayErrorCode(payload),
      });
    }

    const itemSummaries = Array.isArray(payload?.itemSummaries)
      ? payload.itemSummaries
      : [];
    const candidates = itemSummaries
      .map(normalizeCandidate)
      .filter(
        (candidate) =>
          candidate &&
          candidate.price &&
          candidate.buyingOptions.includes("FIXED_PRICE"),
      );
    return {
      marketplaceId: this.marketplaceId,
      total: Number.isInteger(payload?.total) ? payload.total : candidates.length,
      candidates,
    };
  }

  async getItemDetails(itemId) {
    const response = await this.authorizedRequest((accessToken) =>
      this.requestItem({ accessToken, itemId }),
    );
    const payload = await readJson(response);
    if (!response.ok) {
      throw new EbayApiError("eBay Browse item lookup failed.", {
        service: "browse",
        status: response.status,
        code: ebayErrorCode(payload),
      });
    }

    const aspects = normalizeAspects(payload?.localizedAspects);
    const title = optionalString(payload?.title) ?? "Untitled eBay listing";
    return {
      itemId: optionalString(payload?.itemId) ?? itemId,
      title,
      itemWebUrl: optionalString(payload?.itemWebUrl),
      imageUrl: optionalString(payload?.image?.imageUrl),
      aspects,
      suggestions: {
        character: suggestedAspectValue(aspects, [
          "Character",
          "Pokémon",
          "Pokemon",
        ]),
        setOrInsert: suggestedAspectValue(aspects, ["Set", "Card Set"]),
        year: suggestedYearFromTitle(title),
        cardNumber:
          suggestedAspectValue(aspects, [
            "Card Number",
            "Card No",
            "Card #",
          ]) ?? suggestedCardNumberFromTitle(title),
        parallel:
          suggestedAspectValue(aspects, [
            "Parallel/Variety",
            "Parallel",
            "Variety",
          ]) ?? suggestedParallelFromTitle(title),
        serialNumber:
          suggestedSerialNumberFromAspects(aspects) ??
          suggestedSerialNumberFromTitle(title),
        language: suggestedAspectValue(aspects, ["Language"]),
        rarity: suggestedAspectValue(aspects, ["Rarity"]),
        finish: suggestedAspectValue(aspects, ["Finish", "Card Finish"]),
        promo:
          suggestedAspectIncludes(
            aspects,
            ["Features", "Card Type"],
            /\bpromo(?:tional)?\b/i,
          ) || /\bpromo(?:tional)?\b/i.test(title)
            ? true
            : null,
      },
    };
  }

  async authorizedRequest(operation) {
    let accessToken = await this.oauthClient.getAccessToken();
    let response = await operation(accessToken);

    if (response.status === 401) {
      this.oauthClient.invalidate(accessToken);
      accessToken = await this.oauthClient.getAccessToken();
      response = await operation(accessToken);
    }

    return response;
  }

  async requestSearch({ accessToken, image, limit }) {
    const url = new URL(this.searchUrl);
    url.searchParams.set("limit", String(limit));

    try {
      return await this.fetch(url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "X-EBAY-C-MARKETPLACE-ID": this.marketplaceId,
        },
        body: JSON.stringify({ image }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (cause) {
      throw new EbayApiError("The eBay Browse API could not be reached.", {
        service: "browse",
        cause,
      });
    }
  }

  async requestKeywordSearch({
    accessToken,
    query,
    limit,
    categoryId,
  }) {
    const url = new URL(this.keywordSearchUrl);
    url.searchParams.set("q", query);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("filter", "buyingOptions:{FIXED_PRICE}");
    if (categoryId) url.searchParams.set("category_ids", categoryId);

    try {
      return await this.fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
          "X-EBAY-C-MARKETPLACE-ID": this.marketplaceId,
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (cause) {
      throw new EbayApiError("The eBay Browse API could not be reached.", {
        service: "browse",
        cause,
      });
    }
  }

  async requestItem({ accessToken, itemId }) {
    const url = `${this.itemUrl}/${encodeURIComponent(itemId)}`;

    try {
      return await this.fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
          "X-EBAY-C-MARKETPLACE-ID": this.marketplaceId,
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (cause) {
      throw new EbayApiError("The eBay Browse API could not be reached.", {
        service: "browse",
        cause,
      });
    }
  }
}

export {
  EBAY_PRODUCTION_IMAGE_SEARCH_URL,
  EBAY_PRODUCTION_KEYWORD_SEARCH_URL,
  EBAY_PRODUCTION_ITEM_URL,
  imageBase64FromDataUrl,
  suggestedCardNumberFromTitle,
  suggestedParallelFromTitle,
  suggestedSerialNumberFromTitle,
  suggestedYearFromTitle,
};
