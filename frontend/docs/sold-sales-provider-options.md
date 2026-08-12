# Sold-sales data options

Reviewed August 12, 2026. CardPilot should keep sold transactions separate from
active asking prices and should never label an estimated price as a verified
sale.

## Best options

### 1. Card Ladder data partnership

Card Ladder says it tracks more than 100 million historical sales from eBay,
Goldin, Heritage, Fanatics, and other platforms, with researcher-vetted sales.
That makes it the strongest product fit for broad sports-card comps. Its public
site offers consumer Pro access, but no supported public developer API is
documented. CardPilot would need a commercial data-license or partnership before
integrating it.

- [Card Ladder data coverage](https://cardladder.com/)
- [Card Ladder sales history](https://cardladder.com/pro-features/sales-history)

### 2. eBay Marketplace Insights, if CardPilot can obtain access

Marketplace Insights is eBay's own sold-history API and would align naturally
with the existing Browse integration. However, eBay currently labels it a
Limited Release and states that it is restricted and not open to new users.
CardPilot can retain a provider adapter for it, but should not plan the near-term
valuation feature around receiving access.

- [eBay buying-application APIs](https://developer.ebay.com/develop/get-started/get-started-on-a-buying-application)
- [eBay API availability and restriction](https://developer.ebay.com/api-docs/buy/ref-marketplace-supported.html)

### 3. Market Movers commercial partnership

Market Movers covers sales from marketplaces including eBay, PWCC, and Goldin.
Its official guidance describes completed-sale review, automated exclusion of
zero-feedback buyers, and human review of significant outliers. No supported
public developer API is documented, so an app integration requires a commercial
agreement rather than consumer-account automation.

- [Market Movers data-quality guidance](https://www.sportscardinvestor.com/market-movers-deal-search-buying-guide/)

## Useful, but not full sold-comps APIs

### PriceCharting / SportsCardsPro

PriceCharting has a documented paid API and supports sports-card price-guide
values by condition or grade. It is the easiest technically supported pricing
integration to prototype. Its own API documentation explicitly says the API
supports current item values only and does not expose historic prices or
historic sales. CardPilot could label this data **Price guide estimate**, but
not **Recent sold listings**.

- [PriceCharting API documentation](https://www.pricecharting.com/api-documentation)

### PSA Auction Prices Realized

PSA provides more than five million verified auction results updated daily, but
the coverage is centered on PSA-graded items and no public integration API is
documented. It is useful for collector research or a future licensed data
relationship, not for an unsupported scraper.

- [PSA Auction Prices Realized](https://www.psacard.com/auctionprices)

## Recommendation

Start partnership conversations with Card Ladder and Market Movers while asking
eBay whether CardPilot can qualify for Marketplace Insights. If CardPilot needs
an earlier automated pricing milestone, use the documented PriceCharting API
and present its output as a price-guide estimate. Do not scrape consumer sites
or automate a consumer subscription; data rights, reliability, and production
stability need to be explicit.
