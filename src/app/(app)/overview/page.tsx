import Link from "next/link";
import { redirect } from "next/navigation";

import { DayBarChart, type DayBar } from "@/components/charts/day-bar-chart";
import { fillDaySeries, maxSecondsOf } from "@/components/charts/day-series";
import { ProportionBarList } from "@/components/charts/proportion-bar-list";
import { topNWithOther } from "@/components/charts/top-n";
import { TeamAttendanceList } from "@/components/dashboard/team-attendance-list";
import { TeamRunningTimers } from "@/components/dashboard/team-running-timers";
import {
  addDays,
  companyToday,
  dayOfWeek,
  formatDayRange,
  startOfMonth,
} from "@/components/reports/report-days";
import {
  resolveReportQuery,
  reportHref,
} from "@/components/reports/report-params";
import {
  NO_CLIENT_CELL,
  UNKNOWN_PROJECT,
} from "@/components/reports/report-rows";
import {
  FIGURE_UNAVAILABLE,
  StatTile,
  StatTileGrid,
} from "@/components/structure/stat-tile";
import { DEFAULT_MAX_TIMER_HOURS } from "@/components/time-entries/elapsed";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getCurrentMember } from "@/lib/actions/companies";
import { listPendingCorrectionRequests } from "@/lib/actions/corrections";
import {
  getReportByDay,
  getReportByProject,
  getReportByUser,
  getReportSummary,
} from "@/lib/actions/reports";
import { listRunningTimers } from "@/lib/actions/time-entries";
import { formatSecondsHms } from "@/lib/reports/csv";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Overview · Timey",
};

/** Long enough to see a rhythm, short enough to read at phone width. */
const CHART_DAYS = 14;

/** How many people fit the attendance card before it defers to `/reports`. */
const ATTENDANCE_LIMIT = 8;

/** Projects shown before the tail collapses into one "Other". */
const BREAKDOWN_LIMIT = 6;

/**
 * Running timers rendered. Each row owns a 1 Hz interval, so this is a bound on
 * work rather than on layout; the tile above still counts the whole set, and the
 * list is ordered oldest-first so the stale ones are the rows that survive.
 */
const RUNNING_LIMIT = 8;

/**
 * §9.9's admin surface: the team, now and this month.
 *
 * **`/dashboard` is deliberately still the admin's own timer page.** An admin is
 * also somebody who logs time, and the timer is what the product is for — so
 * this is a second destination rather than a replacement, and nothing here
 * duplicates it.
 *
 * **Admin-only, guarded twice** (§4.2.2): `/overview` is in
 * `ADMIN_ONLY_PATHS`, and the redirect below repeats the check because
 * middleware does not run on every rendering path.
 *
 * **Unlike the other three admin routes, the redirect here is not the only
 * thing standing between an employee and this data.** §4.2.2 is careful to say
 * that `/members`, `/clients` and `/projects` hide a surface without making its
 * contents confidential — every table behind them stays company-readable. This
 * page is the first one where that is not true:
 * `time_entries_select_own_or_admin` scopes an employee to their own rows, so an
 * employee who reached this URL would see their own hours and their own timer,
 * not the team's. The redirect spares them a page about themselves with the
 * wrong title; RLS is what keeps it from being a page about everybody else.
 *
 * **Every figure comes from a §9.3 aggregate and nothing is aggregated here**
 * (§9.1, §9.9.1). Four report actions plus two list reads, all through
 * `lib/actions/**`, all sharing the §9.2 scoping that `prepare()` applies once.
 * The page adds nothing up: "Logged today" *picks* one bucket out of the day
 * series — the same bucket the chart below draws as today's bar — and the only
 * addition anywhere is `topNWithOther` folding a breakdown's tail, which is
 * arithmetic over sums Postgres computed rather than over entries.
 */
