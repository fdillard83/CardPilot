const steps = [
  { title: "Welcome to CardPilot", label: "Start here", body: "This optional guide introduces identification, values, collection management, eBay selling, price comparisons, and backups. It never blocks normal use.", action: null },
  { title: "Identify your first card", label: "Step 1", body: "Start with a clear front photo. Review the proposed identity and add a back photo only when it can materially improve the result.", action: "scan" as const, actionLabel: "Open Identify" },
  { title: "Review before saving", label: "Step 2", body: "Confirm the year, player or character, set, card number, parallel, grading, autograph, memorabilia, and serial details before adding the card.", action: "scan" as const, actionLabel: "Review Identify" },
  { title: "Understand card value", label: "Step 3", body: "Low, Median, and High show the compatible market range. Choose Sell faster, Balanced, or Maximum value, and override the account default whenever a card needs a different goal.", action: "collection" as const, actionLabel: "Open My Collection" },
  { title: "Manage your collection", label: "Step 4", body: "Search, filter, edit, value, and expand cards from My Collection. Pricing evidence and live listing actions remain reviewable.", action: "collection" as const, actionLabel: "Open My Collection" },
  { title: "Set up eBay safely", label: "Step 5", body: "Connecting eBay is optional. Before publishing, review seller policies, valuation and selling defaults, transaction fees, mailing cost, promotion, and loss-safety settings.", action: "account" as const, actionLabel: "Open Account" },
  { title: "Compare and monitor listings", label: "Step 6", body: "Compare buyer totals for exact cards, inspect major changes, and apply only selected results. Red warnings identify market positions that would leave estimated profit below $0.", action: "collection" as const, actionLabel: "Open My Collection" },
  { title: "Protect and keep learning", label: "Finish", body: "Download a personal collection backup, use the dashboard checklist, and return to the searchable Help Center whenever a feature is unfamiliar.", action: "account" as const, actionLabel: "Open Account" },
];

export function OnboardingGuide({ step, onStepChange, onSaveForLater, onSkip, onFinish, onNavigate }: {
  step: number;
  onStepChange: (step: number) => void;
  onSaveForLater: () => void;
  onSkip: () => void;
  onFinish: () => void;
  onNavigate: (view: "scan" | "collection" | "account") => void;
}) {
  const current = steps[Math.min(step, steps.length - 1)];
  const last = step >= steps.length - 1;
  return <div className="onboarding-backdrop" role="presentation">
    <section className="onboarding-guide" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      <header><div><span>{current.label}</span><h2 id="onboarding-title">{current.title}</h2></div><button type="button" onClick={onSaveForLater}>Save for later</button></header>
      <div className="onboarding-progress" aria-label={`Step ${step + 1} of ${steps.length}`}><progress value={step + 1} max={steps.length} /><span>{step + 1} of {steps.length}</span></div>
      <p>{current.body}</p>
      {current.action && <button className="onboarding-section-link" type="button" onClick={() => { onNavigate(current.action); onSaveForLater(); }}>{current.actionLabel}</button>}
      <footer><button type="button" disabled={step === 0} onClick={() => onStepChange(step - 1)}>Back</button><button type="button" onClick={onSkip}>Skip / opt out</button><button className="primary-action" type="button" onClick={() => last ? onFinish() : onStepChange(step + 1)}>{last ? "Finish guide" : "Next"}</button></footer>
      <small>You can restart this guide at any time from Help.</small>
    </section>
  </div>;
}
