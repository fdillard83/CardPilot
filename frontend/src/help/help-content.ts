export type HelpCategory = "Getting started" | "Collection" | "Values" | "Selling" | "Account" | "FAQ" | "Advice" | "Troubleshooting" | "Glossary";

export type HelpArticle = {
  id: string;
  category: HelpCategory;
  title: string;
  summary: string;
  sections: Array<{ heading: string; paragraphs?: string[]; bullets?: string[] }>;
};

export const helpCategories: Array<"All" | HelpCategory> = ["All", "Getting started", "Collection", "Values", "Selling", "Account", "FAQ", "Advice", "Troubleshooting", "Glossary"];

export const helpArticles: HelpArticle[] = [
  { id: "welcome", category: "Getting started", title: "Welcome to CardPilot", summary: "A quick overview of the complete CardPilot workflow.", sections: [
    { heading: "The basic workflow", bullets: ["Photograph or upload a card.", "Review the identification and correct anything uncertain.", "Save the card to My Collection.", "Review Low, Median, and High value evidence and confirm a value.", "Optionally connect eBay, prepare a listing, and review every detail before publishing.", "Monitor active listings, compare exact-card buyer totals, and synchronize completed sales."] },
    { heading: "You stay in control", paragraphs: ["CardPilot provides evidence and recommendations. Identification, saved values, listing publication, price changes, and account actions remain reviewable by the collector."] },
  ] },
  { id: "first-card", category: "Getting started", title: "Add your first card", summary: "Photograph, identify, review, and save a card.", sections: [
    { heading: "Take a useful photo", bullets: ["Use the front photo first.", "Keep the full card visible with limited glare.", "Add the back only when it contains useful identity or grading evidence."] },
    { heading: "Review before saving", paragraphs: ["Check the player or character, year, set, card number, parallel, condition, grading, autograph, memorabilia, and serial-number details. Correct uncertain fields before adding the card."] },
  ] },
  { id: "getting-started-checklist", category: "Getting started", title: "Getting Started checklist", summary: "Use the dashboard checklist without blocking normal work.", sections: [
    { heading: "How it works", paragraphs: ["CardPilot completes tasks it can recognize automatically. Tasks such as reviewing cost assumptions can be marked complete by you. Collapse or dismiss the checklist at any time and restore it from Help."] },
  ] },
  { id: "collection", category: "Collection", title: "Manage My Collection", summary: "Search, filter, edit, value, list, and organize saved cards.", sections: [
    { heading: "Collection controls", bullets: ["Search confirmed card details.", "Filter by category, special features, listing status, value status, or stale pricing.", "Sort by date, title, or saved value.", "Expand a card for editing, pricing evidence, valuation, listing, and removal actions."] },
    { heading: "Saved details", paragraphs: ["Editing collection details updates CardPilot's record. It does not silently revise a live eBay listing unless a separate eBay action is reviewed and confirmed."] },
  ] },
  { id: "card-values", category: "Values", title: "Understand estimated card values", summary: "Low, Median, High, confidence, and market evidence explained.", sections: [
    { heading: "The three estimates", bullets: ["Low represents the lower compatible market range.", "Median is CardPilot's balanced market recommendation.", "High represents the upper compatible market range."] },
    { heading: "Evidence and confidence", paragraphs: ["CardPilot combines compatible completed sales and active listings when available. Confidence reflects the quality, agreement, and quantity of that evidence—not a guarantee of the final selling price."] },
  ] },
  { id: "value-strategies", category: "Values", title: "Sell faster, Balanced, and Maximum value", summary: "Choose a default and override it for an individual card.", sections: [
    { heading: "Choosing a goal", bullets: ["Sell faster targets the lower active-market position and may reduce waiting time.", "Balanced uses the market midpoint recommendation.", "Maximum value uses the upper compatible range and may take longer to sell."] },
    { heading: "Defaults and overrides", paragraphs: ["Your Account setting opens automatically for new estimates. Changing the goal inside one card changes the proposed value for that card without changing your account default."] },
  ] },
  { id: "saved-vs-listing", category: "Values", title: "Saved value versus eBay listing price", summary: "Why the collection value and live asking price can differ.", sections: [
    { heading: "Two different purposes", paragraphs: ["A saved value records the collector-confirmed value in CardPilot. The eBay listing price is the current live asking price. CardPilot synchronizes a saved value when a live listing price is revised through supported workflows, but manual adjustments and timing can still create differences that should be reviewed."] },
  ] },
  { id: "batch-scan", category: "Getting started", title: "Scan multiple cards", summary: "Use batch scanning when several cards need identification.", sections: [
    { heading: "Batch workflow", paragraphs: ["Add the card photos, let CardPilot process the queue, and review each result before it enters the collection. Cards remain individually correctable even when they were captured together."] },
    { heading: "Best results", bullets: ["Keep one clearly separated card in each detected region.", "Review uncertain results rather than accepting the full group automatically.", "Use an individual scan for cards with glare, unusual framing, or difficult parallels."] },
  ] },
  { id: "pricing-evidence", category: "Values", title: "Review and refine pricing evidence", summary: "Inspect active listings, completed sales, variants, and exclusions.", sections: [
    { heading: "Evidence review", paragraphs: ["Open pricing evidence from an expanded collection card. Exact matches carry the most weight. Broader and variant-adjusted evidence remains labeled so you can judge how closely it represents the saved card."] },
    { heading: "Exclude a poor comparison", paragraphs: ["If a comparison is a different card, grade, parallel, or condition, exclude it and recalculate. Exclusions affect the current pricing review and CardPilot can learn from confirmed comparison corrections where supported."] },
  ] },
  { id: "refresh-values", category: "Values", title: "Refresh values individually or in bulk", summary: "Keep saved estimates current without losing collector adjustments.", sections: [
    { heading: "Refresh choices", bullets: ["Refresh one card when you are already reviewing it.", "Use Refresh all values for an occasional collection-wide update.", "Pricing out of date identifies values whose evidence should be revisited.", "Collector-adjusted values are protected from automatic overwrite rules."] },
  ] },  { id: "connect-ebay", category: "Selling", title: "Connect eBay and review seller policies", summary: "Connect safely and configure reusable selling choices.", sections: [
    { heading: "Before publishing", bullets: ["Connect the intended eBay seller account.", "Confirm shipping, payment, return, and merchant-location policies.", "Review transaction-fee, mailing-cost, buyer-tax, and promotion assumptions.", "Use Do not sell at a loss when you want CardPilot to block estimated negative proceeds."] },
  ] },
  { id: "listing", category: "Selling", title: "Create and publish a listing", summary: "Prepare individual or batch listings while retaining final review.", sections: [
    { heading: "Individual listings", paragraphs: ["Open the card's eBay action, select a pricing goal, review the title, category, condition, item specifics, photos, price, shipping, promotion, and approximate proceeds, then publish when ready."] },
    { heading: "Batch listings", paragraphs: ["Batch listing shares policies and common choices while keeping every card's title, price, category, condition, and images individually reviewable before publication."] },
  ] },
  { id: "price-comparison", category: "Selling", title: "Compare active listing prices", summary: "Understand exact-card comparisons and buyer totals.", sections: [
    { heading: "Buyer total", paragraphs: ["CardPilot compares the amount a buyer pays: item price plus buyer-paid shipping. The normal positioning target is 5¢ below the lowest compatible exact-card buyer total."] },
    { heading: "Choose the workload", bullets: ["Compare selected listings for the smallest review.", "Use priority or attention-based groups when available.", "Compare all listings for an occasional full review.", "No eBay price changes until you explicitly apply selected results."] },
  ] },
  { id: "profitability", category: "Selling", title: "Profit, fees, promotions, and market-minimum warnings", summary: "How CardPilot estimates proceeds and flags an unprofitable market floor.", sections: [
    { heading: "What is included", bullets: ["Configured transaction percentage and fixed fee.", "Estimated fee effect from buyer sales tax.", "Applicable promoted-listing rate.", "Configured mailing or fulfillment cost."] },
    { heading: "Red market warning", paragraphs: ["Market Minimum is Unprofitable Currently for this Card appears after a delivered-price comparison when 5¢ below the lowest exact match would leave less than $0 under your configured assumptions. It also identifies unprofitable pricing goals."] },
    { heading: "What may still be excluded", paragraphs: ["Unless separately recorded, acquisition cost, supplies, returns, insurance, income taxes, and other business expenses may not be included. Treat the figure as an estimate, not accounting advice."] },
  ] },
  { id: "listing-dashboard", category: "Selling", title: "Listings, drafts, and listing health", summary: "Review drafts, active listings, ended listings, traffic, and suggested actions.", sections: [
    { heading: "Listing dashboard", bullets: ["Drafts are prepared but not live.", "Active listings can show price, views, watchers, impressions, and health signals when eBay supplies them.", "Ended and sold listings remain available for lifecycle review.", "Suggested listing improvements should be reviewed before publication or revision."] },
    { heading: "Traffic signals", paragraphs: ["Low impressions point to discoverability or demand. Impressions with weak click-through point to the title, main image, price, or card appeal. Views without watchers can indicate price or buyer-confidence friction."] },
  ] },
  { id: "automation", category: "Selling", title: "Autopilot, repricing, and safety limits", summary: "Understand what automated modes can do and how limits protect listings.", sections: [
    { heading: "Preview versus Autopilot", paragraphs: ["Preview prepares recommendations without publishing. Autopilot operates only within the confidence, approval, minimum-price, repricing-floor, and other safeguards saved in Account settings."] },
    { heading: "Review the boundaries", bullets: ["Minimum confidence and approval threshold.", "Minimum price and repricing floor.", "Days before repricing.", "Loss-safety assumptions.", "Listing-health thresholds and automatic optimization setting."] },
  ] },  { id: "sold-cards", category: "Selling", title: "Sold cards, revenue, and estimated profit", summary: "Synchronize completed sales and understand dashboard totals.", sections: [
    { heading: "After a sale", paragraphs: ["Synchronize eBay sales so CardPilot can move the card to Sold Cards and record the returned sale amount and date. Revenue is the sale amount; estimated profit subtracts the configured illustrative fees and applicable promotion rate."] },
  ] },
  { id: "account-settings", category: "Account", title: "Account settings and defaults", summary: "Control valuation, automation, pricing, promotion, and safety defaults.", sections: [
    { heading: "Review these settings", bullets: ["Default estimated-card-value goal.", "Default eBay selling goal.", "Automatic lower-value saving limit.", "Repricing and listing-health thresholds.", "Fee, promotion, tax, mailing, and loss-safety assumptions."] },
  ] },
  { id: "backup", category: "Account", title: "Download a collection backup", summary: "Save card details and available private images.", sections: [
    { heading: "Create a backup", paragraphs: ["Open Account, find Personal backup, and choose Download collection backup. The JSON file includes card details and available private images. If an image cannot be retrieved, the backup still downloads and identifies the affected card."] },
  ] },
  { id: "faq", category: "FAQ", title: "Frequently asked questions", summary: "Quick answers to common CardPilot questions.", sections: [
    { heading: "Why did CardPilot not find an exact comparison?", paragraphs: ["The exact card may have no compatible active or completed records, or visible details may conflict. Review year, set, card number, parallel, grading, autograph, memorabilia, and serial details."] },
    { heading: "Why can comparing all listings take a while?", paragraphs: ["Each card requires its own exact-card market search, compatibility checks, and sometimes image verification. Compare selected or priority listings for a faster review."] },
    { heading: "Will CardPilot change eBay without asking?", paragraphs: ["Manual workflows require confirmation before publication or selected price changes. Automation follows the limits and safety rules configured in Account settings."] },
    { heading: "Why are views or sales delayed?", paragraphs: ["Marketplace traffic and order data may be reported or synchronized after a delay. Refresh or synchronize again later before assuming no activity occurred."] },
  ] },
  { id: "selling-advice", category: "Advice", title: "Practical listing advice", summary: "Use market signals without reacting to every small change.", sections: [
    { heading: "A sensible review rhythm", bullets: ["Give a new listing time to collect impressions before changing it repeatedly.", "Prioritize no-view, stale-price, recently active, or watcher-without-sale listings.", "Inspect exact matches before accepting a major price change.", "Use Maximum value when scarcity and demand justify patience.", "Use Sell faster when turnover matters more than extracting the upper range."] },
  ] },
  { id: "identification-advice", category: "Advice", title: "Improve identification and pricing evidence", summary: "Small details that materially improve matching.", sections: [
    { heading: "Details that matter most", bullets: ["Card number and set or product.", "Year and player or Pokémon character.", "Parallel, finish, insert, and image variation.", "Grading company and grade.", "Serial numbering, autograph, memorabilia, and rookie status."] },
  ] },
  { id: "troubleshooting", category: "Troubleshooting", title: "Troubleshooting common problems", summary: "What to try when identification, pricing, eBay, or backups fail.", sections: [
    { heading: "First steps", bullets: ["Retry once after checking the internet connection.", "Confirm the correct eBay account is connected.", "Review the saved card identity for missing or conflicting details.", "Refresh the page and repeat the smallest affected action.", "If a backup reports unavailable images, keep the downloaded file and review its warnings section."] },
    { heading: "When asking for support", paragraphs: ["Include the card title, the action you attempted, the visible message, and whether the problem affects one card or the full collection. Never include passwords or private access tokens."] },
  ] },
  { id: "glossary", category: "Glossary", title: "CardPilot glossary", summary: "Definitions for important valuation and marketplace terms.", sections: [
    { heading: "Common terms", bullets: ["Active listing: a card currently offered for sale.", "Buyer total: item price plus buyer-paid shipping.", "Completed sale: a finished marketplace transaction used as evidence.", "Confidence: CardPilot's assessment of evidence quality and agreement.", "Exact match: a comparison compatible with the saved card's important identity and condition details.", "Market minimum: 5¢ below the lowest compatible exact-card buyer total in the comparison workflow.", "Promotion rate: the percentage potentially charged when an eligible promoted interaction receives sale attribution.", "Saved value: the collector-confirmed CardPilot value, which is distinct from a live asking price."] },
  ] },
];
