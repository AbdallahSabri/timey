"use client";

import { useState } from "react";

import { CreateProjectForm } from "@/components/projects/create-project-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { Client } from "@/lib/actions/clients";

/**
 * Step two of §9.9.7's sequence.
 *
 * The description says the thing `/projects` says on its own card and that the
 * setup card exists to stop an admin discovering by failure: creating a project
 * assigns nobody to it, including the admin who made it, and nobody can log
 * time to a project they are not on (§3.6.1).
 */
export function NewProjectDialog({
  clients,
  label,
}: {
  clients: Client[];
  label: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>
            It starts with a &ldquo;General&rdquo; task, so time can be logged
            to it immediately — but it assigns nobody, including you. Adding
            people is the next step.
          </DialogDescription>
        </DialogHeader>
        <CreateProjectForm
          clients={clients}
          onCompleted={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
