import { DayBarChart, type DayBar } from "@/components/charts/day-bar-chart";
import { fillDaySeries, maxSecondsOf } from "@/components/charts/day-series";
import { ProportionBarList } from "@/components/charts/proportion-bar-list";
import { topNWithOther } from "@/components/charts/top-n";
import { CreateCorrectionDialog } from "@/components/corrections/create-correction-dialog";
import { MonthProgressCard } from "@/components/dashboard/month-progress-card";
import {
  addDays,
  companyToday,
  dayOfWeek,
  formatDayRange,
  startOfMonth,
  startOfWeek,
} from "@/components/reports/report-days";
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
import { EntryList } from "@/components/time-entries/entry-list";
import { ManualEntryDialog } from "@/components/time-entries/manual-entry-dialog";
import { RunningTimerCard } from "@/components/time-entries/running-timer-card";
import { StartTimerForm } from "@/components/time-entries/start-timer-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getCurrentMember } from "@/lib/actions/companies";
import { listMyCorrectionRequests } from "@/lib/actions/corrections";
import { listMemberProjectSchedules } from "@/lib/actions/project-members";
import { listProjects } from "@/lib/actions/projects";
import {
  getReportByDay,
  getReportByProject,
  getReportSummary,
} from "@/lib/actions/reports";
import { getRunningTimer, listMyEntries } from "@/lib/actions/time-entries";
import { formatSecondsHms } from "@/lib/reports/csv";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dashboard · Timey",
};

const RECENT_ENTRY_LIMIT = 10;

/** Long enough to see a rhythm, short enough to read at phone width. */
const CHART_DAYS = 14;

/** Projects shown before the tail collapses into one "Other". */
const BREAKDOWN_LIMIT = 6;

/**
 * The timer lives here rather than a route of its own: it is the thing this
 * product is for, and every extra click between signing in and starting one is
 * a minute nobody logs.
 *
 * Five reads, in parallel, all of them through `lib/actions/**` (`CLAUDE.md`) —
 * no Supabase query is written in this file. Each is role- and RLS-scoped
 * already: `listProjects()` returns only assigned projects to an employee
 * (§3.6.1), and `getRunningTimer()` / `listMyEntries()` /
 * `listMyCorrectionRequests()` are the caller's own rows even for an admin,
 * whose SELECT policy is company-wide.
 *
 * The fifth is Phase 7's: an entry with a request already waiting on it is
 * badged in the list, so "I asked about this on Monday" is visible where the
 * entry is rather than only on `/corrections`. One indexed read, not one per
 * row.
 *
 * **`getCurrentMember()` is awaited before the rest, and has to be**, which is
 * the same shape `/reports` uses. §9.8's month card needs two things that only
 * the member can supply: the company timezone, because the month's first and
 * last day are company-local (§6.1) and computing them in the server's zone
 * would move a boundary by a day; and the caller's own id, because
 * `getReportSummary` returns an Expected figure only when the report resolves
 * to one person (§9.8.1) — an admin who passes no person filter gets a
 * team-wide report and a null. Both are inputs to the sixth read, so it cannot
 * sit in the same `Promise.all` as the call that produces them.
 */
