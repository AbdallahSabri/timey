import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import type { Database } from "@/types/supabase";

/**
 * Reachable in any auth state:
 *
 * - `/api/health` — the container probe, which must answer before anything
 *   about a visitor is known.
 * - `/auth/confirm` (`BLOCKERS.md` N-3) — the email-confirmation callback. Its
 *   visitor has no session yet by definition, and `verifyOtp()` is what creates
 *   one, inside the route itself.
 * - `/auth/reset` (§8.5) — the recovery callback, for the same reason: the
 *   token in its query string *is* the credential, and the session does not
 *   exist until the route exchanges it.
 * - `/reset-password` (§8.5) — and this is the only set that works for it. The
 *   early return below is the only exit before the profile lookup, so in
 *   `SIGNED_OUT_PATHS` a limbo invitee holding a fresh recovery session would
 *   be bounced to `/onboarding` and a company member to `/dashboard`, and in
 *   neither set the limbo case still fails at the same place. An invited
 *   employee who never onboarded is exactly the population that needs a
 *   recovery link to work, so nothing that bounces them is acceptable. Passing
 *   here is not an unguarded surface: the page itself refuses to render without
 *   the marker cookie `/auth/reset` sets (`lib/auth/recovery.ts`), so a
 *   signed-in user typing the URL gets no change-password form.
 *
 * The marketing root is deliberately absent. It is public to a signed-out
 * visitor but not to a signed-in one, so it belongs in `SIGNED_OUT_PATHS`.
 */
const PUBLIC_PATHS = new Set([
  "/api/health",
  "/auth/confirm",
  "/auth/reset",
  "/reset-password",
]);

/**
 * Destinations for a signed-out visitor only.
 *
 * `/` is one of them: the marketing root offers "create an account" and "sign
 * in", and neither is a thing a signed-in user can do. Landing there already
 * ended at the dashboard — via a bounce off `/sign-in` — so this makes the
 * route say directly what the click was going to say anyway, one redirect
 * earlier. A limbo user is parked at onboarding first, by the guard below.
 *
 * `/forgot-password` joins them (§8.5) rather than `PUBLIC_PATHS`: asking for a
 * recovery link is a signed-out act, and a user who already has a session has
 * no need of one — the product offers no change-password surface, so bouncing
 * them onward is the honest answer rather than a form that would only mail them
 * a link back to where they already are. It is also what makes
 * `/reset-password`'s missing-cookie redirect terminate correctly in every
 * state: a member sent here lands on `/dashboard`, a limbo invitee on
 * `/onboarding`, and only a signed-out visitor sees the request form.
 */
const SIGNED_OUT_PATHS = new Set([
  "/",
  "/sign-in",
  "/sign-up",
  "/forgot-password",
]);

/**
 * §8.1 Path B, §8.4. The one prefix rule here, because the route is
 * `/invite/[token]` — everything else stays exact-match.
 *
 * Reachable in **every** auth state, including the one the guard below would
 * otherwise bounce: a user who already belongs to a company. §8.4 requires
 * that user to be told plainly that they cannot accept, and only
 * `accept_invitation()` can say so (23505) — which means the attempt has to be
 * reachable. Redirecting them to `/dashboard` would turn a specific,
 * explicable refusal into a silent bounce. A signed-out visitor needs the page
 * to see which company invited them before signing up; a limbo user needs it
 * to accept.
 */
const INVITE_PATH_PREFIX = "/invite/";

/**
 * Admin-only destinations (§4.2.2). These are **routes**, not data: every
 * policy behind them stays company-readable, because `clients` labels an
 * employee's own projects, `profiles` names them across reports and
 * corrections, and `projects` fills the timer's own picker. Narrowing any of
 * those to admin would break a screen an employee is entitled to. So this
 * hides three admin surfaces an employee has no task on; it does not make
 * their contents secret, and nothing here is load-bearing for tenancy — RLS
 * is (§4.3).
 *
 * `/corrections` is deliberately absent: §7.4 gives an employee their own
 * requests and outcomes, and `corrections/page.tsx` already renders the admin
 * review queue only for an admin.
 */