export default async function OverviewPage() {
  const memberResult = await getCurrentMember();
  const member = memberResult.ok ? memberResult.data : null;
  const isAdmin = member?.role === "admin" && member.status === "active";

  if (!isAdmin) {
    redirect("/dashboard");
  }

  // `member` is non-null past the redirect, but it is still read with `?.`
  // below — the same way `members/page.tsx` does after the same guard. Relying
  // on the compiler to narrow a nullable through an aliased boolean and a
  // `never`-returning call works today and is not a property worth depending
  // on; `?.` costs nothing and cannot stop being true.

  const timezone = member?.company?.timezone ?? null;
  const today = companyToday(timezone, Date.now());
  const monthStart = startOfMonth(today);
  const chartFrom = addDays(today, -(CHART_DAYS - 1));

  // No `userId` on any of these: an active admin's `p_user_id` is left
  // undefined by `prepare()`, which is what makes them company-wide (§9.2).
  const monthRange = {
    from: monthStart,
    to: today,
    userId: undefined,
    clientId: undefined,
    projectId: undefined,
    taskId: undefined,
  };

  const [
    summaryResult,
    attendanceResult,
    daysResult,
    projectsResult,
    runningResult,
    queueResult,
  ] = await Promise.all([
    getReportSummary(monthRange),
    // Already union-merged with expected hours (§9.8.3) — the people who logged
    // nothing arrive from this one call, which is why there is no second one.
    getReportByUser(monthRange),
    getReportByDay({ ...monthRange, from: chartFrom }),
    getReportByProject(monthRange),
    listRunningTimers(),
    listPendingCorrectionRequests(),
  ]);

  // §5.4's threshold is the company's own setting; the constant only backs up
  // the limbo case where the member has no company on record.
  const maxTimerHours =
    member?.company?.maxTimerHours ?? DEFAULT_MAX_TIMER_HOURS;

  const summary = summaryResult.ok ? summaryResult.data : null;

  /**
   * **Every running-timer statement on this page counts these rows, and
   * `report_summary.runningCount` is deliberately not used for any of them.**
   *
   * The two disagree, and the case where they disagree is the one this page
   * exists for. `report_summary` buckets by start day
   * (`(started_at at time zone c.timezone)::date between p_from and p_to`), so
   * a timer started on 30 August and still running on 12 September counts zero
   * in a month-to-date report — while `listRunningTimers()` returns it, because
   * it is running. That 300-hour timer is precisely §5.4's stale case. Gating
   * §9.9.4's disclosure on the report's count would hide the sentence exactly
   * when a timer is most obviously in flight, and the same thing happens every
   * 1st of the month for anything started the evening before.
   *
   * So: one source for "is anything running", which is also §9.9.1's
   * two-paths-to-one-number rule applied to a count.
   */
  const running = runningResult.ok ? runningResult.data : [];
  const pendingCount = queueResult.ok
    ? queueResult.data.filter((request) => request.status === "pending").length
    : 0;

  const days = daysResult.ok
    ? fillDaySeries(daysResult.data, chartFrom, today)
    : [];
  const bars: DayBar[] = days.map((day) => {
    const weekday = dayOfWeek(day.day) ?? 1;

    return {
      day: day.day,
      totalSeconds: day.totalSeconds,
      weekday,
      // Saturday and Sunday, flatly, and **not** `companies.week_starts_on` —
      // that column says which day a week is read from, not which days are the
      // weekend, so consulting it here would dress a hardcoded assumption up as
      // a setting. A team has no single working week anyway: schedules are per
      // assignment (§3.6.3) and two people's can differ, so there is no team
      // working week to read. The card names the two days rather than claiming
      // the company's, and §9.9.2 licenses this only as a statement about the
      // calendar — never about anybody's target.
      offDay: weekday === 0 || weekday === 6,
      isToday: day.day === today,
    };
  });
  const todaySeconds = days.find((day) => day.day === today)?.totalSeconds ?? 0;

  const breakdown = projectsResult.ok
    ? topNWithOther(
        projectsResult.data.map((row) => ({
          key: row.projectId,
          // Project and client on one line, because §3.4 makes project names
          // non-unique per company (`BLOCKERS.md` D-10) and "Redesign" alone
          // can name two projects. A null client is `NO_CLIENT_CELL` rather
          // than "Internal": the null mixes genuinely internal work with a
          // client label this caller cannot read, and naming it would be a
          // confident guess about which (`report-rows.ts`).
          label: `${row.projectName ?? UNKNOWN_PROJECT} · ${row.clientName ?? NO_CLIENT_CELL}`,
          muted: row.projectName === null,
          totalSeconds: row.totalSeconds,
        })),
        BREAKDOWN_LIMIT,
      )
    : [];

  const monthLabel = formatDayRange(monthStart, today);
  const attendanceRows = attendanceResult.ok ? attendanceResult.data : [];
  const attendanceHref = reportHref(
    resolveReportQuery({}, { from: monthStart, to: today }),
    { grouping: "user" },
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Team overview</h1>
        <p className="text-muted-foreground text-sm">
          {member?.company
            ? `Everyone in ${member.company.name}, this month so far.`
            : "Your whole team, this month so far."}
          {timezone ? ` Days are counted in ${timezone}.` : ""}
        </p>
      </div>

      <Card>
        <CardContent>
          {summaryResult.ok ? (
            <StatTileGrid columns={4}>
              <StatTile
                label="Hours this month"
                figure={formatSecondsHms(summary?.totalSeconds ?? 0)}
                caption={monthLabel}
              />
              {/* "—" rather than `0:00:00` when the read failed: a zero would
                  claim the whole company logged nothing today. */}
              <StatTile
                label="Logged today"
                figure={
                  daysResult.ok
                    ? formatSecondsHms(todaySeconds)
                    : FIGURE_UNAVAILABLE
                }
                caption={
                  daysResult.ok
                    ? "Closed entries, company-wide"
                    : "Couldn't be loaded"
                }
              />
              {/* The one place amber appears on this page, and only when there
                  is something in flight — a zero is not a running timer. */}
              <StatTile
                label="On the clock"
                figure={running.length}
                live={running.length > 0}
                caption={
                  running.length === 0
                    ? "No timers in flight"
                    : "Not counted until stopped"
                }
              />
              <StatTile
                label="Awaiting review"
                figure={pendingCount}
                caption={
                  pendingCount === 0
                    ? "No corrections pending"
                    : "Correction requests to decide"
                }
              />
            </StatTileGrid>
          ) : (
            <p className="text-destructive text-sm">{summaryResult.error}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>On the clock now</CardTitle>
          <CardDescription>
            Live, and counted by nothing yet — a running entry contributes zero
            to every figure above until it is stopped. A timer past{" "}
            {maxTimerHours} hours is marked stale; you can&rsquo;t stop somebody
            else&rsquo;s, so ask them to, or approve the correction they send.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {runningResult.ok ? (
            <TeamRunningTimers
              timers={running}
              maxTimerHours={maxTimerHours}
              limit={RUNNING_LIMIT}
              timezone={timezone}
              // One server clock for the whole list, so every counter's first
              // client render matches the HTML it hydrates (§5.3).
              initialNow={Date.now()}
            />
          ) : (
            <p className="text-destructive text-sm">{runningResult.error}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Keeping up</CardTitle>
          <CardDescription>
            Worked against expected for {monthLabel}, furthest behind first.
            Somebody with a schedule who has logged nothing appears here too.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {attendanceResult.ok ? (
            <>
              <TeamAttendanceList
                rows={attendanceRows}
                limit={ATTENDANCE_LIMIT}
                emptyLabel="Nobody has logged time or been given expected hours this month."
              />

              <div className="text-muted-foreground flex flex-col gap-1 text-xs">
                {/* §9.8.2's two disclosures, and both are load-bearing: the
                    figures are correct in a way that reads wrong without
                    them. */}
                <p>Expected hours count today in full, however early it is.</p>
                {running.length > 0 ? (
                  <p>
                    {running.length === 1
                      ? "One timer is running now and is not counted yet."
                      : `${running.length} timers are running now and are not counted yet.`}
                  </p>
                ) : null}
                {attendanceRows.length > ATTENDANCE_LIMIT ? (
                  // No total on this card, because it is showing some of the
                  // people (§12.2, D-16). `/reports` has the whole set and a
                  // footer that sums its own visible rows.
                  <p>
                    Showing {ATTENDANCE_LIMIT} of {attendanceRows.length}{" "}
                    people.
                  </p>
                ) : null}
              </div>

              <div>
                <Button asChild variant="outline" size="sm">
                  <Link href={attendanceHref}>See everyone in Reports</Link>
                </Button>
              </div>
            </>
          ) : (
            <p className="text-destructive text-sm">{attendanceResult.error}</p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>The last {CHART_DAYS} days</CardTitle>
            <CardDescription>
              Everyone&rsquo;s closed hours per day. Saturday and Sunday are
              dimmed — not anyone&rsquo;s working days, which are set per
              project and differ from person to person.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {daysResult.ok ? (
              <DayBarChart
                bars={bars}
                maxSeconds={maxSecondsOf(days)}
                label={`Team hours per day, ${formatDayRange(chartFrom, today)}`}
                emptyLabel={`Nobody logged anything between ${formatDayRange(chartFrom, today)}.`}
              />
            ) : (
              <p className="text-destructive text-sm">{daysResult.error}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Where the hours went</CardTitle>
            <CardDescription>
              By project, {monthLabel}. The biggest few first, then everything
              else together.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {projectsResult.ok ? (
              <ProportionBarList
                rows={breakdown}
                maxSeconds={maxSecondsOf(breakdown)}
                emptyLabel={`No time was logged against any project between ${monthLabel}.`}
              />
            ) : (
              <p className="text-destructive text-sm">{projectsResult.error}</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
