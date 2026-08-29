import { redirect } from "next/navigation";

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
 * §4.2.2: admin-only route. `listProjects()` is still role-asymmetric at the
 * policy level (§3.6.1) — an admin gets every project in the company, an
 * employee only those they are assigned to — and that asymmetry is untouched.
 * What changed is who reaches this page: an employee is redirected to the
 * dashboard, where the timer's own picker gives them their projects in the one
 * place they need them.
 *
 * **The redirect is not what protects the project list.**
 * `projects_select_admin_or_member` stays exactly as it was, because the timer
 * and the manual-entry form both populate their pickers through it. Narrowing
 * it would stop an employee logging time at all.
 *
 * The check is repeated in middleware, which does not run on every rendering
 * path — so the page carries its own.
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

  if (!isAdmin) {
    redirect("/dashboard");
  }

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
