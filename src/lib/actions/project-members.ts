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
import {
  projectMemberScheduleSchema,
  type ProjectMemberScheduleInput,
} from "@/lib/validations/project-members";
import { projectIdSchema } from "@/lib/validations/structure";
import type { Database } from "@/types/supabase";

import type { PostgrestError } from "@supabase/supabase-js";

const NOT_CONFIGURED =
  "Authentication is not configured. Check the Supabase environment variables.";

/**
 * One assignment row (§3.6). `role` is the person's company role, not a
 * per-project one — there is no such thing. It travels with the row because
 * §3.6.1 makes the distinction visible in this exact list: an **admin** who is
 * not on this project can see it but may not log time to it, and an admin who
 * is on it appears here like anyone else.
 *
 * `expectedDailySeconds` and `workingDays` are §3.6.3's schedule, which is a
 * property of *this assignment* rather than of the person: the same employee
 * can be 4h/day Mon–Fri here and 3h/day Mon/Tue/Thu/Fri on the next project.
 * Both are non-null columns with defaults, so every row has them — a row that
 * predates the schedule columns reads back as `0` seconds on Mon–Fri, which is
 * "no target" and not "zero hours were asked of them" (0014).
 *
 * Seconds, never hours (§9.5). Nothing in this layer divides by 3600; the form
 * schema converts on the way in and the edge formats on the way out.
 */
export type ProjectMember = {
  userId: string;
  fullName: string;
  role: MemberRole;
  status: MemberStatus;
  addedAt: string;
  expectedDailySeconds: number;
  workingDays: number[];
};

/**
 * One member's assignment seen from the *person's* side rather than the
 * project's — what the Team page's schedule dialog lists.
 *
 * `projectName` is nullable and a null one is **kept, never dropped**, for the
 * reason the report actions document at length: `project_members` SELECT is
 * company-wide (§3.6.2) while `projects` SELECT is admin-or-member (§3.6.1), so
 * an employee reading a colleague's assignments can hold a membership row whose
 * project they cannot name. Dropping those rows would understate the person's
 * weekly total; rendering the missing label as "—" tells the truth, and
 * inventing one with `?? ""` would turn "I cannot see this" into "this is
 * called nothing".
 */
export type MemberProjectSchedule = {
  projectId: string;
  projectName: string | null;
  expectedDailySeconds: number;
  workingDays: number[];
};

/**
 * The insert payload, named as the generated type so the *absent* columns are
 * as visible as the present ones — see `addProjectMember` on why `company_id`
 * and `added_at` must never appear in one.
 */
type ProjectMemberInsert =
  Database["public"]["Tables"]["project_members"]["Insert"];

/**
 * Every SQLSTATE the membership table can answer a write with, including the
 * three 0014 adds for the schedule columns.
 *
 * One mapper rather than a schedule-specific sibling, because the two writes
 * are not separable: `addProjectMember` may carry a schedule, so a bad
 * `working_days` array and a duplicate assignment can arrive from the *same*
 * insert. A sibling would have to be consulted by both call sites, in an order
 * that decides which of two true sentences the user sees — and that ordering
 * would be the only place the rule lived.
 *
 * The constraint names are matched on rather than assumed from context for the
 * same reason: 23514 is raised by two different CHECKs on this table, and
 * telling somebody their working days are out of range when they typed 30 hours
 * sends them to the wrong field.
 */
