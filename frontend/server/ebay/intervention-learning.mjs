function number(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function outcomeImproved(entry) {
  const latest = [...(entry.outcomes ?? [])].sort((left, right) => right.days - left.days)[0];
  if (!latest) return null;
  const before = entry.before ?? {};
  const after = latest.metrics ?? {};
  if (after.status === "sold") return true;
  const beforeWatchers = number(before.watcherCount) ?? 0;
  const afterWatchers = number(after.watcherCount) ?? 0;
  if (afterWatchers > beforeWatchers) return true;
  const beforeCtr = number(before.clickThroughRate);
  const afterCtr = number(after.clickThroughRate);
  if (beforeCtr !== null && afterCtr !== null && afterCtr > beforeCtr) return true;
  const beforeViews = number(before.viewCount) ?? 0;
  const afterViews = number(after.viewCount) ?? 0;
  return afterViews > beforeViews;
}

function summarize(entries, minimumExamples) {
  const byType = new Map();
  for (const entry of entries) {
    const improved = outcomeImproved(entry);
    if (improved === null) continue;
    const current = byType.get(entry.type) ?? { type: entry.type, measured: 0, improved: 0 };
    current.measured += 1;
    if (improved) current.improved += 1;
    byType.set(entry.type, current);
  }
  return [...byType.values()].map((summary) => ({
    ...summary,
    improvementRate: summary.improved / summary.measured,
    ready: summary.measured >= minimumExamples,
  }));
}

export function aggregateInterventionLearning(rows, userId) {
  const histories = rows.flatMap((row) => (row.draft?.interventionHistory ?? []).map((entry) => ({ ...entry, userId: row.user_id })));
  return {
    personal: summarize(histories.filter((entry) => entry.userId === userId), 3),
    community: summarize(histories, 10),
  };
}