const ADMIN_ONLY_PATHS = new Set(["/members", "/clients", "/projects"]);

/**
 * `/projects/[id]` has to be caught too, and `ADMIN_ONLY_PATHS.has()` cannot
 * see it. Matched on a segment boundary for the reason `isActivePath` gives:
 * a bare `startsWith("/projects")` would also swallow a future
 * `/projects-archive`.
 */
const ADMIN_ONLY_PREFIXES = ["/projects/"];

function isAdminOnlyPath(pathname: string): boolean {
  return (
    ADMIN_ONLY_PATHS.has(pathname) ||
    ADMIN_ONLY_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}

const ONBOARDING_PATH = "/onboarding";
const DASHBOARD_PATH = "/dashboard";
const SIGN_IN_PATH = "/sign-in";

/**
 * A bare `NextResponse.redirect` would drop the refreshed auth cookies that
 * `getUser()` just wrote onto `supabaseResponse`, so the next request arrives
 * with a stale token and bounces again — a redirect loop. Carry them over.
 */
function redirectTo(
  request: NextRequest,
  pathname: string,
  supabaseResponse: NextResponse,
): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = "";

  const response = NextResponse.redirect(url);
  for (const cookie of supabaseResponse.cookies.getAll()) {
    response.cookies.set(cookie);
  }
  return response;
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  // A freshly forked template has no Supabase project configured yet — skip
  // session refresh instead of crashing every route via the global matcher.
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    return supabaseResponse;
  }

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Refreshing the session before rendering keeps Server Components fed
  // with a valid session; do not run logic between here and getUser().
  let user: { id: string } | null = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch {
    // Auth server unreachable. Treating the request as signed out fails
    // closed: the visitor lands on sign-in rather than an unguarded route.
    user = null;
  }

  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.has(pathname) || pathname.startsWith(INVITE_PATH_PREFIX)) {
    return supabaseResponse;
  }

  if (!user) {
    return SIGNED_OUT_PATHS.has(pathname)
      ? supabaseResponse
      : redirectTo(request, SIGN_IN_PATH, supabaseResponse);
  }

  // §8.3 — `profiles.company_id IS NULL` is limbo: the state between signup
  // and company creation, and the only valid null on that column. The row is
  // guaranteed by the signup trigger, but a race on a very fresh signup or a
  // transient error would leave `companyId` null here — and limbo is the safe
  // reading, because onboarding is the one route from which a user can recover.
  //
  // `role` rides along on this same read rather than in a second query: the
  // admin-only route check below needs it, and it is one more column on a row
  // already being fetched. It fails closed for the same reason `companyId`
  // does — an unreadable role is read as `employee`, so a transient error
  // hides an admin page rather than opening one.
  let companyId: string | null = null;
  let role: string | null = null;
  try {
    const { data } = await supabase
      .from("profiles")
      .select("company_id, role")
      .eq("id", user.id)
      .maybeSingle();
    companyId = data?.company_id ?? null;
    role = data?.role ?? null;
  } catch {
    companyId = null;
    role = null;
  }

  if (!companyId) {
    // Blocks the signed-out paths too: a user in limbo has no business on
    // sign-in, sign-up, or the marketing root.
    return pathname === ONBOARDING_PATH
      ? supabaseResponse
      : redirectTo(request, ONBOARDING_PATH, supabaseResponse);
  }

  if (pathname === ONBOARDING_PATH || SIGNED_OUT_PATHS.has(pathname)) {
    return redirectTo(request, DASHBOARD_PATH, supabaseResponse);
  }

  // §4.2.2. Bounced to the dashboard rather than shown a refusal: an employee
  // reaching one of these has followed a stale link or typed a URL, and there
  // is nothing on the page for them to be refused *from*. The pages guard
  // themselves too — middleware does not run on every rendering path, so this
  // is the convenience and the page's own check is the one that must hold.
  if (role !== "admin" && isAdminOnlyPath(pathname)) {
    return redirectTo(request, DASHBOARD_PATH, supabaseResponse);
  }

  return supabaseResponse;
}
