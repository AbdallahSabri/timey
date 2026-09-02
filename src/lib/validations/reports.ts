import { z } from "zod";

/**
 * The input contract for every report (§9.2): "a date range (company-local days,
 * inclusive) plus filters on any of user, client, project, task."
 *
 * **Three things this file deliberately does not do**, because none of them can
 * be decided from the shape of the input alone:
 *
 *   * **It does not turn the range into instants.** `from`/`to` are calendar
 *     days in `companies.timezone`, and §6.1 rules that the conversion is
 *     `(started_at AT TIME ZONE c.timezone)::date` evaluated *in Postgres*. A
 *     schema has no company and no timezone, so resolving here would either
 *     guess a zone or reintroduce the UTC-bucketing bug §6.1 exists to prevent.
 *   * **It does not enforce §9.2's employee scoping.** `userId` is a
 *     convenience filter; the boundary is `time_entries`' SELECT policy, which
 *     hard-scopes an employee to `user_id = auth.uid()` no matter what the UI
 *     sends (`BLOCKERS.md` D-2). The action still overrides it for an employee
 *     rather than passing it through — see the note on `reportFiltersSchema` —
 *     but that is so a mistaken filter returns *their own* rows instead of an
 *     empty report, not because validation is load-bearing for tenancy.
 *   * **It does not check that the ids exist or relate.** "Is this task in this
 *     project" is a fact about the database; a report that names a stale
 *     project id correctly returns nothing.
 */

/**
 * The §9.3 groupings, and the complete list of them: "by day, by user, by
 * project, by task, by client. Cross-tabs (user × project) are the useful ones
 * in practice."
 *
 * Each member maps to exactly one purpose-built aggregate function with its own
 * fixed `GROUP BY`. Deliberately not a free-form list of dimensions the caller
 * can combine: an arbitrary grouping would have to be assembled as dynamic SQL
 * in the database, which is both an injection surface and a query nobody can
 * read the plan of.
 */
export const reportGroupingSchema = z.enum(
  ["day", "user", "project", "task", "client", "user-project"],
  "That isn't a report this app can produce.",
);

export type ReportGrouping = z.infer<typeof reportGroupingSchema>;

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A company-local calendar day, `YYYY-MM-DD` — the same form
 * `<input type="date">` produces and the form Postgres reads directly as a
 * `date` parameter.
 *
 * **No time, no offset, and that is the point.** The range the user picks on a
 * calendar means "these days in the company's timezone" (§9.2), and attaching a
 * time or a `Z` here would make it mean an instant in the *browser's* zone —
 * which near midnight selects a different set of days than the one on screen.
 * `localDateTimeSchema` in `time-entries.ts` refuses an offset for the same
 * reason and is worth reading alongside this.
 *
 * The regex alone would accept `2026-02-30`; Postgres rejects that with `22008`
 * from inside the RPC, which surfaces as an error about a date nobody typed. It
 * is refused here instead.
 */
export const reportDaySchema = z
  .string()
  .trim()
  .regex(DAY_PATTERN, "Enter a date like 2026-08-25.")
  .refine(isRealCalendarDate, "That isn't a real date.");

function isRealCalendarDate(day: string): boolean {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  const date = Number(day.slice(8, 10));

  if (month < 1 || month > 12 || date < 1) {
    return false;
  }

  // Round-tripping through Date.UTC is what catches 31 April and 29 February in
  // a non-leap year: both roll forward, and the parts then disagree.
  const utc = new Date(Date.UTC(year, month - 1, date));
  return (
    utc.getUTCFullYear() === year &&
    utc.getUTCMonth() === month - 1 &&
    utc.getUTCDate() === date
  );
}

/**
 * The longest range a single report may cover, in inclusive days.
 *
 * 366 is one full calendar year including a leap day — long enough for "the
 * whole of last year", which is the widest range a timesheet is actually read
 * over, and short enough that a by-day grouping stays under PostgREST's
 * `max_rows = 1000` and a mistyped year (`2016-08-25` for `2026-08-25`) is
 * refused instead of scanning a decade.
 *
 * This is a product cap, not a safety mechanism: the query would be *correct*
 * over ten years, just slow and unreadable. Raising it is a one-line change
 * here plus a look at whether the grouping in question can still fit in one
 * PostgREST page.
 */
export const MAX_REPORT_DAYS = 366;

/** Inclusive day count between two `YYYY-MM-DD` strings. */
export function inclusiveDayCount(from: string, to: string): number {
  const start = Date.UTC(
    Number(from.slice(0, 4)),
    Number(from.slice(5, 7)) - 1,
    Number(from.slice(8, 10)),
  );
  const end = Date.UTC(
    Number(to.slice(0, 4)),
    Number(to.slice(5, 7)) - 1,
    Number(to.slice(8, 10)),
  );

  // Both endpoints are midnight UTC of a calendar day, so this division is
  // exact — no DST, no leap seconds, nothing to round. The dates are *labels*
  // here, not instants; the company timezone is applied in SQL (§6.1).
  return Math.round((end - start) / 86_400_000) + 1;
}

function optionalUuidSchema(message: string) {
  // Blank and absent both mean "no filter" — an unselected `<select>` posts
  // `""`, and treating that as a malformed uuid would refuse the default,
  // unfiltered report. Same shape as `optionalUuidSchema` in `corrections.ts`.
  return z
    .string()
    .trim()
    .nullish()
    .transform((value) => (value ? value : null))
    .pipe(z.uuid(message).nullable());
}

