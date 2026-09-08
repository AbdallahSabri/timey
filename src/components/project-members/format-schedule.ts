/**
 * A `project_members` schedule (§3.6.3) turned into the sentence an admin reads
 * on a row: `4h/day · Mon, Tue, Thu, Fri`.
 *
 * Seconds come in and hours go out, in one direction only — the reverse trip
 * belongs to `projectMemberScheduleSchema`, which is the one place hours become
 * the integer seconds §9.5 requires. Nothing here is ever sent back to an
 * action, so a value rounded for display can never become a value stored.
 *
 * Pure: no React, no Supabase, no `next/*`.
 */

import { formatWorkingDays, SECONDS_PER_HOUR } from "@/lib/time/working-days";

/**
 * What a row says when nobody has set hours on the assignment.
 *
 * **An unset schedule and a deliberate zero read differently, and the column
 * cannot tell them apart** — `expected_daily_seconds` defaults to 0, so a
 * membership created before §9.8 existed is indistinguishable from one an admin
 * set to zero on purpose. This wording is chosen to be true of both: "no
 * expected hours" describes the state either way, where "0h/day" would assert
 * that somebody decided on zero. `report_expected_by_user` treats them
 * identically too, contributing no expected row at all.
 */
export const NO_EXPECTED_HOURS = "No expected hours";

/**
 * `14400` → `"4h/day"`, `12600` → `"3.5h/day"`.
 *
 * Trailing zeroes are trimmed so a whole number reads as one: a schedule board
 * of "4h/day" and "3.5h/day" is scanned faster than one of "4.00h/day". Up to
 * two decimals, which covers the quarter-hour a contract is ever written in and
 * is well inside the second the column actually stores.
 */
export function formatDailyHours(expectedDailySeconds: number): string {
  const hours = expectedDailySeconds / SECONDS_PER_HOUR;
  return `${Number(hours.toFixed(2))}h/day`;
}

/**
 * The whole schedule on one line, or `NO_EXPECTED_HOURS` when there are no
 * hours to describe.
 *
 * The hours are what decide, not the days: an assignment of 0h/day on Mon–Fri
 * expects nothing, and listing five working days beside it would suggest
 * otherwise. The reverse — real hours with no working days — is a statement
 * somebody made and `formatWorkingDays` already renders it as "No working
 * days", so it is left to say so.
 */
export function formatSchedule(
  expectedDailySeconds: number,
  workingDays: readonly number[],
  weekStartsOn = 1,
): string {
  if (expectedDailySeconds === 0) {
    return NO_EXPECTED_HOURS;
  }

  return `${formatDailyHours(expectedDailySeconds)} · ${formatWorkingDays(
    workingDays,
    weekStartsOn,
  )}`;
}

/**
 * A week's worth of one assignment, in integer seconds: hours/day × working
 * days.
 *
 * Seconds rather than hours for §9.5's reason — the Team dialog adds several of
 * these together and formats the sum once, so nothing rounds until the edge.
 * This is *not* the figure a report shows: `report_expected_by_user` counts the
 * working days that actually fall in a range and accrues only from `added_at`,
 * where this is the flat weekly rate the schedule describes. The dialog labels
 * it as such.
 */
export function weeklySecondsOf(schedule: {
  expectedDailySeconds: number;
  workingDays: readonly number[];
}): number {
  return schedule.expectedDailySeconds * schedule.workingDays.length;
}
