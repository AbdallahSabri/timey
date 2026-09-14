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

import {
  differenceSeconds,
  percentOf,
} from "@/components/reports/report-expected";

/** What this needs from a §9.3 by-user row. */
export type AttendanceRow = {
  userId: string;
  userName: string | null;
  totalSeconds: number;
  /**
   * `null` means expected is not a meaningful quantity for this row, which
   * §9.8.2 gives exactly one cause: a task filter. **On `/overview` it is
   * therefore never null** — that page sets no task filter, and
   * `mergeExpectedByUser` gives somebody with no schedule a `0` rather than a
   * null by design. So the null branches here are defensive, and the live
   * "nobody set a target" case is the zero one; `percentOf` treats the two
   * alike for that reason.
   *
   * Either way it sorts last, after every real shortfall and every real
   * surplus, because "no target" is not a standing.
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

/**
 * The team's figures, summed from the rows that are on screen (`SPEC.md`
 * §9.9.3).
 *
 * **Both sides are summed over the same people, and that is the whole point.**
 * A percentage is a ratio, so its numerator and denominator have to describe
 * the same population. `report_summary.totalSeconds` is every hour in the
 * company including those of people with no schedule, while expected can only
 * come from people who have one — divide the first by the second and a
 * contractor with no target who logs a hundred hours pushes the team past 100%
 * while every individual card sits below it. So the worked figure here is
 * summed from the same rows the expected figure is, and the company-wide total
 * stays where §9.8.1 put it: the tile above, which is a different claim and
 * says so.
 *
 * Summing durations in Node is legitimate here for §9.9.1's stated test — the
 * line items are on screen. The grid beneath renders **every** row, which is
 * also what §12.2 requires of a total, and is why the card this feeds may carry
 * one where the truncated list it replaced could not. It is the same
 * arithmetic `/reports`' footer does through `totalsOf`.
 *
 * `expectedSeconds` is `null` when nobody has a schedule at all — not zero.
 * Zero would be a target of no hours, which somebody would have had to choose;
 * null is "there is no target to be a share of", and the card renders it as an
 * absence. `totalsOf` draws the same distinction for the same reason.
 *
 * The four counts partition the rows exactly, and `noTarget` is decided by
 * `percentOf` rather than by its own test of `expectedSeconds`, so the count in
 * the summary and the dashes on the cards cannot disagree about who has a
 * target.
 */
export function teamTotals(rows: readonly AttendanceRow[]): {
  /** Worked by the people who have a target. Not the company's total. */
  workedSeconds: number;
  /** `null` when nobody has a schedule — see above. */
  expectedSeconds: number | null;
  behind: number;
  ahead: number;
  onTarget: number;
  noTarget: number;
} {
  const totals = rows.reduce(
    (running, row) => {
      if (percentOf(row.totalSeconds, row.expectedSeconds) === null) {
        return { ...running, noTarget: running.noTarget + 1 };
      }

      const difference = differenceSeconds(
        row.totalSeconds,
        row.expectedSeconds,
      );

      return {
        withTarget: running.withTarget + 1,
        workedSeconds: running.workedSeconds + row.totalSeconds,
        expectedSeconds: running.expectedSeconds + (row.expectedSeconds ?? 0),
        behind:
          running.behind + (difference !== null && difference < 0 ? 1 : 0),
        ahead: running.ahead + (difference !== null && difference > 0 ? 1 : 0),
        onTarget: running.onTarget + (difference === 0 ? 1 : 0),
        noTarget: running.noTarget,
      };
    },
    {
      withTarget: 0,
      workedSeconds: 0,
      expectedSeconds: 0,
      behind: 0,
      ahead: 0,
      onTarget: 0,
      noTarget: 0,
    },
  );

  return {
    workedSeconds: totals.workedSeconds,
    expectedSeconds: totals.withTarget === 0 ? null : totals.expectedSeconds,
    behind: totals.behind,
    ahead: totals.ahead,
    onTarget: totals.onTarget,
    noTarget: totals.noTarget,
  };
}
