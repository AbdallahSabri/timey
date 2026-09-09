import { cookies } from "next/headers";

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
 * **What it is not.** The value is a marker and carries no secret, because it
 * cannot: a cookie this process sets is a cookie the browser holding it can
 * replay. The authority is the session `verifyOtp` created — without that
 * session `updateUser({ password })` fails with `AuthSessionMissingError` no
 * matter what cookies came along. So this protects the *route* from being a
 * change-password surface; it does not protect the *password*, and nothing here
 * should ever be treated as if it did.
 *
 * **Why its own module.** A route handler (`/auth/reset`), a Server Component
 * (`/reset-password`) and a server action (`updatePassword`) all need it, and a
 * `"use server"` module may only export async functions — publishing a shared
 * helper from one would also make it a network-reachable endpoint. Same
 * constraint that put `PENDING_NEXT_KEY` in `components/auth/next-path.ts`
 * (documented at `next-path.ts:68-73`) and `lib/time/company-time.ts` outside
 * the actions that use it.
 */
export const RECOVERY_COOKIE_NAME = "timey-recovery";

/**
 * Long enough to read the email and type a password, short enough that a
 * shared or walked-away-from browser is not left holding the marker. It does
 * not need to outlive the recovery session it accompanies.
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

/** Set by `/auth/reset` after `verifyOtp` succeeds, before it redirects. */
export async function setRecoveryCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(RECOVERY_COOKIE_NAME, "1", cookieOptions());
}

/** Read by `/reset-password` to decide whether it has a form to render. */
export async function hasRecoveryCookie(): Promise<boolean> {
  const cookieStore = await cookies();
  return cookieStore.get(RECOVERY_COOKIE_NAME) !== undefined;
}

/**
 * Cleared by `updatePassword` once the password is actually changed, so a back
 * button does not land on a second, pointless form.
 */
export async function clearRecoveryCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete({ name: RECOVERY_COOKIE_NAME, path: "/" });
}
