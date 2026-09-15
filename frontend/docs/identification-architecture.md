# CardPilot identification architecture

CardPilot identifies a card through a staged pipeline instead of treating one vision-model answer as final truth.

## Pipeline

1. **Image intake** validates a required front image and an optional back image.
2. **Evidence extraction** reads only what the supplied pixels support. It returns a value, confidence, concise image observations, and character-by-character numeric readings for every field.
3. **Semantic normalization** keeps literal marks separate from their meaning. Four-digit season rules and anniversary-branding guardrails prevent a logo such as “75 Years of Baseball” from becoming the year, product, or set.
4. **Candidate generation** queries the local catalog provider first. Its small starter catalog covers the current Nolan Ryan regression; cards outside that seed set fall back to unverified model search leads without a second model call.
5. **Verification** compares every candidate with the visible extraction, records supporting and conflicting fields, and ranks the candidates. Catalog agreement is independent evidence; model suggestions cannot verify their own extraction.
6. **Confidence scoring** calculates overall confidence from weighted identity fields. Missing evidence, candidate-only values, and conflicts cap the score.
7. **Overall decision** applies configurable trust thresholds and high-impact feature rules.

When first-pass verification materially adds or changes a retrieval field such
as year, product, insert, card number, parallel, or serial number, the engine
feeds those fields backward through candidate retrieval once, merges the new
leads with the first pass, and verifies again. This bounded refinement pass
allows later evidence to improve earlier search without creating an unbounded
feedback loop. Strong catalog evidence may correct a tentative model-derived
value, but it cannot overwrite high-confidence visible text. A later eBay year
consensus also triggers catalog re-verification in the browser.

Google Vision Web Detection is an independent evidence family in both
directions. Its cached result first corroborates or cautiously corrects the
normalized image extraction before catalog retrieval. After bounded candidate
refinement, a final reconciliation compares the untouched original extraction,
the forward Google-assisted fields, and the backward candidate fields. A late
field earns higher confidence only when independent Google and catalog evidence
agree. Repeated Google matching-card evidence can restore a year that a later
candidate changed, while near-certain visible text remains authoritative.

Shine is also treated as structured evidence rather than a generic color.
Evidence extraction records reflective finish separately from repeatable foil
geometry such as waves, rays, dots, sparkle, cracked ice, checkerboard, and
rainbow refraction. Independent image matching carries a surface-pattern score
alongside color, layout, structure, and player pose. These attributes help
separate inserts and parallels, but appearance alone cannot invent a named
parallel; printed text, serial numbering, Google evidence, or catalog agreement
must independently support the name.

Every visual comparison now evaluates both full-color and grayscale versions of
the card. Ordinary cards use a balanced score so stable border color remains a
useful parallel clue. When the extracted finish or parallel indicates foil,
holographic, prism, wave, cracked-ice, or refractor behavior, the matcher switches
to a reflective-card score: photographed hue and color-border similarity lose
their vote, while grayscale border shape, layout, pose, and foil-pattern geometry
carry the consensus. Both component scores remain recorded for review.

The identity search also performs a design-only cross-player pass. It searches
the same year and product family without the scanned player's name, then
compares border, frame layout, and foil geometry while deliberately excluding
the other player's pose from the design score. A repeated label may be proposed
as an insert or parallel only when at least two different card numbers support
the same design; listings without usable card numbers require three examples.
Only the design classification can transfer back—the other player, team, year,
and card number never can—and the proposed field remains review-required.

The public route remains `POST /api/identify-card`. Its response is validated with `CardIdentificationResultSchema` and versioned as schema `1.0`.

## Modules

- `image-intake.mjs` validates image inputs without making a model call.
- `evidence-engine.mjs` owns multimodal evidence extraction, literal mark classification, visual-feature notes, numeric reconciliation, and unverified embedded candidate suggestions.
- `semantic-normalizer.mjs` is the deterministic firewall between visual transcription and card semantics.
- `catalog-records.mjs` contains a deliberately small, source-linked seed catalog. It is an adapter target, not the eventual complete card database.
- `candidate-generator.mjs` ranks independent catalog records and retains the embedded/provisional fallbacks without another network call.
- `verification-engine.mjs` compares candidates to extracted evidence.
- `confidence-engine.mjs` owns deterministic overall confidence calculation.
- `trust-engine.mjs` maps confidence and high-impact details to auto-accept, confirm, or review.
- `contracts.mjs` contains the strict result, model-output, and correction schemas.
- `identification-engine.mjs` orchestrates the stages and records pipeline metadata.
- `correction-log.mjs` appends user corrections to a local JSONL log.

## Result contract

Each identification includes:

