"use client";

import { AmendCorrectionForm } from "@/components/corrections/amend-correction-form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Project } from "@/lib/actions/projects";
import type { TimeEntryWithLabels } from "@/lib/actions/time-entries";

/**
 * The `amend` request, opened from the row it is about.
 *
 * Controlled from the parent rather than carrying its own `DialogTrigger`,
 * because the trigger is a `DropdownMenuItem`: Radix closes the menu on select,
 * which would unmount a trigger nested inside it and take the dialog with it.
 *
 * The form mounts and unmounts with the dialog (Radix does not keep closed
 * content mounted), so its seeds and any half-typed reason are read fresh each
 * time it opens rather than carried over from the last row it was opened on.
 */
export function AmendCorrectionDialog({
  entry,
  projects,
  timezone,
  open,
  onOpenChange,
}: {
  entry: TimeEntryWithLabels;
  projects: Project[];
  timezone: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Request a correction</DialogTitle>
          <DialogDescription>
            This entry is closed, so its times are yours to propose and an
            admin&rsquo;s to approve. Nothing changes until someone reviews it —
            and the entry keeps counting as it is in the meantime.
          </DialogDescription>
        </DialogHeader>
        <AmendCorrectionForm
          entry={entry}
          projects={projects}
          timezone={timezone}
          onCompleted={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
