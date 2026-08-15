export function PublicPage({ page }: { page: "about" | "privacy" }) {
  const isPrivacy = page === "privacy";
  return (
    <div className="public-page-shell">
      <header className="public-page-header">
        <a href="/" aria-label="CardPilot home">
          <img src="/cardpilot-logo.png" alt="" />
          <span>CardPilot</span>
        </a>
        <nav aria-label="Public information">
          <a href="/about">About</a>
          <a href="/privacy">Privacy</a>
          <a href="/">Open CardPilot</a>
        </nav>
      </header>
      <main className="public-page-content">
        <span className="account-eyebrow">{isPrivacy ? "Privacy and trust" : "About CardPilot"}</span>
        <h1>{isPrivacy ? "CardPilot Privacy Policy" : "Know what’s in the sleeve."}</h1>
        <p className="public-page-updated">
          {isPrivacy ? "Effective August 14, 2026" : "Evidence-assisted collection, valuation and selling tools for trading-card collectors."}
        </p>
        {isPrivacy ? <PrivacyContent /> : <AboutContent />}
      </main>
      <footer><span>CardPilot</span><span>Collector control comes first.</span></footer>
    </div>
  );
}

function AboutContent() {
  return (
    <div className="public-page-sections">
      <section><h2>What CardPilot does</h2><p>CardPilot helps collectors identify sports and Pokémon cards from photographs, organize a private collection, compare market evidence, prepare value recommendations and create reviewable eBay listing drafts.</p></section>
      <section><h2>Evidence before certainty</h2><p>Identification and valuation are assisted estimates, not guarantees or appraisals. CardPilot shows supporting information and lets collectors correct details, remove unsuitable comparisons and decide what should be saved or published.</p></section>
      <section><h2>Safe selling workflow</h2><p>Connecting eBay does not publish a card. A collector must review a listing draft and separately confirm publication. Sandbox testing remains isolated from the real eBay marketplace.</p></section>
      <section><h2>Current stage</h2><p>CardPilot is under active private development. Features, providers and availability can change as accuracy, security and collector workflows are tested.</p></section>
    </div>
  );
}

function PrivacyContent() {
  return (
    <div className="public-page-sections">
      <section><h2>Information CardPilot stores</h2><p>CardPilot may store an account email address, private card photographs, confirmed card details, collection records, pricing preferences, valuation records, eBay listing drafts and the status of listings created through CardPilot.</p></section>
      <section><h2>How information is used</h2><p>This information is used to authenticate the collector, identify and organize cards, prepare market comparisons and valuations, synchronize a private collection, recover account data and perform eBay actions the collector explicitly requests.</p></section>
      <section><h2>Service providers</h2><p>CardPilot uses service providers including Supabase for accounts and private storage, OpenAI for image-assisted identification, eBay for market searches and authorized selling, Render for application hosting, and specialized catalog or market-data providers when enabled. Only information needed for the requested feature is sent to a provider.</p></section>
      <section><h2>eBay authorization</h2><p>CardPilot never asks for or stores an eBay password. eBay sign-in occurs on eBay. CardPilot stores the resulting eBay refresh token in encrypted form on the server so it can perform seller-authorized actions. A collector can disconnect eBay, and listing publication, revision and ending require deliberate actions.</p></section>
      <section><h2>Security and retention</h2><p>Application secrets and provider tokens are kept out of browser code. Collection images are stored privately and served through authenticated or time-limited links. Account deletion removes the account’s CardPilot collection records and private images; third-party marketplaces may retain records under their own policies.</p></section>
      <section><h2>Collector choices</h2><p>Collectors can edit card details, remove cards, clear saved values, download a personal backup, disconnect eBay and delete their CardPilot account. Provider account permissions may also be revoked through the provider’s own account settings.</p></section>
      <section><h2>Children and financial decisions</h2><p>CardPilot is not directed to children under 13. Pricing information is an estimate and should not be treated as financial, investment or professional appraisal advice.</p></section>
      <section><h2>Questions and updates</h2><p>Privacy questions may be directed through the developer contact information presented with the CardPilot eBay authorization screen. Material policy updates will be posted on this page with a revised effective date.</p></section>
    </div>
  );
}
