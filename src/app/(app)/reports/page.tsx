import { ReportControls } from "@/components/reports/report-controls";
import { ReportDataTable } from "@/components/reports/report-data-table";
import {
  addDays,
  companyToday,
  formatDayRange,
} from "@/components/reports/report-days";
import { ReportEntriesTable } from "@/components/reports/report-entries-table";
import { ReportPagination } from "@/components/reports/report-pagination";
import {
  REPORT_GROUPINGS,
  resolveReportQuery,
  type ReportSearchParams,
} from "@/components/reports/report-params";
import { describeReport } from "@/components/reports/report-rows";
import { ReportSummaryHeader } from "@/components/reports/report-summary";
import { ReportViewTabs } from "@/components/reports/report-view-tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ActionResult } from "@/lib/actions/auth";
import { listClients } from "@/lib/actions/clients";
import { getCurrentMember, listMembers } from "@/lib/actions/companies";
import { listProjects } from "@/lib/actions/projects";
import {
  getReportByClient,
  getReportByDay,
  getReportByProject,
  getReportByTask,
  getReportByUser,
  getReportByUserProject,
  getReportEntries,
  getReportSummary,
  type ReportEntriesPage,
  type ReportResult,
} from "@/lib/actions/reports";
import type {
  ReportFiltersInput,
  ReportGrouping,
} from "@/lib/validations/reports";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Reports · Timey",
};

/** The default range when the URL names none: the last seven days, ending today. */
const DEFAULT_RANGE_DAYS = 7;

/**
 * Grouping → action, tagged so the renderer can narrow six row shapes without a
 * cast.
 *
 * `lib/actions/reports.ts` has this switch too, and it is not exported — a
 * `'use server'` module publishes every export as an endpoint, so its copy could
 * not be shared without also publishing it. Six named calls repeated here is the
 * cheaper of the two costs, and the compiler keeps them honest: `ReportGrouping`
 * is a closed enum and every arm returns, so a seventh grouping is a type error
 * rather than a blank page.
 */
async function runReport(
  grouping: ReportGrouping,
  filters: ReportFiltersInput,
): Promise<ActionResult<ReportResult>> {
  switch (grouping) {
    case "day": {
      const result = await getReportByDay(filters);
      return result.ok
        ? { ok: true, data: { grouping, rows: result.data } }
        : result;
    }
    case "user": {
      const result = await getReportByUser(filters);
      return result.ok
        ? { ok: true, data: { grouping, rows: result.data } }
        : result;
    }
    case "project": {
      const result = await getReportByProject(filters);
      return result.ok
        ? { ok: true, data: { grouping, rows: result.data } }
        : result;
    }
    case "task": {
      const result = await getReportByTask(filters);
      return result.ok
        ? { ok: true, data: { grouping, rows: result.data } }
        : result;
    }
    case "client": {
      const result = await getReportByClient(filters);
      return result.ok
        ? { ok: true, data: { grouping, rows: result.data } }
        : result;
    }
    case "user-project": {
      const result = await getReportByUserProject(filters);
      return result.ok
        ? { ok: true, data: { grouping, rows: result.data } }
        : result;
    }
  }
}

/**
 * Whichever of §9's two shapes the URL asked for, tagged with which one it is.
 *
 * The tag is what lets one `await` serve both: the two results have nothing in
 * common — grouped totals against a page of entries — and re-reading `query.view`
 * at the render site would not narrow the union it produced. Carrying the
 * discriminant alongside the value makes the branch below exhaustive and keeps
 * the fetch to a single `Promise.all`.
 */
type ReportViewResult =
  | { view: "summary"; result: ActionResult<ReportResult> }
  | { view: "detail"; result: ActionResult<ReportEntriesPage> };

async function runView(
  query: { view: "summary" | "detail"; grouping: ReportGrouping; page: number },
  filters: ReportFiltersInput,
): Promise<ReportViewResult> {
  if (query.view === "detail") {
    // The page is the one report parameter the aggregate actions have no use
    // for, which is why it is added here rather than living in `filters`.
    return {
      view: "detail",
      result: await getReportEntries({ ...filters, page: query.page }),
    };
  }

  return { view: "summary", result: await runReport(query.grouping, filters) };
}

/**
 * The employee-and-client caveat, which both empty states have to make.
 *
 * `clients` SELECT is company-wide (§4.2) while `time_entries` and `projects`
 * are not, so an employee can filter by a client they can see the name of and
 * get nothing back — and "you logged nothing for Acme" is the wrong reading of
 * that emptiness. Written once because it is the same sentence in both views:
 * the filter is the same `WHERE` clause either way.
 */
function ClientScopeNote() {
  return (
    <p>
      Everyone in the company can filter by any client, but you only see time on
      projects you are assigned to. Hours you logged on a project you have since
      been removed from won&rsquo;t appear under its client here — clear the
      client filter to see them.
    </p>
  );
}

