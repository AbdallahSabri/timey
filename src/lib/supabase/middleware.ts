import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import type { Database } from "@/types/supabase";

/** Reachable in any auth state — the marketing root and the health probe. */
const PUBLIC_PATHS = new Set(["/", "/api/health"]);

/** Destinations for a signed-out visitor only. */
const AUTH_ONLY_PATHS = new Set(["/sign-in", "/sign-up"]);

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
    return AUTH_ONLY_PATHS.has(pathname)
      ? supabaseResponse
      : redirectTo(request, SIGN_IN_PATH, supabaseResponse);
  }

  // §8.3 — `profiles.company_id IS NULL` is limbo: the state between signup
  // and company creation, and the only valid null on that column. The row is
  // guaranteed by the signup trigger, but a race on a very fresh signup or a
  // transient error would leave `companyId` null here — and limbo is the safe
  // reading, because onboarding is the one route from which a user can recover.
  let companyId: string | null = null;
  try {
    const { data } = await supabase
      .from("profiles")
      .select("company_id")
      .eq("id", user.id)
      .maybeSingle();
    companyId = data?.company_id ?? null;
  } catch {
    companyId = null;
  }

  if (!companyId) {
    // Blocks the auth-only paths too: a signed-in user in limbo has no
    // business on sign-in or sign-up.
    return pathname === ONBOARDING_PATH
      ? supabaseResponse
      : redirectTo(request, ONBOARDING_PATH, supabaseResponse);
  }

  if (pathname === ONBOARDING_PATH || AUTH_ONLY_PATHS.has(pathname)) {
    return redirectTo(request, DASHBOARD_PATH, supabaseResponse);
  }

  return supabaseResponse;
}