function membershipErrorMessage(error: PostgrestError): string {
  switch (error.code) {
    case "23505":
      // The (project_id, user_id) primary key.
      return "That person is already assigned to this project.";
    case "42501":
      // Two paths, one sentence, because the answer is the same either way: the
      // 0004 row policies (`is_admin()` and same company), and 0014's column
      // GRANTs — a caller naming a column outside
      // `(project_id, user_id, expected_daily_seconds, working_days)` is refused
      // by the privilege check before RLS is consulted at all.
      return "Only an admin can change project membership.";
    case "23503":
      // Two composite FKs and the derive trigger land here. The user-side one
      // fires when the named person belongs to another company (§2.2) or to no
      // company at all — a limbo profile has a NULL company_id, which cannot
      // match the project's.
      return error.message.includes("user_id")
        ? "That person isn't a member of your company."
        : "That project no longer exists.";
    case "23514":
      // 0014's two CHECKs. `project_members_working_days_valid` also fires on a
      // NULL *element* inside the array, which the normalizing trigger
      // deliberately lets through so the refusal is legible rather than silent.
      return error.message.includes("working_days")
        ? "Pick working days between Sunday and Saturday."
        : "Hours per day must be between 0 and 24.";
    case "22023":
      // 0014's normalizing trigger, refusing a multi-dimensional array before
      // `array_position` can raise 0A000 (a 500) on it. Unreachable through the
      // schedule schema — `z.array(z.number())` rejects a nested array first —
      // so this is a direct API call, and the sentence says what shape was
      // wanted rather than apologising.
      return "Working days must be a plain list of day numbers, 0 (Sunday) to 6 (Saturday).";
    case "23502":
      // NOT NULL. Since 0014 the table has two more of them, and answering an
      // explicitly-null `working_days` with "that project no longer exists"
      // would send the reader to look for a deleted project that is right where
      // they left it.
      return error.message.includes("working_days") ||
        error.message.includes("expected_daily_seconds")
        ? "That schedule is incomplete. Reload the page and try again."
        : "That project no longer exists.";
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
 * records when something happened, and since 0014 it has a *second* job as the
 * date every expected figure starts accruing from (§9.8). A client-settable
 * `added_at` would be a client-settable answer to "how many hours did you owe
 * last month", which is the strongest reason yet not to name it here.
 *
 * **The schedule is optional, and omitting it is not the same as sending
 * zeroes.** When no schedule is given, neither column appears in the payload
 * and the row takes 0014's DEFAULTs — 0 seconds on Mon–Fri, which is "no
 * target" (`report_expected_by_user` filters those rows out entirely, so an
 * unscheduled assignment produces no expected row rather than a zero one).
 * Sending an explicit `{ expectedDailySeconds: 0, workingDays: [1..5] }` would
 * store the identical values, so the distinction is one of intent rather than
 * of data — which is exactly why the parameter is optional instead of
 * defaulted here: the caller that has a schedule passes one, and assignment and
 * scheduling are then a single submit and a single row version.
 */
export async function addProjectMember(
  projectId: string,
  userId: string,
  schedule?: ProjectMemberScheduleInput,
): Promise<ActionResult<null>> {
  const parsedProjectId = projectIdSchema.safeParse(projectId);
  if (!parsedProjectId.success) {
    return { ok: false, error: "That project no longer exists." };
  }

  const parsedUserId = memberIdSchema.safeParse(userId);
  if (!parsedUserId.success) {
    return { ok: false, error: "That member no longer exists." };
  }

  const payload: ProjectMemberInsert = {
    project_id: parsedProjectId.data,
    user_id: parsedUserId.data,
  };

  if (schedule !== undefined) {
    const parsedSchedule = projectMemberScheduleSchema.safeParse(schedule);
    if (!parsedSchedule.success) {
      return {
        ok: false,
        error:
          parsedSchedule.error.issues[0]?.message ??
          "That schedule isn't valid.",
      };
    }

    // The schema's output is already seconds and already sorted; this layer
    // neither converts nor normalizes, because doing either here would be a
    // second implementation of a rule that lives in the schema and in
    // `project_members_20_normalize_working_days`.
    payload.expected_daily_seconds = parsedSchedule.data.expectedDailySeconds;
    payload.working_days = parsedSchedule.data.workingDays;
  }

  try {
    const supabase = await createClient();

    const { error } = await supabase
      .from("project_members")
      .insert(payload)
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
 * §3.6.3's schedule, changed on an assignment that already exists.
 *
 * **The zero-rows branch is the reason this is not three lines.**
 * `project_members_update_admin` filters through USING, and a USING clause that
 * excludes a row does not raise — it makes the row invisible to the statement,
 * so PostgREST answers `200` with an empty array. An employee editing a
 * schedule, or an admin editing another company's, therefore gets *success* from
 * the database and would get "Saved" from the UI while nothing changed. Same
 * treatment as `updateMemberRole` in `companies.ts`, and for the same reason:
 * the two indistinguishable causes (no such assignment / not allowed to touch
 * it) are reported in one sentence, because RLS deliberately declines to tell
 * them apart and neither should this.
 *
 * `.select("project_id")` without `.single()` is what makes that branch
 * reachable: `.single()` would turn zero rows into a PGRST116 error and the
 * distinction would be made by a Postgrest code rather than by this file.
 *
 * Only the two schedule columns are named. `project_id` and `user_id` identify
 * the row and are not rewritten by it — an "edit" that moved an assignment to a
 * different person would silently reassign their history's permissions.
 */
export async function updateProjectMemberSchedule(
  projectId: string,
  userId: string,
  input: ProjectMemberScheduleInput,
): Promise<ActionResult<null>> {
  const parsedProjectId = projectIdSchema.safeParse(projectId);
  if (!parsedProjectId.success) {
    return { ok: false, error: "That project no longer exists." };
  }

  const parsedUserId = memberIdSchema.safeParse(userId);
  if (!parsedUserId.success) {
    return { ok: false, error: "That member no longer exists." };
  }

  const parsedSchedule = projectMemberScheduleSchema.safeParse(input);
  if (!parsedSchedule.success) {
    return {
      ok: false,
      error:
        parsedSchedule.error.issues[0]?.message ?? "That schedule isn't valid.",
    };
  }

  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("project_members")
      .update({
        expected_daily_seconds: parsedSchedule.data.expectedDailySeconds,
        working_days: parsedSchedule.data.workingDays,
      })
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

  // Layout-wide, as everywhere else in this file: a schedule is read by the
  // project page, the Team page's dialog, every report that carries an Expected
  // column, and the employee's own dashboard card. Revalidating the routes this
  // action happens to know about would leave the others stale.
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
      .select(
        "user_id, added_at, expected_daily_seconds, working_days, profiles (full_name, role, status)",
      )
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
              expectedDailySeconds: row.expected_daily_seconds,
              // PostgREST decodes a `smallint[]` into a JSON array, so this
              // arrives as `number[]` — already sorted and de-duplicated by
              // 0014's trigger, which is why nothing here sorts it again.
              workingDays: row.working_days,
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

/**
 * The same rows as `listProjectMembers`, pivoted: one person's assignments
 * across every project, which is what the Team page's schedule dialog edits.
 *
 * It is a separate query rather than a filter over the project list because the
 * two ask different questions of the same table — "who is on this project" and
 * "what is this person on" — and the second one has no project to be given.
 *
 * **An empty result is genuinely "assigned to nothing".** `project_members`
 * SELECT is company-wide (§3.6.2), so unlike `listTasks` this cannot come back
 * empty because the caller lacks visibility; it can only come back empty
 * because there are no rows, or because the person is in another company, where
 * an empty list is also the honest answer.
 *
 * Sorted in TypeScript for the reason `listProjectMembers` gives: PostgREST's
 * `order` applies to embedded rows of a to-one join, not to the parent, so
 * ordering by `projects.name` in the query would sort nothing. Rows whose
 * project label is unreadable sort last — they have no key to sort *by*, and
 * putting them first would make the list open with a column of dashes.
 */
export async function listMemberProjectSchedules(
  userId: string,
): Promise<ActionResult<MemberProjectSchedule[]>> {
  const parsed = memberIdSchema.safeParse(userId);
  if (!parsed.success) {
    return { ok: false, error: "That member no longer exists." };
  }

  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("project_members")
      .select(
        "project_id, expected_daily_seconds, working_days, projects (name)",
      )
      .eq("user_id", parsed.data);

    if (error) {
      return { ok: false, error: "Could not load that member's schedule." };
    }

    const schedules = data.map((row) => ({
      projectId: row.project_id,
      // Null, not dropped and not `""` — see `MemberProjectSchedule`. The
      // embedded row is null exactly when `projects_select_admin_or_member`
      // hides the project from this caller, and the schedule beside it is still
      // real and still counts toward the person's expected hours.
      projectName: row.projects?.name ?? null,
      expectedDailySeconds: row.expected_daily_seconds,
      workingDays: row.working_days,
    }));

    schedules.sort((a, b) => {
      if (a.projectName === b.projectName) return 0;
      if (a.projectName === null) return 1;
      if (b.projectName === null) return -1;
      return a.projectName.localeCompare(b.projectName);
    });

    return { ok: true, data: schedules };
  } catch {
    return { ok: false, error: NOT_CONFIGURED };
  }
}