- Field-level value, confidence, evidence references, inference source, and missing evidence for player, sport, team, year, manufacturer, product, brand, set/insert, card number, rookie status, parallel, serial number, autograph, memorabilia, and image variation.
- A global evidence list that says what was observed, where it appeared, and whether it came from the front or back image.
- Character-by-character readings for short digits such as anniversary marks, card numbers, and serial numbering. Conflicting aggregate and character readings are reconciled before candidate verification.
- Ranked candidate matches with supporting and conflicting fields.
- Overall confidence and an explicit trust decision.
- Optional back-photo guidance with an estimated confidence gain.
- Pipeline stages and whether any stage used a degraded fallback.

## Trust behavior

The default thresholds live in `defaultTrustConfig`:

- `0.95` and above: auto-accept an ordinary, fully supported card.
- `0.80` through `0.949`: request one-tap confirmation.
- Below `0.80`: recommend full review.

An uncertain parallel forces review. Serial-numbered cards, autographs, memorabilia cards, and image variations require stronger field evidence and receive at least one-tap confirmation even when overall confidence is high.

A back photo is never required. It is suggested only when the result is not already auto-accepted and missing back-side evidence for an identity or high-impact field is expected to improve confidence by at least `0.08`. Generic missing rookie status alone does not trigger the suggestion. Estimated gain is capped by the remaining confidence headroom and at `0.35`. The UI always leaves **Edit result** and **Use anyway** available on uncertain results.

## Latency controls

The normal front-only path makes one request to the configured accuracy vision model at low reasoning effort. An operator can explicitly set `OPENAI_FAST_MODEL` to choose a different latency/cost tradeoff. The browser adds enlarged top and bottom detail bands so small printed details receive focused attention inside that same request. A supplied back photo routes to the configured accuracy model at medium reasoning effort because the user has explicitly chosen deeper verification.

The API client uses a 60-second timeout and no automatic retry. A transient failure therefore returns control to the collector instead of silently repeating a long identification. Each result records total pipeline duration and stage duration, and the server logs those values for regression monitoring.

## Corrections

`POST /api/corrections` validates and appends corrections to `.data/corrections.jsonl`. Each record stores the original value, original confidence, corrected value, decision metadata, and whether a back photo was present. Images are not stored.

Every record is labeled `unverified_example`. Nothing in the identification pipeline reads this log, so one user correction can never become global truth automatically. A future evaluation or reviewed-training workflow can consume repeated, verified examples separately.

## Extension points

`IdentificationEngine` receives its evidence engine and candidate generator through its constructor. Future engines can consume `CardIdentificationResultSchema` without importing OpenAI-specific code.

The in-memory catalog is intentionally a first adapter implementation. A complete checklist database or licensed catalog API can replace its record source while preserving the existing `generate(extraction)` boundary, `catalog` source, and stable `catalogRecordId`. The verification and trust stages already distinguish independent catalog evidence from model suggestions.

### eBay image-search candidates

`POST /api/ebay/image-search` reuses `parseImageIntake` and sends the validated
front image to the Production Browse API `search_by_image` resource. The eBay
OAuth module obtains an application token with the client-credentials grant,
caches it only in server memory, refreshes it before expiry, coalesces concurrent
token requests, and retries one Browse request after a rejected token.

The response is a bounded list of normalized active-listing candidates. These
are visual search leads, not checklist truth, and they are intentionally kept
separate from the current `CatalogCandidateGenerator` and OpenAI evidence flow.
Future candidate fusion can rank them against the versioned visible extraction
without allowing seller titles to overwrite pixel-supported evidence.

The scanner requests up to 30 eBay image-search leads and independently compares
the first 24 listing images. Same-player keyword corroboration retrieves up to
20 results per query and visually checks up to 30 unique listings. Structured
card-catalog retrieval requests up to 10 records per query; final verification
still exposes only the five strongest candidates so broader recall does not
become unbounded UI noise.

Pricing, Grading, Market Intelligence, Inventory, and Automation should take the versioned identification result as input and honor `decision.reviewRequired` before performing high-impact actions.

## Ludex-inspired product path

CardPilot uses proven collector workflows as product inspiration without copying another app’s implementation or data. The intended sequence is:

1. Verified identity and parallel/variation disambiguation.
2. Collection and inventory records keyed by `catalogRecordId`.
3. Market-price comparisons attached to the verified identity.
4. Condition and grading assistance kept separate from identity confidence.
5. Faster continuous or batch scanning with an asynchronous queue.
6. Draft eBay listings generated only from user-confirmed identities.

Each later engine consumes the same versioned identification result. This avoids rebuilding identification inside pricing, inventory, or listing features.

## Validation

Run:

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run build
npm.cmd run test:server
```

The tests cover threshold boundaries, high-confidence front-only acceptance, material back-photo guidance, uncertain parallels, special-card handling, strict result validation, the Nolan Ryan `75` versus `70` numeric regression, semantic rejection of anniversary branding, and independent catalog candidate ranking.
