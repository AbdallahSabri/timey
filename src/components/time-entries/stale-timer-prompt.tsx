"use client";

import { useState } from "react";

import { CorrectRunningEndTimeForm } from "@/components/corrections/correct-running-end-time-form";
import { formatApproxHours } from "@/components/time-entries/elapsed";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * §5.4 — "Stale timers are never auto-closed. Silently writing an `ended_at`
 * the system invented is fabricating a work record."
 *
 * So this is a prompt, not a cleanup job: it interrupts, it asks, and it does
 * nothing at all until a person answers. Escape and click-outside are both
 * prevented and there is no close button, because the answers are materially
 * different and dismissing the question by reflex should not be one of them.
 *
 * **"Keep going" is a real answer, not an escape hatch.** A 14-hour shift under
 * a 12-hour threshold is stale by the company's definition and still true, and
 * the only way to record it honestly is to leave the timer running until the
 * work actually stops. Dismissing lasts for this page load; §5.4's "on next
 * load" is what brings the prompt back.
 *
 * **§5.4's second offer — "submit a correction with the real end time" — is now
 * reachable from here** (`BLOCKERS.md` N-9, closed). `mode` switches this
 * dialog's body between the two-choice prompt and
 * `CorrectRunningEndTimeForm`, in place, rather than nesting a second modal:
 * Radix's own focus trap does not compose cleanly across two `Dialog`
 * instances, and the entry, the elapsed time and the "nothing changes until
 * an admin approves it" framing are all still true for both views, so the
 * header stays fixed and only the body swaps.
 *
 * Filing the correction counts as "keep going" — the timer is still running
 * and stays running until a request is approved — so a successful submit
 * calls `onKeepRunning` the same way the button does, and dismisses for this
 * page load.
 */
export function StaleTimerPrompt({
  open,
  elapsed,
  maxTimerHours,
  timeEntryId,
  stopping,
  onStopNow,
  onKeepRunning,
}: {
  open: boolean;
  elapsed: number;
  maxTimerHours: number;
  timeEntryId: string;
  stopping: boolean;
  onStopNow: () => void;
  onKeepRunning: () => void;
}) {
  const [mode, setMode] = useState<"prompt" | "correct">("prompt");

  return (
    <Dialog open={open}>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        className="sm:max-w-md"
      >
        <DialogHeader>
          <DialogTitle>
            Your timer has been running {formatApproxHours(elapsed)}
          </DialogTitle>
          <DialogDescription>
            That is past this company&rsquo;s {maxTimerHours}-hour limit, so it
            may have been left on by mistake. When did you actually stop?
          </DialogDescription>
        </DialogHeader>

        {mode === "prompt" ? (
          <>
            <div className="text-muted-foreground flex flex-col gap-2 text-sm">
              <p>
                <span className="text-foreground font-medium">
                  Stopping now records this moment
                </span>{" "}
                as the end time — not the moment you meant to stop. Nothing is
                guessed on your behalf either way.
              </p>
              <p>
                Setting a real, earlier end time instead needs a correction
                request — an admin reviews it before anything changes, and the
                timer keeps running in the meantime.
              </p>
            </div>

            <DialogFooter className="sm:justify-between">
              <Button
                type="button"
                variant="link"
                className="self-start px-0 sm:self-center"
                disabled={stopping}
                onClick={() => setMode("correct")}
              >
                Request a correction instead
              </Button>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={stopping}
                  onClick={onKeepRunning}
                >
                  It&rsquo;s still running
                </Button>
                <Button type="button" disabled={stopping} onClick={onStopNow}>
                  {stopping ? "Stopping…" : "Stop it now"}
                </Button>
              </div>
            </DialogFooter>
          </>
        ) : (
          <CorrectRunningEndTimeForm
            timeEntryId={timeEntryId}
            onCompleted={() => {
              setMode("prompt");
              onKeepRunning();
            }}
            onCancel={() => setMode("prompt")}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
