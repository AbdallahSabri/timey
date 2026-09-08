"use client";

import { useCallback, useEffect, useState } from "react";

import {
  formatSchedule,
  weeklySecondsOf,
} from "@/components/project-members/format-schedule";
import { ScheduleForm } from "@/components/project-members/schedule-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { listMemberProjectSchedules } from "@/lib/actions/project-members";
import type { MemberProjectSchedule } from "@/lib/actions/project-members";
import { formatSecondsHms } from "@/lib/reports/csv";

/** A project whose name this caller cannot read — see `MemberProjectSchedule`. */
const UNKNOWN_PROJECT = "A project you can't see";

/**
 * §3.6.3's schedules seen from the *person's* side: every project this member
 * is assigned to, with the hours expected on each.
 *
 * **The same rows the project page edits, reached the other way round.** An
 * admin setting up one project works down its member list; an admin answering
 * "what is Dana expected to do?" works across Dana's projects. Both write the
 * same `project_members` row through the same action, so this is a second entry
 * point rather than a second source of truth — which is the whole reason the
 * schedule is a property of the assignment (§3.6.3) rather than of the person.
 *
 * Fetched when the dialog opens rather than with the page. The Team page lists
 * everybody, and pre-loading a project list per member would be one query per
 * row to populate a dialog almost none of them will open.
 *
 * `listMemberProjectSchedules` is called from the client here, which is
 * prop-wiring and not a query: the action owns the SQL and the scoping, and
 * `project_members` SELECT is company-wide (§3.6.2) so an admin reading a
 * colleague's assignments is exactly what the policy allows.
 */
export function MemberSchedulesDialog({
  userId,
  memberName,
  weekStartsOn,
  open,
  onOpenChange,
}: {
  userId: string;
  memberName: string;
  /** `companies.week_starts_on` — orders the day picker and the day summaries. */
  weekStartsOn: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [schedules, setSchedules] = useState<MemberProjectSchedule[] | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  /** Which assignment is being edited, by project id. */
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const result = await listMemberProjectSchedules(userId);

    if (!result.ok) {
      setSchedules([]);
      setError(result.error);
      return;
    }

    setSchedules(result.data);
  }, [userId]);

  useEffect(() => {
    if (!open) {
      return;
    }

    // Re-read on every open rather than caching: a schedule changed on the
    // project page in another tab, or by the row below, should not be shown
    // stale by the dialog whose job is to state it.
    void load();
  }, [open, load]);

  /**
   * The flat weekly rate this person's assignments describe: hours/day ×
   * working days, summed over projects and formatted once at the edge (§9.5).
   *
   * **Not what a report will say they were expected to work**, and labelled so.
   * `report_expected_by_user` counts the working days that actually fall inside
   * a range and accrues only from each assignment's `added_at` (§9.8), so a
   * part-month assignment or a range that is not a whole week gives a different
   * figure. This one answers "what does their week look like", which is the
   * question somebody has while setting the hours.
   */
  const weeklySeconds = (schedules ?? []).reduce(
    (total, schedule) => total + weeklySecondsOf(schedule),
    0,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Expected hours for {memberName}</DialogTitle>
          <DialogDescription>
            Hours are set per project, so this person can work different days on
            each. What a report expects of them is the sum of these assignments.
          </DialogDescription>
        </DialogHeader>

        {error ? <p className="text-destructive text-sm">{error}</p> : null}

        {schedules === null ? (
          <p className="text-muted-foreground text-sm">Loading assignments…</p>
        ) : schedules.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {memberName} isn&rsquo;t assigned to any projects yet. Hours are set
            on an assignment, so there is nothing to schedule until they are on
            one.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <ul className="flex flex-col gap-2">
              {schedules.map((schedule) => (
                <li
                  key={schedule.projectId}
                  className="ring-foreground/10 flex flex-col gap-3 rounded-lg p-3 text-sm ring-1"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className="font-medium break-words">
                        {schedule.projectName ?? (
                          // Kept rather than dropped: the row is real and its
                          // hours still count toward this person's expected
                          // total, so hiding it would understate the week.
                          <span className="text-muted-foreground italic">
                            {UNKNOWN_PROJECT}
                          </span>
                        )}
                      </span>
                      <span className="text-muted-foreground font-mono tabular-nums">
                        {formatSchedule(
                          schedule.expectedDailySeconds,
                          schedule.workingDays,
                          weekStartsOn,
                        )}
                      </span>
                    </div>

                    {editingProjectId === schedule.projectId ? null : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setEditingProjectId(schedule.projectId)}
                      >
                        Edit
                      </Button>
                    )}
                  </div>

                  {editingProjectId === schedule.projectId ? (
                    <ScheduleForm
                      projectId={schedule.projectId}
                      userId={userId}
                      memberName={memberName}
                      expectedDailySeconds={schedule.expectedDailySeconds}
                      workingDays={schedule.workingDays}
                      weekStartsOn={weekStartsOn}
                      onSaved={() => {
                        setEditingProjectId(null);
                        // This list is client state, so `router.refresh()` in
                        // the form cannot update it — the row it just changed
                        // would go on showing the old hours underneath it.
                        void load();
                      }}
                      onCancel={() => setEditingProjectId(null)}
                    />
                  ) : null}
                </li>
              ))}
            </ul>

            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-muted-foreground">
                A full week at these hours
              </span>
              <span className="font-mono font-medium tabular-nums">
                {formatSecondsHms(weeklySeconds)}
              </span>
            </div>
            <p className="text-muted-foreground text-xs">
              A flat weekly rate, not a forecast: a report counts only the
              working days inside its range, and only from the day each
              assignment was made.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
