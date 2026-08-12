const defaultBaseUrl = "https://thecardapi.com/api/v1/market";

function cleanString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function cleanNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeSale(sale) {
  return {
    id: cleanString(sale?.id),
    platform: cleanString(sale?.platform) ?? "Unknown marketplace",
    listingType: cleanString(sale?.listing_type),
    title: cleanString(sale?.title) ?? "Untitled completed sale",
    saleDate: cleanString(sale?.sale_date),
    soldAt: cleanString(sale?.sold_at),
    price: cleanNumber(sale?.price),
    originalPrice: cleanNumber(sale?.original_price),
    currency: cleanString(sale?.currency),
    priceConfirmed: sale?.price_confirmed === true,
    bids: cleanNumber(sale?.bids),
    imageUrl:
      cleanString(sale?.image_url) ?? cleanString(sale?.thumbnail_url),
    listingUrl: cleanString(sale?.listing_url),
    cert: cleanString(sale?.cert),
    condition: cleanString(sale?.condition),
    grade: cleanString(sale?.grade),
    grader:
      cleanString(sale?.grader) ?? cleanString(sale?.grading_company),
    player: cleanString(sale?.player),
    manufacturer: cleanString(sale?.manufacturer),
    cardSet: cleanString(sale?.card_set),
    cardNumber: cleanString(sale?.card_number),
    year: cleanString(sale?.year),
    season: cleanString(sale?.season),
    league: cleanString(sale?.league),
    sport: cleanString(sale?.sport),
    team: cleanString(sale?.team),
    features: Array.isArray(sale?.features)
      ? sale.features.map(cleanString).filter(Boolean)
      : [],
    printRun: cleanNumber(sale?.print_run),
    shippingPrice: cleanNumber(sale?.shipping_price),
    category: cleanString(sale?.category),
  };
}

export class TheCardApiError extends Error {
  constructor(message, { status = null, code = null } = {}) {
    super(message);
    this.name = "TheCardApiError";
    this.status = status;
    this.code = code;
  }
}

export class TheCardApiClient {
  constructor({
    apiKey,
    fetchImpl = fetch,
    baseUrl = defaultBaseUrl,
    timeoutMs = 15_000,
  }) {
    if (!cleanString(apiKey)) {
      throw new TypeError("A The Card API key is required.");
    }
    this.apiKey = apiKey.trim();
    this.fetchImpl = fetchImpl;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.timeoutMs = timeoutMs;
  }

  async searchSales({
    query,
    category = null,
    graded,
    grader = null,
    grade = null,
    limit = 100,
  }) {
    const cleanQuery = cleanString(query);
    if (!cleanQuery) throw new TypeError("A completed-sales query is required.");
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
      throw new TypeError("The completed-sales limit must be from 1 through 1000.");
    }

    const url = new URL(`${this.baseUrl}/sales`);
    url.searchParams.set("q", cleanQuery.slice(0, 500));
    if (cleanString(category)) url.searchParams.set("category", category.trim());
    if (typeof graded === "boolean") {
      url.searchParams.set("graded", String(graded));
    }
    if (cleanString(grader)) url.searchParams.set("grader", grader.trim());
    if (cleanString(grade)) url.searchParams.set("grade", grade.trim());
    url.searchParams.set("limit", String(limit));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await this.fetchImpl(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "x-market-api-key": this.apiKey,
        },
        signal: controller.signal,
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new TheCardApiError("The Card API request timed out.", {
          code: "timeout",
        });
      }
      throw new TheCardApiError("The Card API request could not be completed.", {
        code: "network_error",
      });
    } finally {
      clearTimeout(timeout);
    }

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new TheCardApiError("The Card API rejected the request.", {
        status: response.status,
        code: cleanString(payload?.code) ?? cleanString(payload?.error),
      });
    }
    if (!payload || !Array.isArray(payload.data)) {
      throw new TheCardApiError("The Card API returned an invalid response.", {
        status: response.status,
        code: "invalid_response",
      });
    }

    return {
      sales: payload.data.map(normalizeSale),
      pagination: {
        total: cleanNumber(payload.pagination?.total) ?? payload.data.length,
        hasMore: payload.pagination?.has_more === true,
        nextCursor: cleanString(payload.pagination?.next_cursor),
      },
      coverage: {
        from: cleanString(payload.meta?.coverage_date_from),
        to: cleanString(payload.meta?.coverage_date_to),
        platforms: Array.isArray(payload.meta?.platforms_covered)
          ? payload.meta.platforms_covered.map(cleanString).filter(Boolean)
          : [],
        generatedAt: cleanString(payload.meta?.generated_at),
      },
    };
  }
}
