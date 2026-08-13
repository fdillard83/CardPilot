# CardPilot variant-adjusted valuation

CardPilot uses variant adjustment only as a fallback when fewer than three
exact pricing matches are available. The result is labeled as a modeled
estimate, not an observed sale, appraisal, or guaranteed market value.

## Serial-number baseline

| Serial tier | Value versus ordinary base | Increase from prior numbered tier |
| --- | ---: | ---: |
| Base | 1.0x | — |
| /2000 | 1.2–1.5x | — |
| /1000 | 1.4–2.0x | 20–40% |
| /500 | 2–3x | 30–60% |
| /250 | 3–5x | 40–70% |
| /100 | 5–9x | 60–100% |
| /75 | 6–11x | 15–35% |
| /50 | 8–15x | 25–60% |
| /25 | 12–25x | 50–100% |
| /10 | 25–60x | 100–200% |
| /5 | 45–100x | 60–150% |
| 1/1 | 100–500x+ | 150–500%+ |

An unlisted denominator such as `/85` is interpolated between the surrounding
`/100` and `/75` tiers on a logarithmic scale. The physical copy number in a
stamp such as `63/85` does not change the multiplier; only the print run does.

## Card-feature baseline

Each card uses one primary, mutually exclusive feature profile.

| Feature | Premium versus comparable non-auto/non-relic card |
| --- | ---: |
| Player-worn relic / jersey swatch | 1.3–2x |
| Game-used single-color relic | 1.5–3x |
| Multi-color patch | 2–5x |
| Premium game-used patch | 3–8x |
| Sticker autograph | 2–5x |
| On-card autograph | 3–8x |
| Rookie autograph | 4–10x+ |
| Patch + autograph | 4–12x |
| Rookie Patch Auto (RPA) | 5–20x+ |
| Logo / shield / tag + autograph | 10–50x+ |

An RPA uses the RPA range once. CardPilot does not multiply separate rookie,
patch, and autograph ranges on top of it. When the exact autograph or relic
type is not confirmed, CardPilot uses an intentionally broad fallback range and
keeps confidence low.

## Bidirectional calculation

For each dimension that differs between the source observation and the
collector's card:

`target estimate = source price × target multiplier ÷ source multiplier`

The calculation works upward and downward. For example, a `/50` on-card
autograph can be adjusted downward to an ordinary base card, while an ordinary
base sale can be adjusted upward to a `/50` on-card autograph. When serial tier
and feature profile both differ, both ratios are applied and confidence remains
limited.

CardPilot uses geometric midpoints for the displayed central estimate. The
modeled range combines the source price range with the conservative low and
high multiplier ratios. This deliberately produces a wide range when the
underlying assumptions are broad.

## Matching and confidence safeguards

- Compatible exact active listings and completed sales are blended with 60%
  weight on current active asks and 40% on completed sales. Exact direct
  evidence remains preferred over broader or modeled evidence.
- Source observations must match the same player. A different player is never
  eligible because player demand can overwhelm serial-tier differences.
- The actual card family must also be established by a matching meaningful
  set/insert name, matching card number, or a collector-confirmed visual design.
  Generic printed phrases such as "Topps Certified Autograph Issue" do not count
  as an insert identity. Known year, product, set, and card-number conflicts are
  rejected.
- Lots, boxes, reprints, replicas, and ambiguous unnumbered parallels are not
  used as adjustment anchors.
- The closest variant requiring the fewest adjustment dimensions is ranked
  first. Up to three independent anchors may be shown for comparison.
- A user-confirmed feature profile is stronger than an automatically derived
  profile.
- Interpolation, `1/1` cards, unknown feature types, one-record anchors, and
  two-dimensional adjustments remain low confidence.
- Completed-sale estimates and active-asking estimates are calculated and
  displayed separately. When both describe the same source and target variant
  profiles in the same currency, their recommendation can be blended at 60%
  active and 40% sold. Active asking prices are never presented as sales.
- Each modeled estimate shows its source median, central adjustment factor, and
  resulting target estimate. A one-sale recommendation is visibly cautioned
  when comparable active evidence differs by 50 percent or more.
- Collectors can exclude individual exact matches, broader comparisons, and
  modeled source anchors. CardPilot immediately recalculates the relevant
  summary or estimate, and **Restore all** reverses every exclusion. These
  exclusions last only while that pricing result is open and are not saved to
  the collection.
- Parallel design, player demand, condition, eye appeal, and marketplace
  behavior may outweigh general rarity multipliers.

The multiplier tables are versioned application assumptions. Provider records
used during free-tier evaluation remain in server memory only and are not
written into saved collection records.
