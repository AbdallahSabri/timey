/**
 * Column definitions for §9.6's "CSV export of any report view" — the one place
 * that decides what a report *looks like* as a file.
 *
 * `csv.ts` owns quoting and knows nothing about reports; `actions/reports.ts`
 * owns fetching and knows nothing about presentation. This module is the seam,
 * and it is a plain module rather than part of either: a `'use server'` file can
 * only export async functions, so column tables placed there could not be
 * exported at all without publishing each as an endpoint, and could not be unit
 * tested.
 */

import { differenceSeconds } from "@/components/reports/report-expected";
import type {
  ReportClientRow,
  ReportDayRow,
  ReportEntryRow,
  ReportProjectRow,
  ReportResult,
  ReportTaskRow,
  ReportUserProjectRow,
  ReportUserRow,
} from "@/lib/actions/reports";
import { formatSecondsHms, toCsv, type CsvColumn } from "@/lib/reports/csv";

/**
 * Every grouping ends with the same two duration columns, in this order.
 *
 * **Both, not one.** The integer is what anyone re-importing or re-summing the
 * file must use — §9.5's whole point is that hours are never the unit of
 * arithmetic — and `H:MM:SS` is what an admin reconciles against the screen. A
 * decimal-hours column is deliberately absent: it exists only to be summed, and
 * summing it is the drift §9.5 forbids.
 *
 * Generic over the row type because every §9.3 grouping carries these two
 * fields under the same names; the alternative is six copies of the same pair.
 */
function durationColumns<
  Row extends { entryCount: number; totalSeconds: number },
>(): CsvColumn<Row>[] {
  return [
    { header: "Entries", value: (row) => row.entryCount },
    { header: "Duration (seconds)", value: (row) => row.totalSeconds },
    { header: "Duration", value: (row) => formatSecondsHms(row.totalSeconds) },
  ];
}

// ---------------------------------------------------------------------------
// The six column tables
//
// A label the caller could not read is written as an EMPTY FIELD, which is what
// `csvField` already does with null — no placeholder is invented in any table
// below.
//
// Two reasons it stays empty rather than becoming "Unknown project" or "—": the
// string would be indistinguishable from a real name in a re-imported file, and
// every label this can replace is NOT NULL and non-blank at the database
// (`clients.name`, `projects.name`, `tasks.name`, and §4.2.1's non-blank
// `profiles.full_name`), so an empty cell unambiguously means "no label was
// readable" and can never be confused with a row genuinely named "".
//
// The on-screen wording is build-ui's call and can be as explicit as it likes;
// a spreadsheet has no tooltip to qualify a guess with.
//
// §9.7's entry table below adds a SECOND meaning for a blank cell, and that is
// why it carries a column the six aggregate tables do not. In `entryColumns` an
// empty End or Duration does not mean "unreadable" — it means the timer is still
// running (§9.4, 0013's DEPARTURE 1), which is a fact about the entry rather
// than about the reader. The two are indistinguishable by emptiness alone, so
// the reading is made explicit in its own `Status` column instead of being
// inferred from which cells happen to be blank.
// ---------------------------------------------------------------------------

const dayColumns: CsvColumn<ReportDayRow>[] = [
  // The company-local calendar day (§6.1), already `YYYY-MM-DD` from Postgres.
  // Left as text rather than reformatted: every spreadsheet reads ISO as a date,
  // and any locale-specific rendering here would be the *server's* locale.
  { header: "Date", value: (row) => row.day },
  ...durationColumns<ReportDayRow>(),
];

/**
 * §9.8.1's attendance pair, appended after the duration columns so the file
 * reads in the same order as the screen: labels, Entries, Duration, Expected,
 * Difference. `report-rows.ts` states that contract from the other side and a
 * test asserts it.
 *
 * **A null `expectedSeconds` writes both cells EMPTY, never `0:00:00`.** Null
 * means expected is not a meaningful quantity for this row (§9.8.2's task
 * filter — schedules are per project, so hours owed against one task is not a
 * number that exists), and a zero in a spreadsheet is a value somebody will sum.
 * This is the same reading an empty cell has everywhere else in this file, and
 * the same choice `entryColumns` makes for a running entry's Duration.
 *
 * **Difference carries its sign explicitly**, because `formatSecondsHms` clamps
 * negatives to `0:00:00` — a shortfall passed to it raw would export as "no
 * difference", which is the one value it must never read as. The direction
 * comes from `differenceSeconds` rather than from a subtraction written here,
 * so the file and the screen cannot disagree about which way behind points.
 *
 * Only the `H:MM:SS` form, with no integer sibling. That breaks the pattern
 * `durationColumns` sets and does so knowingly: a signed cell is not summable
 * text either way, and the seconds anyone re-summing needs are already in the
 * file — Expected is `Duration (seconds)` minus the Difference, both of which
 * are exported beside it.
 */
