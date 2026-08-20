function cents(value) { return Number.isFinite(Number(value)) ? Number(value) : 0; }

export class SupabaseAdminOverview {
  constructor({ client, identificationFeedback = null, marketFeedback = null, providerUsage = null }) {
    this.client = client;
    this.identificationFeedback = identificationFeedback;
    this.marketFeedback = marketFeedback;
    this.providerUsage = providerUsage;
  }

  async load() {
    const users = [];
    let page = 1;
    while (true) {
      const { data, error } = await this.client.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) throw error;
      users.push(...(data?.users ?? []));
      if ((data?.users?.length ?? 0) < 1000) break;
      page += 1;
    }
    const [{ data: cards, error: cardError }, { data: drafts, error: draftError }, { data: sales, error: salesError }, fieldFeedback, marketFeedback, providerUsage] = await Promise.all([
      this.client.from("collection_cards").select("user_id"),
      this.client.from("ebay_listing_drafts").select("user_id,status,draft"),
      this.client.from("ebay_order_sales").select("user_id,amount_cents,currency"),
      this.identificationFeedback?.summary() ?? [],
      this.marketFeedback?.summary() ?? [],
      this.providerUsage?.summary() ?? [],
    ]);
    if (cardError || draftError || salesError) throw cardError ?? draftError ?? salesError;
    const rows = users.map((user) => {
      const userDrafts = (drafts ?? []).filter((draft) => draft.user_id === user.id);
      const userSales = (sales ?? []).filter((sale) => sale.user_id === user.id);
      return {
        userId: user.id, email: user.email ?? null,
        createdAt: user.created_at, lastSignInAt: user.last_sign_in_at ?? null,
        cardCount: (cards ?? []).filter((card) => card.user_id === user.id).length,
        activeListingCount: userDrafts.filter((draft) => draft.status === "published").length,
        activeListingValueCents: userDrafts.filter((draft) => draft.status === "published").reduce((sum, draft) => sum + cents(draft.draft?.priceCents), 0),
        soldCount: userSales.length,
        soldGrossCents: userSales.reduce((sum, sale) => sum + cents(sale.amount_cents), 0),
      };
    });
    return {
      users: rows,
      totals: {
        users: rows.length, cards: rows.reduce((sum, row) => sum + row.cardCount, 0),
        activeListings: rows.reduce((sum, row) => sum + row.activeListingCount, 0),
        activeListingValueCents: rows.reduce((sum, row) => sum + row.activeListingValueCents, 0),
        soldCount: rows.reduce((sum, row) => sum + row.soldCount, 0),
        soldGrossCents: rows.reduce((sum, row) => sum + row.soldGrossCents, 0),
        currency: "USD",
      },
      fieldFeedback,
      marketFeedback,
      providerUsage,
    };
  }
}
