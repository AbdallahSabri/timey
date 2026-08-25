"use client";

import { useState } from "react";

import { ManualEntryForm } from "@/components/time-entries/manual-entry-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { Project } from "@/lib/actions/projects";

/**
 * Manual entry lives behind a dialog, and behind a quieter button than the
 * timer's, because it is the secondary path: the timer measures, this asserts
 * (§5.3), and the product is for the former. Putting the form permanently on
 * the dashboard would give the two equal weight on the one screen where the
 * distance between signing in and starting a timer matters most.
 *
 * The form mounts with the dialog, so its "now" seed is read when the dialog
 * opens rather than when the page rendered — a dashboard left open since
 * this morning does not pre-fill this morning.
 */
export function ManualEntryDialog({
  projects,
  timezone,
}: {
  projects: Project[];
  timezone: string | null;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          Log time manually
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Log time manually</DialogTitle>
          <DialogDescription>
            For work the timer missed. It is saved as a completed entry and
            marked <span className="text-foreground font-medium">Manual</span>{" "}
            in your list, so a typed entry is never mistaken for a measured one.
          </DialogDescription>
        </DialogHeader>
        <ManualEntryForm
          projects={projects}
          timezone={timezone}
          onCompleted={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
