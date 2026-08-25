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
import { listProjects } from "@/lib/actions/projects";
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
 * Four reads, in parallel, all of them through `lib/actions/**` (`CLAUDE.md`) —
 * no Supabase query is written in this file. Each is role- and RLS-scoped
 * already: `listProjects()` returns only assigned projects to an employee
 * (§3.6.1), and `getRunningTimer()` / `listMyEntries()` are the caller's own
 * rows even for an admin, whose SELECT policy is company-wide.
 */
export default async function DashboardPage() {
  const [memberResult, runningResult, projectsResult, entriesResult] =
    await Promise.all([
      getCurrentMember(),
      getRunningTimer(),
      listProjects(),
      listMyEntries({ limit: RECENT_ENTRY_LIMIT }),
    ]);

  const member = memberResult.ok ? memberResult.data : null;
  const timezone = member?.company?.timezone ?? null;
  const projects = projectsResult.ok ? projectsResult.data : [];
  const running = runningResult.ok ? runningResult.data : null;

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
            Worked without the timer? Add today&rsquo;s time by hand.
          </p>
          <ManualEntryDialog projects={projects} timezone={timezone} />
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Your recent entries</CardTitle>
          <CardDescription>
            The last {RECENT_ENTRY_LIMIT} entries you recorded
            {timezone ? `, shown in ${timezone}` : ""}. Only yours — an entry
            belongs to the person who logged it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {entriesResult.ok ? (
            <EntryList entries={entriesResult.data} timezone={timezone} />
          ) : (
            <p className="text-destructive text-sm">{entriesResult.error}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
