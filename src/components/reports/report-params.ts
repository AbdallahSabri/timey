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
  reportViewSchema,
  type ReportGrouping,
  type ReportView,
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
  /**
   * Which of the two shapes is on screen. Orthogonal to `grouping`, which is
   * carried unchanged while the detail view is showing so that coming back
   * lands on the grouping you left rather than on the default one.
   */
  view: ReportView;
  grouping: ReportGrouping;
  userId: string;
  clientId: string;
  projectId: string;
  taskId: string;
  /** 1-based, and only ever consulted by the detail view. */
  page: number;
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
 * Three fields fall back silently, and all three for the same reason: each one
 * chooses *which query runs* rather than describing the answer, so it has to be
 * a member of a closed set before anything can run at all, and a value outside
 * that set can only come from a hand-edited URL.
 *
 *   * `view` picks between §9.3's aggregate actions and §9.7's entry list;
 *     anything but `detail` reads as `summary`.
 *   * `grouping` picks which of the six aggregate actions the page calls.
 *   * `page` is an offset into a result set, and every wrong shape of it — a
 *     word, a zero, a negative — has one obviously correct reading, the first
 *     page. Parsing is permissive rather than strict for that reason; the
 *     *ceiling* is `reportEntriesRequestSchema`'s to enforce, since a page far
 *     past the end is a legal request that happens to be empty, not a typo.
 *
 * Dates do **not** fall back — a typo in `from` must produce the schema's
 * "Enter a date like 2026-08-25", not a report of some other range that looks
 * like it worked.
 */
export function resolveReportQuery(
  params: ReportSearchParams,
  defaults: { from: string; to: string },
): ReportQuery {
  const view = reportViewSchema.safeParse(readParam(params, "view"));
  const grouping = reportGroupingSchema.safeParse(
    readParam(params, "grouping"),
  );

  // `parseInt` and not `Number` so that a trailing-garbage value still yields
  // the number a reader would say out loud; `Number("3x")` is NaN, which would
  // send someone who mangled a URL back to page 1 for no visible reason.
  const page = Number.parseInt(readParam(params, "page"), 10);

  return {
    from: readParam(params, "from") || defaults.from,
    to: readParam(params, "to") || defaults.to,
    view: view.success ? view.data : "summary",
    grouping: grouping.success ? grouping.data : "day",
    userId: readParam(params, "userId"),
    clientId: readParam(params, "clientId"),
    projectId: readParam(params, "projectId"),
    taskId: readParam(params, "taskId"),
    page: Number.isFinite(page) && page >= 1 ? page : 1,
  };
}

function toSearchParams(query: ReportQuery): URLSearchParams {
  const search = new URLSearchParams({
    from: query.from,
    to: query.to,
    grouping: query.grouping,
  });

  // Empty filters are left out entirely rather than sent as blanks, so the URL
  // reads as the report does: only what is actually narrowing it appears. The
  // view and the page follow the same rule from the other side — each has a
  // default that needs no announcing, so `?view=summary&page=1` never appears.
  // `grouping` is the exception and stays unconditional: it survives a trip
  // through the detail view precisely because it is always written down.
  if (query.view === "detail") {
    search.set("view", query.view);
  }

  if (query.page > 1) {
    search.set("page", String(query.page));
  }

  for (const key of ["userId", "clientId", "projectId", "taskId"] as const) {
    if (query[key]) {
      search.set(key, query[key]);
    }
  }

  return search;
}

/**
 * `/reports?…` for a query, optionally with fields replaced.
 *
 * **Any override that is not the page itself resets the page to 1.** Every
 * other field narrows or re-shapes the result set, and page 4 of the old one
 * has no guaranteed counterpart in the new one — filtering to a single client
 * while on the last page would otherwise land on a legal, empty list that reads
 * as "this client has no time" instead of "you are past the end". An explicit
 * `{ page: n }` is the one thing that means "same question, different page", so
 * it is honoured; the check is on the key's presence, not its value, so that a
 * caller assembling overrides dynamically cannot lose the intent.
 */
export function reportHref(
  query: ReportQuery,
  overrides: Partial<ReportQuery> = {},
): string {
  const page = "page" in overrides ? (overrides.page ?? 1) : 1;

  return `/reports?${toSearchParams({ ...query, ...overrides, page }).toString()}`;
}

/**
 * The §9.6 download, which is the same query against the route handler that
 * writes `Content-Disposition`. A plain URL on purpose: it can be a link, a
 * middle-click, or a "save as", none of which a fetch-then-Blob dance supports.
 *
 * It carries `view`, so the handler exports the shape on screen — the grouped
 * totals or the entry list. It never carries `page`, and cannot: `page` is
 * above 1 only when the detail view is paginated, and a CSV of one screenful is
 * not a document anyone asked for. The detail export is the whole range.
 */
export function reportExportHref(query: ReportQuery): string {
  const search = toSearchParams(query);
  search.delete("page");

  return `/api/reports/export?${search.toString()}`;
}
