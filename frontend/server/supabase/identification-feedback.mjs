export function aggregateFieldFeedback(rows) {
  const summaries = new Map();
  for (const row of rows ?? []) {
    const current = summaries.get(row.field_name) ?? {
      field: row.field_name,
      reviewed: 0,
      kept: 0,
      changed: 0,
      confidenceTotal: 0,
    };
    current.reviewed += 1;
    current.confidenceTotal += Number(row.original_confidence) || 0;
    if (row.was_changed) current.changed += 1;
    else current.kept += 1;
    summaries.set(row.field_name, current);
  }
  return [...summaries.values()]
    .map(({ confidenceTotal, ...summary }) => ({
      ...summary,
      changeRate: summary.reviewed ? summary.changed / summary.reviewed : 0,
      averageOriginalConfidence: summary.reviewed
        ? confidenceTotal / summary.reviewed
        : 0,
    }))
    .sort((left, right) =>
      right.changeRate - left.changeRate || right.reviewed - left.reviewed,
    );
}

export class SupabaseIdentificationFeedback {
  constructor({ client }) {
    this.client = client;
  }

  async record(userId, submission) {
    const rows = submission.fields.map((field) => ({
      user_id: userId,
      identification_id: submission.identificationId,
      field_name: field.field,
      was_changed: field.changed,
      original_confidence: field.originalConfidence,
      inference_source: field.inferenceSource,
      overall_confidence: submission.metadata.overallConfidence,
    }));
    const { error } = await this.client
      .from("identification_field_reviews")
      .upsert(rows, { onConflict: "user_id,identification_id,field_name" });
    if (error) throw error;
    return { fieldCount: rows.length };
  }

  async summary() {
    const rows = [];
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await this.client
        .from("identification_field_reviews")
        .select("field_name,was_changed,original_confidence")
        .range(from, from + pageSize - 1);
      if (error) {
        // Permit deployment before the accompanying migration is applied.
        if (error.code === "42P01" || error.code === "PGRST205") return [];
        throw error;
      }
      rows.push(...(data ?? []));
      if ((data?.length ?? 0) < pageSize) break;
    }
    return aggregateFieldFeedback(rows);
  }
}
