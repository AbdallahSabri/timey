"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { ArchiveDialog } from "@/components/structure/archive-dialog";
import { DataCard, DataCardList } from "@/components/structure/data-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { archiveTask } from "@/lib/actions/tasks";
import type { Task } from "@/lib/actions/tasks";
import { cn } from "@/lib/utils";

/**
 * §3.5.2 — every project is born with a "General" task, so "this project has no
 * tasks, create one first" is not a state this list renders. An empty list here
 * means every task has been archived, which is allowed and is not something to
 * recover from.
 */
export function TaskList({
  tasks,
  canManage,
  showArchived,
}: {
  tasks: Task[];
  canManage: boolean;
  showArchived: boolean;
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function archive(task: Task) {
    setPendingId(task.id);
    const result = await archiveTask(task.id);
    setPendingId(null);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    toast.success(`${task.name} has been archived.`);
    router.refresh();
  }

  if (tasks.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        {showArchived
          ? "No tasks to show."
          : "Every task in this project is archived."}
      </p>
    );
  }

  function archiveControl(task: Task) {
    if (!canManage || task.archivedAt !== null) {
      return null;
    }

    return (
      <ArchiveDialog
        title={`Archive ${task.name}?`}
        description="Time already logged against it keeps this label. It leaves the pickers and cannot be un-archived — the name is released when it goes, so a restore could collide with a task created since."
        triggerAriaLabel={`Archive ${task.name}`}
        disabled={pendingId === task.id}
        onConfirm={() => archive(task)}
      />
    );
  }

  return (
    <>
      <DataCardList className="md:hidden">
        {tasks.map((task) => (
          <DataCard
            key={task.id}
            title={task.name}
            muted={task.archivedAt !== null}
            action={archiveControl(task)}
            fields={[
              {
                label: "Status",
                value: task.archivedAt !== null ? "Archived" : "Active",
              },
            ]}
          />
        ))}
      </DataCardList>

      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Task</TableHead>
              <TableHead>Status</TableHead>
              {canManage ? (
                <TableHead className="w-28">
                  <span className="sr-only">Actions</span>
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.map((task) => {
              const isArchived = task.archivedAt !== null;

              return (
                <TableRow
                  key={task.id}
                  className={cn(isArchived && "text-muted-foreground")}
                >
                  <TableCell className="font-medium">{task.name}</TableCell>
                  <TableCell>{isArchived ? "Archived" : "Active"}</TableCell>
                  {canManage ? (
                    <TableCell className="text-right">
                      {archiveControl(task)}
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
