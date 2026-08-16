import { useEffect, useState } from "react";

type Overview = {
  totals: { users: number; cards: number; activeListings: number; activeListingValueCents: number; soldCount: number; soldGrossCents: number; currency: string };
  users: { userId: string; email: string | null; createdAt: string; lastSignInAt: string | null; cardCount: number; activeListingCount: number; activeListingValueCents: number; soldCount: number; soldGrossCents: number }[];
};
const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

export function AdminDashboard() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void fetch("/api/admin/overview").then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error); setOverview(body); }).catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load the dashboard.")); }, []);
  return <section className="collection-section">
    <div className="collection-heading"><div><span>Private administration</span><h1>CardPilot activity</h1><p>Account-level totals only. Customer card images and private listing details are not displayed here.</p></div></div>
    {error && <div className="error-banner" role="alert">{error}</div>}
    {!overview && !error && <div className="collection-empty"><span className="spinner" /> Loading account activity...</div>}
    {overview && <>
      <div className="collection-summary"><div><strong>{overview.totals.users}</strong><span>Users</span></div><div><strong>{overview.totals.cards}</strong><span>Cards saved</span></div><div><strong>{overview.totals.activeListings}</strong><span>Active listings</span></div><div><strong>{money(overview.totals.activeListingValueCents)}</strong><span>Currently for sale</span></div><div><strong>{overview.totals.soldCount}</strong><span>Cards sold</span></div><div><strong>{money(overview.totals.soldGrossCents)}</strong><span>Gross sold value</span></div></div>
      <div className="ebay-queue-list">{overview.users.map((user) => <article key={user.userId}><div><h3>{user.email ?? "Email unavailable"}</h3><small>Joined {new Date(user.createdAt).toLocaleDateString()}{user.lastSignInAt ? ` · Last active ${new Date(user.lastSignInAt).toLocaleDateString()}` : ""}</small><p>{user.cardCount} cards · {user.activeListingCount} active ({money(user.activeListingValueCents)}) · {user.soldCount} sold ({money(user.soldGrossCents)})</p></div></article>)}</div>
      <p className="valuation-disclaimer">Sales figures are gross eBay line-item amounts before fees, taxes, shipping costs, refunds, and other expenses.</p>
    </>}
  </section>;
}
