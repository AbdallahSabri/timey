/**
 * The team's attendance, ordered the way a shortfall list is read.
 *
 * **This is a deliberate departure from the ordering everything else keeps, and
 * the departure is the point.** `report-expected.ts` explains at length why it
 * leaves SQL's order alone: `0007_reports.sql` establishes
 * `total_seconds desc, name, id` — a total order — and re-sorting it in a
 * second language with a different collation gives two answers that eventually
 * disagree. That reasoning is about the report *table*, where the question is
 * "who logged the most" and the answer is a ranking.
 *
 * `/overview`'s attendance card asks the opposite question. "Who is behind" is
 * not visible in a list sorted by hours worked — the person who logged nothing
 * at all sorts last there, which is exactly backwards for the one reading this
 * card exists to support. So the rows are re-ordered by how far behind they
 * are, worst first, and the card says so in its own words.
 *
 * Nothing is hidden by this: the card links to `/reports?grouping=user` for the
 * full list in its own order, and re-ordering a set is not re-computing it —
 * every figure is the one the database returned.
 *
 * Pure: no React, no Supabase, no `next/*`.
 */

import { differenceSeconds } from "@/components/reports/report-expected";

/** What this needs from a §9.3 by-user row. */
export type AttendanceRow = {
  userId: string;
  userName: string | null;
  totalSeconds: number;
  /**
   * `null` means expected is not a meaningful quantity here, which on a
   * dashboard has exactly one cause — nobody has set a schedule, so §9.8 has
   * nothing to compare against. It is **not** zero: zero is a schedule of no
   * hours, which somebody chose. Rows with null sort last, after every real
   * shortfall and every real surplus, because "no target" is not a standing.
   */
  expectedSeconds: number | null;
};

/**
 * Worst shortfall first; then surpluses, smallest first; then anybody with no
 * target at all.
 *
 * The name is the tiebreak so the order is stable across renders — two people
 * exactly 4 hours behind must not swap places on a refresh — and a null name
 * sorts last, matching `nulls last` in 0007's own `ORDER BY`.
 */
export function byShortfall(rows: readonly AttendanceRow[]): AttendanceRow[] {
  return [...rows].sort((a, b) => {
    const left = differenceSeconds(a.totalSeconds, a.expectedSeconds);
    const right = differenceSeconds(b.totalSeconds, b.expectedSeconds);

    // No target is not a standing, so those rows go after every row that has
    // one — in either direction.
    if (left === null || right === null) {
      if (left !== right) {
        return left === null ? 1 : -1;
      }
    } else if (left !== right) {
      // Ascending: the most negative difference is the biggest shortfall.
      return left - right;
    }

    if (a.userName === b.userName) return 0;
    if (a.userName === null) return 1;
    if (b.userName === null) return -1;
    return a.userName.localeCompare(b.userName);
  });
}
