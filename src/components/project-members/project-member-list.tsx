"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { formatSchedule } from "@/components/project-members/format-schedule";
import { MemberScheduleDialog } from "@/components/project-members/member-schedule-dialog";
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
 *
 * Each row also carries §3.6.3's schedule — `4h/day · Mon, Tue, Thu, Fri` — and
 * an Edit control for it. The schedule is a property of *this* assignment, so
 * this is one of the two places it can be changed and the other (the Team
 * page) reaches the same row through the same action.
 */
export function ProjectMemberList({
  projectId,
  projectName,
  members,
  canManage,
  weekStartsOn,
}: {
  projectId: string;
  projectName: string;
  members: ProjectMemberRow[];
  canManage: boolean;
  /** `companies.week_starts_on` — orders the day picker's checkboxes only. */
  weekStartsOn: number;
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  /** Which row's schedule dialog is open, by user id. */
  const [editingId, setEditingId] = useState<string | null>(null);

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

  function rowControls(member: ProjectMemberRow) {
    if (!canManage) {
      return null;
    }

    return (
      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pendingId === member.userId}
          onClick={() => setEditingId(member.userId)}
        >
          Edit hours
        </Button>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={pendingId === member.userId}
          onClick={() => void remove(member)}
        >
          {pendingId === member.userId ? "Removing…" : "Remove"}
        </Button>
      </div>
    );
  }

  /**
   * The row being edited, if any.
   *
   * **One dialog for the whole list, not one per row**, because every row is
   * rendered twice — once as a `DataCard` below `md` and once as a table row
   * above it. A dialog mounted inside each would put two open copies of the
   * same form in the DOM, both portalled to the body, where the breakpoint
   * classes that hide one list cannot reach either.
   *
   * Mounted only while open, so `useForm` reads `defaultValues` from the row's
   * current values each time it appears — those are read once at mount, and a
   * dialog kept mounted across a `router.refresh()` would go on showing the
   * hours it opened with after they had changed underneath it.
   */
  const editing = members.find((member) => member.userId === editingId) ?? null;

  return (
    <>
      <DataCardList className="md:hidden">
        {members.map((member) => (
          <DataCard
            key={member.userId}
            muted={member.status !== "active"}
            title={member.fullName}
            action={rowControls(member)}
            fields={[
              { label: "Role", value: member.role },
              { label: "Status", value: member.status },
              {
                label: "Assigned",
                value: member.addedLabel,
                numeric: true,
              },
              {
                label: "Expected",
                value: formatSchedule(
                  member.expectedDailySeconds,
                  member.workingDays,
                  weekStartsOn,
                ),
              },
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
              <TableHead>Assigned</TableHead>
              <TableHead>Expected</TableHead>
              {canManage ? (
                <TableHead className="w-52">
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
                <TableCell className="font-mono tabular-nums">
                  {member.addedLabel}
                </TableCell>
                {/* Mono because the hours are a figure, even inside a sentence
                    that also names days — it lines up down the column with the
                    Assigned dates beside it. */}
                <TableCell className="font-mono tabular-nums">
                  {formatSchedule(
                    member.expectedDailySeconds,
                    member.workingDays,
                    weekStartsOn,
                  )}
                </TableCell>
                {canManage ? (
                  <TableCell className="text-right">
                    {rowControls(member)}
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {editing ? (
        <MemberScheduleDialog
          projectId={projectId}
          userId={editing.userId}
          memberName={editing.fullName}
          projectName={projectName}
          expectedDailySeconds={editing.expectedDailySeconds}
          workingDays={editing.workingDays}
          weekStartsOn={weekStartsOn}
          open
          onOpenChange={(next) => setEditingId(next ? editing.userId : null)}
        />
      ) : null}
    </>
  );
}
