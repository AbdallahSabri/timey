/**
 * Calendar-day strings for the report filters (§9.2).
 *
 * **Nothing here does timezone math on an instant except `companyToday`**, and
 * that one delegates to `companyLocalDate` in `lib/time/company-time.ts` rather
 * than reimplementing §6.1. Every other function treats `YYYY-MM-DD` as a
 * *label*: the range a person picks on a calendar means "these days in the
 * company's timezone", and the bucketing that turns a label into a set of
 * instants happens in Postgres (`(started_at AT TIME ZONE c.timezone)::date`),
 * where the company's zone actually is.
 *
 * That is why `addDays` counts in UTC midnights and `formatDayLabel` formats in
 * UTC: both are arithmetic on the label, and using the *browser's* zone for
 * either would move a day across a boundary the user never crossed.
 */

import { safeTimeZone } from "@/components/time-entries/format-entry";
import { companyLocalDate } from "@/lib/time/company-time";

/** Pinned for the same reason `format-entry.ts` pins it: server and browser must agree. */
const LOCALE = "en-GB";

const DAY_MS = 86_400_000;

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** True for a well-formed `YYYY-MM-DD` that names a day that exists. */
export function isDayString(value: string): boolean {
  if (!DAY_PATTERN.test(value)) {
    return false;
  }

  return dayToUtcMs(value) !== null;
}

/**
 * `YYYY-MM-DD` → the UTC midnight that stands in for it, or null if the string
 * names no real day (`2026-02-30` matches the pattern and is not a date).
 */
function dayToUtcMs(day: string): number | null {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  const date = Number(day.slice(8, 10));

  const ms = Date.UTC(year, month - 1, date);
  const parsed = new Date(ms);

  // Round-tripping is what catches 31 April: `Date.UTC` rolls it forward, and
  // the parts then disagree with what was asked for.
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== date
  ) {
    return null;
  }

  return ms;
}

function utcMsToDay(ms: number): string {
  const date = new Date(ms);
  return [
    String(date.getUTCFullYear()).padStart(4, "0"),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

/**
 * Today, as the company reckons it (§6.1).
 *
 * `companyLocalDate` throws `RangeError` for a zone this runtime's ICU data does
 * not know, and `safeTimeZone` already answers that with UTC — the same fallback
 * every timer card uses, so a company with an unreadable zone renders one
 * consistent (if wrong) day rather than crashing the page.
 */
export function companyToday(timezone: string | null, now: number): string {
  return companyLocalDate(now, safeTimeZone(timezone));
}

/** `day` shifted by whole calendar days. Returns `day` unchanged if it isn't one. */
export function addDays(day: string, delta: number): string {
  const ms = dayToUtcMs(day);
  if (ms === null) {
    return day;
  }

  return utcMsToDay(ms + delta * DAY_MS);
}

/** The first day of `day`'s month. */
export function startOfMonth(day: string): string {
  return isDayString(day) ? `${day.slice(0, 7)}-01` : day;
}

/** The last day of `day`'s month, found by stepping back from the first of the next. */
export function endOfMonth(day: string): string {
  const first = startOfMonth(day);
  const ms = dayToUtcMs(first);
  if (ms === null) {
    return day;
  }

  const next = new Date(ms);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return utcMsToDay(next.getTime() - DAY_MS);
}

/**
 * A `Date` from the browser's own calendar → the day it names.
 *
 * `react-day-picker` hands back a `Date` at local midnight of the cell that was
 * clicked, so the *local* parts are the day on screen. `toISOString()` here
 * would be the classic off-by-one: it converts to UTC first, which is the
 * previous day for anyone west of Greenwich.
 */
export function dateToDayString(date: Date): string {
  return [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

/** The inverse: a day label → local midnight, which is the cell the calendar highlights. */
export function dayStringToDate(day: string): Date | undefined {
  if (!isDayString(day)) {
    return undefined;
  }

  return new Date(
    Number(day.slice(0, 4)),
    Number(day.slice(5, 7)) - 1,
    Number(day.slice(8, 10)),
  );
}

/**
 * "Mon, 10 Aug 2026" — formatted in UTC deliberately.
 *
 * The string being formatted is already a company-local day computed by
 * Postgres. Handing it to `Intl` with any other zone would re-interpret the
 * label as an instant and can shift it a day; UTC is the only zone in which
 * "midnight of this label" is that label.
 */
export function formatDayLabel(day: string): string {
  const ms = dayToUtcMs(day);
  if (ms === null) {
    return day;
  }

  return new Intl.DateTimeFormat(LOCALE, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(ms);
}

/** "10 Aug 2026", the shorter form used on the range button. */
export function formatDayShort(day: string): string {
  const ms = dayToUtcMs(day);
  if (ms === null) {
    return day;
  }

  return new Intl.DateTimeFormat(LOCALE, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(ms);
}

/** "10 Aug 2026 – 25 Aug 2026", collapsing to one date when the range is a single day. */
export function formatDayRange(from: string, to: string): string {
  if (from === to) {
    return formatDayShort(from);
  }

  return `${formatDayShort(from)} – ${formatDayShort(to)}`;
}
