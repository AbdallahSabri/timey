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

import type {
  ReportClientRow,
  ReportDayRow,
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
// ---------------------------------------------------------------------------

const dayColumns: CsvColumn<ReportDayRow>[] = [
  // The company-local calendar day (§6.1), already `YYYY-MM-DD` from Postgres.
  // Left as text rather than reformatted: every spreadsheet reads ISO as a date,
  // and any locale-specific rendering here would be the *server's* locale.
  { header: "Date", value: (row) => row.day },
  ...durationColumns<ReportDayRow>(),
];

const userColumns: CsvColumn<ReportUserRow>[] = [
  { header: "User", value: (row) => row.userName },
  ...durationColumns<ReportUserRow>(),
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
