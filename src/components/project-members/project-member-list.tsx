"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { removeProjectMember } from "@/lib/actions/project-members";
import type { ProjectMember } from "@/lib/actions/project-members";
import { cn } from "@/lib/utils";

/** Formatted on the server so hydration cannot disagree about the zone. */
export type ProjectMemberRow = ProjectMember & { addedLabel: string };

/**
 * §3.6.1 — who may log time to this project, which is a different question from
 * who can see it. An admin appears here only if they were added, exactly like
 * an employee; being an admin is what lets them *see* every project, not what
 * puts them on one.
 *
 * Removal is a plain button rather than a confirmation dialog: a membership row
 * carries no history, so re-adding someone restores the state exactly. That is
 * the opposite of archiving, which is why archiving asks first and this does
 * not.
 */
export function ProjectMemberList({
  projectId,
  members,
  canManage,
}: {
  projectId: string;
  members: ProjectMemberRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function remove(member: ProjectMemberRow) {
    setPendingId(member.userId);
    const result = await removeProjectMember(projectId, member.userId);
    setPendingId(null);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    toast.success(`${member.fullName} is no longer on this project.`);
    router.refresh();
  }

  if (members.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Nobody is assigned to this project yet. Until someone is, nobody can log
        time to it.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Assigned</TableHead>
          {canManage ? (
            <TableHead className="w-24">
              <span className="sr-only">Actions</span>
            </TableHead>
          ) : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {members.map((member) => (
          <TableRow
            key={member.userId}
            className={cn(
              member.status !== "active" && "text-muted-foreground",
            )}
          >
            <TableCell className="font-medium">{member.fullName}</TableCell>
            <TableCell>{member.role}</TableCell>
            <TableCell>{member.status}</TableCell>
            <TableCell>{member.addedLabel}</TableCell>
            {canManage ? (
              <TableCell className="text-right">
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={pendingId === member.userId}
                  onClick={() => void remove(member)}
                >
                  {pendingId === member.userId ? "Removing…" : "Remove"}
                </Button>
              </TableCell>
            ) : null}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
