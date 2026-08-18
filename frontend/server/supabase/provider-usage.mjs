const providerLabels = {
  openai: "OpenAI identification",
  google_vision: "Google Cloud Vision",
  the_card_api: "The Card API",
  ebay: "eBay APIs",
  pokemon_tcg: "Pokémon TCG API",
  render: "Render hosting",
  supabase: "Supabase accounts and storage",
};

export function aggregateProviderUsage(rows, monthlyCosts = {}) {
  const summaries = new Map();
  for (const row of rows ?? []) {
    const key = `${row.provider}:${row.operation}`;
    const current = summaries.get(key) ?? {
      provider: row.provider,
      providerLabel: providerLabels[row.provider] ?? row.provider,
      operation: row.operation,
      requests: 0,
      successfulRequests: 0,
      durationTotal: 0,
      returnedCount: 0,
      usefulCount: 0,
    };
    current.requests += 1;
    if (row.success) current.successfulRequests += 1;
    current.durationTotal += Number(row.duration_ms) || 0;
    current.returnedCount += Number(row.returned_count) || 0;
    current.usefulCount += Number(row.useful_count) || 0;
    summaries.set(key, current);
  }
  const providerOperationCounts = new Map();
  for (const summary of summaries.values()) {
    providerOperationCounts.set(
      summary.provider,
      (providerOperationCounts.get(summary.provider) ?? 0) + 1,
    );
  }
  for (const provider of Object.keys(monthlyCosts)) {
    if ([...summaries.values()].some((summary) => summary.provider === provider)) continue;
    summaries.set(`${provider}:no_usage`, {
      provider,
      providerLabel: providerLabels[provider] ?? provider,
      operation: new Set(["render", "supabase"]).has(provider)
        ? "Infrastructure cost"
        : "No usage recorded",
      requests: 0,
      successfulRequests: 0,
      durationTotal: 0,
      returnedCount: 0,
      usefulCount: 0,
    });
    providerOperationCounts.set(provider, 1);
  }
  return [...summaries.values()].map((summary) => {
    const configuredMonthlyCostCents = Number(monthlyCosts[summary.provider]) || 0;
    const allocatedMonthlyCostCents = Math.round(
      configuredMonthlyCostCents / (providerOperationCounts.get(summary.provider) ?? 1),
    );
    const usefulRate = summary.returnedCount
      ? summary.usefulCount / summary.returnedCount
      : 0;
    return {
      ...summary,
      successRate: summary.requests ? summary.successfulRequests / summary.requests : 0,
      averageDurationMs: summary.requests ? Math.round(summary.durationTotal / summary.requests) : 0,
      usefulRate,
      configuredMonthlyCostCents,
      estimatedCostPerUsefulResultCents: summary.usefulCount
        ? Math.round(allocatedMonthlyCostCents / summary.usefulCount)
        : null,
      assessment: summary.requests < 10
        ? "collecting_data"
        : usefulRate >= 0.5
          ? "strong"
          : usefulRate >= 0.2
            ? "watch"
            : "weak",
    };
  }).sort((left, right) =>
    right.configuredMonthlyCostCents - left.configuredMonthlyCostCents ||
    right.requests - left.requests,
  );
}

export class SupabaseProviderUsage {
  constructor({ client, monthlyCosts = {} }) {
    this.client = client;
    this.monthlyCosts = monthlyCosts;
  }

  async record(event) {
    const { error } = await this.client.from("provider_usage_events").insert({
      provider: event.provider,
      operation: event.operation,
      success: event.success,
      duration_ms: Math.max(0, Math.round(event.durationMs ?? 0)),
      returned_count: Math.max(0, Math.round(event.returnedCount ?? 0)),
      useful_count: Math.max(0, Math.round(event.usefulCount ?? 0)),
    });
    if (error && error.code !== "42P01" && error.code !== "PGRST205") throw error;
  }

  async summary() {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await this.client
      .from("provider_usage_events")
      .select("provider,operation,success,duration_ms,returned_count,useful_count")
      .gte("created_at", since)
      .limit(10_000);
    if (error) {
      if (error.code === "42P01" || error.code === "PGRST205") return [];
      throw error;
    }
    return aggregateProviderUsage(data, this.monthlyCosts);
  }
}