function expectedColumns<
  Row extends { totalSeconds: number; expectedSeconds: number | null },
>(): CsvColumn<Row>[] {
  return [
    {
      header: "Expected",
      value: (row) =>
        row.expectedSeconds === null
          ? null
          : formatSecondsHms(row.expectedSeconds),
    },
    {
      header: "Difference",
      value: (row) => {
        const difference = differenceSeconds(
          row.totalSeconds,
          row.expectedSeconds,
        );
        if (difference === null) {
          return null;
        }

        return `${difference < 0 ? "-" : ""}${formatSecondsHms(Math.abs(difference))}`;
      },
    },
  ];
}

const userColumns: CsvColumn<ReportUserRow>[] = [
  { header: "User", value: (row) => row.userName },
  ...durationColumns<ReportUserRow>(),
  ...expectedColumns<ReportUserRow>(),
];

const projectColumns: CsvColumn<ReportProjectRow>[] = [
  { header: "Project", value: (row) => row.projectName },
  { header: "Client", value: (row) => row.clientName },
  ...durationColumns<ReportProjectRow>(),
];

const taskColumns: CsvColumn<ReportTaskRow>[] = [
  // Project first, matching the SQL's sort key: §3.5.2 gives every project a
  // task named "General", so the task column alone repeats itself.
  { header: "Project", value: (row) => row.projectName },
  { header: "Task", value: (row) => row.taskName },
  ...durationColumns<ReportTaskRow>(),
];

const clientColumns: CsvColumn<ReportClientRow>[] = [
  // The blank cell here is a whole line item, not a missing attribute — it is
  // internal work (§3.4) and unreadable-label work together, and neither this
  // file nor the SQL can separate them. It must never be written "Internal".
  { header: "Client", value: (row) => row.clientName },
  ...durationColumns<ReportClientRow>(),
];

const userProjectColumns: CsvColumn<ReportUserProjectRow>[] = [
  { header: "User", value: (row) => row.userName },
  { header: "Project", value: (row) => row.projectName },
  { header: "Client", value: (row) => row.clientName },
  ...durationColumns<ReportUserProjectRow>(),
  ...expectedColumns<ReportUserProjectRow>(),
];

/** The `Status` cell on a running entry. Empty on a closed one — see below. */
const IN_PROGRESS = "In progress";

/** `"2026-09-01T09:02:11"` → `"09:02"`. */
function clockOf(localTimestamp: string): string {
  // A fixed-width slice rather than a Date: the value is already a company wall
  // clock with no offset (0013's DEPARTURE 2), and `new Date(...)` would read it
  // in whatever zone the server happens to run in and hand back a different
  // time. Seconds are dropped because a timesheet is read to the minute; the
  // full instant is not lost, since `Duration (seconds)` carries the exact
  // length the database computed.
  return localTimestamp.slice(11, 16);
}

/**
 * §9.7's entry table: one line per time entry, in the order the detail view
 * reads.
 *
 * **Why this does not reuse `durationColumns()`.** That helper is generic over
 * `{ entryCount: number; totalSeconds: number }` — an aggregate shape — and an
 * entry row has neither field. It is one entry, so a count of entries would be
 * the constant 1, and its duration is `durationSeconds`, which is nullable in a
 * way no total is: null means running, not zero. The two duration columns are
 * still both here, for §9.5's reason unchanged — the integer is what anyone
 * re-summing the file must use, the `H:MM:SS` is what an admin reconciles
 * against the screen.
 *
 * **A running row leaves End, Duration (seconds) and Duration all empty** rather
 * than writing 0, and `Status` says "In progress" so that emptiness cannot be
 * read as a missing label. Writing 0 would put a completed zero-length entry in
 * the file, which sums silently and wrongly (0013's DEPARTURE 1 says this at
 * length); `Status` is left empty on a closed row for the same reason no other
 * cell in this file invents a placeholder — a spreadsheet filter on the blank
 * cells of one column is how someone finds every running entry, and a word like
 * "Complete" in the other rows makes that column two words rather than one flag.
 */
