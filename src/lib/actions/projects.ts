"use server";

import { revalidatePath } from "next/cache";

// Type-only, so it is erased at build time and does not pull another
// "use server" module into this one's graph.
import type { ActionResult } from "@/lib/actions/auth";
import { createClient } from "@/lib/supabase/server";
import {
  listStructureOptionsSchema,
  projectIdSchema,
  projectSchema,
  type ListStructureOptions,
  type ProjectInput,
} from "@/lib/validations/structure";

import type { PostgrestError } from "@supabase/supabase-js";

const NOT_CONFIGURED =
  "Authentication is not configured. Check the Supabase environment variables.";

const NOT_FOUND =
  "Project not found, or you don't have permission to change it.";

/**
 * One row of the project list. `client` is null for an internal project
 * (§3.4), which is a real state and not a missing join.
 */
export type Project = {
  id: string;
  name: string;
  description: string | null;
  archivedAt: string | null;
  client: { id: string; name: string } | null;
};

const PROJECT_COLUMNS =
  "id, name, description, archived_at, clients (id, name)";

function projectWriteErrorMessage(error: PostgrestError): string {
  switch (error.code) {
    case "42501":
      return "Only an admin can manage projects.";
    case "23503":
      // The composite FK `(client_id, company_id) -> clients (id, company_id)`
      // is what fails when a project names a client of another company (§2.2),
      // and it fails identically for a client id that never existed. Both mean
      // the same thing to the person reading it: not a client you can use.
      return error.message.includes("client")
        ? "That client doesn't exist in your company."
        : "Create your company before adding projects to it.";
    case "23502":
      return "Create your company before adding projects to it.";
    case "23505":
      // §3.4 asks for no unique index on project names and 0004 creates none,
      // so this is currently unreachable through a duplicate name — the only
      // unique keys on `projects` are on `id`. Branched on the message rather
      // than assumed, so that adding `(company_id, lower(name))` later starts
      // producing the right sentence instead of a uuid-collision message.
      return error.message.includes("name")
        ? "A project with this name already exists."
        : "Could not save the project. Please try again.";
    default:
      return "Could not save the project. Please try again.";
  }
}

/**
 * §3.4. `company_id` is omitted — it defaults to `current_company_id()` and the
 * INSERT policy accepts nothing else.
 *
 * The returned project always has at least one task: `projects_10_create_general_task`
 * fires after this insert and gives it "General" (§3.5.2), so the caller can
 * send the user straight into the entry flow without a task-creation step.
 */
export async function createProject(
  input: ProjectInput,
): Promise<ActionResult<Project>> {
  const parsed = projectSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid project details.",
    };
  }

  const { name, description, clientId } = parsed.data;

  let project: Project;
  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("projects")
      .insert({ name, description, client_id: clientId })
      .select(PROJECT_COLUMNS)
      .single();

    if (error) {
      return { ok: false, error: projectWriteErrorMessage(error) };
    }

    project = {
      id: data.id,
      name: data.name,
      description: data.description,
      archivedAt: data.archived_at,
      client: data.clients,
    };
  } catch {
    return { ok: false, error: NOT_CONFIGURED };
  }

  revalidatePath("/", "layout");
  return { ok: true, data: project };
}

/**
 * §3.11 — archive, never delete; `authenticated` has no DELETE grant on
 * `projects`, and `tasks` references it `ON DELETE RESTRICT`.
 *
 * Tasks of an archived project are deliberately left active. They are reached
 * through their project everywhere, so archiving them too would be a second
 * write that says nothing new — and it would silently free their names under
 * `tasks_project_id_name_active_key` while the project can still be seen.
 *
 * Zero rows affected means the UPDATE policy's USING clause filtered the row:
 * not an admin, or not this company. That is silent at the database, so it is
 * checked here rather than read as success (a non-admin's blocked archive would
 * otherwise render as done).
 */
export async function archiveProject(
  projectId: string,
): Promise<ActionResult<null>> {
  const parsed = projectIdSchema.safeParse(projectId);
  if (!parsed.success) {
    return { ok: false, error: "Project not found." };
  }

  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("projects")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", parsed.data)
      .select("id");

    if (error) {
      return { ok: false, error: projectWriteErrorMessage(error) };
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
 * **This query is role-asymmetric and nothing here makes it so.**
 * `projects_select_admin_or_member` (§3.6.1) returns every project in the
 * company to an admin and only assigned ones to an employee. There is no role
 * branch in this function on purpose: a second copy of that rule in TypeScript
 * is a second place for it to be wrong, and the one that fails open is the one
 * users notice last.
 *
 * The `clients` embed is safe for employees too — `clients_select_own_company`
 * is company-wide, so an employee sees the client label of a project they are
 * assigned to without gaining a way to enumerate projects they are not.
 */
export async function listProjects(
  options?: ListStructureOptions,
): Promise<ActionResult<Project[]>> {
  const parsed = listStructureOptionsSchema.safeParse(options ?? {});
  if (!parsed.success) {
    return { ok: false, error: "Could not load the project list." };
  }

  try {
    const supabase = await createClient();

    let query = supabase.from("projects").select(PROJECT_COLUMNS);

    if (!parsed.data.includeArchived) {
      query = query.is("archived_at", null);
    }

    const { data, error } = await query
      .order("archived_at", { ascending: true, nullsFirst: true })
      .order("name", { ascending: true });

    if (error) {
      return { ok: false, error: "Could not load the project list." };
    }

    return {
      ok: true,
      data: data.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        archivedAt: row.archived_at,
        client: row.clients,
      })),
    };
  } catch {
    return { ok: false, error: NOT_CONFIGURED };
  }
}
