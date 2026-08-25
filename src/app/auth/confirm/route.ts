import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";

import { safeNextPath } from "@/components/auth/next-path";
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
  const next = safeNextPath(searchParams.get("next"), "/dashboard");

  if (tokenHash && type) {
    // `redirect()` throws by design (Next's own control-flow signal for a
    // Route Handler), so it must never sit inside this try — catching it here
    // would swallow the navigation instead of performing it. Only the
    // Supabase call is guarded: an unconfigured project throwing here gets
    // the same refusal a bad or expired token gets below, and there is
    // nothing this route can do differently for either case.
    let verified = false;
    try {
      const supabase = await createClient();
      const { error } = await supabase.auth.verifyOtp({
        type,
        token_hash: tokenHash,
      });
      verified = !error;
    } catch {
      verified = false;
    }

    if (verified) {
      redirect(next);
    }
  }

  redirect("/sign-in?error=confirmation_failed");
}
