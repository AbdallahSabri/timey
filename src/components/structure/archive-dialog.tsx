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
 * Archiving is one-way. No action un-archives a client, project or task —
 * freeing the name under the partial unique indexes (§3.3, §3.5) means a
 * one-click restore can collide with something created since — so the click
 * gets a confirmation step rather than an undo.
 *
 * The dialog closes itself once `onConfirm` settles; the caller owns what the
 * result means (toast, refresh), because only it knows the noun.
 */
export function ArchiveDialog({
  title,
  description,
  triggerLabel = "Archive",
  triggerAriaLabel,
  confirmLabel = "Archive",
  disabled = false,
  onConfirm,
}: {
  title: string;
  description: string;
  triggerLabel?: string;
  triggerAriaLabel?: string;
  confirmLabel?: string;
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
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={disabled}
          aria-label={triggerAriaLabel}
        >
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
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
            {pending ? "Archiving…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
