import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AddProjectMemberForm } from "@/components/project-members/add-project-member-form";
import { ProjectMemberList } from "@/components/project-members/project-member-list";
import type { ProjectMemberRow } from "@/components/project-members/project-member-list";
import { ArchivedToggle } from "@/components/structure/archived-toggle";
import { CreateTaskForm } from "@/components/tasks/create-task-form";
import { TaskList } from "@/components/tasks/task-list";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getCurrentMember, listMembers } from "@/lib/actions/companies";
import { listProjectMembers } from "@/lib/actions/project-members";
import { listProjects } from "@/lib/actions/projects";
import { listTasks } from "@/lib/actions/tasks";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Project · Timey",
};

function formatAdded(addedAt: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
    new Date(addedAt),
  );
}

/**
 * The project is found in `listProjects()` rather than fetched by id, because
 * no `getProject(id)` action exists and this needs none: the list is already
 * scoped by `projects_select_admin_or_member` (§3.6.1), so a project missing
 * from it is one this account may not see — an employee who is not a member
 * gets the same 404 as an id that never existed, which is the answer that
 * leaks least. Archived projects are included so their tasks stay readable
 * (§3.11).
 *
 * Everything admin-only on this page is admin-only in Postgres first. Hiding a
 * control is not what stops an employee changing a project — `tasks_*_admin`
 * and `project_members_*_admin` are.
 *
 * §4.2.2: admin-only route, like its parent. The redirect sits *after* the
 * 404, deliberately — an employee asking for a project id that does not exist,
 * or that they are not a member of, should get the same `notFound()` an admin
 * would, not a redirect that tells them the id was real.
 */
export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ archived?: string }>;
}) {
  const [{ id }, { archived }] = await Promise.all([params, searchParams]);
  const showArchived = archived === "1";

  const [memberResult, projectsResult] = await Promise.all([
    getCurrentMember(),
    listProjects({ includeArchived: true }),
  ]);

  if (!projectsResult.ok) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">Project</h1>
        <p className="text-destructive text-sm">{projectsResult.error}</p>
      </div>
    );
  }

  const project = projectsResult.data.find((candidate) => candidate.id === id);
  if (!project) {
    notFound();
  }

  const currentMember = memberResult.ok ? memberResult.data : null;
  const isAdmin =
    currentMember?.role === "admin" && currentMember.status === "active";

  if (!isAdmin) {
    redirect("/dashboard");
  }

  const isArchived = project.archivedAt !== null;

  // An archived project is a dead end — nothing un-archives it (§3.11) — so it
  // is shown read-only rather than offering writes that would technically
  // succeed and mean nothing.
  const canManage = isAdmin && !isArchived;

  const [tasksResult, projectMembersResult] = await Promise.all([
    listTasks(id, { includeArchived: showArchived }),
    listProjectMembers(id),
  ]);

  const companyMembersResult = canManage ? await listMembers() : null;

  const projectMembers: ProjectMemberRow[] = projectMembersResult.ok
    ? projectMembersResult.data.map((member) => ({
        ...member,
        addedLabel: formatAdded(member.addedAt),
      }))
    : [];

  // The "add someone" picker is `listMembers()` minus the people already on the
  // project, diffed here. No anti-join action exists and none is needed at
  // company headcount.
  const assignedIds = new Set(projectMembers.map((member) => member.userId));
  const candidates =
    companyMembersResult?.ok === true
      ? companyMembersResult.data.filter(
          (member) => !assignedIds.has(member.id),
        )
      : [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href="/projects"
          className="text-muted-foreground hover:text-foreground w-fit text-sm underline underline-offset-4 transition-colors"
        >
          ← All projects
        </Link>
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">{project.name}</h1>
          <p className="text-muted-foreground text-sm">
            {project.client?.name ?? "Internal"}
            {isArchived ? " · Archived" : null}
          </p>
          {project.description ? (
            <p className="text-sm">{project.description}</p>
          ) : null}
        </div>
      </div>

      {isArchived ? (
        <p className="border-border bg-muted/40 text-muted-foreground rounded-lg border p-3 text-sm">
          This project is archived. Its time entries and labels stay readable,
          and it can&apos;t be changed or un-archived.
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{showArchived ? "All tasks" : "Tasks"}</CardTitle>
          <CardDescription>
            Time is always logged against a task, never a bare project — which
            is why every project starts with &ldquo;General&rdquo;.
          </CardDescription>
          <ArchivedToggle
            showArchived={showArchived}
            basePath={`/projects/${project.id}`}
            subject="tasks"
          />
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {tasksResult.ok ? (
            <TaskList
              tasks={tasksResult.data}
              canManage={canManage}
              showArchived={showArchived}
            />
          ) : (
            <p className="text-destructive text-sm">{tasksResult.error}</p>
          )}

          {canManage ? <CreateTaskForm projectId={project.id} /> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Assigned people</CardTitle>
          <CardDescription>
            Assignment decides who may log time here. Admins see every project
            without being on it — logging time still takes a row in this list.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {projectMembersResult.ok ? (
            <ProjectMemberList
              projectId={project.id}
              members={projectMembers}
              canManage={canManage}
            />
          ) : (
            <p className="text-destructive text-sm">
              {projectMembersResult.error}
            </p>
          )}

          {canManage ? (
            companyMembersResult?.ok === false ? (
              <p className="text-destructive text-sm">
                {companyMembersResult.error}
              </p>
            ) : (
              <AddProjectMemberForm
                projectId={project.id}
                candidates={candidates}
              />
            )
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
