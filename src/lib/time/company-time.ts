/**
 * Company-timezone arithmetic (§6.1, §6.2), shared by every action that has to
 * turn a wall clock into an instant or an instant into a company-local day.
 *
 * **Why this is its own module and not part of `lib/actions/time-entries.ts`,
 * where it was written in Phase 6.** That file carries `'use server'`, and every
 * export of a `'use server'` module is a network-reachable endpoint — so a
 * helper cannot be shared out of it without also publishing it. Phase 7 needs
 * the exact same resolution for correction proposals (a proposal is a wall clock
 * too), and §6.1's failure mode is precisely the kind that a second, subtly
 * different copy produces: two paths agreeing about a timestamp on 364 days a
 * year. One implementation, imported by both.
 *
 * Nothing here touches Supabase, `next/*`, or the request context. It is pure
 * arithmetic over `Intl`, which is why it can be imported from anywhere.
 *
 * All of it is done with `Intl` rather than `Date`'s local methods, because the
 * only zone `Date` knows is the *server's* — and a Next.js server in UTC
 * deciding what "today" means for a Cairo company is §6.1's failure mode with a
 * different cause (§6.2: per-user zones are out of scope, so the company's is
 * the only one that exists).
 *
 * `Intl.DateTimeFormat` throws `RangeError` for a zone this runtime's ICU data
 * does not know. `companies.timezone` is validated against `pg_timezone_names`
 * by trigger (§4.2.1), so the two catalogues should agree — but "should" is not
 * a guarantee across a Node upgrade, so every caller of these helpers is inside
 * a try/catch that reports the mismatch instead of 500-ing the action.
 */

const zonedFormatters = new Map<string, Intl.DateTimeFormat>();

function zonedFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = zonedFormatters.get(timeZone);
  if (cached) {
    return cached;
  }

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    // h23, not `hour12: false` — under some ICU versions the latter yields the
    // h24 cycle, which renders midnight as "24" and would put every entry
    // logged in the first hour of the day on the previous date.
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  zonedFormatters.set(timeZone, formatter);
  return formatter;
}

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function zonedParts(instantMs: number, timeZone: string): ZonedParts {
  const parts = zonedFormatter(timeZone).formatToParts(instantMs);
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value);

  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  };
}

export const MINUTE_MS = 60_000;

/**
 * §6.4's grace, in one place. "`started_at` may not exceed `now() + 5 minutes`.
 * The grace absorbs minor clock drift on manual entry; anything beyond is
 * rejected." `assert_entry_window_valid()` applies the same five minutes at
 * approval time, so this constant and the migration's `interval '5 minutes'`
 * have to stay the same number.
 */
export const FUTURE_GRACE_MS = 5 * MINUTE_MS;

/** `YYYY-MM-DD` — the company-local calendar day an instant falls on (§6.1). */
export function companyLocalDate(instantMs: number, timeZone: string): string {
  const { year, month, day } = zonedParts(instantMs, timeZone);
  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}

/** The zone's offset from UTC at a given instant, in milliseconds east. */
function zonedOffsetMs(instantMs: number, timeZone: string): number {
  const seconds = Math.floor(instantMs / 1000) * 1000;
  const { year, month, day, hour, minute, second } = zonedParts(
    seconds,
    timeZone,
  );
  return Date.UTC(year, month - 1, day, hour, minute, second) - seconds;
}

const DAY_MS = 86_400_000;

