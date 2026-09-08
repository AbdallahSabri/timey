import { CreateCorrectionDialog } from "@/components/corrections/create-correction-dialog";
import { MonthProgressCard } from "@/components/dashboard/month-progress-card";
import {
  companyToday,
  formatDayRange,
  startOfMonth,
} from "@/components/reports/report-days";
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
import { listProjects } from "@/lib/actions/projects";
import { getReportSummary } from "@/lib/actions/reports";
import { getRunningTimer, listMyEntries } from "@/lib/actions/time-entries";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dashboard · Timey",
};

const RECENT_ENTRY_LIMIT = 10;

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

  const [
    runningResult,
    projectsResult,
    entriesResult,
    correctionsResult,
    monthResult,
  ] = await Promise.all([
    getRunningTimer(),
    listProjects(),
    listMyEntries({ limit: RECENT_ENTRY_LIMIT }),
    listMyCorrectionRequests(),
    // The sanctioned source of range totals (§9.8.1). Nothing is aggregated in
    // this page: a dashboard figure computed a second way could disagree with
    // `/reports`, which would be worse than showing no figure at all.
    getReportSummary({
      from: monthStart,
      to: today,
      userId: member?.id,
      clientId: undefined,
      projectId: undefined,
      taskId: undefined,
    }),
  ]);

  const projects = projectsResult.ok ? projectsResult.data : [];
  const running = runningResult.ok ? runningResult.data : null;
  const isAdmin = member?.role === "admin" && member.status === "active";
  const month = monthResult.ok ? monthResult.data : null;

  const pendingCorrectionEntryIds = (
    correctionsResult.ok ? correctionsResult.data : []
  )
    .filter((request) => request.status === "pending")
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
