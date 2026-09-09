import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";

import { PENDING_NEXT_KEY, safeNextPath } from "@/components/auth/next-path";
import { createClient } from "@/lib/supabase/server";

/**
 * §8.3's other half of account creation (`BLOCKERS.md` N-3): the link
 * Supabase emails after `signUp()` reports `confirmationRequired: true`.
 *
 * `supabase/templates/confirmation.html` points here with `token_hash` in the
 * query string, rather than at Supabase's own hosted verify endpoint — GoTrue's
 * default template lands the session as a URL fragment, which no server here
 * can read. This route exchanges the token for a session server-side, so it
 * arrives as a cookie the way every other sign-in does.
 *
 * The OTP type is **hardcoded** rather than read from the query. It used to be
 * `searchParams.get("type") as EmailOtpType`, which asserted nothing —
 * `EmailOtpType` includes `(string & {})`, so the union absorbs any string and
 * the cast was decorative. Everything below this line is signup-shaped (the
 * `pending_next` read, the `/dashboard` default, the failure copy on
 * `/sign-in`), so the type it verifies has to be signup too. Recovery has its
 * own route, `/auth/reset`.
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
  const queryNext = safeNextPath(searchParams.get("next"), "/dashboard");

  if (tokenHash) {
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
        type: "signup",
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
      //
      // It is written once and **never cleared**, which is why the hardcoded
      // `type: "signup"` above is load-bearing rather than tidiness. While this
      // route accepted `type` from the query, a *recovery* token verified here
      // would have hit this same override and sent an invitee to their stale
      // `/invite/<token>` instead of the reset form — into the app, holding a
      // live session, with the password they came to change still in place. A
      // reset that silently does nothing, for exactly the people most likely to
      // need one. Scoping the route to signup is what makes permanent metadata
      // safe to keep: nothing but a signup confirmation can reach this branch.
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
