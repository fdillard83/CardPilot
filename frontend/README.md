# CardPilot

CardPilot is a mobile-friendly sports trading card identifier. A collector starts with one front photo, optionally adds the back only when useful, and receives an evidence-backed identification with field-level confidence and a trust decision.

## Current milestone

- Camera or photo-library upload
- Automatic identification as soon as a front photo is selected
- Staged identification pipeline: intake, evidence extraction, candidates, verification, confidence, and decision
- One-call front-only workflow with focused corner crops for faster small-text reading
- Character-by-character verification for anniversary marks, years, card numbers, and serial numbers
- Semantic guardrails that keep anniversary logos from becoming issue years, products, or sets
- Independent starter catalog matches with explicit user selection for ambiguous cards
- Optional card-back image suggested only when it could materially improve confidence
- Server-side OpenAI vision analysis (the API key never reaches the browser)
- Server-side eBay Production Browse API image search with cached OAuth tokens
- Active eBay image matches displayed separately on the identification result screen
- Strict versioned result with field-level confidence, evidence, missing evidence, and candidate matches
- Configurable Trust Engine for auto-accept, one-tap confirmation, and full review
- Special handling for uncertain parallels, serial numbers, autographs, memorabilia, and image variations
- Editable confirmation screen for every returned field
- Local correction logging that retains original values and never treats one edit as global truth
- Private local collection storage with saved photos, search, filters, editing, and removal
- Automatic collection save and navigation when the collector confirms a card
- On-demand eBay Buy It Now snapshots with raw and graded cards separated
- Optimized upload payloads, parallel eBay matching, and visible scan progress
- A repeatable, opt-in accuracy evaluation library for verified sample cards

CardPilot now has a small source-linked catalog adapter for the active Nolan Ryan regression, but it is not yet a complete trading-card catalog. The provider boundary and versioned result are designed for future valuation and verification engines.

CardPilot now includes local collection tracking and descriptive active-listing
snapshots. Sold-sales valuation,
condition grading, listing automation, authentication, accounts, and cloud sync
remain future milestones. See [the identification architecture](docs/identification-architecture.md)
and [sold-sales provider options](docs/sold-sales-provider-options.md).

## Run locally

1. Install dependencies:

   ```powershell
   npm.cmd install
   ```

2. Copy `.env.example` to `.env` and replace its placeholders. Add an OpenAI
   API key from the [OpenAI API dashboard](https://platform.openai.com/api-keys).
   To enable image-search candidates, also add Production credentials from
   [eBay Application Keys](https://developer.ebay.com/my/keys) and select a
   supported `EBAY_MARKETPLACE_ID`. The same eBay credentials power both image
   matching and collection active-market searches. Keep every credential
   server-side and never prefix it with `VITE_`.

3. Start the web app and identification server together:

   ```powershell
   npm.cmd run dev
   ```

4. Open `http://localhost:5173`.

## Production-style run

```powershell
npm.cmd run build
npm.cmd start
```

Then open `http://localhost:8787`.

## eBay image-search route

`POST /api/ebay/image-search` accepts the same `frontImage` data URL used by
`POST /api/identify-card`, plus an optional integer `limit` from 1 through 50:

```json
{
  "frontImage": "data:image/jpeg;base64,...",
  "limit": 10
}
```

It returns normalized active-listing candidates with eBay item IDs, titles,
listing links, images, prices, conditions, buying options, and categories. The
route is independent of the OpenAI identification request, so an eBay outage or
configuration issue does not replace or disable the existing identification
pipeline.

Collectors can optionally mark one listing as the closest visual reference.
CardPilot then checks that active listing's seller-provided item aspects and
offers year, card-number, parallel, or serial-number values beside that listing.
Serial-number suggestions use only the known print run, such as `/99`. CardPilot
does not copy an exact stamp such as `23/99` from a seller's listing because the
collector's physical copy may have a different number. Selecting a listing
alone never changes the identification. When the collector explicitly confirms
it is the same card, CardPilot immediately applies the available listing details,
saves the card, and opens My Collection. Before confirming, the collector can add
a photo showing their own serial stamp or review and edit any card detail.

Card details show **Numbered card** as a derived Yes/No value and label the
exact stamp separately as **Numbered Card Serial Number**. For example, `63/85`
means Numbered card: Yes and identifies that physical copy as number 63 in a
print run of 85.

The Browse API returns active purchasable listings, not verified sold
comparables. Sold-price history requires a separately authorized data source
and should be presented as a distinct valuation signal rather than mixed into
visual identification.

## Active-market route

`GET /api/collection/:collectionId/active-market` builds a keyword search from
the collector-confirmed details and queries the eBay Production Browse API for
fixed-price listings. An exact serial stamp such as `63/85` is reduced to the
product-level print run `/85`, so one physical copy is not confused with
another.

CardPilot rejects obvious lots, boxes, reprints, conflicting parallels, and
other title mismatches. Closely matching listings are grouped into raw and
grade-specific sections. Each section shows the median active ask, a typical
asking range, and its source listings. Unusually priced outliers are excluded
when enough listings exist. Item price and API-supplied shipping are kept
separate and combined only when they use the same currency.

If the collector confirmed an eBay listing as the same card during
identification, that still-active listing is retained as a trusted reference
even when its seller title omits otherwise required details such as the year.

When fewer than three exact listings are available, CardPilot also runs a
guarded fallback pass. It can tolerate missing seller-title details, but still
rejects conflicting players, years, card numbers, parallels, product variants,
and serial print runs. Broader comparisons are grouped separately, capped at
low confidence, and never blended into the exact-match median or range.

Snapshots are fetched on demand and cached in server memory for ten minutes;
they are not stored on collection records. The Browse API supplies active
seller asking prices rather than completed sales, so the interface never labels
the result as sold comps, fair market value, or an appraisal. True sold comps
remain reserved for a separately licensed data provider. See
[sold-sales provider options](docs/sold-sales-provider-options.md).

## Checks

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run build
npm.cmd run test:server
```

The paid-call accuracy baseline is intentionally separate from normal tests. With
the local server running, use `npm.cmd run eval:accuracy`. It evaluates only
collector-verified fields in `accuracy/fixtures.sample.json` and consumes OpenAI
API usage.

## Notes

- Supported images: JPG, PNG, WebP, and GIF, up to 12 MB each.
- The local server sends the selected images to the OpenAI Responses API for identification and does not write uploaded images to disk.
- eBay image search sends only the requested front image to the Production Browse API. OAuth tokens are cached in server memory and refreshed before expiry; the Client Secret and access tokens are never returned to browser code.
- eBay keyword searches run through the Express server. The Client Secret and cached OAuth access token are never returned to browser code.
- User corrections are stored locally in `.data/corrections.jsonl`; that directory is ignored by Git.
- Saved collection records and card photos are stored under `.data`; that directory is ignored by Git.
- Front-only scans use `gpt-5.4-mini` by default for lower latency and reliable visual extraction. Override it with `OPENAI_FAST_MODEL`.
- Scans with an optional back photo use `gpt-5.6-sol` by default for deeper verification. Override it with `OPENAI_MODEL`.
- AI identification is a first-pass assistant, not a guarantee. Verify the printed card number, set, parallel, and serial numbering before a purchase, sale, or grading submission.
