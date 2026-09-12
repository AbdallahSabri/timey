/**
 * The first few rows of an already-aggregated breakdown, with the rest
 * collapsed into one "Other".
 *
 * A dashboard card has room for about six lines. A company with forty projects
 * would otherwise render forty bars, none of them legible, and the answer to
 * "where did the month go" is the top handful and a sense of how much is
 * elsewhere.
 *
 * **Not aggregation in §9.1's sense**, for the reason `day-series.ts` and
 * `report-expected.ts` both set out: the rows arriving here are sums Postgres
 * computed with a `GROUP BY`, and adding a few of those buckets together is the
 * same arithmetic `totalsOf` already does for a table footer — which §12.2
 * asks for explicitly. Nothing here reads a `time_entries` row.
 *
 * **The rows must arrive sorted largest-first, and they do**: every §9.3
 * function orders by `total_seconds desc` (`0007_reports.sql`). This does not
 * re-sort them, so the "top" it takes is the database's ordering and not a
 * second opinion about it — the same rule `report-expected.ts` follows.
 *
 * Pure: no React, no Supabase, no `next/*`.
 */

/** What this needs from a breakdown row. Callers pass their own wider shape. */
export type Breakdown = {
  key: string;
  label: string;
  /** True when `label` stands in for a name RLS hid, so the bar can be muted. */
  muted: boolean;
  totalSeconds: number;
};

/** The label the collapsed tail carries. Exported so a test cannot drift from it. */
export const OTHER_LABEL = "Other";

/**
 * `rows` truncated to `limit`, plus one `Other` row if anything was left over.
 *
 * **`Other` is only ever added when it stands for more than one row**, because
 * a single row relabelled "Other" hides a name for no gain — if the tail is one
 * project, that project is shown. So a seven-row breakdown with a limit of six
 * comes back as seven rows, not six plus an "Other" of one.
 *
 * The `Other` row is `muted`, so it is drawn as the absence of a label rather
 * than as a project called Other — the same treatment `report-rows.ts` gives a
 * name the caller could not read, and for a related reason: neither is a thing
 * you can click through to.
 *
 * A zero-total tail contributes no row at all: "Other: 0:00:00" is a line of
 * nothing.
 *
 * **`Other` can be the largest row in the result, and that is not a bug.** Ten
 * projects at roughly equal size give a tail that outweighs any single head
 * row, so a caller scaling bars against the largest value will draw the longest
 * bar at the bottom of the list. That is honest — the collapsed tail really is
 * bigger — but it makes "longest first" a false caption, so the two cards that
 * use this describe themselves as "the biggest few first, then everything else
 * together" instead.
 */
export function topNWithOther(
  rows: readonly Breakdown[],
  limit: number,
): Breakdown[] {
  if (limit < 1 || rows.length <= limit + 1) {
    return [...rows];
  }

  const head = rows.slice(0, limit);
  const tail = rows.slice(limit);
  const tailSeconds = tail.reduce((sum, row) => sum + row.totalSeconds, 0);

  if (tailSeconds === 0) {
    return head;
  }

  return [
    ...head,
    {
      key: "__other__",
      label: `${OTHER_LABEL} (${tail.length})`,
      muted: true,
      totalSeconds: tailSeconds,
    },
  ];
}