/**
 * A wall clock in `timeZone` → the instant it names. The inverse of everything
 * else here, and the one direction `Intl` does not offer, so it is built from
 * two offset probes.
 *
 * Reading the offset *at the wall clock read as UTC* would be the obvious
 * one-liner and is wrong twice a year: it asks the zone what its offset is at
 * an instant up to fourteen hours away from the one being resolved, which lands
 * on the wrong side of a transition for any wall clock within that window of
 * one. Probing a day either side instead brackets every transition (no zone
 * shifts twice in 48 hours), then keeps whichever candidate actually reproduces
 * the wall clock it started from.
 *
 * The two DST cases are decided deliberately rather than by accident of
 * arithmetic. Both were checked against Postgres's own
 * `timestamp X at time zone Z` on this stack, across America/New_York,
 * Europe/London, Africa/Cairo, Australia/Lord_Howe (a 30-minute shift),
 * Pacific/Chatham (+12:45) and Pacific/Kiritimati (+14):
 *
 *   * **Nonexistent** (clocks went forward; the wall clock is skipped). Neither
 *     candidate round-trips, and the pre-transition offset is used, which
 *     resolves 02:30 to 03:30 — shifted forward by the gap. **Identical to
 *     Postgres in every case tried.** Rejecting it instead was considered: it
 *     would be defensible, but "that time does not exist" is a sentence about
 *     the timezone database, not about the user's day, and one hour a year is
 *     not worth an error message nobody can act on.
 *   * **Ambiguous** (clocks went back; the wall clock happens twice). Both
 *     candidates round-trip and the EARLIER instant is chosen — the first
 *     occurrence. **This is where the two implementations diverge**, and the
 *     divergence is chosen rather than discovered: Postgres returned the second
 *     occurrence for every ambiguous case tried (01:30 EST, not 01:30 EDT).
 *     Both instants are a truthful reading of the wall clock, and Postgres's
 *     own documentation declines to specify which one `AT TIME ZONE` picks, so
 *     matching it would mean depending on unspecified behaviour to stay
 *     consistent. `Math.min` is fixed, is the same rule ECMAScript's Temporal
 *     calls `compatible`, and costs at most one DST hour a year on an entry the
 *     user can see and correct. **Phase 7 makes the same choice by importing
 *     this function** — a correction proposal is a wall clock too, and resolving
 *     it in SQL rather than here would reintroduce exactly this disagreement.
 *
 * `local` is the schema's normalised 19-character form, so the slices below are
 * guaranteed positions, not a second parse (`localDateTimeSchema`).
 */
export function wallClockToInstant(local: string, timeZone: string): Date {
  const naiveUtc = Date.UTC(
    Number(local.slice(0, 4)),
    Number(local.slice(5, 7)) - 1,
    Number(local.slice(8, 10)),
    Number(local.slice(11, 13)),
    Number(local.slice(14, 16)),
    Number(local.slice(17, 19)),
  );

  const before = naiveUtc - zonedOffsetMs(naiveUtc - DAY_MS, timeZone);
  const after = naiveUtc - zonedOffsetMs(naiveUtc + DAY_MS, timeZone);

  const roundTrips = (candidate: number): boolean => {
    const parts = zonedParts(candidate, timeZone);
    return (
      Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day,
        parts.hour,
        parts.minute,
        parts.second,
      ) === naiveUtc
    );
  };

  const matches = [before, after].filter(roundTrips);
  if (matches.length > 0) {
    return new Date(Math.min(...matches));
  }

  return new Date(before);
}

/**
 * "14:00–15:30" when the whole conflicting entry sits on today's company-local
 * date, and "24 Aug, 22:00 – 25 Aug, 03:00" when it does not.
 *
 * The second form is not decoration: §5.5 rules that an entry is never split
 * across days, so a 22:00→03:00 shift is one row, and a manual entry for this
 * morning can collide with the tail of it. "This overlaps an entry from
 * 22:00–03:00" would then name a range that is nowhere on the day the user is
 * looking at.
 *
 * The locale is pinned to en-GB and the zone is the company's, matching
 * `formatStartedAt` in `components/time-entries/format-entry.ts` — the same
 * entry must not be called 14:00 in the list and 2:00 pm in the error about it.
 * That module is not imported because it belongs to the UI layer; the shared
 * thing is the convention, not the function.
 */
export function formatConflictRange(
  startMs: number,
  endMs: number,
  timeZone: string,
): string {
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  });

  const today = companyLocalDate(Date.now(), timeZone);
  const sameDay =
    companyLocalDate(startMs, timeZone) === today &&
    companyLocalDate(endMs, timeZone) === today;

  if (sameDay) {
    return `${time.format(startMs)}–${time.format(endMs)}`;
  }

  const dayTime = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  });

  return `${dayTime.format(startMs)} – ${dayTime.format(endMs)}`;
}
