"use server";

import { revalidatePath } from "next/cache";

// Type-only, so it is erased at build time and does not pull another
// "use server" module into this one's graph.
import type { ActionResult } from "@/lib/actions/auth";
import { createClient } from "@/lib/supabase/server";
import {
  createCompanySchema,
  type CreateCompanyInput,
} from "@/lib/validations/auth";
import {
  setMemberStatusSchema,
  updateMemberRoleSchema,
  type MemberRole,
  type MemberStatus,
} from "@/lib/validations/members";

import type { PostgrestError } from "@supabase/supabase-js";

const NOT_CONFIGURED =
  "Authentication is not configured. Check the Supabase environment variables.";

/**
 * Who is signed in, what they may do, and where. One read, because the
 * dashboard, the members page, and every admin-gated view ask the same
 * question and a copy of this query in each of them drifts (`BLOCKERS.md`
 * N-4).
 *
 * `company` is null for a limbo user (§8.3) — the state between signup and
 * company creation or invitation acceptance, and the only valid null on
 * `profiles.company_id`.
 */
export type CurrentMember = {
  id: string;
  /**
   * The auth account's address, not a profiles column — `profiles` has none.
   * Carried because `/invite/[token]` has to compare it against the invited
   * address (§8.4.1): without it the page offers an Accept button to someone
   * `accept_invitation()` is certain to refuse with 42501.
   *
   * Nullable because `auth.users.email` is, for an account created through a
   * provider that supplies no address.
   */
  email: string | null;
  fullName: string;
  role: MemberRole;
  status: MemberStatus;
  company: {
    id: string;
    name: string;
    timezone: string;
    maxTimerHours: number;
    /**
     * 0 = Sunday, 1 = Monday (§3.1). Stored since Phase 1 and, until §9.8's
     * schedule picker, read by nothing — the column was carried on the promise
     * that something would eventually order a week by it, and this is that
     * something. It orders *display* only: `working_days` is stored in
     * `extract(dow)` numbering regardless, so rotating a picker can never
     * change what a schedule means.
     */
    weekStartsOn: number;
  } | null;
};

/** One row of the admin members list. */
export type CompanyMember = {
  id: string;
  fullName: string;
  role: MemberRole;
  status: MemberStatus;
};

function createCompanyErrorMessage(error: PostgrestError): string {
  switch (error.code) {
    case "23505":
      // create_company() raises this when profiles.company_id is already set.
      // §2: a user belongs to exactly one company for the life of the account,
      // so this is a permanent state, not a retryable failure.
      return "You already belong to a company.";
    case "28000":
    case "42501":
      // Verified against the local stack: an anon-key call never reaches the
      // function body — EXECUTE is granted to `authenticated` only, so it
      // fails as 42501 "permission denied for function create_company".
      // 28000 is the function's own guard for an authenticated role whose
      // auth.uid() is null. Both mean the same thing to the person reading it.
      return "You need to be signed in to create a company.";
    case "23514":
      // Three different states share this code. `pending_invitation` is the
      // one 0012 added and it is keyed on DETAIL rather than the message,
      // because the message embeds a company name and matching prose that
      // varies per tenant is how a check quietly stops firing. The refusal is
      // rendered verbatim: only the function knows which company invited them
      // (§8.1), and paraphrasing it here would drop the one useful noun.
      if (error.details === "pending_invitation") {
        return error.message;
      }
      // create_company() and the companies triggers share the rest; the
      // timezone trigger is the only one a user can provoke with valid input.
      return error.message.includes("timezone")
        ? "That timezone is not recognised. Pick a valid IANA timezone."
        : "Your account is not ready yet. Reload the page and try again.";
    default:
      return "Could not create the company. Please try again.";
  }
}

/**
 * Company creation is one `SECURITY DEFINER` RPC, never two client-side
 * inserts (§8.2): it creates the row and binds `profiles.company_id` +
 * `role = 'admin'` in a single transaction. Two inserts can strand a user in
 * limbo owning a company they cannot even select.
 *
 * Defaults for `p_week_starts_on` / `p_max_timer_hours` live in the function
 * signature, so omitted fields are left out of the payload rather than sent
 * as null — passing null would override the default with NOT NULL and fail.
 */
