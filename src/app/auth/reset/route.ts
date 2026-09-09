import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";

import { setRecoveryCookie } from "@/lib/auth/recovery";
import { createClient } from "@/lib/supabase/server";

/**
 * §8.5. The link `supabase/templates/recovery.html` emails after
 * `requestPasswordReset()`, and the sibling of `/auth/confirm`.
 *
 * The template points here with `token_hash` and nothing else, for the same
 * reason `/auth/confirm` exists at all: GoTrue's default recovery mail lands
 * the session as a URL fragment, which no server can read (`BLOCKERS.md` D-8).
 * This route exchanges the token server-side so the session arrives as a
 * cookie.
 *
 * A route handler, not a Server Component: `verifyOtp()` must run and its
 * cookies must be written before any redirect, and only a route handler (or
 * middleware) can do that on the way out of a GET request.
 *
 * **Deliberately not a `type`/`next` variant of `/auth/confirm`.** Both are
 * hardcoded here because a recovery token is the highest-value token in the
 * system — it grants a session — and neither the OTP type nor the landing page
 * is something the emailed URL should get a vote on. It also means this route
 * never reads `user_metadata`: `pending_next` is signup-scoped, and reading it
 * here is precisely the defect the hardcoded type in `/auth/confirm` closes.
 *
 * The destination is fixed at `/reset-password`, which sits in middleware's
 * `PUBLIC_PATHS` and gates itself on the marker cookie set just below.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");

  if (tokenHash) {
    // `redirect()` throws by design (Next's own control-flow signal for a
    // Route Handler), so it must never sit inside this try — catching it here
    // would swallow the navigation instead of performing it. Only the Supabase
    // call and the cookie write are guarded: an unconfigured project throwing
    // here gets the same refusal a bad, used or expired token gets below, and
    // there is nothing this route can do differently for either case.
    let verified = false;
    try {
      const supabase = await createClient();
      const { error } = await supabase.auth.verifyOtp({
        type: "recovery",
        token_hash: tokenHash,
      });
      verified = !error;

      // Only after the session exists. The cookie is a marker for the page's
      // own gate (`lib/auth/recovery.ts`) — it carries no secret, and setting
      // it without a session would just produce a form that cannot submit.
      if (verified) {
        await setRecoveryCookie();
      }
    } catch {
      verified = false;
    }

    if (verified) {
      redirect("/reset-password");
    }
  }

  // Not `/sign-in?error=confirmation_failed` — that page's copy tells the user
  // to sign up again for a new link, which is wrong advice for a dead reset
  // link. `/forgot-password` renders the error above a working request form,
  // so the fix is one click away rather than a dead end (§4.2.2).
  redirect("/forgot-password?error=reset_link_invalid");
}
