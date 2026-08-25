import { safeTimeZone } from "@/components/time-entries/format-entry";

/**
 * Seeding an `<input type="datetime-local">`, and nothing else.
 *
 * **This function's output is a starting point to edit, not an assertion about
 * which timezone is correct.** `datetime-local` has exactly one value format —
 * `YYYY-MM-DDTHH:MM`, a wall clock with no `Z` and no offset — and it is the
 * same format `localDateTimeSchema` accepts, which is why the field's raw value
 * is submitted untouched: the server resolves it against `companies.timezone`
 * (§6.1, §6.2), and no timezone arithmetic happens in the browser at all.
 *
 * The default below reads the *browser's* clock, because that is the only zone
 * `Date`'s local getters know and the only sensible thing to pre-fill a blank
 * field with. For the overwhelmingly common case — a user in their company's
 * timezone — it is already the right number. For a user working in a different
 * zone from their company it is not, and the form says so in words rather than
 * quietly adjusting it: guessing the company-local now here would make the seed
 * disagree with the clock on the user's own wall while still being editable to
 * anything, which trades one confusion for a stranger one. Either way the
 * submitted value is whatever the user leaves in the field, read by the server
 * as company-local time.
 *
 * `getMonth()`/`getDate()`/`getHours()` — never `toISOString()`, which would
 * shift the seed by the browser's offset and pre-fill yesterday's date for
 * anyone east of UTC in the early evening.
 */
export function toDateTimeLocalValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");

  return [
    [
      String(date.getFullYear()).padStart(4, "0"),
      pad(date.getMonth() + 1),
      pad(date.getDate()),
    ].join("-"),
    [pad(date.getHours()), pad(date.getMinutes())].join(":"),
  ].join("T");
}

/**
 * A **stored instant** → the `datetime-local` value that shows it in the
 * company's timezone. The other direction from `toDateTimeLocalValue`, and a
 * different job: this one seeds a field with a value that already exists.
 *
 * Phase 7 needs it and Phase 6 did not. A manual entry starts blank, so the
 * browser's own clock is a fair guess; a correction starts from an entry the
 * user is looking at, and the field has to agree with the list row above it.
 * `new Date(iso)` plus local getters would disagree by the offset between the
 * browser and `companies.timezone` — the employee would edit an end time that
 * reads 16:32 in their list and propose 14:32, and the server would read that
 * proposal as company-local (§6.1) and honour it.
 *
 * `en-US` with `h23` and the same zone fallback `formatStartedAt` uses, so a
 * seeded value and the rendered row are the same clock. Midnight is 00:00, never
 * 24:00 — `hourCycle: "h23"` rather than `hour12: false`, for the reason
 * `lib/time/company-time.ts` documents at length.
 *
 * Seconds are dropped: `localDateTimeSchema` accepts `YYYY-MM-DDTHH:MM` and pads
 * them back, and `datetime-local` without a `step` shows minutes only. An entry
 * stopped at 14:32:47 therefore proposes 14:32:00 unless the user changes it —
 * visible, editable, and preferable to a control that silently drops a value it
 * displayed.
 */
export function toCompanyDateTimeLocalValue(
  instant: string,
  timezone: string | null,
): string {
  const parsed = Date.parse(instant);
  if (Number.isNaN(parsed)) {
    return "";
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: safeTimeZone(timezone),
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(parsed);

  const read = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${read("year").padStart(4, "0")}-${read("month")}-${read("day")}T${read("hour")}:${read("minute")}`;
}
