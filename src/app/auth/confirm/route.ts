import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";

import { PENDING_NEXT_KEY, safeNextPath } from "@/components/auth/next-path";
import { createClient } from "@/lib/supabase/server";

import type { EmailOtpType } from "@supabase/supabase-js";

/**
 * §8.3's other half of account creation (`BLOCKERS.md` N-3): the link
 * Supabase emails after `signUp()` reports `confirmationRequired: true`.
 *
 * `supabase/templates/confirmation.html` points here with `token_hash` and
 * `type` in the query string, rather than at Supabase's own hosted verify
 * endpoint — GoTrue's default template lands the session as a URL fragment,
 * which no server here can read. This route exchanges the token for a session
 * server-side, so it arrives as a cookie the way every other sign-in does.
 *
 * A route handler, not a Server Component: `verifyOtp()` must run and its
 * cookies must be written before any redirect, and only a route handler
 * (or middleware) can do that on the way out of a GET request.
 *
 * `next` is attacker-influenceable the same way `?next=` is on `/sign-in` and
 * `/sign-up` — it comes back verbatim in a URL — so it goes through the same
 * `safeNextPath` guard rather than a bespoke check.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const queryNext = safeNextPath(searchParams.get("next"), "/dashboard");

  if (tokenHash && type) {
    // `redirect()` throws by design (Next's own control-flow signal for a
    // Route Handler), so it must never sit inside this try — catching it here
    // would swallow the navigation instead of performing it. Only the
    // Supabase call is guarded: an unconfigured project throwing here gets
    // the same refusal a bad or expired token gets below, and there is
    // nothing this route can do differently for either case.
    let verified = false;
    let next = queryNext;
    try {
      const supabase = await createClient();
      const { data, error } = await supabase.auth.verifyOtp({
        type,
        token_hash: tokenHash,
      });
      verified = !error;

      // §8.1 Path B. `signUp` stashed where this account was heading, because
      // the confirmation link cannot carry it: the email template is fixed
      // text on the Supabase side, and the invitee is not in the loop between
      // the two. Read only after `verifyOtp` succeeds — before that there is
      // no session and no metadata to read.
      //
      // Re-validated rather than trusted. `user_metadata` is writable by its
      // own user (`auth.updateUser`), so this is attacker-influenceable in
      // exactly the way `?next=` is, and gets exactly the same guard. It
      // overrides the query value because it was chosen at signup, when the
      // invitation was in hand, whereas the query default is a generic
      // `/dashboard`.
      const stashed = data.user?.user_metadata?.[PENDING_NEXT_KEY];
      if (verified && typeof stashed === "string") {
        next = safeNextPath(stashed, queryNext);
      }
    } catch {
      verified = false;
    }

    if (verified) {
      redirect(next);
    }
  }

  redirect("/sign-in?error=confirmation_failed");
}
