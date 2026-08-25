"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { DataCard, DataCardList } from "@/components/structure/data-card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { revokeInvitation } from "@/lib/actions/invitations";
import type { PendingInvitation } from "@/lib/actions/invitations";
import { cn } from "@/lib/utils";

/**
 * The expiry is formatted on the server and passed down as a string: formatting
 * it here would render one date during hydration and another one on a machine
 * in a different zone.
 */
export type PendingInvitationRow = PendingInvitation & { expiresLabel: string };

/**
 * Outstanding invitations only — an accepted one is a member, and belongs in
 * the member list. Expired rows are still listed rather than filtered out, so
 * the admin can see why nothing happened and revoke or re-send deliberately.
 */
export function PendingInvitationList({
  invitations,
}: {
  invitations: PendingInvitationRow[];
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function revoke(invitation: PendingInvitationRow) {
    setPendingId(invitation.id);
    const result = await revokeInvitation(invitation.id);
    setPendingId(null);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    // §8.4: revoking deletes the row, so the link stops working immediately.
    toast.success(`The invitation to ${invitation.email} no longer works.`);
    router.refresh();
  }

  if (invitations.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No invitations are waiting to be accepted.
      </p>
    );
  }

  function revokeControl(invitation: PendingInvitationRow) {
    return (
      <Button
        type="button"
        variant="destructive"
        size="sm"
        disabled={pendingId === invitation.id}
        onClick={() => void revoke(invitation)}
      >
        {pendingId === invitation.id ? "Revoking…" : "Revoke"}
      </Button>
    );
  }

  function expiryLabel(invitation: PendingInvitationRow) {
    return invitation.expired
      ? `Expired ${invitation.expiresLabel}`
      : invitation.expiresLabel;
  }

  return (
    <>
      <DataCardList className="md:hidden">
        {invitations.map((invitation) => (
          <DataCard
            key={invitation.id}
            muted={invitation.expired}
            title={invitation.email}
            action={revokeControl(invitation)}
            fields={[
              { label: "Role", value: invitation.role },
              { label: "Invited by", value: invitation.invitedByName ?? "—" },
              { label: "Expires", value: expiryLabel(invitation) },
            ]}
          />
        ))}
      </DataCardList>

      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Invited by</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead className="w-24">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invitations.map((invitation) => (
              <TableRow
                key={invitation.id}
                className={cn(invitation.expired && "text-muted-foreground")}
              >
                <TableCell className="font-medium">
                  {invitation.email}
                </TableCell>
                <TableCell>{invitation.role}</TableCell>
                <TableCell>{invitation.invitedByName ?? "—"}</TableCell>
                <TableCell>{expiryLabel(invitation)}</TableCell>
                <TableCell className="text-right">
                  {revokeControl(invitation)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
