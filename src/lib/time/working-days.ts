/**
 * Day-of-week vocabulary, shared by the schedule forms, the report columns and
 * the dashboard card.
 *
 * It lives beside `company-time.ts` rather than in `components/` because
 * `lib/` may not import from `components/`, and both an action (validating a
 * schedule) and a component (rendering one) need the same seven names. Nothing
 * here touches an instant or a timezone: a day-of-week is a property of the
 * *schedule*, not of any particular moment, and the moment-shaped question —
 * "which company-local day is this instant on" — is `company-time.ts`'s job and
 * stays there.
 */

/** The one place hours become seconds. §9.5: totals are integer seconds. */
export const SECONDS_PER_HOUR = 3600;

/**
 * Postgres `extract(dow)` numbering, which is also `companies.week_starts_on`'s
 * (0 = Sunday, 1 = Monday). Matching it means `working_days` is compared with a
 * bare `= any(...)` in SQL and needs no offset arithmetic anywhere — and offset
 * arithmetic on weekdays is the kind of thing that is wrong by one for a year
 * before anybody notices.
 */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const WEEKDAYS: readonly Weekday[] = [0, 1, 2, 3, 4, 5, 6];

/** Monday–Friday, the `working_days` column default. */
export const DEFAULT_WORKING_DAYS: readonly Weekday[] = [1, 2, 3, 4, 5];

export function isWorkingDay(value: number): value is Weekday {
  return Number.isInteger(value) && value >= 0 && value <= 6;
}

/**
 * Pinned `en-GB` for the same reason `report-days.ts` pins it: a label that
 * changes with the viewer's locale makes two screenshots of the same schedule
 * disagree, and these strings sit next to `en-GB` dates already.
 *
 * The reference instants are Sundays-onward in January 2024 (2024-01-07 was a
 * Sunday) chosen in UTC and formatted in UTC, so no zone can shift which day a
 * name belongs to.
 */
const WEEKDAY_NAMES: readonly string[] = WEEKDAYS.map((day) =>
  new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    timeZone: "UTC",
  }).format(Date.UTC(2024, 0, 7 + day)),
);

const WEEKDAY_SHORT_NAMES: readonly string[] = WEEKDAYS.map((day) =>
  new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    timeZone: "UTC",
  }).format(Date.UTC(2024, 0, 7 + day)),
);

/** "Monday". */
export function weekdayName(day: Weekday): string {
  return WEEKDAY_NAMES[day] ?? "";
}

/** "Mon" — the picker's checkbox labels and the table's compact summary. */
export function weekdayShortName(day: Weekday): string {
  return WEEKDAY_SHORT_NAMES[day] ?? "";
}

/**
 * The seven days in the order this company reads a week.
 *
 * `companies.week_starts_on` has been stored since Phase 1 and never read by
 * anything; a day picker is the first surface with a reason to care. Only the
 * *display* order changes — stored values stay 0–6 dow — so rotating here can
 * never alter what a schedule means, which is the property that makes it safe
 * to do at the edge.
 */
export function weekdaysFrom(weekStartsOn: number): Weekday[] {
  const start = isWorkingDay(weekStartsOn) ? weekStartsOn : 1;
  return WEEKDAYS.map((offset) => ((start + offset) % 7) as Weekday);
}

/**
 * "Mon, Tue, Thu, Fri" — ordered by the company's week, not by dow, so a
 * Sunday-start company does not read its own schedule starting on Monday.
 *
 * Empty is rendered as a sentence rather than an empty string: a blank cell
 * where a schedule should be reads as missing data, while "No working days" is
 * a statement somebody chose to make (`SPEC.md` §3.6.3).
 */
export function formatWorkingDays(
  days: readonly number[],
  weekStartsOn = 1,
): string {
  const chosen = new Set(days);
  const ordered = weekdaysFrom(weekStartsOn).filter((day) => chosen.has(day));
  if (ordered.length === 0) return "No working days";
  if (ordered.length === 7) return "Every day";
  return ordered.map(weekdayShortName).join(", ");
}
