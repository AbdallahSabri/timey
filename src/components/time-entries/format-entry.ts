/**
 * Rendering a stored instant as a wall clock time.
 *
 * **The company timezone, never the browser's** (§6.1, §6.2): a day boundary in
 * this product is defined by `companies.timezone`, and a per-user zone is
 * explicitly out of scope for v1. Reading `Intl`'s default zone here would also
 * make the same entry render differently on the server and in the browser,
 * which is a hydration mismatch on every timer card.
 *
 * The locale is pinned for the same reason — a server in `C` and a browser in
 * `en-GB` disagree about month abbreviations and about which of two numbers is
 * the day.
 */
const LOCALE = "en-GB";

/**
 * Exported for `datetime-local.ts`, which has to seed a form field with the
 * *same* zone this module renders with: a prefilled correction proposing
 * "14:32" must be the 14:32 the row above it shows, or the employee is
 * proposing a time they never saw.
 */
export function safeTimeZone(timezone: string | null): string {
  if (!timezone) {
    return "UTC";
  }

  try {
    new Intl.DateTimeFormat(LOCALE, { timeZone: timezone }).format(0);
    return timezone;
  } catch {
    // A zone the database accepted but this runtime's ICU data does not know.
    // Falling back is better than throwing inside a render.
    return "UTC";
  }
}

/** "24 Aug, 14:32" — enough to recognise an entry, not a full timestamp. */
export function formatStartedAt(
  startedAt: string,
  timezone: string | null,
): string {
  const parsed = Date.parse(startedAt);
  if (Number.isNaN(parsed)) {
    return "—";
  }

  return new Intl.DateTimeFormat(LOCALE, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: safeTimeZone(timezone),
  }).format(parsed);
}