const entryColumns: CsvColumn<ReportEntryRow>[] = [
  // The company-local day (§6.1), which for a shift crossing midnight is the day
  // it STARTED (§5.5) — the row is not split, so this can differ from the
  // calendar day the End column's clock belongs to.
  { header: "Date", value: (row) => row.day },
  { header: "User", value: (row) => row.userName },
  { header: "Start", value: (row) => clockOf(row.startedAt) },
  {
    header: "End",
    value: (row) => (row.endedAt === null ? null : clockOf(row.endedAt)),
  },
  {
    header: "Status",
    value: (row) => (row.endedAt === null ? IN_PROGRESS : null),
  },
  { header: "Duration (seconds)", value: (row) => row.durationSeconds },
  {
    header: "Duration",
    value: (row) =>
      row.durationSeconds === null
        ? null
        : formatSecondsHms(row.durationSeconds),
  },
  { header: "Client", value: (row) => row.clientName },
  { header: "Project", value: (row) => row.projectName },
  { header: "Task", value: (row) => row.taskName },
  // §3.7's enum, written as the database's own token ("timer" / "manual")
  // rather than a prettified label: this column exists to be filtered on, and a
  // translated word would not match what any other export or query calls it.
  { header: "Source", value: (row) => row.source },
  // Last because it is the only free-text column — a note carrying a comma, a
  // quote or a newline is quoted by `csvField`, and a long one at the end of the
  // record is the one place that cannot push another column out of view.
  { header: "Note", value: (row) => row.note },
];

/**
 * A finished report → a CSV document.
 *
 * The switch narrows `ReportResult` by its `grouping` tag, which is why the
 * actions return that tag at all: without it, pairing six row shapes with six
 * column tables would need a cast, and a mismatched pair would compile.
 */
export function csvForReport(result: ReportResult): string {
  switch (result.grouping) {
    case "day":
      return toCsv(dayColumns, result.rows);
    case "user":
      return toCsv(userColumns, result.rows);
    case "project":
      return toCsv(projectColumns, result.rows);
    case "task":
      return toCsv(taskColumns, result.rows);
    case "client":
      return toCsv(clientColumns, result.rows);
    case "user-project":
      return toCsv(userProjectColumns, result.rows);
  }
}

/**
 * The download's filename, e.g. `timey-by-day-2026-08-01-to-2026-08-31.csv`.
 *
 * Every part is either a literal or a value that has already been through
 * `reportRequestSchema` — the grouping is a closed enum and the dates match
 * `^\d{4}-\d{2}-\d{2}$` — so nothing here can introduce a quote, a semicolon or
 * a CRLF into the `Content-Disposition` header that carries it. That is a
 * property of the validated input, not of this function, which is why the
 * caller must pass validated values and not raw query parameters.
 */
export function reportCsvFilename(
  grouping: ReportResult["grouping"],
  from: string,
  to: string,
): string {
  return `timey-by-${grouping}-${from}-to-${to}.csv`;
}

/**
 * §9.7's rows → a CSV document.
 *
 * A plain function rather than an arm of `csvForReport`'s switch: that switch is
 * closed over `ReportResult`, whose six variants all aggregate, and the detail
 * view is deliberately not a seventh grouping (§9.7). Keeping it out is what
 * lets the switch stay exhaustive without a default arm.
 */
export function csvForReportEntries(rows: ReportEntryRow[]): string {
  return toCsv(entryColumns, rows);
}

/**
 * The detail download's filename, e.g.
 * `timey-entries-2026-08-01-to-2026-08-31.csv`.
 *
 * `entries` rather than a grouping name, because there is no grouping — the file
 * is a list, and the name should not suggest it has been summarised.
 *
 * The same safety argument as `reportCsvFilename` applies unchanged and for the
 * same reason: every part is either a literal or a `YYYY-MM-DD` that has already
 * been through `reportEntriesRequestSchema`'s `reportDaySchema`, so nothing here
 * can introduce a quote, a semicolon or a CRLF into the `Content-Disposition`
 * header that carries it. That is a property of the validated input rather than
 * of this function, which is why the caller must pass validated values and never
 * raw query parameters.
 */
export function reportEntriesCsvFilename(from: string, to: string): string {
  return `timey-entries-${from}-to-${to}.csv`;
}
