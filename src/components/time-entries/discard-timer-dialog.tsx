"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * §5.1's discard transition — the only DELETE any user may perform on
 * `time_entries`, and it is instant and total: the row is gone, not archived,
 * not voided, not visible in the recent list afterwards. Archiving a project at
 * least leaves the project behind; this leaves nothing, which is why it is
 * allowed at all (nothing was ever recorded as complete) and why it gets a
 * confirmation step.
 *
 * The elapsed time on screen is what is being thrown away, so the caller passes
 * it in — "Discard 2:14:09?" is a materially different question from "Discard?"
 */
export function DiscardTimerDialog({
  elapsedLabel,
  disabled = false,
  onConfirm,
}: {
  elapsedLabel: string;
  disabled?: boolean;
  onConfirm: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  async function confirm() {
    setPending(true);
    try {
      await onConfirm();
    } finally {
      setPending(false);
      setOpen(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" disabled={disabled}>
          Discard
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Discard {elapsedLabel}?</DialogTitle>
          <DialogDescription>
            This deletes the running entry outright. Nothing is recorded, and it
            will not appear in your entries — there is no undo. Stop the timer
            instead if you want to keep the time.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={pending}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={() => void confirm()}
          >
            {pending ? "Discarding…" : "Discard it"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
