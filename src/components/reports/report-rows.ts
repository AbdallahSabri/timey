/**
 * Six report shapes → one table model, and the single place where a label the
 * caller could not read becomes words on a screen.
 *
 * **Every label column from the actions is `string | null`, and the null is
 * real** (`lib/actions/reports.ts` documents it at length): §2.3 keeps a removed
 * employee's time entries while §3.6.1 takes away their `projects` SELECT, so a
 * report can legitimately arrive with hours attached to a project whose name is
 * not readable. The rules below, in one module so they cannot drift between
 * groupings:
 *
 *   * A missing **name** reads "Unknown project" / "Unknown task" /
 *     "Unknown person" — never blank, never the string "null", and never the
 *     row silently dropped.
 *   * A missing **client** reads "No client" as a line item and "—" as an
 *     attribute of some other row. It must never read "Internal": the null
 *     group mixes genuinely internal projects (§3.4 makes `client_id` nullable)
 *     with projects whose client label this caller can no longer reach, and
 *     naming it "Internal" would be a confident lie about the second kind.
 *
 * The CSV writes the same cells **empty** (`lib/reports/columns.ts` explains
 * why: a placeholder is indistinguishable from a real name in a re-imported
 * file). The two are deliberately different — a spreadsheet has no room to
 * qualify a guess and a screen does.
 *
 * Pure, and importable from anywhere: no React, no Supabase, no `next/*`.
 */

import { formatDayLabel } from "@/components/reports/report-days";
import type { ReportResult } from "@/lib/actions/reports";

export const UNKNOWN_PERSON = "Unknown person";
export const UNKNOWN_PROJECT = "Unknown project";
export const UNKNOWN_TASK = "Unknown task";
/** The by-client grouping's null bucket, which is a row of its own. */
export const NO_CLIENT_GROUP = "No client";
/** The same absence as a column on a project or cross-tab row. */
export const NO_CLIENT_CELL = "—";

/**
 * One label cell.
 *
 * `sortKey` is separate from `text` because the two differ wherever the display
 * is prettier than the data: a day sorts by `2026-08-10` and reads
 * "Mon, 10 Aug 2026", and sorting the rendered string would put April before
 * August. `muted` marks a placeholder so the table can style it as the absence
 * it is rather than as a name.
 */
export type ReportCell = {
  text: string;
  sortKey: string;
  muted: boolean;
};

export type ReportRow = {
  /** Stable per row within a report; used as the React key. */
  key: string;
  labels: ReportCell[];
  entryCount: number;
  totalSeconds: number;
};

export type ReportTableModel = {
  /** Headers for the label columns. Entries and duration are appended by the table. */
  labelHeaders: string[];
  rows: ReportRow[];
};

/** A readable label: present, so it sorts and renders as itself. */
function label(text: string): ReportCell {
  return { text, sortKey: text.toLocaleLowerCase(), muted: false };
}

/** An absent label: the placeholder is what sorts, so the unknowns group together. */
function placeholder(text: string): ReportCell {
  return { text, sortKey: text.toLocaleLowerCase(), muted: true };
}

function nameCell(name: string | null, unknown: string): ReportCell {
  return name === null ? placeholder(unknown) : label(name);
}

function clientCell(name: string | null, absent: string): ReportCell {
  return name === null ? placeholder(absent) : label(name);
}

function dayCell(day: string): ReportCell {
  return { text: formatDayLabel(day), sortKey: day, muted: false };
}

/**
 * The column order matches `lib/reports/columns.ts` exactly — project before
 * task, person before project, client after project — so the screen and the
 * exported file are read the same way round. That file is the CSV's contract
 * and cannot be imported for its layout (its columns are `CsvColumn`s that
 * produce raw values, not display text), so it is followed rather than reused.
 */
export function describeReport(result: ReportResult): ReportTableModel {
  switch (result.grouping) {
    case "day":
      return {
        labelHeaders: ["Date"],
        rows: result.rows.map((row) => ({
          key: row.day,
          labels: [dayCell(row.day)],
          entryCount: row.entryCount,
          totalSeconds: row.totalSeconds,
        })),
      };

    case "user":
      return {
        labelHeaders: ["Person"],
        rows: result.rows.map((row) => ({
          key: row.userId,
          labels: [nameCell(row.userName, UNKNOWN_PERSON)],
          entryCount: row.entryCount,
          totalSeconds: row.totalSeconds,
        })),
      };

    case "project":
      return {
        labelHeaders: ["Project", "Client"],
        rows: result.rows.map((row) => ({
          key: row.projectId,
          labels: [
            nameCell(row.projectName, UNKNOWN_PROJECT),
            clientCell(row.clientName, NO_CLIENT_CELL),
          ],
          entryCount: row.entryCount,
          totalSeconds: row.totalSeconds,
        })),
      };

    case "task":
      return {
        labelHeaders: ["Project", "Task"],
        rows: result.rows.map((row) => ({
          key: row.taskId,
          labels: [
            nameCell(row.projectName, UNKNOWN_PROJECT),
            nameCell(row.taskName, UNKNOWN_TASK),
          ],
          entryCount: row.entryCount,
          totalSeconds: row.totalSeconds,
        })),
      };

    case "client":
      return {
        labelHeaders: ["Client"],
        rows: result.rows.map((row) => ({
          // The null bucket is one row and needs a key that is not null. It can
          // occur at most once, so a literal is enough.
          key: row.clientId ?? "no-client",
          labels: [clientCell(row.clientName, NO_CLIENT_GROUP)],
          entryCount: row.entryCount,
          totalSeconds: row.totalSeconds,
        })),
      };

    case "user-project":
      return {
        labelHeaders: ["Person", "Project", "Client"],
        rows: result.rows.map((row) => ({
          key: `${row.userId}:${row.projectId}`,
          labels: [
            nameCell(row.userName, UNKNOWN_PERSON),
            nameCell(row.projectName, UNKNOWN_PROJECT),
            clientCell(row.clientName, NO_CLIENT_CELL),
          ],
          entryCount: row.entryCount,
          totalSeconds: row.totalSeconds,
        })),
      };
  }
}

/**
 * The visible line items, added up.
 *
 * §12.2 asks that "report totals equal the sum of their own visible line items",
 * and this is the on-screen half of that check: the footer computed from the
 * rows the user can see, against the summary header computed by `report_summary`
 * in SQL. Two independent paths to the same number, shown together, so a
 * disagreement is visible rather than inferred.
 *
 * Integer seconds throughout (§9.5) — nothing here becomes hours until it is
 * formatted.
 */
export function totalsOf(rows: ReportRow[]): {
  entryCount: number;
  totalSeconds: number;
} {
  return rows.reduce(
    (running, row) => ({
      entryCount: running.entryCount + row.entryCount,
      totalSeconds: running.totalSeconds + row.totalSeconds,
    }),
    { entryCount: 0, totalSeconds: 0 },
  );
}
