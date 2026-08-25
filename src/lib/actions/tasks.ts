"use server";

import { revalidatePath } from "next/cache";

// Type-only, so it is erased at build time and does not pull another
// "use server" module into this one's graph.
import type { ActionResult } from "@/lib/actions/auth";
import { createClient } from "@/lib/supabase/server";
import {
  listStructureOptionsSchema,
  projectIdSchema,
  taskIdSchema,
  taskSchema,
  type ListStructureOptions,
  type TaskInput,
} from "@/lib/validations/structure";

import type { PostgrestError } from "@supabase/supabase-js";

const NOT_CONFIGURED =
  "Authentication is not configured. Check the Supabase environment variables.";

const NOT_FOUND = "Task not found, or you don't have permission to change it.";

/** One row of a project's task list. Tasks are flat — they do not nest (§3.5.1). */
export type Task = {
  id: string;
  projectId: string;
  name: string;
  archivedAt: string | null;
};

function taskWriteErrorMessage(error: PostgrestError): string {
  switch (error.code) {
    case "23505":
      // `tasks_project_id_name_active_key`, scoped to ACTIVE tasks in this one
      // project. Every project has a "General" task from birth (§3.5.2), so
      // this is the error a second hand-made "General" hits.
      return "A task with this name already exists in this project.";
    case "42501":
      // Two different refusals with one honest answer: `tasks_insert_admin`
      // rejecting a non-admin, and the same policy rejecting an admin of
      // another company (the derive trigger resolves company_id from the
      // project itself, so a cross-tenant insert reaches WITH CHECK carrying
      // the *other* company's id and is refused there rather than mislabelled
      // "project not found").
      return "You don't have permission to change tasks on this project.";
    case "23503":
    case "23502":
      // `set_company_id_from_project()` raises these when project_id names
      // nothing, or names nothing at all.
      return "That project no longer exists.";
    default:
      return "Could not save the task. Please try again.";
  }
}

/**
 * `projectId` is an argument rather than a schema field because it comes from
 * the route, not from the user (see `taskSchema`).
 *
 * **`company_id` is never in this payload.** It is derived from the project by
 * `tasks_10_set_company_id`, and `authenticated` holds no INSERT grant on that
 * column — naming it fails with 42501 even when the value would have been
 * correct (§3.6.2).
 */
export async function createTask(
  projectId: string,
  input: TaskInput,
): Promise<ActionResult<Task>> {
  const parsedProjectId = projectIdSchema.safeParse(projectId);
  if (!parsedProjectId.success) {
    return { ok: false, error: "That project no longer exists." };
  }

  const parsed = taskSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid task details.",
    };
  }

  let task: Task;
  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("tasks")
      .insert({ project_id: parsedProjectId.data, name: parsed.data.name })
      .select("id, project_id, name, archived_at")
      .single();

    if (error) {
      return { ok: false, error: taskWriteErrorMessage(error) };
    }

    task = {
      id: data.id,
      projectId: data.project_id,
      name: data.name,
      archivedAt: data.archived_at,
    };
  } catch {
    return { ok: false, error: NOT_CONFIGURED };
  }

  revalidatePath("/", "layout");
  return { ok: true, data: task };
}

/**
 * §3.11 — archive, never delete. A task with time entries against it must stay
 * readable for those entries to keep a label, which is why there is no DELETE
 * grant on `tasks` for anyone.
 *
 * Archiving the auto-created "General" task is allowed and not special-cased:
 * §3.5.2 guarantees it exists at creation so the flow is never *blocked*, not
 * that it exists forever. A project whose tasks are all archived can still be
 * given a new one.
 *
 * Zero rows affected = the UPDATE policy filtered the row (not an admin, or not
 * this company). Silent at the database, so checked here.
 */
export async function archiveTask(taskId: string): Promise<ActionResult<null>> {
  const parsed = taskIdSchema.safeParse(taskId);
  if (!parsed.success) {
    return { ok: false, error: "Task not found." };
  }

  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("tasks")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", parsed.data)
      .select("id");

    if (error) {
      return { ok: false, error: taskWriteErrorMessage(error) };
    }
    if (data.length === 0) {
      return { ok: false, error: NOT_FOUND };
    }
  } catch {
    return { ok: false, error: NOT_CONFIGURED };
  }

  revalidatePath("/", "layout");
  return { ok: true, data: null };
}

/**
 * Active tasks of one project by default (§3.11 — pickers exclude archived).
 *
 * An empty list means the project is invisible to this caller
 * (`tasks_select_admin_or_member` follows the parent project, §4.2) — not that
 * the project has no tasks. "No tasks yet" is unreachable: every project is
 * born with "General" (§3.5.2), so nothing downstream should treat an empty
 * task list as a state to recover from.
 */
export async function listTasks(
  projectId: string,
  options?: ListStructureOptions,
): Promise<ActionResult<Task[]>> {
  const parsedProjectId = projectIdSchema.safeParse(projectId);
  if (!parsedProjectId.success) {
    return { ok: false, error: "That project no longer exists." };
  }

  const parsed = listStructureOptionsSchema.safeParse(options ?? {});
  if (!parsed.success) {
    return { ok: false, error: "Could not load the task list." };
  }

  try {
    const supabase = await createClient();

    let query = supabase
      .from("tasks")
      .select("id, project_id, name, archived_at")
      .eq("project_id", parsedProjectId.data);

    if (!parsed.data.includeArchived) {
      query = query.is("archived_at", null);
    }

    const { data, error } = await query
      .order("archived_at", { ascending: true, nullsFirst: true })
      .order("name", { ascending: true });

    if (error) {
      return { ok: false, error: "Could not load the task list." };
    }

    return {
      ok: true,
      data: data.map((row) => ({
        id: row.id,
        projectId: row.project_id,
        name: row.name,
        archivedAt: row.archived_at,
      })),
    };
  } catch {
    return { ok: false, error: NOT_CONFIGURED };
  }
}
