"use client";

import { useState } from "react";

import { CreateCorrectionForm } from "@/components/corrections/create-correction-form";
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
 * The `create` request lives beside the manual-entry dialog on the dashboard,
 * and the pairing is the explanation: they are the same form with two different
 * answers to "which day?".
 *
 * §7.1 draws the line there and nowhere else — *today* an employee may assert
 * alone; any other day is a proposal an admin approves. Two adjacent buttons
 * make that the visible difference between them, where a single form with a
 * date field that sometimes needs approval would make it a surprise at submit
 * time.
 *
 * Its own trigger, unlike the amend and delete dialogs: this one is not about a
 * row, so there is no menu for it to live in.
 */
export function CreateCorrectionDialog({
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
        <Button type="button" variant="ghost" size="sm">
          Request an earlier day
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Request an entry for another day</DialogTitle>
          <DialogDescription>
            Logging time by hand is limited to today. For any other day, propose
            the entry here and an admin adds it — nothing is recorded until they
            approve it.
          </DialogDescription>
        </DialogHeader>
        <CreateCorrectionForm
          projects={projects}
          timezone={timezone}
          onCompleted={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
