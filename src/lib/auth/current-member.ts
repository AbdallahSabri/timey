/**
 * Who is signed in, what they may do, and where — read **once per request**.
 *
 * This module exists for one reason: `getCurrentMember()` is the answer to a
 * question most of the app asks, and every one of `lib/actions/reports.ts`'s
 * eleven actions asks it again through `prepare()`. Each ask is a
 * `supabase.auth.getUser()` — a network round trip that validates the JWT
 * against the auth server — plus a `profiles` select. One report was two of
 * those; a dashboard composed of four reports is six, to render one page
 * (`SPEC.md` §9.9).
 *
 * **`cache()` is the whole fix, and it is a memo rather than a cache.** React's
 * `cache` is scoped to a single server request: two callers in one render share
 * one result, and the next request reads again. So nothing here can serve a
 * stale role, and a mutation cannot be followed by a stale read — a server
 * action invoked from the browser is its own request with its own memo.
 *
 * **Why it is not in `lib/actions/companies.ts`.** That file is `"use server"`,
 * which requires every export to be an async function; `cache(fn)` is a value.
 * Putting it there would mean either not memoising or publishing the memo as a
 * server endpoint, which is worse than either. `lib/auth/` is the row
 * `CLAUDE.md` wrote for exactly this shape — "auth-flow state a `'use server'`
 * module can't publish, shared by a route handler, a page and an action",
 * which is what `recovery.ts` next door already is. `getCurrentMember()` stays
 * the `"use server"` door onto this, so no existing caller changes.
 *
 * **What the memo does and does not guarantee.** It cannot serve a role from a
 * previous request: React's `cache` is per-request, and a server action
 * invoked from the browser is its own request with its own memo. What it *can*
 * do is serve a value read earlier in the **same** request — so an action that
 * read the member, then mutated `profiles`, then read again would see its own
 * write missed. No action does that today: `updateMemberRole` and
 * `setMemberStatus` mutate without reading first, and the actions that do read
 * take only `id` and the company timezone. That is a property of the current
 * call graph rather than of this mechanism, so **an action that both reads the
 * member and writes to `profiles` must not rely on a second read inside one
 * request.**
 *
 * **It deliberately does not answer "is this caller an admin".** §0.2 warns
 * against a second definition of that, and there already is exactly one:
 * `role === "admin" && status === "active"`, which is `is_admin()`'s own
 * definition restated at each call site and inside `prepare()`. This module
 * returns the two columns and lets them keep deciding.
 */

import { cache } from "react";

import type { ActionResult } from "@/lib/actions/auth";
import { createClient } from "@/lib/supabase/server";
import type { MemberRole, MemberStatus } from "@/lib/validations/members";

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

/**
 * `null` data means "nobody is signed in" — not an error, so a Server
 * Component can call this defensively without a try/catch of its own.
 * Middleware (§8.3) already guarantees a session on authenticated routes;
 * this is the belt to that pair of braces, not a second gate.
 *
 * RLS scopes the read to the caller's own row regardless of what is asked
 * for, and `profiles_select_own_company` covers the limbo case by PK
 * (§4.2.1).
 *
 * The `ActionResult` shape is kept even though this is no longer an action:
 * `getCurrentMember()` returns it verbatim, and every caller in the app
 * already destructures it.
 */
export const readCurrentMember = cache(
  async (): Promise<ActionResult<CurrentMember | null>> => {
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
  },
);
