import { cookies } from "next/headers";

import { createClient } from "@/lib/supabase/server";

/**
 * The marker cookie that gates `/reset-password` (§8.5).
 *
 * **Why it exists.** `/reset-password` has to sit in middleware's
 * `PUBLIC_PATHS`, because the early return there is the only exit before the
 * profile lookup — and an invited employee still in limbo (`company_id IS
 * NULL`) would otherwise be bounced to `/onboarding` before ever reaching the
 * form. But passing that early return means an ordinary signed-in user could
 * type the URL and get a working change-password form, which is a surface the
 * product deliberately does not offer: recovery starts from an emailed link,
 * never from inside the app. `/auth/reset` sets this cookie immediately before
 * redirecting, and the page refuses to render without it.
 *
 * **Its value is the id of the user who verified the link, and that is
 * load-bearing.** A bare "1" marked the *browser*, not a person: Alice opens her
 * reset link on a shared machine and walks away, Bob signs in on the same
 * browser inside the marker's lifetime, and `/reset-password` would render a
 * form whose `updateUser({ password })` changes *Bob's* password on Bob's
 * session — the change-password surface this cookie exists to prevent, reached
 * through the gate meant to prevent it, with no old password asked for. So
 * `isRecoveryUnlocked()` compares the marker against the id of whoever the
 * request is actually authenticated as, and a mismatch is refused.
 *
 * **What it is still not.** The value is an identifier, not a secret, and this
 * comparison is not authentication: a cookie this process sets is a cookie the
 * browser holding it can replay, and a user id is not a credential. The
 * authority remains the session `verifyOtp` created — without that session
 * `updateUser({ password })` fails with `AuthSessionMissingError` no matter what
 * cookies came along. The binding narrows *whose* session the route will offer
 * to change; it does not protect the password, and nothing here should ever be
 * treated as if it did.
 *
 * **Why its own module.** A route handler (`/auth/reset`), a Server Component
 * (`/reset-password`) and a server action (`updatePassword`) all need it, and a
 * `"use server"` module may only export async functions — publishing a shared
 * helper from one would also make it a network-reachable endpoint. Same
 * constraint that put `PENDING_NEXT_KEY` in `components/auth/next-path.ts`
 * (documented at `next-path.ts:68-73`) and `lib/time/company-time.ts` outside
 * the actions that use it. It is also why the session comparison lives here
 * rather than in `/reset-password/page.tsx`: a Server Component does not query
 * Supabase inline (`CLAUDE.md`), it calls one helper.
 */
export const RECOVERY_COOKIE_NAME = "timey-recovery";

/**
 * Long enough to read the email and type a password, short enough that a
 * forgotten marker does not linger for the rest of the browser session. It
 * bounds staleness only — what stops a walked-away-from browser from handing
 * the form to the next person is the user binding in `isRecoveryUnlocked()`,
 * not this number, and no lifetime short enough to be a defence would be long
 * enough to be usable.
 */
const RECOVERY_COOKIE_MAX_AGE_SECONDS = 15 * 60;

/**
 * `secure` is dropped in development only: `pnpm dev` serves plain HTTP on
 * localhost, where a `Secure` cookie is silently never stored — the reset flow
 * would fail locally for a reason nothing surfaces.
 */
function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV !== "development",
    path: "/",
    maxAge: RECOVERY_COOKIE_MAX_AGE_SECONDS,
  };
}

/**
 * Set by `/auth/reset` after `verifyOtp` succeeds, before it redirects. The id
 * is the one `verifyOtp` returned, never one taken from a request.
 */
export async function setRecoveryCookie(userId: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(RECOVERY_COOKIE_NAME, userId, cookieOptions());
}

/** The marked user id, or `null` when there is no marker at all. */
export async function readRecoveryCookie(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(RECOVERY_COOKIE_NAME)?.value ?? null;
}

/**
 * The gate: is *this* request the recovery the marker was set for?
 *
 * Called twice, deliberately — by `/reset-password` before it renders and by
 * `updatePassword` before it writes. Not redundancy: a server action is a
 * network-reachable endpoint, so a page-only check would hide the form without
 * closing it, and §4.2.2 already rules that a route guarded in one place only
 * is guarded nowhere ("neither check is sufficient alone"). One function rather
 * than two comparisons so the page and the action cannot drift.
 *
 * Fails closed on every unknown — no marker, no session, an unreadable user, a
 * Supabase client that cannot even be constructed. Each of those means the form
 * would have nothing to submit against, so refusing costs the user only the
 * redirect to `/forgot-password`, where a new link is one click away (§4.2.2).
 */
export async function isRecoveryUnlocked(): Promise<boolean> {
  const markedUserId = await readRecoveryCookie();
  if (!markedUserId) {
    return false;
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      return false;
    }
    return data.user.id === markedUserId;
  } catch {
    return false;
  }
}

/**
 * Cleared by `updatePassword` once the password is actually changed, so a back
 * button does not land on a second, pointless form — and when the recovery
 * session turns out to be gone, so the marker cannot outlive it. `signOut`
 * clears it too: a marker belongs to one session and must not survive it.
 */
export async function clearRecoveryCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete({ name: RECOVERY_COOKIE_NAME, path: "/" });
}
