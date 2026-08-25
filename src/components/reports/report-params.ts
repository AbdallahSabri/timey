/**
 * The report's state lives in the URL, and this module is the only place that
 * knows its shape.
 *
 * **Why the URL and not component state.** A report is a question with an
 * answer — "what did the team do in August" — and both halves want to be
 * linkable: reloading keeps the view, a colleague can be sent the exact figures
 * being discussed, and the CSV download is the same query string pointed at
 * `/api/reports/export`, so "export what I'm looking at" is true by
 * construction rather than by two pieces of state being kept in step.
 *
 * Nothing here validates: `reportFiltersSchema` does that inside every action,
 * and re-deciding "is this a real date" in the UI is how two answers to the same
 * question start to disagree. A malformed `from` is passed through and the
 * action's own sentence is what the page renders.
 */

import {
  reportGroupingSchema,
  type ReportGrouping,
} from "@/lib/validations/reports";

/** The §9.3 groupings in the order the selector offers them. */
export const REPORT_GROUPINGS: { value: ReportGrouping; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "user", label: "Person" },
  { value: "project", label: "Project" },
  { value: "task", label: "Task" },
  { value: "client", label: "Client" },
  { value: "user-project", label: "Person × project" },
];

/** What Next hands a page: repeated keys arrive as arrays. */
export type ReportSearchParams = Record<string, string | string[] | undefined>;

/**
 * Resolved report state. Every filter is a string, and `""` means "no filter" —
 * the same thing an unselected `<option value="">` posts, and what
 * `optionalUuidSchema` already reads as absent.
 */
export type ReportQuery = {
  from: string;
  to: string;
  grouping: ReportGrouping;
  userId: string;
  clientId: string;
  projectId: string;
  taskId: string;
};

function readParam(params: ReportSearchParams, key: string): string {
  const value = params[key];
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }

  return value ?? "";
}

/**
 * Search params → report state, filling in a default range when none was asked
 * for.
 *
 * The grouping is the one field that falls back silently: it decides which of
 * the seven actions the page calls, so it has to be one of the six names before
 * anything can run, and a value that is not one of them can only come from a
 * hand-edited URL. Dates do **not** fall back — a typo in `from` must produce
 * the schema's "Enter a date like 2026-08-25", not a report of some other range
 * that looks like it worked.
 */
export function resolveReportQuery(
  params: ReportSearchParams,
  defaults: { from: string; to: string },
): ReportQuery {
  const grouping = reportGroupingSchema.safeParse(
    readParam(params, "grouping"),
  );

  return {
    from: readParam(params, "from") || defaults.from,
    to: readParam(params, "to") || defaults.to,
    grouping: grouping.success ? grouping.data : "day",
    userId: readParam(params, "userId"),
    clientId: readParam(params, "clientId"),
    projectId: readParam(params, "projectId"),
    taskId: readParam(params, "taskId"),
  };
}

function toSearchParams(query: ReportQuery): URLSearchParams {
  const search = new URLSearchParams({
    from: query.from,
    to: query.to,
    grouping: query.grouping,
  });

  // Empty filters are left out entirely rather than sent as blanks, so the URL
  // reads as the report does: only what is actually narrowing it appears.
  for (const key of ["userId", "clientId", "projectId", "taskId"] as const) {
    if (query[key]) {
      search.set(key, query[key]);
    }
  }

  return search;
}

/** `/reports?…` for a query, optionally with fields replaced. */
export function reportHref(
  query: ReportQuery,
  overrides: Partial<ReportQuery> = {},
): string {
  return `/reports?${toSearchParams({ ...query, ...overrides }).toString()}`;
}

/**
 * The §9.6 download, which is the same query against the route handler that
 * writes `Content-Disposition`. A plain URL on purpose: it can be a link, a
 * middle-click, or a "save as", none of which a fetch-then-Blob dance supports.
 */
export function reportExportHref(query: ReportQuery): string {
  return `/api/reports/export?${toSearchParams(query).toString()}`;
}
