"use client";

import {
  UNKNOWN_PERSON,
  UNKNOWN_PROJECT,
  UNKNOWN_TASK,
} from "@/components/reports/report-rows";
import {
  formatApproxHours,
  formatClock,
  isStale,
} from "@/components/time-entries/elapsed";
import { useElapsedSeconds } from "@/components/time-entries/elapsed-counter";
import { formatStartedAt } from "@/components/time-entries/format-entry";
import { RunningBadge } from "@/components/time-entries/running-badge";
import { Badge } from "@/components/ui/badge";
import type { TeamRunningTimer } from "@/lib/actions/time-entries";
import { cn } from "@/lib/utils";

/**
 * Who is on the clock right now, and which of those timers has gone stale
 * (`SPEC.md` §9.9, §5.4).
 *
 * **One component for both, because staleness is a property of the ticking
 * clock rather than of the row.** §5.4 defines stale as "running longer than
 * `companies.max_timer_hours`", which is a comparison against elapsed time —
 * and elapsed time is computed in the browser, a second at a time (§5.3). A
 * server component could sort the rows into two lists at render time, but the
 * boundary moves while the page is open: a timer twelve hours old crosses it
 * without a reload. Splitting the two readings across a server and a client
 * component would let them disagree, so there is one client component and the
 * sort happens where the clock is.
 *
 * **There is no stop button, and its absence is a ruling rather than an
 * omission** (`BLOCKERS.md` D-5). An admin may close a running entry only when
 * its owner is *inactive*; an active employee's timer is untouchable by
 * anybody, including an admin, at the database. So the stale rows say what can
 * actually be done — ask the person, or wait for the correction §5.4 offers
 * them on their own dashboard — rather than offering a control Postgres is
 * certain to refuse.
 *
 * `--live` amber marks the running rows and nothing else (`CLAUDE.md`); a stale
 * one escalates to `destructive`, matching `RunningTimerCard`'s own escalation
 * exactly, because past the threshold the figure on screen is probably wrong,
 * which is a different claim from "still counting".
 */
export function TeamRunningTimers({
  timers,
  maxTimerHours,
  timezone,
  initialNow,
  limit,
}: {
  /** Oldest first, as `listRunningTimers()` returns them — see `limit`. */
  timers: TeamRunningTimer[];
  /** §5.4's threshold — the company's own setting, not a constant. */
  maxTimerHours: number;
  timezone: string | null;
  /**
   * The server's clock at render time, threaded down so every row's first
   * client render matches the HTML it hydrates. One value for the whole list,
   * not one per row — see `useElapsedSeconds`.
   */
  initialNow: number;
  /**
   * How many rows to render, and it is a real bound rather than a layout
   * preference: **each row owns a `setInterval` at 1 Hz.** A two-hundred-person
   * company at ten in the morning would otherwise hand the admin two hundred
   * timers and two hundred re-renders a second, to move counters that mostly
   * sit below the fold.
   *
   * Truncating an *exception* queue would normally be the wrong thing, and is
   * safe only because of the order: `listRunningTimers()` returns oldest first,
   * so the longest-running — the ones §5.4 is about, the ones most likely to be
   * stale — are the rows that survive the cut. The count above the list is the
   * whole set (§9.9.3 permits a count; it is the list that truncates).
   */
  limit: number;
}) {
  if (timers.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Nobody has a timer running. Hours appear here the moment somebody starts
        one.
      </p>
    );
  }

  const shown = timers.slice(0, limit);

  return (
    <div className="flex flex-col gap-2">
      <ul role="list" className="flex flex-col gap-2">
        {shown.map((timer) => (
          <TimerRow
            key={timer.id}
            timer={timer}
            maxTimerHours={maxTimerHours}
            timezone={timezone}
            initialNow={initialNow}
          />
        ))}
      </ul>

      {timers.length > shown.length ? (
        <p className="text-muted-foreground text-xs">
          Showing the {shown.length} longest-running of {timers.length}.
        </p>
      ) : null}
    </div>
  );
}

/**
 * One row, with its own ticking counter.
 *
 * A component per row rather than one hook over the list: `useElapsedSeconds`
 * is keyed on `startedAt` and owns an interval, and the alternative — one
 * `now` in the parent — would re-render every row every second to move one
 * counter. This way each row re-renders itself.
 */
function TimerRow({
  timer,
  maxTimerHours,
  timezone,
  initialNow,
}: {
  timer: TeamRunningTimer;
  maxTimerHours: number;
  timezone: string | null;
  initialNow: number;
}) {
  const elapsed = useElapsedSeconds(timer.startedAt, initialNow);
  const stale = isStale(elapsed, maxTimerHours);

  return (
    <li
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl p-3 ring-1",
        stale ? "ring-destructive/40" : "ring-live/40",
      )}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          {/* Every label here can be null and each null is real — an admin's
              `profiles` read is company-wide, but a project they cannot see is
              ordinary (§2.3, §3.6.1). The placeholder words come from
              `report-rows.ts` so the whole app names the same absence the same
              way. */}
          <span
            className={cn(
              "text-sm font-medium",
              timer.userName === null && "text-muted-foreground italic",
            )}
          >
            {timer.userName ?? UNKNOWN_PERSON}
          </span>
          {stale ? (
            <Badge variant="destructive">Stale</Badge>
          ) : (
            <RunningBadge />
          )}
        </div>
        <span className="text-muted-foreground truncate text-xs">
          {timer.projectName ?? UNKNOWN_PROJECT} ·{" "}
          {timer.taskName ?? UNKNOWN_TASK} · started{" "}
          {formatStartedAt(timer.startedAt, timezone)}
        </span>
      </div>

      <div className="flex flex-col items-end gap-0.5">
        <span
          className={cn(
            "font-mono text-lg leading-none font-medium tabular-nums",
            stale ? "text-destructive" : "text-live",
          )}
          // A counter that announced itself every second would make the page
          // unusable with a screen reader — the same reasoning, and the same
          // setting, as `ElapsedCounter`.
          aria-live="off"
        >
          {formatClock(elapsed)}
        </span>
        {stale ? (
          <span className="text-destructive text-xs">
            Running {formatApproxHours(elapsed)}
          </span>
        ) : null}
      </div>
    </li>
  );
}
