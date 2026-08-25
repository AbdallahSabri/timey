import { ReportControls } from "@/components/reports/report-controls";
import { ReportDataTable } from "@/components/reports/report-data-table";
import {
  addDays,
  companyToday,
  formatDayRange,
} from "@/components/reports/report-days";
import {
  REPORT_GROUPINGS,
  resolveReportQuery,
  type ReportSearchParams,
} from "@/components/reports/report-params";
import { describeReport } from "@/components/reports/report-rows";
import { ReportSummaryHeader } from "@/components/reports/report-summary";
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
  getReportSummary,
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
    reportResult,
    clientsResult,
    projectsResult,
    membersResult,
  ] = await Promise.all([
    getReportSummary(filters),
    runReport(query.grouping, filters),
    listClients(),
    listProjects(),
    // Skipped for an employee, who has no person filter to populate. A saved
    // round trip, not a permission: `profiles` SELECT is company-wide (§4.2).
    isAdmin ? listMembers() : Promise.resolve(null),
  ]);

  const model = reportResult.ok ? describeReport(reportResult.data) : null;
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
  const runningCount = summaryResult.ok ? summaryResult.data.runningCount : 0;

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

      <ReportControls
        query={query}
        today={today}
        isAdmin={isAdmin}
        members={membersResult?.ok ? membersResult.data : []}
        clients={clientsResult.ok ? clientsResult.data : []}
        projects={projectsResult.ok ? projectsResult.data : []}
        canExport={reportResult.ok && rows.length > 0}
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
          {reportResult.ok && model ? (
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
                    {query.clientId && !isAdmin ? (
                      <p>
                        Everyone in the company can filter by any client, but
                        you only see time on projects you are assigned to. Hours
                        you logged on a project you have since been removed from
                        won&rsquo;t appear under its client here — clear the
                        client filter to see them.
                      </p>
                    ) : null}
                  </div>
                }
              />
              {hasUnreadableLabels ? (
                <p className="text-muted-foreground text-xs">
                  A greyed-out label is one this report can&rsquo;t name: a
                  project, task or person you can no longer see, or — under
                  Client — work that has no client at all. The hours are counted
                  either way.
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-destructive text-sm">
              {reportResult.ok
                ? "Could not build that report."
                : reportResult.error}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