const reportFilterShape = {
  from: reportDaySchema,
  to: reportDaySchema,
  /**
   * §9.2's user filter. **A convenience, never the boundary.** An admin may
   * filter to any member of their company; an employee's RLS scope makes the
   * parameter redundant, and the action drops it for them rather than forwarding
   * it — forwarding a colleague's id would return an empty report, which reads
   * as "that person logged nothing" rather than "you cannot see that."
   */
  userId: optionalUuidSchema("That person isn't in your company."),
  clientId: optionalUuidSchema("That client no longer exists."),
  projectId: optionalUuidSchema("That project no longer exists."),
  taskId: optionalUuidSchema("That task no longer exists."),
};

/**
 * Range plus filters, with the two rules that need both endpoints at once.
 *
 * String comparison is a valid date comparison here precisely because the
 * format is fixed-width ISO — `"2026-08-05" <= "2026-08-25"` is both
 * lexicographic and chronological. That holds only for this shape, which is why
 * `reportDaySchema` normalises before this refinement sees it.
 */
export const reportFiltersSchema = z
  .object(reportFilterShape)
  .refine((value) => value.from <= value.to, {
    error: "The start date has to come before the end date.",
    path: ["to"],
  })
  .refine(
    (value) => inclusiveDayCount(value.from, value.to) <= MAX_REPORT_DAYS,
    {
      error: `A report can cover at most ${MAX_REPORT_DAYS} days. Narrow the date range.`,
      path: ["to"],
    },
  );

/**
 * What a report request is: the filters plus which §9.3 grouping to produce.
 *
 * Separate from `reportFiltersSchema` rather than an `.extend()` of it because
 * a refined zod schema is no longer an object schema and cannot be extended —
 * both are built from the same `reportFilterShape`, so the two cannot drift.
 */
export const reportRequestSchema = z
  .object({ ...reportFilterShape, grouping: reportGroupingSchema })
  .refine((value) => value.from <= value.to, {
    error: "The start date has to come before the end date.",
    path: ["to"],
  })
  .refine(
    (value) => inclusiveDayCount(value.from, value.to) <= MAX_REPORT_DAYS,
    {
      error: `A report can cover at most ${MAX_REPORT_DAYS} days. Narrow the date range.`,
      path: ["to"],
    },
  );

/**
 * Which of the two report shapes `/reports` is showing: §9.3's aggregate
 * groupings, or §9.7's entry-level list.
 *
 * **Not folded into `reportGroupingSchema`, and the separation is the point.**
 * A grouping names a `GROUP BY`; every member of that enum maps to a function
 * that aggregates. The detail view aggregates nothing — it has different
 * columns, different row semantics (a running entry appears in it, and in
 * nothing else), and no total of its own. Adding a seventh member would make
 * `csvForReport`'s and `describeReport`'s exhaustive switches claim to handle a
 * row shape they cannot produce.
 *
 * The two are orthogonal, so both live in the URL at once: switching to the
 * detail view and back returns you to the grouping you left.
 */
export const reportViewSchema = z.enum(
  ["summary", "detail"],
  "That isn't a report view this app can produce.",
);

export type ReportView = z.infer<typeof reportViewSchema>;

/**
 * Rows per page in §9.7's detail view.
 *
 * Matches `report_entries`' own `p_limit` default, so the two cannot silently
 * disagree about what "page 2" means. Well under the function's hard clamp of
 * 200, which is itself well under PostgREST's `max_rows = 1000`.
 */
export const ENTRIES_PER_PAGE = 50;

/**
 * The largest page number this schema will accept.
 *
 * At `ENTRIES_PER_PAGE` rows a page, this is an offset of half a million — far
 * past any real range, and the point is only that a hand-typed `?page=1e9`
 * becomes a refusal rather than an `OFFSET` the database has to count its way
 * to. A page past the end of a real result is *not* an error: it renders an
 * empty list with working "previous" navigation, the same as any paginated
 * list.
 */
const MAX_PAGE = 10_000;

/**
 * §9.7's request: the same range and filters every other report takes, plus
 * which page of the entry list is wanted.
 *
 * `page`, not `offset`, because the page number is what the URL carries and
 * what the pagination control reasons about; the offset is arithmetic the
 * action does once. Built from `reportFilterShape` and re-stating the same two
 * refinements for the same reason `reportRequestSchema` does — a refined schema
 * is no longer an object schema and cannot be extended.
 */
export const reportEntriesRequestSchema = z
  .object({
    ...reportFilterShape,
    // Coerced because this arrives from a query string, where every value is a
    // string. `.catch()` rather than a refusal: unlike a date, a malformed page
    // number has an obviously correct reading — the first one — and refusing
    // the whole report over it would be a worse answer than showing page 1.
    page: z.coerce.number().int().min(1).max(MAX_PAGE).catch(1),
  })
  .refine((value) => value.from <= value.to, {
    error: "The start date has to come before the end date.",
    path: ["to"],
  })
  .refine(
    (value) => inclusiveDayCount(value.from, value.to) <= MAX_REPORT_DAYS,
    {
      error: `A report can cover at most ${MAX_REPORT_DAYS} days. Narrow the date range.`,
      path: ["to"],
    },
  );

export type ReportEntriesRequestInput = z.input<
  typeof reportEntriesRequestSchema
>;
export type ReportEntriesRequest = z.output<typeof reportEntriesRequestSchema>;

/** What a caller passes in: ids may be omitted, blank, or null. */
export type ReportFiltersInput = z.input<typeof reportFiltersSchema>;

/** What the action works with: every id resolved to `string | null`. */
export type ReportFilters = z.output<typeof reportFiltersSchema>;

export type ReportRequestInput = z.input<typeof reportRequestSchema>;
export type ReportRequest = z.output<typeof reportRequestSchema>;
