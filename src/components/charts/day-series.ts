/**
 * A continuous run of days from a report that only returns the days that
 * happened.
 *
 * `report_by_day` is a `GROUP BY` over `time_entries`, so a day nobody logged
 * against produces no row at all. A chart fed those rows directly draws a
 * fourteen-day week: the bars slide together and the axis lies about which day
 * each one is. So the gaps are filled with zeroes here, once, before anything
 * renders.
 *
 * **This is presentation, not aggregation** — the distinction `SPEC.md` §9.1
 * draws, and the same one `report-expected.ts` makes about its own merge. §9.1
 * forbids aggregating raw entries in Node; nothing here sums a duration or
 * touches an entry. It takes buckets Postgres already totalled and inserts the
 * empty ones Postgres had no row to report. A zero it adds is a statement the
 * database would have made if `generate_series` had been on the other side of
 * the query.
 *
 * Pure: no React, no Supabase, no `next/*`.
 */

import { addDays, isDayString } from "@/components/reports/report-days";

/** The shape §9.3's by-day aggregate returns. */
export type DayTotal = {
  day: string;
  totalSeconds: number;
};

/**
 * Every day from `from` to `to` inclusive, in order, each carrying its total or
 * zero.
 *
 * Both ends are inclusive because that is what §9.2's ranges are, everywhere:
 * the chart's last bar is `to`, which on a dashboard is the company's today.
 *
 * **A row outside the range is dropped rather than kept**, and the range rather
 * than the data decides the length. The alternative — trusting the rows to
 * define the axis — would let one stray day silently widen a chart labelled
 * "last 14 days". In practice the action already filtered to this range, so
 * dropping one means something upstream disagreed about the range, and a chart
 * is the wrong place to discover that.
 *
 * A malformed or inverted range yields an empty series, which renders as the
 * caller's empty state rather than as an unbounded loop.
 */
export function fillDaySeries(
  rows: readonly DayTotal[],
  from: string,
  to: string,
): DayTotal[] {
  if (!isDayString(from) || !isDayString(to) || from > to) {
    return [];
  }

  const totals = new Map(rows.map((row) => [row.day, row.totalSeconds]));

  const series: DayTotal[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    series.push({ day, totalSeconds: totals.get(day) ?? 0 });
  }

  return series;
}

/**
 * The tallest bar in a series, which is what every bar's height is a fraction
 * of.
 *
 * Named rather than inlined so two charts on one page can be put on the same
 * scale deliberately — and so the all-zero case has one answer instead of one
 * per caller. Zero is returned as zero; the chart components read that as "no
 * bar has any height" rather than dividing by it.
 */
export function maxSecondsOf(
  rows: readonly { totalSeconds: number }[],
): number {
  return rows.reduce((largest, row) => Math.max(largest, row.totalSeconds), 0);
}
