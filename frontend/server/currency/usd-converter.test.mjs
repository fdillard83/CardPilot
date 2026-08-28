import test from "node:test";
import assert from "node:assert/strict";
import {
  UsdCurrencyConverter,
  parseEcbReferenceRates,
} from "./usd-converter.mjs";

const ratesXml = (date = "2026-08-28") => `<?xml version="1.0"?>
<gesmes:Envelope>
  <Cube>
    <Cube time="${date}">
      <Cube currency="USD" rate="1.2000"/>
      <Cube currency="GBP" rate="0.8000"/>
      <Cube currency="CAD" rate="1.5000"/>
    </Cube>
  </Cube>
</gesmes:Envelope>`;

test("ECB daily rates parse their effective date and quoted currencies", () => {
  assert.deepEqual(parseEcbReferenceRates(ratesXml()), {
    effectiveDate: "2026-08-28",
    rates: { EUR: 1, USD: 1.2, GBP: 0.8, CAD: 1.5 },
  });
});

test("USD bypasses exchange-rate requests", async () => {
  let requests = 0;
  const converter = new UsdCurrencyConverter({
    fetchImpl: async () => {
      requests += 1;
      throw new Error("should not fetch");
    },
  });

  assert.deepEqual(await converter.convert("12.34", "USD"), {
    value: "12.34",
    currency: "USD",
    conversion: null,
  });
  assert.equal(requests, 0);
});

test("foreign amounts use the latest ECB rate once per day", async () => {
  let requests = 0;
  let now = Date.parse("2026-08-28T12:00:00.000Z");
  const converter = new UsdCurrencyConverter({
    now: () => now,
    fetchImpl: async () => {
      requests += 1;
      return new Response(ratesXml(), { status: 200 });
    },
  });

  const first = await converter.convert("8.00", "GBP");
  const second = await converter.convert("15.00", "CAD");
  assert.equal(first.value, "12.00");
  assert.equal(first.currency, "USD");
  assert.equal(first.conversion.effectiveDate, "2026-08-28");
  assert.equal(second.value, "12.00");
  assert.equal(requests, 1);

  now = Date.parse("2026-08-29T12:00:00.000Z");
  await converter.convert("8.00", "GBP");
  assert.equal(requests, 2);
});

test("market records are converted to USD and unavailable currencies are excluded", async () => {
  const converter = new UsdCurrencyConverter({
    fetchImpl: async () => new Response(ratesXml(), { status: 200 }),
  });
  const candidates = await converter.ebayCandidates([
    {
      itemId: "gbp",
      price: { value: "8.00", currency: "GBP" },
      shippingCost: { value: "2.00", currency: "GBP" },
    },
    {
      itemId: "unsupported",
      price: { value: "100.00", currency: "XYZ" },
      shippingCost: null,
    },
  ]);
  assert.equal(candidates.length, 1);
  assert.deepEqual(candidates[0].price, { value: "12.00", currency: "USD" });
  assert.deepEqual(candidates[0].shippingCost, { value: "3.00", currency: "USD" });

  const result = await converter.soldResult({
    sales: [
      { id: "cad", price: "15.00", originalPrice: "20.00", shippingPrice: null, currency: "CAD" },
    ],
  });
  assert.equal(result.sales[0].price, "12.00");
  assert.equal(result.sales[0].originalPrice, "16.00");
  assert.equal(result.sales[0].currency, "USD");
});

test("a rate outage excludes foreign amounts without affecting USD", async () => {
  const converter = new UsdCurrencyConverter({
    fetchImpl: async () => new Response("offline", { status: 503 }),
  });
  assert.equal(await converter.convert("8.00", "GBP"), null);
  assert.equal((await converter.convert("8.00", "USD")).value, "8.00");
});
