const ECB_DAILY_RATES_URL =
  "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";

function normalizedCurrency(value) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function numericAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

export function parseEcbReferenceRates(xml) {
  if (typeof xml !== "string" || !xml.trim()) {
    throw new TypeError("The ECB exchange-rate response was empty.");
  }
  const effectiveDate = xml.match(/<Cube\s+time=["']([^"']+)["']/i)?.[1] ?? null;
  const rates = { EUR: 1 };
  for (const cube of xml.matchAll(/<Cube\b[^>]*>/gi)) {
    const currency = cube[0].match(/currency=["']([A-Z]{3})["']/i)?.[1]?.toUpperCase();
    const rate = Number(cube[0].match(/rate=["']([0-9.]+)["']/i)?.[1]);
    if (currency && Number.isFinite(rate) && rate > 0) rates[currency] = rate;
  }
  if (!effectiveDate || !Number.isFinite(rates.USD)) {
    throw new TypeError("The ECB exchange-rate response did not include a dated USD rate.");
  }
  return { effectiveDate, rates };
}

export class UsdCurrencyConverter {
  constructor({
    fetchImpl = fetch,
    now = () => Date.now(),
    ratesUrl = ECB_DAILY_RATES_URL,
    timeoutMs = 5_000,
  } = {}) {
    this.fetch = fetchImpl;
    this.now = now;
    this.ratesUrl = ratesUrl;
    this.timeoutMs = timeoutMs;
    this.cache = null;
    this.pending = null;
  }

  async convert(value, currency) {
    const amount = numericAmount(value);
    const sourceCurrency = normalizedCurrency(currency);
    if (amount === null || !sourceCurrency) return null;
    if (sourceCurrency === "USD") {
      return {
        value: amount.toFixed(2),
        currency: "USD",
        conversion: null,
      };
    }

    let table;
    try {
      table = await this.#dailyRates();
    } catch {
      return null;
    }
    const sourceRate = table.rates[sourceCurrency];
    const usdRate = table.rates.USD;
    if (!Number.isFinite(sourceRate) || sourceRate <= 0) return null;
    const rateToUsd = usdRate / sourceRate;
    const convertedAmount = Math.round(amount * rateToUsd * 100) / 100;
    return {
      value: convertedAmount.toFixed(2),
      currency: "USD",
      conversion: {
        sourceCurrency,
        sourceValue: amount.toFixed(2),
        rateToUsd,
        effectiveDate: table.effectiveDate,
        provider: "European Central Bank",
      },
    };
  }

  async ebayCandidates(candidates) {
    const converted = await Promise.all((candidates ?? []).map(async (candidate) => {
      const price = await this.convert(candidate?.price?.value, candidate?.price?.currency);
      if (!price) return null;
      const shipping = candidate.shippingCost
        ? await this.convert(candidate.shippingCost.value, candidate.shippingCost.currency)
        : null;
      return {
        ...candidate,
        price: { value: price.value, currency: "USD" },
        shippingCost: shipping
          ? { value: shipping.value, currency: "USD" }
          : null,
        currencyConversion: price.conversion,
      };
    }));
    return converted.filter(Boolean);
  }

  async soldResult(result) {
    const sales = await Promise.all((result?.sales ?? []).map(async (sale) => {
      const price = await this.convert(sale.price, sale.currency);
      if (!price) return null;
      const originalPrice = sale.originalPrice === null || sale.originalPrice === undefined
        ? null
        : await this.convert(sale.originalPrice, sale.currency);
      const shippingPrice = sale.shippingPrice === null || sale.shippingPrice === undefined
        ? null
        : await this.convert(sale.shippingPrice, sale.currency);
      return {
        ...sale,
        price: price.value,
        originalPrice: originalPrice?.value ?? null,
        shippingPrice: shippingPrice?.value ?? null,
        currency: "USD",
        currencyConversion: price.conversion,
      };
    }));
    return { ...result, sales: sales.filter(Boolean) };
  }

  async #dailyRates() {
    const requestedDay = new Date(this.now()).toISOString().slice(0, 10);
    if (this.cache?.requestedDay === requestedDay) return this.cache.table;
    if (this.pending?.requestedDay === requestedDay) return this.pending.promise;

    const promise = this.#fetchRates().then((table) => {
      this.cache = { requestedDay, table };
      return table;
    }).finally(() => {
      if (this.pending?.requestedDay === requestedDay) this.pending = null;
    });
    this.pending = { requestedDay, promise };
    return promise;
  }

  async #fetchRates() {
    const response = await this.fetch(this.ratesUrl, {
      headers: { Accept: "application/xml, text/xml" },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`ECB daily exchange rates were unavailable (HTTP ${response.status}).`);
    }
    return parseEcbReferenceRates(await response.text());
  }
}

export { ECB_DAILY_RATES_URL };
