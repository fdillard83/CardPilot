# CardPilot

CardPilot is a mobile-friendly sports and Pokémon trading card identifier. A collector starts with one front photo, optionally adds the back only when useful, and receives an evidence-backed identification with field-level confidence and a trust decision.

## Current milestone

- Camera or photo-library upload
- Automatic identification as soon as a front photo is selected
- Automatic card-border cropping and perspective correction with a safe original-photo fallback
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
- Pokémon-aware identification with separate character, set, collector-number, language, rarity, finish, promo, and variant fields
- Category-aware collection labels, filtering, eBay searches, and valuation matching without placing Pokémon names in sports-player fields
- Editable confirmation screen for every returned field
- Local correction logging that retains original values and never treats one edit as global truth
- Private local collection storage with saved photos, search, filters, editing, and removal
- Raw-by-default collection condition profiles with optional grading details
- Automatic collection save and navigation when the collector confirms a card
- On-demand eBay Buy It Now snapshots with raw and graded cards separated
- Experimental on-demand completed-sales comparisons from The Card API
- Bidirectional serial- and feature-adjusted fallback estimates when exact pricing is scarce
- Review-first CardPilot valuation recommendations with collector confirmation or adjustment
- Confirmed per-card values, portfolio totals, stale-pricing filters, and sequential collection refresh
- Optimized upload payloads, parallel eBay matching, and visible scan progress
- A repeatable, opt-in accuracy evaluation library for verified sample cards

CardPilot now has a small source-linked catalog adapter for the active Nolan Ryan regression, but it is not yet a complete trading-card catalog. The provider boundary and versioned result are designed for future valuation and verification engines.

CardPilot now includes local collection tracking, descriptive active-listing
snapshots, and an experimental completed-sales comparison view. Detailed
raw-condition assessment, listing automation, authentication, accounts, and
cloud sync remain future milestones. See
[the identification architecture](docs/identification-architecture.md) and
[sold-sales provider options](docs/sold-sales-provider-options.md).

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
   matching and collection active-market searches. To evaluate completed-sales
   comparisons, add a The Card API key as `THE_CARD_API_KEY`. Keep every
   credential server-side and never prefix it with `VITE_`.

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

## Pokémon cards

Pokémon scans use the same Express identification and collection workflow as
sports cards. The model classifies the card category first, stores the Pokémon
name separately from a sports player, and reads the printed collector number,
set code or name, language, rarity, rarity symbol, finish, promo status, and
named variant when the image supports them. CardPilot inspects the enlarged
bottom corners and keeps the literal rarity mark separate from the normalized
rarity name, set symbol, regulation mark, and language code. A lone boxed
regulation mark such as `J` is not treated as a language code.

Pokémon pricing starts with the full confirmed identity. When that literal
query is too restrictive, CardPilot retries focused searches that retain the
Pokémon name, collector number, set, and promo or variant details while dropping
generic publisher and product wording. All search phrases are shown in the
market panels, and the same title-conflict checks still protect exact and
broader comparisons.

The confirmation and collection screens automatically switch to Pokémon labels
such as **Pokémon**, **Set**, **Collector number**, and **Variant**. Current eBay
searches use those confirmed details. CardPilot does not apply the sports-card
serial-number, autograph, relic, or rookie multiplier model to Pokémon cards;
Pokémon variant modeling needs its own evidence-backed methodology.

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

## Completed-sales route

`GET /api/collection/:collectionId/sold-comps` searches The Card API from the
existing Express backend. It uses the collector-confirmed card details and the
saved raw-or-graded condition profile. Raw is the default; graded searches send
the saved grading company and grade as provider filters.

Only provider-confirmed sale prices are summarized. Exact title matches and
guarded broader matches are grouped separately, and marketplace platforms are
also kept separate because price and buyer-premium treatment can differ. Each
group shows a median sold price, typical range, count, and source records.
Unusually priced outliers are excluded when enough records exist.

The provider key is sent only as the server-side `x-market-api-key` header. The
browser receives normalized comparison data and never receives the key. Results
are cached in server memory for ten minutes and are not written to collection
records, which keeps the current free-tier evaluation session-only. A zero-result
search means no qualifying record was found in the provider's available window;
it does not mean the card has no value.

When fewer than three exact matches are available, CardPilot can also show a
separate **Variant-adjusted estimate**. It finds other versions from the same
card lineage and scales their completed sale or active asking price upward or
downward using configured serial-number and card-feature premium ranges. `/85`
and other unlisted print runs are interpolated between adjacent tiers. Composite
profiles such as RPA are applied once, so rookie, patch, and autograph premiums
are not double-counted. Sold and active-asking estimates are calculated
separately before they are eligible for the recommendation blend.

Collectors can confirm the card's primary feature profile from **Edit details**.
Automatic profiles are intentionally conservative when the autograph or relic
type is unknown. Every adjusted estimate identifies its source tier, target
tier, same-player and card-family evidence, applied factors, source records,
plain-language calculation, modeled range, and limited confidence. Generic
autograph certification wording is not accepted as an insert name.
See [the variant-adjustment methodology](docs/variant-adjusted-valuation.md).

## Confirmed valuation workflow

`GET /api/collection/:collectionId/valuation` checks the cached sold-comps and
active-market services and returns a decision-support recommendation. When
comparable active listings and completed sales exist at the same evidence tier,
CardPilot blends them with **60% weight on current active asking prices and 40%
weight on completed sales**. This gives the current market more influence while
keeping the estimate grounded in prices buyers actually paid. The same blend is
available for compatible exact, broader, and variant-adjusted evidence; tiers
and incompatible variant profiles are never mixed.

Direct exact evidence is preferred over broader evidence, and broader evidence
is preferred over modeled variant estimates. If only one source is available at
the best available tier, CardPilot still recommends from that source instead of
mixing in a lower-quality tier. Active-only, broader, and variant-adjusted
recommendations remain low confidence because asking prices are not confirmed
sales and modeled estimates add assumptions. The interface shows both source
amounts, sample counts, and their weights whenever a blend is used.

The final CardPilot recommendation rounds upward to the next price point ending
in `.25`, `.50`, or `.95`. This display adjustment does not change source
prices, source medians, the modeled range, or a collector's ability to enter a
different confirmed value.

Collectors can accept or edit the recommendation. `PUT /api/collection/:collectionId/valuation`
saves only the confirmed amount,
currency, confidence, method, adjustment flag, and confirmation date. Raw
provider sales and listings remain in server memory and are never written to
the collection record. `DELETE /api/collection/:collectionId/valuation` clears
the confirmed value.

The collection shows confirmed portfolio value, cards needing a value, and
values older than 30 days or made stale by later card-detail edits. **Refresh all
values** searches sequentially and pauses when a provider reports a request
limit. Recommendations are reviewed and selected before the collection is
updated.

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
- The Card API completed-sales searches run through the Express server. `THE_CARD_API_KEY` is never returned to browser code, and free-tier results remain in memory only.
- User corrections are stored locally in `.data/corrections.jsonl`; that directory is ignored by Git.
- Saved collection records and card photos are stored under `.data`; that directory is ignored by Git.
- Front-only scans use `gpt-5.4-mini` by default for lower latency and reliable visual extraction. Override it with `OPENAI_FAST_MODEL`.
- Scans with an optional back photo use `gpt-5.6-sol` by default for deeper verification. Override it with `OPENAI_MODEL`.
- AI identification is a first-pass assistant, not a guarantee. Verify the printed card number, set, parallel, and serial numbering before a purchase, sale, or grading submission.