/**
 * §9 on one route: one date range, six interchangeable groupings, four filters,
 * and the CSV of exactly what is on screen.
 *
 * **Both roles land here and the page does not branch on role for data.**
 * Everything below is RLS-scoped already: an employee's `time_entries` SELECT
 * returns their own rows, `listProjects()` returns only assigned projects
 * (§3.6.1), and `getReport*` replaces an employee's `userId` filter with their
 * own id rather than forwarding a colleague's (§9.2). The only role read is
 * whether to *offer* the person filter, which is a control with one possible
 * outcome for an employee — a convenience, never the boundary. An employee who
 * hand-edits `?userId=` into the URL gets their own report, not an error and not
 * somebody else's.
 *
 * The date range is resolved on the server so "today" is the company's today
 * (§6.1), not the browser's.
 *
 * **`?view=detail` swaps the results card for §9.7's entry list and changes
 * nothing else.** The range, the four filters and the scoping are identical —
 * one `WHERE` clause serving two shapes — so everything above the card is
 * fetched and rendered once for both, including the summary figures, which stay
 * the range's figures whichever view is on screen.
 *
 * It is the one report surface where a **running** entry appears. Every §9.3
 * grouping excludes them (§9.4) because a null duration cannot be summed; the
 * entry list has no sum to protect and marks them instead. That is also why the
 * detail card carries a caption pointing back at the header: the figures above
 * cover the whole range and exclude what is still in flight, while the table
 * below shows one page and includes it.
 */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<ReportSearchParams>;
}) {
  const params = await searchParams;

  const memberResult = await getCurrentMember();
  const member = memberResult.ok ? memberResult.data : null;
  const timezone = member?.company?.timezone ?? null;
  const isAdmin = member?.role === "admin" && member.status === "active";

  const today = companyToday(timezone, Date.now());
  const query = resolveReportQuery(params, {
    from: addDays(today, -(DEFAULT_RANGE_DAYS - 1)),
    to: today,
  });

  // Blank means "no filter" to `optionalUuidSchema`, so the strings go through
  // as they are. Nothing is validated here — the actions parse every one of
  // these and word their own refusals (§9.2).
  const filters: ReportFiltersInput = {
    from: query.from,
    to: query.to,
    userId: query.userId,
    clientId: query.clientId,
    projectId: query.projectId,
    taskId: query.taskId,
  };

  const [
    summaryResult,
    viewResult,
    clientsResult,
    projectsResult,
    membersResult,
  ] = await Promise.all([
    getReportSummary(filters),
    // One of the two shapes, never both — the view that is not on screen is not
    // worth a round trip — but still inside this `Promise.all`, so the summary
    // header and the results below it are fetched together rather than in turn.
    runView(query, filters),
    listClients(),
    listProjects(),
    // Skipped for an employee, who has no person filter to populate. A saved
    // round trip, not a permission: `profiles` SELECT is company-wide (§4.2).
    isAdmin ? listMembers() : Promise.resolve(null),
  ]);

  const model =
    viewResult.view === "summary" && viewResult.result.ok
      ? describeReport(viewResult.result.data)
      : null;
  const rows = model?.rows ?? [];
  const rangeLabel = formatDayRange(query.from, query.to);
  const groupingLabel =
    REPORT_GROUPINGS.find((grouping) => grouping.value === query.grouping)
      ?.label ?? "Day";

  const hasFilters = Boolean(
    query.userId || query.clientId || query.projectId || query.taskId,
  );
  const hasUnreadableLabels = rows.some((row) =>
    row.labels.some((label) => label.muted),
  );
  // The same question asked of the entry list, where the muting is per field
  // rather than per label cell. A null client is included on purpose: the note
  // it triggers covers internal work (§3.4) and an unreachable client label
  // together, because the row cannot tell which of the two it is.
  const detailHasUnreadableLabels =
    viewResult.view === "detail" &&
    viewResult.result.ok &&
    viewResult.result.data.rows.some(
      (row) =>
        row.userName === null ||
        row.projectName === null ||
        row.taskName === null ||
        row.clientName === null,
    );
  const runningCount = summaryResult.ok ? summaryResult.data.runningCount : 0;

  // §9.8.2 — a task filter makes expected undefined, so the two attendance
  // columns are omitted rather than zeroed. Said out loud for the same reason
  // the detail view explains its missing total: a column that is simply gone
  // reads as a bug, and the absence here is a ruling. The caption is scoped to
  // the two groupings that would otherwise carry the columns; nowhere else was
  // ever going to show them (§3.6.3), so explaining it under By project would
  // answer a question nobody asked.
  const taskFilterHidesExpected =
    Boolean(query.taskId) &&
    (query.grouping === "user" || query.grouping === "user-project");

  // A CSV of nothing helps nobody, and the two views count "nothing"
  // differently: the detail export is the whole range (§9.6), so it is the
  // server's `totalCount` that decides, not the length of the page on screen.
  const canExport =
    viewResult.view === "detail"
      ? viewResult.result.ok && viewResult.result.data.totalCount > 0
      : viewResult.result.ok && rows.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Reports</h1>
        <p className="text-muted-foreground text-sm">
          {isAdmin
            ? "Every entry in your company, grouped how you need it."
            : "Your own recorded time, grouped how you need it."}
          {timezone ? ` Days are counted in ${timezone}.` : ""}
        </p>
      </div>

      <ReportViewTabs query={query} />

      <ReportControls
        query={query}
        today={today}
        isAdmin={isAdmin}
        members={membersResult?.ok ? membersResult.data : []}
        clients={clientsResult.ok ? clientsResult.data : []}
        projects={projectsResult.ok ? projectsResult.data : []}
        canExport={canExport}
      />

      {summaryResult.ok ? (
        <ReportSummaryHeader
          summary={summaryResult.data}
          rangeLabel={rangeLabel}
        />
      ) : (
        <Card>
          <CardContent>
            <p className="text-destructive text-sm">{summaryResult.error}</p>
          </CardContent>
        </Card>
      )}

      {viewResult.view === "detail" ? (
        <Card>
          <CardHeader>
            <CardTitle>Every entry</CardTitle>
            <CardDescription>
              One row per entry, newest first. A running timer is shown but
              counts nothing until it is stopped.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {viewResult.result.ok ? (
              <>
                <ReportEntriesTable
                  rows={viewResult.result.data.rows}
                  // The same role read as the person filter above, and no more
                  // of a boundary: an employee's every row is their own, so the
                  // column would repeat one name down the page.
                  showPerson={isAdmin}
                  emptyState={
                    <div className="flex flex-col gap-2">
                      {/* Not "no time logged": this list includes running
                          entries, which have logged no time yet and would still
                          appear. Empty here means no entry at all. */}
                      <p className="text-foreground font-medium">
                        No entries in this range.
                      </p>
                      <p>
                        {hasFilters
                          ? `Nothing matching these filters started between ${rangeLabel}.`
                          : `Nothing was started between ${rangeLabel}.`}
                      </p>
                      {query.clientId && !isAdmin ? <ClientScopeNote /> : null}
                    </div>
                  }
                />

                <ReportPagination
                  query={query}
                  page={viewResult.result.data.page}
                  perPage={viewResult.result.data.perPage}
                  totalCount={viewResult.result.data.totalCount}
                />

                {viewResult.result.data.rows.length > 0 ? (
                  <div className="text-muted-foreground flex flex-col gap-1 text-xs">
                    {/* Said out loud because the two disagree by design: the
                        header counts only stopped entries over the whole range
                        (§9.4), and this table is one page of it with the
                        running ones in. Neither is wrong; without this line
                        they just look it. */}
                    <p>
                      The figures above cover the whole range and count only
                      stopped entries. This table shows one page of it, running
                      entries included.
                    </p>
                    {detailHasUnreadableLabels ? (
                      <p>
                        A greyed-out label is one this report can&rsquo;t name:
                        a project, task or person you can no longer see, or work
                        with no client at all.
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : (
              <p className="text-destructive text-sm">
                {viewResult.result.error}
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>By {groupingLabel.toLocaleLowerCase()}</CardTitle>
            <CardDescription>
              {query.grouping === "day"
                ? "An entry counts entirely on the day it started, even if it ran past midnight."
                : "Running timers are excluded — time counts only once it has been stopped."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {viewResult.result.ok && model ? (
              <>
                <ReportDataTable
                  model={model}
                  emptyState={
                    <div className="flex flex-col gap-2">
                      <p className="text-foreground font-medium">
                        No time logged in this range.
                      </p>
                      <p>
                        {hasFilters
                          ? `Nothing matching these filters was recorded between ${rangeLabel}.`
                          : `Nothing was recorded between ${rangeLabel}.`}
                      </p>
                      {runningCount > 0 ? (
                        <p>
                          A timer is running right now. Running time is never
                          counted until it is stopped.
                        </p>
                      ) : null}
                      {query.clientId && !isAdmin ? <ClientScopeNote /> : null}
                    </div>
                  }
                />
                {taskFilterHidesExpected ? (
                  <p className="text-muted-foreground text-xs">
                    Expected hours aren&rsquo;t shown while a task filter is
                    set. Hours are expected per project, not per task, so there
                    is no target for one task to compare against — clear the
                    task filter to see them.
                  </p>
                ) : null}
                {hasUnreadableLabels ? (
                  <p className="text-muted-foreground text-xs">
                    A greyed-out label is one this report can&rsquo;t name: a
                    project, task or person you can no longer see, or — under
                    Client — work that has no client at all. The hours are
                    counted either way.
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-destructive text-sm">
                {viewResult.result.ok
                  ? "Could not build that report."
                  : viewResult.result.error}
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
