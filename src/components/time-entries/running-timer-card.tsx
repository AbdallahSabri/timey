"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { DiscardTimerDialog } from "@/components/time-entries/discard-timer-dialog";
import { formatClock, isStale } from "@/components/time-entries/elapsed";
import {
  ElapsedCounter,
  useElapsedSeconds,
} from "@/components/time-entries/elapsed-counter";
import { formatStartedAt } from "@/components/time-entries/format-entry";
import { StaleTimerPrompt } from "@/components/time-entries/stale-timer-prompt";
import { StartTimerForm } from "@/components/time-entries/start-timer-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import type { Project } from "@/lib/actions/projects";
import type { RunningTimer } from "@/lib/actions/time-entries";
import {
  discardTimer,
  stopTimer,
  updateEntryNote,
} from "@/lib/actions/time-entries";

/**
 * The running state of §5.1's state machine, which is not a separate entity:
 * this card renders one `time_entries` row whose `ended_at` is null, and every
 * control on it is one of the three transitions that row allows — stop,
 * discard, or (via `switchTimer`) stop-then-start.
 *
 * **There is no edit affordance here beyond the note**, and that is a rule
 * rather than a layout decision. `started_at` has no UPDATE grant, `project_id`
 * has none either, and the trigger refuses a client-chosen `ended_at` (§5.3,
 * §7.2) — a control that offered any of them would be a button whose only
 * possible outcome is a permission error.
 */
export function RunningTimerCard({
  timer,
  projects,
  maxTimerHours,
  timezone,
  initialNow,
}: {
  timer: RunningTimer;
  projects: Project[];
  maxTimerHours: number;
  timezone: string | null;
  initialNow: number;
}) {
  const router = useRouter();
  const elapsed = useElapsedSeconds(timer.startedAt, initialNow);
  const stale = isStale(elapsed, maxTimerHours);

  const [pending, setPending] = useState<"stop" | "discard" | null>(null);
  const [note, setNote] = useState(timer.note ?? "");
  const [savingNote, setSavingNote] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [promptDismissed, setPromptDismissed] = useState(false);

  async function stop() {
    setPending("stop");
    const result = await stopTimer(timer.id);
    setPending(null);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    // The duration announced here is the server's `duration_seconds`, not the
    // counter that was ticking a moment ago (§5.3). They will usually agree to
    // the second; when they don't, the database is the one that is right.
    toast.success(
      `Saved ${formatClock(result.data.durationSeconds ?? 0)} to your entries.`,
    );
    router.refresh();
  }

  async function discard() {
    setPending("discard");
    const result = await discardTimer(timer.id);
    setPending(null);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    toast.success("Discarded. Nothing was recorded.");
    router.refresh();
  }

  async function saveNote() {
    setSavingNote(true);
    const result = await updateEntryNote(timer.id, note);
    setSavingNote(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    setNote(result.data.note ?? "");
    toast.success(result.data.note ? "Note saved." : "Note cleared.");
    router.refresh();
  }

  const busy = pending !== null;
  const noteChanged = note.trim() !== (timer.note ?? "");

  return (
    <Card data-testid="running-timer">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Timer running
          <Badge variant={stale ? "destructive" : "secondary"}>
            {stale ? "Stale" : "Running"}
          </Badge>
        </CardTitle>
        <CardDescription>
          {timer.project?.name ?? "Unknown project"} ·{" "}
          {timer.task?.name ?? "Unknown task"} · started{" "}
          {formatStartedAt(timer.startedAt, timezone)}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <ElapsedCounter seconds={elapsed} />
          <div className="flex items-center gap-2">
            <Button type="button" onClick={() => void stop()} disabled={busy}>
              {pending === "stop" ? "Stopping…" : "Stop"}
            </Button>
            <DiscardTimerDialog
              elapsedLabel={formatClock(elapsed)}
              disabled={busy}
              onConfirm={discard}
            />
          </div>
        </div>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <Field className="sm:flex-1">
            <FieldLabel htmlFor="running-note">Note</FieldLabel>
            <Input
              id="running-note"
              autoComplete="off"
              placeholder="What are you working on?"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              disabled={savingNote}
            />
          </Field>
          <Button
            type="button"
            variant="outline"
            onClick={() => void saveNote()}
            disabled={savingNote || !noteChanged}
          >
            {savingNote ? "Saving…" : "Save note"}
          </Button>
        </div>

        <Separator />

        {switching ? (
          <div className="flex flex-col gap-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium">Move to another project</p>
                <p className="text-muted-foreground text-sm">
                  This stops the timer first and saves{" "}
                  <span className="text-foreground font-medium">
                    {formatClock(elapsed)}
                  </span>{" "}
                  against {timer.project?.name ?? "the current project"}, then
                  starts a new one. Time already elapsed is never moved.
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setSwitching(false)}
              >
                Cancel
              </Button>
            </div>
            <StartTimerForm
              projects={projects}
              mode="switch"
              onCompleted={() => setSwitching(false)}
            />
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            className="self-start"
            disabled={busy}
            onClick={() => setSwitching(true)}
          >
            Working on something else?
          </Button>
        )}
      </CardContent>

      <StaleTimerPrompt
        open={stale && !promptDismissed}
        elapsed={elapsed}
        maxTimerHours={maxTimerHours}
        timeEntryId={timer.id}
        stopping={pending === "stop"}
        onStopNow={() => void stop()}
        onKeepRunning={() => setPromptDismissed(true)}
      />
    </Card>
  );
}
