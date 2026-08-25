import { CreateProjectForm } from "@/components/projects/create-project-form";
import { ProjectList } from "@/components/projects/project-list";
import { ArchivedToggle } from "@/components/structure/archived-toggle";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { listClients } from "@/lib/actions/clients";
import { getCurrentMember } from "@/lib/actions/companies";
import { listProjects } from "@/lib/actions/projects";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Projects · Timey",
};

/**
 * One route for both roles. `listProjects()` is role-asymmetric at the policy
 * level (§3.6.1): an admin gets every project in the company, an employee gets
 * only the ones they are assigned to. This page adds no filter of its own — the
 * role read below decides which *controls* render, nothing about which rows do.
 *
 * An employee on no projects therefore sees an empty list, which is a correct
 * answer and not an error.
 */
export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>;
}) {
  const { archived } = await searchParams;
  const showArchived = archived === "1";

  const [memberResult, projectsResult] = await Promise.all([
    getCurrentMember(),
    listProjects({ includeArchived: showArchived }),
  ]);

  const currentMember = memberResult.ok ? memberResult.data : null;
  const isAdmin =
    currentMember?.role === "admin" && currentMember.status === "active";

  // Active clients only, and only for the form that uses them (§3.11 —
  // archived rows are excluded from pickers).
  const clientsResult = isAdmin ? await listClients() : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Projects</h1>
        <p className="text-muted-foreground text-sm">
          {isAdmin
            ? "Every project in your company. Open one to manage its tasks and who is assigned to it."
            : "The projects you're assigned to. Open one to see its tasks."}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {showArchived ? "All projects" : "Active projects"}
          </CardTitle>
          <CardDescription>
            Every project starts with a &ldquo;General&rdquo; task, so time can
            be logged to it immediately.
          </CardDescription>
          <ArchivedToggle
            showArchived={showArchived}
            basePath="/projects"
            subject="projects"
          />
        </CardHeader>
        <CardContent>
          {projectsResult.ok ? (
            <ProjectList
              projects={projectsResult.data}
              canManage={isAdmin}
              emptyMessage={
                isAdmin
                  ? "No projects yet. Create one below."
                  : "You're not assigned to any projects yet. An admin adds you to one."
              }
            />
          ) : (
            <p className="text-destructive text-sm">{projectsResult.error}</p>
          )}
        </CardContent>
      </Card>

      {isAdmin ? (
        <Card>
          <CardHeader>
            <CardTitle>Create a project</CardTitle>
            <CardDescription>
              Creating it does not assign anyone — including you. Open the
              project to add people.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {clientsResult === null || clientsResult.ok ? (
              <CreateProjectForm clients={clientsResult?.data ?? []} />
            ) : (
              <p className="text-destructive text-sm">{clientsResult.error}</p>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
