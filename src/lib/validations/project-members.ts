import { z } from "zod";

import { SECONDS_PER_HOUR, isWorkingDay } from "@/lib/time/working-days";

/**
 * A schedule is a property of the *assignment*, not of the person (`SPEC.md`
 * §3.6.3): the same employee can be 4h/day Mon–Fri on one project and 3h/day
 * Mon/Tue/Thu/Fri on another, and a `profiles`-level schedule cannot express
 * that without an allocation model layered on top. So these fields validate a
 * `project_members` row, and the per-person figure is always a sum.
 */

/** 24h. The column CHECK is `between 0 and 86400`; this is the same bound in hours. */
export const MAX_EXPECTED_DAILY_HOURS = 24;

/**
 * Hours in, integer seconds out.
 *
 * §9.5 is the reason for the transform rather than a `numeric` column: the
 * stored value is displayed beside `sum(duration_seconds)`, and two quantities
 * shown as one comparison must be the same kind of number or the comparison
 * drifts. The admin still *types* hours, because nobody schedules staff in
 * seconds — the conversion is this layer's job, exactly once, here.
 *
 * `z.coerce` is avoided for the same reason `weekStartsOnField` avoids it in
 * `auth.ts`: it turns an untouched input (`""`) into `0`, which is a *valid*
 * `expectedDailyHours` meaning "no target", so a blank field would silently
 * clear a schedule instead of failing.
 *
 * Fractions are allowed — half-days and 7.5h contracts are ordinary — and
 * rounded to the nearest second on the way in. 3.5 → 12600, 0.25 → 900. The
 * rounding can only bite on inputs finer than 1/3600 of an hour, which is not
 * a schedule anybody writes down.
 */
const expectedDailyHoursField = z
  .union([z.number(), z.string()], "Enter the hours worked per day.")
  .transform((value) => {
    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed === "" ? Number.NaN : Number(trimmed);
    }
    return value;
  })
  .pipe(
    z
      .number("Enter the hours worked per day.")
      .min(0, "Hours per day cannot be negative.")
      .max(
        MAX_EXPECTED_DAILY_HOURS,
        `Hours per day cannot exceed ${MAX_EXPECTED_DAILY_HOURS}.`,
      ),
  )
  .transform((hours) => Math.round(hours * SECONDS_PER_HOUR));

/**
 * Postgres `extract(dow)` numbering — 0 = Sunday … 6 = Saturday — which is what
 * `report_expected_by_user` compares against with a bare `= any(working_days)`.
 * It is also the numbering `companies.week_starts_on` already uses, so the app
 * has exactly one day-of-week convention rather than one per feature.
 *
 * Sorting and de-duplicating here is a convenience, not the guarantee:
 * `project_members_20_normalize_working_days` does it again in the database,
 * because a value the client cannot get wrong is better than one it merely
 * usually gets right.
 *
 * An empty array is legal and means "no working days on this project" — which
 * is a real thing to say about an advisory assignment, and is not the same
 * statement as zero hours per day.
 */
export const workingDaysSchema = z
  .array(
    z
      .number()
      .int()
      .refine(
        isWorkingDay,
        "Pick days of the week between Sunday and Saturday.",
      ),
    "Pick the days of the week this member works.",
  )
  .max(7, "A week has seven days.")
  .transform((days) => [...new Set(days)].sort((a, b) => a - b));

/**
 * The object-level transform renames the field as well as converting it, so the
 * output cannot be misread: `expectedDailyHours` is what a person types and
 * `expectedDailySeconds` is what the column stores, and no value is ever called
 * "hours" while holding seconds. This is why the form is typed
 * `useForm<Input, unknown, Values>` — the two sides genuinely differ.
 */
export const projectMemberScheduleSchema = z
  .object({
    expectedDailyHours: expectedDailyHoursField,
    workingDays: workingDaysSchema,
  })
  .transform(({ expectedDailyHours, workingDays }) => ({
    expectedDailySeconds: expectedDailyHours,
    workingDays,
  }));

/** What the form holds (hours, unsorted days) versus what the action sends (seconds). */
export type ProjectMemberScheduleInput = z.input<
  typeof projectMemberScheduleSchema
>;
export type ProjectMemberScheduleValues = z.output<
  typeof projectMemberScheduleSchema
>;
