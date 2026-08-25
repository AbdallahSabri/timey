"use client";

import { MoreHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { DataCard, DataCardList } from "@/components/structure/data-card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ActionResult } from "@/lib/actions/auth";
import { setMemberStatus, updateMemberRole } from "@/lib/actions/companies";
import type { CompanyMember } from "@/lib/actions/companies";
import { cn } from "@/lib/utils";

/**
 * §2.3 — the list includes deactivated members, because they keep their time
 * entries and an admin needs to see one to reactivate them.
 *
 * `canManage` decides whether the per-row menu renders at all. It is a
 * convenience, not the boundary: `updateMemberRole` and `setMemberStatus` are
 * gated by RLS, the column GRANT, and the last-admin trigger regardless of what
 * this component draws, and their refusals are surfaced verbatim below. The
 * self row never gets role or status controls — §2 forbids an admin changing
 * their own role, and deactivating yourself is a lockout, not a feature.
 */
export function MemberList({
  members,
  currentUserId,
  canManage,
}: {
  members: CompanyMember[];
  currentUserId: string | null;
  canManage: boolean;
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function run(
    userId: string,
    mutate: () => Promise<ActionResult<null>>,
    success: string,
  ) {
    setPendingId(userId);
    const result = await mutate();
    setPendingId(null);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    toast.success(success);
    // The list is rendered on the server; without this the row keeps its old
    // role until the next full navigation.
    router.refresh();
  }

  if (members.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">No members to show yet.</p>
    );
  }

  function rowMenu(member: CompanyMember) {
    const isSelf = member.id === currentUserId;

    if (!canManage || isSelf) {
      return null;
    }

    const isActive = member.status === "active";
    const nextRole = member.role === "admin" ? "employee" : "admin";

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={pendingId === member.id}
            aria-label={`Manage ${member.fullName}`}
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={() =>
              void run(
                member.id,
                () => updateMemberRole(member.id, nextRole),
                `${member.fullName} is now ${nextRole === "admin" ? "an admin" : "an employee"}.`,
              )
            }
          >
            Make {nextRole}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant={isActive ? "destructive" : "default"}
            onSelect={() =>
              void run(
                member.id,
                () =>
                  setMemberStatus(member.id, isActive ? "inactive" : "active"),
                isActive
                  ? `${member.fullName} has been deactivated.`
                  : `${member.fullName} is active again.`,
              )
            }
          >
            {isActive ? "Deactivate" : "Reactivate"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <>
      <DataCardList className="md:hidden">
        {members.map((member) => (
          <DataCard
            key={member.id}
            muted={member.status !== "active"}
            title={member.fullName}
            meta={
              member.id === currentUserId ? (
                <span className="text-muted-foreground text-xs">you</span>
              ) : null
            }
            action={rowMenu(member)}
            fields={[
              { label: "Role", value: member.role },
              { label: "Status", value: member.status },
            ]}
          />
        ))}
      </DataCardList>

      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              {canManage ? (
                <TableHead className="w-12">
                  <span className="sr-only">Actions</span>
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((member) => {
              const isSelf = member.id === currentUserId;

              return (
                <TableRow
                  key={member.id}
                  className={cn(
                    member.status !== "active" && "text-muted-foreground",
                  )}
                >
                  <TableCell className="font-medium">
                    {member.fullName}
                    {isSelf ? (
                      <span className="text-muted-foreground ml-2 font-normal">
                        you
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>{member.role}</TableCell>
                  <TableCell>{member.status}</TableCell>
                  {canManage ? (
                    <TableCell className="text-right">
                      {rowMenu(member)}
                    </TableCell>
                  ) : null}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
