"use client";

import { nativeSelectClassName } from "@/components/structure/select-class";
import type { TaskState } from "@/components/time-entries/use-project-tasks";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import type { Project } from "@/lib/actions/projects";

import type { UseFormRegisterReturn } from "react-hook-form";

/**
 * The pair of selects every "log time against something" form needs, shared by
 * the timer and the manual entry so the two never drift apart.
 *
 * `projects` is already RLS- and role-scoped by `listProjects()` — an employee
 * only ever sees the projects they are assigned to (§3.6.1). That is a
 * convenience, not the enforcement: an admin who can *see* every project still
 * cannot log time to one they are not a member of, and the insert policy is
 * what says so. A project reaching this list that the database will refuse is
 * answered by the pre-worded "You're not assigned to this project" message, not
 * by hiding it twice.
 *
 * Errors are rendered from whatever the caller's form state holds, so the
 * component stays agnostic about which schema is validating it.
 */
export function ProjectTaskFields({
  idPrefix,
  projects,
  taskState,
  projectField,
  taskField,
  projectError,
  taskError,
}: {
  idPrefix: string;
  projects: Project[];
  taskState: TaskState;
  projectField: UseFormRegisterReturn;
  taskField: UseFormRegisterReturn;
  projectError?: { message?: string };
  taskError?: { message?: string };
}) {
  const tasks = taskState.status === "ready" ? taskState.tasks : [];

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
      <Field
        className="sm:flex-1"
        data-invalid={projectError ? true : undefined}
      >
        <FieldLabel htmlFor={`${idPrefix}-project`}>Project</FieldLabel>
        <select
          id={`${idPrefix}-project`}
          className={nativeSelectClassName}
          aria-invalid={projectError ? true : undefined}
          {...projectField}
        >
          <option value="">Pick a project…</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.client
                ? `${project.client.name} — ${project.name}`
                : project.name}
            </option>
          ))}
        </select>
        <FieldError errors={projectError ? [projectError] : undefined} />
      </Field>

      <Field className="sm:flex-1" data-invalid={taskError ? true : undefined}>
        <FieldLabel htmlFor={`${idPrefix}-task`}>Task</FieldLabel>
        <select
          id={`${idPrefix}-task`}
          className={nativeSelectClassName}
          disabled={taskState.status !== "ready"}
          aria-invalid={taskError ? true : undefined}
          {...taskField}
        >
          <option value="">
            {taskState.status === "loading" ? "Loading tasks…" : "Pick a task…"}
          </option>
          {tasks.map((task) => (
            <option key={task.id} value={task.id}>
              {task.name}
            </option>
          ))}
        </select>
        {taskState.status === "error" ? (
          <FieldError errors={[{ message: taskState.message }]} />
        ) : (
          <FieldError errors={taskError ? [taskError] : undefined} />
        )}
      </Field>
    </div>
  );
}
