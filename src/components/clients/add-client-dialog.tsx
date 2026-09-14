"use client";

import { useState } from "react";

import { CreateClientForm } from "@/components/clients/create-client-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * Step one of §9.9.7's sequence, reachable without leaving the dashboard.
 *
 * It wraps the same `CreateClientForm` that `/clients` renders inline rather
 * than restating it: two forms writing one table would be two places for the
 * duplicate-name refusal to be worded differently. The only concession to the
 * dialog is `layout="stack"`, because the page version puts its field and
 * button side by side and that crushes both at dialog width.
 */
export function AddClientDialog({ label }: { label: string }) {
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
          <DialogTitle>Add a client</DialogTitle>
          <DialogDescription>
            Who the work is for. Projects hang off a client — though a project
            with no client is internal, which is a valid answer too.
          </DialogDescription>
        </DialogHeader>
        <CreateClientForm layout="stack" onCompleted={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
