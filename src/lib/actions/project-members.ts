"use server";

import { revalidatePath } from "next/cache";

// Type-only, so it is erased at build time and does not pull another
// "use server" module into this one's graph.
import type { ActionResult } from "@/lib/actions/auth";
import { createClient } from "@/lib/supabase/server";
import {
  memberIdSchema,
  type MemberRole,
  type MemberStatus,
} from "@/lib/validations/members";
import { projectIdSchema } from "@/lib/validations/structure";

import type { PostgrestError } from "@supabase/supabase-js";

const NOT_CONFIGURED =
  "Authentication is not configured. Check the Supabase environment variables.";

/**
 * One assignment row (§3.6). `role` is the person's company role, not a
 * per-project one — there is no such thing. It travels with the row because
 * §3.6.1 makes the distinction visible in this exact list: an **admin** who is
 * not on this project can see it but may not log time to it, and an admin who
 * is on it appears here like anyone else.
 */
export type ProjectMember = {
  userId: string;
  fullName: string;
  role: MemberRole;
  status: MemberStatus;
  addedAt: string;
};

function membershipErrorMessage(error: PostgrestError): string {
  switch (error.code) {
    case "23505":
      // The (project_id, user_id) primary key.
      return "That person is already assigned to this project.";
    case "42501":
      return "Only an admin can change project membership.";
    case "23503":
      // Two composite FKs and the derive trigger land here. The user-side one
      // fires when the named person belongs to another company (§2.2) or to no
      // company at all — a limbo profile has a NULL company_id, which cannot
      // match the project's.
      return error.message.includes("user_id")
        ? "That person isn't a member of your company."
        : "That project no longer exists.";
    case "23502":
      return "That project no longer exists.";
    default:
      return "Could not update project membership. Please try again.";
  }
}

/**
 * §3.6.1: membership is membership regardless of role. An admin who wants to
 * log time to a project needs a row here exactly like an employee does —
 * nothing in this action treats admins as implicit members, and Phase 5's
 * `time_entries` INSERT policy must not either.
 *
 * **`company_id` is never in this payload.** It is derived from the project by
 * `project_members_10_set_company_id`, and `authenticated` holds no INSERT
 * grant on that column: naming it is refused with 42501 even when the value
 * would have been correct (§3.6.2). `added_at` is likewise not writable — it
 * records when something happened.
 */
export async function addProjectMember(
  projectId: string,
  userId: string,
): Promise<ActionResult<null>> {
  const parsedProjectId = projectIdSchema.safeParse(projectId);
  if (!parsedProjectId.success) {
    return { ok: false, error: "That project no longer exists." };
  }

  const parsedUserId = memberIdSchema.safeParse(userId);
  if (!parsedUserId.success) {
    return { ok: false, error: "That member no longer exists." };
  }

  try {
    const supabase = await createClient();

    const { error } = await supabase
      .from("project_members")
      .insert({
        project_id: parsedProjectId.data,
        user_id: parsedUserId.data,
      })
      .select("project_id")
      .single();

    if (error) {
      return { ok: false, error: membershipErrorMessage(error) };
    }
  } catch {
    return { ok: false, error: NOT_CONFIGURED };
  }

  revalidatePath("/", "layout");
  return { ok: true, data: null };
}

/**
 * Unassigning is a real delete, and the only one this phase grants (§4.2):
 * a membership row carries no history — the time entries it once permitted keep
 * their own `user_id` and stay untouched — so §3.11's archive-never-delete rule
 * does not reach it.
 *
 * `project_members_delete_admin` filters through USING, which is silent, so a
 * non-admin's blocked delete arrives as zero rows rather than as an error.
 * Reporting that as success would tell an admin someone had been removed from a
 * project they can still log time to.
 */
export async function removeProjectMember(
  projectId: string,
  userId: string,
): Promise<ActionResult<null>> {
  const parsedProjectId = projectIdSchema.safeParse(projectId);
  if (!parsedProjectId.success) {
    return { ok: false, error: "That project no longer exists." };
  }

  const parsedUserId = memberIdSchema.safeParse(userId);
  if (!parsedUserId.success) {
    return { ok: false, error: "That member no longer exists." };
  }

  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("project_members")
      .delete()
      .eq("project_id", parsedProjectId.data)
      .eq("user_id", parsedUserId.data)
      .select("project_id");

    if (error) {
      return { ok: false, error: membershipErrorMessage(error) };
    }
    if (data.length === 0) {
      return {
        ok: false,
        error:
          "That person isn't assigned to this project, or you don't have permission to change it.",
      };
    }
  } catch {
    return { ok: false, error: NOT_CONFIGURED };
  }

  revalidatePath("/", "layout");
  return { ok: true, data: null };
}

/**
 * Who is assigned to one project, with the profile fields a list needs.
 *
 * `project_members_select_own_company` is company-wide by §4.2's literal
 * reading (§3.6.2), so an employee can read the assignment pairs of a project
 * whose name they cannot see. That is what the matrix says and it is not
 * widened here — but it does mean an empty result is genuinely "nobody is
 * assigned", not "you cannot see this project", which is the opposite of how
 * `listTasks` reads.
 *
 * Sorted in TypeScript rather than SQL: the sort key lives on the embedded
 * profile, and PostgREST's ordering applies to the embedded rows of a to-one
 * join, not to the parent. A project's membership is a handful of rows.
 */
export async function listProjectMembers(
  projectId: string,
): Promise<ActionResult<ProjectMember[]>> {
  const parsed = projectIdSchema.safeParse(projectId);
  if (!parsed.success) {
    return { ok: false, error: "That project no longer exists." };
  }

  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("project_members")
      .select("user_id, added_at, profiles (full_name, role, status)")
      .eq("project_id", parsed.data);

    if (error) {
      return { ok: false, error: "Could not load the project's members." };
    }

    const members = data.flatMap((row) =>
      // The composite FK to profiles is NOT NULL on both columns, so a
      // membership always has a profile. Skipping rather than asserting keeps
      // the type honest without inventing a placeholder name for a row that
      // cannot exist.
      row.profiles
        ? [
            {
              userId: row.user_id,
              fullName: row.profiles.full_name,
              role: row.profiles.role,
              status: row.profiles.status,
              addedAt: row.added_at,
            },
          ]
        : [],
    );

    members.sort((a, b) => a.fullName.localeCompare(b.fullName));

    return { ok: true, data: members };
  } catch {
    return { ok: false, error: NOT_CONFIGURED };
  }
}