/**
 * §8.1 Path B. The caller's own unexpired invitation, or null.
 *
 * `/onboarding` asks so it can show the invitation instead of a form that
 * `create_company()` is now guaranteed to refuse (0012). This is the
 * explanation; the function is the enforcement — a client that skips this
 * still cannot create the company.
 *
 * `invitations` SELECT is admin-only (§4.2), so a limbo user cannot read their
 * own invitation directly. `pending_invitation_for_me()` is the definer
 * function for it, and takes no argument precisely so it cannot describe
 * anyone else's.
 *
 * A failed read reports null rather than an error: onboarding then renders its
 * ordinary form, and the database still refuses if an invitation really is
 * outstanding. Failing toward the form keeps a transient RPC problem from
 * stranding a legitimate Path A signup on a page with nothing on it.
 */
export async function getPendingInvitation(): Promise<PendingInvitation | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("pending_invitation_for_me");

    if (error || !data || data.length === 0) {
      return null;
    }

    const [invitation] = data;
    return {
      companyName: invitation.company_name,
      role: invitation.role,
      expiresAt: invitation.expires_at,
    };
  } catch {
    return null;
  }
}

export async function createCompany(
  input: CreateCompanyInput,
): Promise<ActionResult<{ companyId: string }>> {
  const parsed = createCompanySchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid company details.",
    };
  }

  const { name, timezone, weekStartsOn, maxTimerHours } = parsed.data;

  let companyId: string;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("create_company", {
      p_name: name,
      p_timezone: timezone,
      ...(weekStartsOn === undefined ? {} : { p_week_starts_on: weekStartsOn }),
      ...(maxTimerHours === undefined
        ? {}
        : { p_max_timer_hours: maxTimerHours }),
    });

    if (error) {
      return { ok: false, error: createCompanyErrorMessage(error) };
    }
    if (!data) {
      return {
        ok: false,
        error: "Could not create the company. Please try again.",
      };
    }

    companyId = data;
  } catch {
    return { ok: false, error: NOT_CONFIGURED };
  }

  // The user just left limbo (§8.3); every cached authenticated view was
  // rendered under the old state.
  revalidatePath("/", "layout");
  return { ok: true, data: { companyId } };
}

/**
 * `null` data means "nobody is signed in" — not an error, so a Server
 * Component can call this defensively without a try/catch of its own.
 * Middleware (§8.3) already guarantees a session on authenticated routes;
 * this is the belt to that pair of braces, not a second gate.
 *
 * RLS scopes the read to the caller's own row regardless of what is asked
 * for, and `profiles_select_own_company` covers the limbo case by PK
 * (§4.2.1).
 */
/** One row of `pending_invitation_for_me()`. Never carries a token — see 0012. */
export type PendingInvitation = {
  companyName: string;
  role: MemberRole;
  expiresAt: string;
};

export async function getCurrentMember(): Promise<
  ActionResult<CurrentMember | null>
> {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { ok: true, data: null };
    }

    const { data, error } = await supabase
      .from("profiles")
      .select(
        "id, full_name, role, status, companies (id, name, timezone, max_timer_hours, week_starts_on)",
      )
      .eq("id", user.id)
      .maybeSingle();

    if (error) {
      return { ok: false, error: "Could not load your account." };
    }
    if (!data) {
      // Authenticated with no profile row: a signup whose trigger has not
      // landed yet. Reported as absent rather than fabricated, so the caller
      // shows the same "not ready" state it would for a signed-out visitor.
      return { ok: true, data: null };
    }

    return {
      ok: true,
      data: {
        id: data.id,
        email: user.email ?? null,
        fullName: data.full_name,
        role: data.role,
        status: data.status,
        company: data.companies
          ? {
              id: data.companies.id,
              name: data.companies.name,
              timezone: data.companies.timezone,
              maxTimerHours: data.companies.max_timer_hours,
              weekStartsOn: data.companies.week_starts_on,
            }
          : null,
      },
    };
  } catch {
    return { ok: false, error: NOT_CONFIGURED };
  }
}