export default async function DashboardPage() {
  const memberResult = await getCurrentMember();
  const member = memberResult.ok ? memberResult.data : null;
  const timezone = member?.company?.timezone ?? null;

  // Month to date, in the company's reckoning of "today" (§6.1). Both ends are
  // resolved here rather than in the card, which takes seconds and formats
  // them; and today is the range end because §9.8 counts it in full.
  const today = companyToday(timezone, Date.now());
  const monthStart = startOfMonth(today);

  // The chart's window, and the source of the Today and This week figures too
  // (§9.9). A week is at most seven days, so both sit inside fourteen — which
  // is why those two tiles cost no extra round trip and why they can be read
  // off the bars underneath them.
  const chartFrom = addDays(today, -(CHART_DAYS - 1));
  const weekStart = startOfWeek(today, member?.company?.weekStartsOn ?? 1);

  const monthRange = {
    from: monthStart,
    to: today,
    userId: member?.id,
    clientId: undefined,
    projectId: undefined,
    taskId: undefined,
  };

  const [
    runningResult,
    projectsResult,
    entriesResult,
    correctionsResult,
    monthResult,
    daysResult,
    breakdownResult,
    schedulesResult,
  ] = await Promise.all([
    getRunningTimer(),
    listProjects(),
    listMyEntries({ limit: RECENT_ENTRY_LIMIT }),
    listMyCorrectionRequests(),
    // The sanctioned source of range totals (§9.8.1). **The month figure is
    // this one and only this one.** The day series below could be summed over
    // the month instead, and must not be: two paths to one number is how a
    // dashboard comes to disagree with the report behind it.
    getReportSummary(monthRange),
    // §9.9's chart, and the two shorter horizons with it.
    getReportByDay({ ...monthRange, from: chartFrom }),
    getReportByProject(monthRange),
    // Only for dimming the chart's non-working days — an undimmed Saturday
    // reads as a day you failed to log. It supplies no target: expected hours
    // are a range quantity that accrues from each assignment's `added_at`
    // (§9.8), and a daily figure rebuilt from these columns would be a second,
    // disagreeing answer to a question §9.8 already answers on the card above.
    member ? listMemberProjectSchedules(member.id) : Promise.resolve(null),
  ]);

  const projects = projectsResult.ok ? projectsResult.data : [];
  const running = runningResult.ok ? runningResult.data : null;
  const isAdmin = member?.role === "admin" && member.status === "active";
  const month = monthResult.ok ? monthResult.data : null;

  // Presentation over buckets Postgres already grouped, not aggregation of
  // entries (§9.1) — and the buckets being summed are the bars rendered below,
  // which is §12.2's own test of an honest total.
  const days = daysResult.ok
    ? fillDaySeries(daysResult.data, chartFrom, today)
    : [];
  const todaySeconds = days.find((day) => day.day === today)?.totalSeconds ?? 0;
  const weekSeconds = days
    .filter((day) => day.day >= weekStart)
    .reduce((sum, day) => sum + day.totalSeconds, 0);

  // The union of the working days across every assignment: a day this person
  // works on any project is a working day for them. A day in none of them is
  // dimmed — a statement about the calendar, never about a target.
  const workingDays = new Set(
    (schedulesResult?.ok ? schedulesResult.data : []).flatMap((schedule) =>
      schedule.expectedDailySeconds > 0 ? schedule.workingDays : [],
    ),
  );

  const bars: DayBar[] = days.map((day) => {
    const weekday = dayOfWeek(day.day) ?? 1;

    return {
      day: day.day,
      totalSeconds: day.totalSeconds,
      weekday,
      // Nothing is dimmed when nobody has set a schedule: with no working days
      // on record, dimming every day would imply this person is never due in.
      offDay: workingDays.size > 0 && !workingDays.has(weekday),
      isToday: day.day === today,
    };
  });

  const breakdown = breakdownResult.ok
    ? topNWithOther(
        breakdownResult.data.map((row) => ({
          key: row.projectId,
          // Project and client together, because §3.4 lets two projects share a
          // name (`BLOCKERS.md` D-10). A null client is "—" and never
          // "Internal": the null mixes genuinely internal work with a client
          // label this caller cannot read (`report-rows.ts`).
          label: `${row.projectName ?? UNKNOWN_PROJECT} · ${row.clientName ?? NO_CLIENT_CELL}`,
          muted: row.projectName === null,
          totalSeconds: row.totalSeconds,
        })),
        BREAKDOWN_LIMIT,
      )
    : [];

  const pendingCorrections = (
    correctionsResult.ok ? correctionsResult.data : []
  ).filter((request) => request.status === "pending");

  const pendingCorrectionEntryIds = pendingCorrections
    .map((request) => request.timeEntryId)
    .filter((entryId): entryId is string => entryId !== null);

  // The server's clock, handed to the counter so its first client render
  // matches the HTML it hydrates. It seeds the display only — §5.3's stored
  // values are Postgres's own `now()`, and nothing computed from this is ever
  // sent back.
  const initialNow = Date.now();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">
          {member?.company?.name ?? "Your company"}
        </h1>
        <p className="text-muted-foreground text-sm">
          {member
            ? `Signed in as ${member.fullName} · ${member.role}`
            : "Signed in."}
        </p>
      </div>

      {/* Three horizons and a queue, above everything (§9.9). The month figure
          alone answers "how am I doing" over four weeks and says nothing about
          whether today has started; these read in the order a day is lived.
          Silent when both reads failed, because four blanks say less than
          nothing. */}
      {month || daysResult.ok ? (
        <Card>
          <CardContent>
            <StatTileGrid columns={4}>
              {/* A failed read reads as "—", never as `0:00:00` — a zero is a
                  measurement and this is the absence of one, and on a
                  timesheet those must not look alike. */}
              <StatTile
                label="Today"
                figure={
                  daysResult.ok
                    ? formatSecondsHms(todaySeconds)
                    : FIGURE_UNAVAILABLE
                }
                caption={
                  daysResult.ok ? "Closed entries" : "Couldn't be loaded"
                }
              />
              <StatTile
                label="This week"
                figure={
                  daysResult.ok
                    ? formatSecondsHms(weekSeconds)
                    : FIGURE_UNAVAILABLE
                }
                caption={
                  daysResult.ok
                    ? `Since ${formatDayRange(weekStart, weekStart)}`
                    : "Couldn't be loaded"
                }
              />
              <StatTile
                label="This month"
                figure={
                  month
                    ? formatSecondsHms(month.totalSeconds)
                    : FIGURE_UNAVAILABLE
                }
                caption={
                  month
                    ? formatDayRange(monthStart, today)
                    : "Couldn't be loaded"
                }
              />
              {/* Not a duration, and not amber: `--live` marks a running timer
                  and nothing else (`CLAUDE.md`). A request waiting on an admin
                  is not urgent, it is just outstanding. */}
              <StatTile
                label="Awaiting review"
                figure={pendingCorrections.length}
                caption={
                  pendingCorrections.length === 0
                    ? "No requests pending"
                    : "Corrections an admin still has to decide"
                }
              />
            </StatTileGrid>
          </CardContent>
        </Card>
      ) : null}

      {/* Above the timer, because it is the question the timer is an answer to:
          "am I keeping up?" reads first, and the control that changes it sits
          underneath. Silent when the summary failed — a card with no figures
          would say less than nothing, and the timer below still works. */}
      {month ? (
        <MonthProgressCard
          workedSeconds={month.totalSeconds}
          expectedSeconds={month.expectedSeconds}
          runningCount={month.runningCount}
          monthLabel={formatDayRange(monthStart, today)}
        />
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>The last {CHART_DAYS} days</CardTitle>
            <CardDescription>
              The question a total can&rsquo;t answer: five eight-hour days and
              one forty-hour Friday add up the same.
              {workingDays.size > 0
                ? " Days you aren’t scheduled on are dimmed."
                : ""}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {daysResult.ok ? (
              <DayBarChart
                bars={bars}
                maxSeconds={maxSecondsOf(days)}
                label={`Your hours per day, ${formatDayRange(chartFrom, today)}`}
                emptyLabel={`You logged nothing between ${formatDayRange(chartFrom, today)}.`}
              />
            ) : (
              <p className="text-destructive text-sm">{daysResult.error}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Where your time went</CardTitle>
            <CardDescription>
              By project, {formatDayRange(monthStart, today)}. The biggest few
              first, then everything else together.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {breakdownResult.ok ? (
              <ProportionBarList
                rows={breakdown}
                maxSeconds={maxSecondsOf(breakdown)}
                emptyLabel="You haven’t logged time against a project this month."
              />
            ) : (
              <p className="text-destructive text-sm">
                {breakdownResult.error}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {!runningResult.ok ? (
        <Card>
          <CardHeader>
            <CardTitle>Timer unavailable</CardTitle>
            <CardDescription>{runningResult.error}</CardDescription>
          </CardHeader>
        </Card>
      ) : running ? (
        <RunningTimerCard
          /* Keyed by the entry, so switching projects — which is a *new* row
             (§5.1), not a mutation of the old one — remounts the card instead
             of carrying the previous entry's note and dismissed stale prompt
             onto it. */
          key={running.id}
          timer={running}
          projects={projects}
          /* §5.4's threshold is the company's own `max_timer_hours` setting.
             `DEFAULT_MAX_TIMER_HOURS` only backs up the rare case where the
             member has no company on record. */
          maxTimerHours={
            member?.company?.maxTimerHours ?? DEFAULT_MAX_TIMER_HOURS
          }
          timezone={timezone}
          initialNow={initialNow}
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Start a timer</CardTitle>
            <CardDescription>
              The clock runs on the server — starting and stopping record the
              moment the database sees, not your device&rsquo;s.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!projectsResult.ok ? (
              <p className="text-destructive text-sm">{projectsResult.error}</p>
            ) : projects.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                You&rsquo;re not assigned to any projects yet, so there is
                nothing to log time against. An admin adds you to one.
              </p>
            ) : (
              <StartTimerForm projects={projects} />
            )}
          </CardContent>
        </Card>
      )}

      {/* Below the timer and outside a card of its own, because §5.3's two
          kinds of entry are not two equal choices: the timer measures and this
          asserts, and the assertion is the fallback. §7.1 allows it only for
          today, which the dialog says before you type rather than after the
          server refuses. */}
      {projects.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-muted-foreground text-sm">
            Worked without the timer? Add today&rsquo;s time by hand — or ask an
            admin to add an earlier day.
          </p>
          <div className="flex items-center gap-2">
            {/* Two adjacent buttons because §7.1 draws its line between them:
                today is an assertion the employee may make alone, any other day
                is a proposal. Same fields either way; different consequence. */}
            <CreateCorrectionDialog projects={projects} timezone={timezone} />
            <ManualEntryDialog projects={projects} timezone={timezone} />
          </div>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Your recent entries</CardTitle>
          <CardDescription>
            The last {RECENT_ENTRY_LIMIT} entries you recorded
            {timezone ? `, shown in ${timezone}` : ""}. Only yours — an entry
            belongs to the person who logged it. A closed one can&rsquo;t be
            edited here; its menu asks for a correction instead.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {entriesResult.ok ? (
            <EntryList
              entries={entriesResult.data}
              timezone={timezone}
              projects={projects}
              canAdminEdit={isAdmin}
              pendingCorrectionEntryIds={pendingCorrectionEntryIds}
            />
          ) : (
            <p className="text-destructive text-sm">{entriesResult.error}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
