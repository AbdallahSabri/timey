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