function memberUpdateErrorMessage(
  error: PostgrestError,
  subject: "role" | "status",
): string {
  switch (error.code) {
    case "42501":
      // profiles_guard_columns(): not an active admin of this company, or an
      // admin trying to change their own role (§2 — "except themselves").
      return `You don't have permission to change this member's ${subject}.`;
    case "23514":
      // profiles_enforce_last_admin(). The guard's other 23514s cover id,
      // created_at and company_id, none of which this update touches, so the
      // message check is a safety net rather than a real branch.
      return error.message.includes("at least one active admin")
        ? "A company must always have at least one active admin."
        : `Could not change this member's ${subject}. Please try again.`;
    default:
      return `Could not change this member's ${subject}. Please try again.`;
  }
}

/**
 * Everyone in the company, including deactivated members — §2.3 keeps them
 * for their history, and an admin needs to see them to reactivate one.
 *
 * No `company_id` filter and no admin check: `profiles_select_own_company`
 * already scopes this to the caller's company, and adding a redundant filter
 * here would invite the reading that tenancy is enforced in TypeScript. An
 * employee gets the same list — §4.2 makes `profiles` SELECT company-wide, and
 * who your colleagues are is not privileged information; only the mutations
 * are admin-gated.
 */
export async function listMembers(): Promise<ActionResult<CompanyMember[]>> {
  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name, role, status")
      .order("full_name", { ascending: true });

    if (error) {
      return { ok: false, error: "Could not load the member list." };
    }

    return {
      ok: true,
      data: data.map((row) => ({
        id: row.id,
        fullName: row.full_name,
        role: row.role,
        status: row.status,
      })),
    };
  } catch {
    return { ok: false, error: NOT_CONFIGURED };
  }
}

/**
 * Everything this could get wrong is already enforced in Postgres by
 * `0002_tenancy_core.sql`: `profiles_update_self_or_admin` (row scope), the
 * column GRANT (`full_name, role, status` only), `profiles_10_guard_columns()`
 * (admin-only, same-company, never your own role) and
 * `profiles_20_last_admin()` (§2). This action issues the update and
 * translates what comes back — it re-implements none of it.
 *
 * Zero rows affected is the quiet case worth naming: a non-admin's update
 * fails the policy's USING clause, which filters rather than raises, so
 * PostgREST reports success with an empty set. Surfaced as not-found rather
 * than as a no-op the UI would render as "saved".
 */
export async function updateMemberRole(
  userId: string,
  role: MemberRole,
): Promise<ActionResult<null>> {
  const parsed = updateMemberRoleSchema.safeParse({ userId, role });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid member details.",
    };
  }

  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("profiles")
      .update({ role: parsed.data.role })
      .eq("id", parsed.data.userId)
      .select("id");

    if (error) {
      return { ok: false, error: memberUpdateErrorMessage(error, "role") };
    }
    if (!data || data.length === 0) {
      return {
        ok: false,
        error: "Member not found, or you don't have permission to change them.",
      };
    }
  } catch {
    return { ok: false, error: NOT_CONFIGURED };
  }

  revalidatePath("/", "layout");
  return { ok: true, data: null };
}

/**
 * §2.3 — deactivation, not deletion. An inactive member loses access and
 * keeps every time entry they ever recorded; hard-deleting them would orphan
 * the history reports are built from. Deactivating the last active admin is
 * rejected by the same guard that rejects demoting them (§2).
 */
export async function setMemberStatus(
  userId: string,
  status: MemberStatus,
): Promise<ActionResult<null>> {
  const parsed = setMemberStatusSchema.safeParse({ userId, status });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid member details.",
    };
  }

  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("profiles")
      .update({ status: parsed.data.status })
      .eq("id", parsed.data.userId)
      .select("id");

    if (error) {
      return { ok: false, error: memberUpdateErrorMessage(error, "status") };
    }
    if (!data || data.length === 0) {
      return {
        ok: false,
        error: "Member not found, or you don't have permission to change them.",
      };
    }
  } catch {
    return { ok: false, error: NOT_CONFIGURED };
  }

  revalidatePath("/", "layout");
  return { ok: true, data: null };
}
