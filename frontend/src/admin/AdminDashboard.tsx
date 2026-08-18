import { useCallback, useEffect, useState } from "react";

type Overview = {
  totals: { users: number; cards: number; activeListings: number; activeListingValueCents: number; soldCount: number; soldGrossCents: number; currency: string };
  users: { userId: string; email: string | null; createdAt: string; lastSignInAt: string | null; cardCount: number; activeListingCount: number; activeListingValueCents: number; soldCount: number; soldGrossCents: number }[];
  fieldFeedback: { field: string; reviewed: number; kept: number; changed: number; changeRate: number; averageOriginalConfidence: number }[];
  providerUsage: { provider: string; providerLabel: string; operation: string; requests: number; successfulRequests: number; successRate: number; averageDurationMs: number; returnedCount: number; usefulCount: number; usefulRate: number; configuredMonthlyCostCents: number; estimatedCostPerUsefulResultCents: number | null; assessment: "collecting_data" | "strong" | "watch" | "weak" }[];
};
const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

export function AdminDashboard() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);

  const loadOverview = useCallback(async (refresh = false) => {
    if (refresh) setIsRefreshing(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/overview", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setOverview(body);
      setRefreshedAt(new Date());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load the dashboard.");
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let current = true;
    void fetch("/api/admin/overview", { cache: "no-store" }).then(async (response) => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      if (current) { setOverview(body); setRefreshedAt(new Date()); }
    }).catch((caught) => {
      if (current) setError(caught instanceof Error ? caught.message : "Could not load the dashboard.");
    });
    return () => { current = false; };
  }, []);
  return <section className="collection-section">
    <div className="collection-heading"><div><span>Private administration</span><h1>CardPilot activity</h1><p>Account-level totals only. Customer card images and private listing details are not displayed here.</p>{refreshedAt && <small>Updated {refreshedAt.toLocaleString()}</small>}</div><button type="button" disabled={isRefreshing} onClick={() => void loadOverview(true)}>{isRefreshing ? "Refreshing..." : "Refresh dashboard"}</button></div>
    {error && <div className="error-banner" role="alert">{error}</div>}
    {!overview && !error && <div className="collection-empty"><span className="spinner" /> Loading account activity...</div>}
    {overview && <>
      <div className="collection-summary"><div><strong>{overview.totals.users}</strong><span>Users</span></div><div><strong>{overview.totals.cards}</strong><span>Cards saved</span></div><div><strong>{overview.totals.activeListings}</strong><span>Active listings</span></div><div><strong>{money(overview.totals.activeListingValueCents)}</strong><span>Currently for sale</span></div><div><strong>{overview.totals.soldCount}</strong><span>Cards sold</span></div><div><strong>{money(overview.totals.soldGrossCents)}</strong><span>Gross sold value</span></div></div>
      <div className="ebay-queue-list">{overview.users.map((user) => <article key={user.userId}><div><h3>{user.email ?? "Email unavailable"}</h3><small>Joined {new Date(user.createdAt).toLocaleDateString()}{user.lastSignInAt ? ` · Last active ${new Date(user.lastSignInAt).toLocaleDateString()}` : ""}</small><p>{user.cardCount} cards · {user.activeListingCount} active ({money(user.activeListingValueCents)}) · {user.soldCount} sold ({money(user.soldGrossCents)})</p></div></article>)}</div>
      <section className="admin-feedback-section">
        <div><span>Identification feedback</span><h2>Fields users change most</h2><p>Aggregate outcomes from confirmed cards. No card values or photographs are shown.</p></div>
        {overview.fieldFeedback.length ? (
          <div className="admin-feedback-table" role="table" aria-label="Identification field feedback">
            <div className="admin-feedback-row admin-feedback-header" role="row"><span>Field</span><span>Reviewed</span><span>Kept</span><span>Changed</span><span>Change rate</span><span>Avg. confidence</span></div>
            {overview.fieldFeedback.map((field) => <div className="admin-feedback-row" role="row" key={field.field}><strong>{field.field}</strong><span>{field.reviewed}</span><span>{field.kept}</span><span>{field.changed}</span><span>{Math.round(field.changeRate * 100)}%</span><span>{Math.round(field.averageOriginalConfidence * 100)}%</span></div>)}
          </div>
        ) : <p className="valuation-disclaimer">Field feedback will appear after users confirm cards with this update.</p>}
      </section>
      <section className="admin-feedback-section">
        <div><span>Paid-service value</span><h2>Are providers earning their cost?</h2><p>Rolling 30-day aggregate. “Useful” means a result survived CardPilot’s matching thresholds and contributed usable evidence—not merely that the provider returned something.</p></div>
        <div className="admin-provider-grid">
          {overview.providerUsage.map((provider) => <article key={`${provider.provider}-${provider.operation}`}>
            <div className="admin-provider-heading"><div><strong>{provider.providerLabel}</strong><small>{provider.operation.replaceAll("_", " ")}</small></div><span className={`admin-provider-assessment assessment-${provider.assessment}`}>{provider.assessment === "collecting_data" ? "Collecting data" : provider.assessment}</span></div>
            <dl><div><dt>Requests</dt><dd>{provider.requests}</dd></div><div><dt>Success</dt><dd>{Math.round(provider.successRate * 100)}%</dd></div><div><dt>Avg. time</dt><dd>{(provider.averageDurationMs / 1000).toFixed(1)}s</dd></div><div><dt>Returned</dt><dd>{provider.returnedCount}</dd></div><div><dt>Useful</dt><dd>{provider.usefulCount} ({Math.round(provider.usefulRate * 100)}%)</dd></div><div><dt>Monthly cost</dt><dd>{money(provider.configuredMonthlyCostCents)}</dd></div><div><dt>Cost / useful</dt><dd>{provider.estimatedCostPerUsefulResultCents === null ? "Not enough data" : money(provider.estimatedCostPerUsefulResultCents)}</dd></div></dl>
          </article>)}
        </div>
        <p className="valuation-disclaimer">Add each current monthly amount in Render using the optional *_MONTHLY_COST_CENTS variables. Zero means the cost has not been entered or the service is free. Render and Supabase appear as cost inventory; usefulness scoring applies to data providers after a meaningful request sample.</p>
      </section>
      <p className="valuation-disclaimer">Sales figures are gross eBay line-item amounts before fees, taxes, shipping costs, refunds, and other expenses.</p>
    </>}
  </section>;
}
