"use client";

import { useState } from "react";

import { InviteMemberForm } from "@/components/invitations/invite-member-form";
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
 * Step three of §9.9.7's sequence — and **the one dialog here that does not
 * close on success.**
 *
 * `InviteMemberForm` renders the invitation link once, after it is minted, and
 * says so in its own copy: leaving the page loses it, and a lost link means
 * revoking the invitation and sending another. A dialog that dismissed itself
 * on `onSent` would destroy the only copy of the token in the instant it
 * appeared. So `onSent` is used for nothing but a nudge in the description, and
 * the admin closes this deliberately once they have copied the link.
 *
 * The description also states the gap §9.9.7 exists to make visible: an
 * invitation adds somebody to the *company*, and they still cannot log time
 * until they accept and are put on a project. The schema forces that order —
 * `project_members` references `profiles`, so there is no row to create until
 * the invitee has one.
 */
export function InviteMemberDialog({ label }: { label: string }) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setSent(false);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Invite someone</DialogTitle>
          <DialogDescription>
            {sent
              ? "Copy the link before you close this — it is shown once. They will be able to log time once they accept and you add them to a project."
              : "This adds them to the company. They can log time once they accept and you add them to a project."}
          </DialogDescription>
        </DialogHeader>
        <InviteMemberForm onSent={() => setSent(true)} />
      </DialogContent>
    </Dialog>
  );
}
