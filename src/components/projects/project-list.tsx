"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { ArchiveDialog } from "@/components/structure/archive-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { archiveProject } from "@/lib/actions/projects";
import type { Project } from "@/lib/actions/projects";
import { cn } from "@/lib/utils";

/**
 * The same component for both roles, because `listProjects()` already answers
 * differently for each: `projects_select_admin_or_member` (§3.6.1) gives an
 * admin every project in the company and an employee only the ones they are
 * assigned to. Re-deciding that here in TypeScript would be a second copy of
 * the rule, and the copy that fails open is the one nobody notices.
 *
 * `canManage` only chooses whether the archive column renders.
 */
export function ProjectList({
  projects,
  canManage,
  emptyMessage,
}: {
  projects: Project[];
  canManage: boolean;
  emptyMessage: string;
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function archive(project: Project) {
    setPendingId(project.id);
    const result = await archiveProject(project.id);
    setPendingId(null);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    toast.success(`${project.name} has been archived.`);
    router.refresh();
  }

  if (projects.length === 0) {
    return <p className="text-muted-foreground text-sm">{emptyMessage}</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Project</TableHead>
          <TableHead>Client</TableHead>
          <TableHead>Status</TableHead>
          {canManage ? (
            <TableHead className="w-28">
              <span className="sr-only">Actions</span>
            </TableHead>
          ) : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {projects.map((project) => {
          const isArchived = project.archivedAt !== null;

          return (
            <TableRow
              key={project.id}
              className={cn(isArchived && "text-muted-foreground")}
            >
              <TableCell className="font-medium">
                <Link
                  href={`/projects/${project.id}`}
                  className="hover:text-foreground underline underline-offset-4"
                >
                  {project.name}
                </Link>
                {project.description ? (
                  <span className="text-muted-foreground block text-sm font-normal">
                    {project.description}
                  </span>
                ) : null}
              </TableCell>
              {/* An archived client keeps its label here (§3.11) — it is only
                  gone from the pickers. */}
              <TableCell>{project.client?.name ?? "Internal"}</TableCell>
              <TableCell>{isArchived ? "Archived" : "Active"}</TableCell>
              {canManage ? (
                <TableCell className="text-right">
                  {isArchived ? null : (
                    <ArchiveDialog
                      title={`Archive ${project.name}?`}
                      description="Time already logged against it stays, and its tasks keep their names. It disappears from pickers and cannot be un-archived — there is no restore, because the name is released when it goes."
                      triggerAriaLabel={`Archive ${project.name}`}
                      disabled={pendingId === project.id}
                      onConfirm={() => archive(project)}
                    />
                  )}
                </TableCell>
              ) : null}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
