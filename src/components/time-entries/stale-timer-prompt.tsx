"use client";

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
 * prevented and there is no close button, because the two answers are
 * materially different and dismissing the question by reflex should not be one
 * of them.
 *
 * **"Keep going" is a real answer, not an escape hatch.** A 14-hour shift under
 * a 12-hour threshold is stale by the company's definition and still true, and
 * the only way to record it honestly is to leave the timer running until the
 * work actually stops. Dismissing lasts for this page load; §5.4's "on next
 * load" is what brings the prompt back.
 *
 * **§5.4's second offer — "submit a correction with the real end time" — has no
 * control here, and the copy below says so plainly rather than implying a
 * sequence.** Phase 7 built the correction flow on *closed* entries only, so
 * from this dialog there is currently one action and one deferral. It is not
 * reworded into "stop it now, then correct it": §7.4.1 read those two offers as
 * alternatives and rejected the sequential reading precisely because it forces
 * every stale timer through a materialised, fully-counted, wrong-duration entry
 * first. The honest sentence about the gap is the one that does not quietly
 * recommend the reading the spec turned down. Reported as an outstanding item
 * rather than papered over here.
 */
export function StaleTimerPrompt({
  open,
  elapsed,
  maxTimerHours,
  stopping,
  onStopNow,
  onKeepRunning,
}: {
  open: boolean;
  elapsed: number;
  maxTimerHours: number;
  stopping: boolean;
  onStopNow: () => void;
  onKeepRunning: () => void;
}) {
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

        <div className="text-muted-foreground flex flex-col gap-2 text-sm">
          <p>
            <span className="text-foreground font-medium">
              Stopping now records this moment
            </span>{" "}
            as the end time — not the moment you meant to stop. Nothing is
            guessed on your behalf either way.
          </p>
          <p>
            Setting a real, earlier end time needs a correction request, and
            those can only be filed on an entry that has already stopped — so it
            can&rsquo;t be done from here yet.
          </p>
        </div>

        <DialogFooter>
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
