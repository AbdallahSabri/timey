"use server";

import { isAuthSessionMissingError } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

import { PENDING_NEXT_KEY, safeNextPath } from "@/components/auth/next-path";
import { clearRecoveryCookie, isRecoveryUnlocked } from "@/lib/auth/recovery";
import { createClient } from "@/lib/supabase/server";
import {
  forgotPasswordSchema,
  MIN_PASSWORD_LENGTH,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
  type ForgotPasswordInput,
  type ResetPasswordInput,
  type SignInInput,
  type SignUpInput,
} from "@/lib/validations/auth";

import type { AuthError } from "@supabase/supabase-js";

/**
 * Boolean-tagged result (`CLAUDE.md`). A nullable-field union does not narrow
 * cleanly through destructuring under `strict`, so every action returns this.
 */
export type ActionResult<T> =
  { ok: true; data: T } | { ok: false; error: string };

/**
 * Thrown by `createServerClient` when `NEXT_PUBLIC_SUPABASE_URL` /
 * `NEXT_PUBLIC_SUPABASE_ANON_KEY` are absent — a fresh clone with no `.env`.
 * Surfaced as a result, never as an unhandled throw that 500s the route.
 */
const NOT_CONFIGURED =
  "Authentication is not configured. Check the Supabase environment variables.";

function firstIssue(
  error: { issues: readonly { message: string }[] },
  fallback: string,
): string {
  return error.issues[0]?.message ?? fallback;
}

/**
 * Clearing the marker cookie can never be the reason an action reports failure.
 *
 * By the time either caller reaches this, the thing the user asked for has
 * already happened — the password is changed, or the session is ended — and the
 * cookie delete is bookkeeping after the fact. Left inside the try/catch that
 * maps a missing Supabase configuration to `NOT_CONFIGURED`, a throw from here
 * would tell the user their successful password change was an unconfigured
 * project; they would not navigate, would retry, and would be told "That is
 * already your password." about the password they just set.
 *
 * A stale marker is harmless by construction (§8.5): the gate at
 * `/reset-password` compares it against the current session's user, and
 * `updateUser` still needs the recovery session GoTrue holds. So there is
 * nothing to report and nothing to undo.
 */
async function clearRecoveryMarker(): Promise<void> {
  try {
    await clearRecoveryCookie();
  } catch {
    // Deliberately swallowed — see above.
  }
}

function signUpErrorMessage(error: AuthError): string {
  switch (error.code) {
    case "user_already_exists":
    case "email_exists":
      // Deliberately plain. GoTrue's own wording ("User already registered")
      // is fine to state here because the user is the one claiming the address.
      return "An account with this email already exists. Sign in instead.";
    case "weak_password":
      return `Choose a stronger password — at least ${MIN_PASSWORD_LENGTH} characters.`;
    case "email_address_invalid":
    case "validation_failed":
      return "Enter a valid email address.";
    case "signup_disabled":
    case "email_provider_disabled":
      return "Sign-ups are currently disabled.";
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return "Too many attempts. Wait a minute and try again.";
    default:
      return "Could not create your account. Please try again.";
  }
}

function signInErrorMessage(error: AuthError): string {
  switch (error.code) {
    case "invalid_credentials":
      // Never distinguish "no such user" from "wrong password" — that turns
      // the sign-in form into an account-enumeration oracle.
      return "Incorrect email or password.";
    case "email_not_confirmed":
      return "Confirm your email address before signing in.";
    case "user_banned":
      return "This account has been suspended.";
    case "over_request_rate_limit":
      return "Too many attempts. Wait a minute and try again.";
    default:
      return error.status === 400
        ? "Incorrect email or password."
        : "Could not sign you in. Please try again.";
  }
}

/**
 * Only reached for the codes `requestPasswordReset` decides are facts about the
 * *input*. Everything that is a fact about the *account* is folded into the
 * neutral success there, not mapped here.
 */
function requestPasswordResetErrorMessage(error: AuthError): string {
  switch (error.code) {
    case "email_address_invalid":
    case "validation_failed":
      return "Enter a valid email address.";
    default:
      // Unreachable today — the caller only routes those two codes here. Kept
      // so that widening the caller's list cannot accidentally ship a raw
      // GoTrue string, and so it stays shaped like the other mappers.
      return "Could not send a reset link. Please try again.";
  }
}

const EXPIRED_LINK_MESSAGE = "That reset link has expired. Request a new one.";

/**
 * Every way `updateUser` can say "the recovery session is gone", in one place:
 * it decides both the message and whether the marker cookie is cleared, and
 * those two must never disagree.
 *
 * `isAuthSessionMissingError` is checked first and separately because that one
 * has no code. With no session at all `updateUser` returns
 * `AuthSessionMissingError`, whose `code` is `undefined` and whose `status` is
 * 400 — a `switch (error.code)` would drop it on `default` and report a generic
 * failure, when the actual cause has a specific and actionable answer.
 */
function isRecoverySessionGone(error: AuthError): boolean {
  return (
    isAuthSessionMissingError(error) ||
    error.code === "session_not_found" ||
    error.code === "bad_jwt" ||
    error.code === "session_expired"
  );
}

function updatePasswordErrorMessage(error: AuthError): string {
  if (isRecoverySessionGone(error)) {
    return EXPIRED_LINK_MESSAGE;
  }

  switch (error.code) {
    case "same_password":
      return "That is already your password. Choose a different one.";
    case "weak_password":
      return `Choose a stronger password — at least ${MIN_PASSWORD_LENGTH} characters.`;
    case "over_request_rate_limit":
      return "Too many attempts. Wait a minute and try again.";
    case "reauthentication_needed":
      // Hosted-only: GoTrue's "Secure password change" setting demands a nonce
      // that this flow never collects. A fresh link is the only way through
      // from the user's side, and it is a truthful instruction either way.
      return "Request a new reset link and try again.";
    default:
      return "Could not update your password. Please try again.";
  }
}

/**
 * `full_name` rides along in user metadata because the `handle_new_user()`
 * trigger reads `raw_user_meta_data->>'full_name'` to satisfy
 * `profiles.full_name NOT NULL` (§3.2, §4.2.1).
 *
 * `confirmationRequired: true` means the signup succeeded but no session came
 * back — email confirmation is on for this project. The caller shows a
 * "check your email" state; there is nothing to redirect to yet.
 */
export async function signUp(
  input: SignUpInput,
  next?: string,
): Promise<ActionResult<{ confirmationRequired: boolean }>> {
  const parsed = signUpSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: firstIssue(parsed.error, "Invalid sign-up details."),
    };
  }

  const { email, password, fullName } = parsed.data;

  let confirmationRequired: boolean;
  try {
    const supabase = await createClient();

    // §8.1 Path B across a confirmation email. When confirmation is off this
    // is never read: a session comes straight back and `SignUpForm` navigates
    // itself. When it is ON, the form has nothing to navigate to and used to
    // drop the destination entirely — every invitee resumed at the template's
    // hardcoded `/dashboard`, and middleware sent that limbo user to
    // `/onboarding` (§8.3). Before 0012 that made them an admin.
    //
    // Carried in user metadata rather than through `emailRedirectTo`: GoTrue
    // exposes that to the template as `{{ .RedirectTo }}`, an absolute URL
    // that defaults to the Site URL when unset — so a template built around it
    // silently produces a malformed link the moment the option is missing, and
    // it also has to clear the project's redirect allow-list. Metadata needs
    // neither, and needs no change to the hosted email template at all.
    //
    // Attacker-influenceable, and treated as such: it is re-validated through
    // `safeNextPath` when read (`/auth/confirm`), exactly like `?next=`. The
    // worst a caller can do is choose their own same-origin landing page. An
    // invite token placed here by somebody else still buys nothing —
    // `accept_invitation()` checks the caller's address (§8.4.1).
    const pendingNext = safeNextPath(next, "");

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          ...(pendingNext ? { [PENDING_NEXT_KEY]: pendingNext } : {}),
        },
      },
    });

    if (error) {
      return { ok: false, error: signUpErrorMessage(error) };
    }

    confirmationRequired = data.session === null;
  } catch {
    return { ok: false, error: NOT_CONFIGURED };
  }

  revalidatePath("/", "layout");
  return { ok: true, data: { confirmationRequired } };
}

export async function signIn(
  input: SignInInput,
): Promise<ActionResult<{ userId: string }>> {
  const parsed = signInSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: firstIssue(parsed.error, "Invalid sign-in details."),
    };
  }

  const { email, password } = parsed.data;

  let userId: string;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return { ok: false, error: signInErrorMessage(error) };
    }
    if (!data.user) {
      return { ok: false, error: "Incorrect email or password." };
    }

    userId = data.user.id;
  } catch {
    return { ok: false, error: NOT_CONFIGURED };
  }

  revalidatePath("/", "layout");
  return { ok: true, data: { userId } };
}

/**
 * Returns rather than redirects. `redirect()` works by throwing, so calling it
 * inside the try/catch below would turn a navigation into a swallowed error.
 * Navigation is the caller's decision; middleware bounces an anonymous request
 * off every authenticated route regardless.
 */
export async function signOut(): Promise<ActionResult<null>> {
  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signOut();

    if (error) {
      return { ok: false, error: "Could not sign you out. Please try again." };
    }
  } catch {
    return { ok: false, error: NOT_CONFIGURED };
  }

  // A recovery marker belongs to the session that was just ended, and must not
  // outlive it: the next person to sign in on this browser would otherwise
  // arrive while it is still valid (§8.5).
  await clearRecoveryMarker();

  revalidatePath("/", "layout");
  return { ok: true, data: null };
}

/**
 * §8.5. Mails a recovery link, and says the same thing whether or not the
 * address has an account — the caller renders one neutral confirmation for
 * every `ok: true`.
 *
 * No `redirectTo` option, deliberately: GoTrue exposes it to the template as
 * `{{ .RedirectTo }}`, which defaults to the Site URL when unset and so
 * produces a malformed link the moment the option goes missing (§8.1.2). The
 * template builds the URL from `{{ .SiteURL }}` itself and hardcodes
 * `/auth/reset?token_hash=…`, which is also what keeps the destination out of
 * a caller's hands on the highest-value token in the system.
 */
export async function requestPasswordReset(
  input: ForgotPasswordInput,
): Promise<ActionResult<null>> {
  const parsed = forgotPasswordSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: firstIssue(parsed.error, "Enter a valid email address."),
    };
  }

  const { email } = parsed.data;

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email);

    if (error) {
      // Same rule as `invalid_credentials` in `signInErrorMessage`: never let
      // the answer depend on whether the address has an account.
      //
      // `over_email_send_rate_limit` is reported as **success**, and that is
      // the whole point. GoTrue enforces `max_frequency` against the user row,
      // so an unknown address asked twice gets 200/200 while a known one gets
      // 200 then 429 — a distinct rate-limit message here would be an
      // enumeration oracle that costs one extra click to read. Folding it into
      // the neutral state is not a lie either: the code means a mail *was*
      // recently sent to this address, which is exactly what the neutral copy
      // claims happened.
      //
      // Only facts about the input itself — a malformed address — and the
      // unconfigured-project catch below are allowed to refuse, because
      // neither says anything about who has an account.
      if (
        error.code === "email_address_invalid" ||
        error.code === "validation_failed"
      ) {
        return { ok: false, error: requestPasswordResetErrorMessage(error) };
      }
    }
  } catch {
    return { ok: false, error: NOT_CONFIGURED };
  }

  // No `revalidatePath("/", "layout")`, unlike every action above it — and not
  // an oversight to be tidied up for symmetry. `signUp`/`signIn`/`signOut`
  // revalidate because they change the session every Server Component renders
  // from; this one creates no session and changes nothing any page displays, so
  // the call would buy nothing. What it would cost is real: this endpoint is
  // reachable by an anonymous visitor, so a purge of the entire route cache
  // would be one unauthenticated submit away, repeatable in a loop.
  return { ok: true, data: null };
}

/**
 * §8.5. Sets the new password on the session `/auth/reset` created. There is no
 * old-password field because there is no old password to check against: the
 * emailed token was the proof, and GoTrue holds the only session that lets this
 * call succeed at all. That is also why this refuses any caller the recovery
 * marker does not name — without it the absent old-password field would be a
 * missing check rather than an unnecessary one.
 *
 * Returns rather than redirects, for the reason `signOut` gives — `redirect()`
 * throws, and the try/catch here would swallow it. The caller navigates.
 */
export async function updatePassword(
  input: ResetPasswordInput,
): Promise<ActionResult<null>> {
  const parsed = resetPasswordSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: firstIssue(parsed.error, "Choose a valid password."),
    };
  }

  const { password } = parsed.data;

  // **This is the enforcement; the page's identical check is the convenience.**
  // A server action is a network-reachable endpoint, so gating only
  // `/reset-password` would hide the form without closing it — and §4.2.2
  // already settles that shape for admin routes ("neither check is sufficient
  // alone"), as §8.1.1 does for onboarding ("the function, not the page, is the
  // enforcement"). Without this, any signed-in user who crafts the POST changes
  // their own password with no old password asked for, which is precisely the
  // change-password surface §8.5 says the product does not offer.
  //
  // It costs a `getUser()` round trip on every submit, and that is the right
  // trade: it happens once per completed recovery, against a call that is about
  // to hit GoTrue anyway.
  //
  // Same wording as an expired link, because from the user's side it is the
  // same event with the same remedy — the marker no longer speaks for this
  // session, and a new link is what fixes it either way. The stale marker goes
  // with it, so the retry lands on `/forgot-password` rather than on a form
  // that can only refuse again.
  //
  // A live recovery — marker and session agreeing — passes straight through to
  // `updateUser`, which stays the authority: a session that dies between this
  // check and that call still surfaces as `AuthSessionMissingError` below.
  if (!(await isRecoveryUnlocked())) {
    await clearRecoveryMarker();
    return { ok: false, error: EXPIRED_LINK_MESSAGE };
  }

  let refusal: string | null = null;
  let recoverySessionGone = false;
  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      refusal = updatePasswordErrorMessage(error);
      recoverySessionGone = isRecoverySessionGone(error);
    }
  } catch {
    return { ok: false, error: NOT_CONFIGURED };
  }

  if (refusal) {
    if (recoverySessionGone) {
      // The marker outlived the session it was set for, which is the one state
      // where leaving it in place makes a dead end: the page renders a form,
      // the form is refused, and nothing clears the cookie — so the next
      // attempt is refused identically. Clearing it here means the retry lands
      // on `/forgot-password` and a new link, one click away (§4.2.2).
      await clearRecoveryMarker();
    }
    return { ok: false, error: refusal };
  }

  // The marker has done its job. Cleared so a back button lands on
  // `/forgot-password` rather than a second form that would only report
  // `same_password` — and outside the try above, because a failure to delete a
  // cookie must not report an already-changed password as a failed change.
  await clearRecoveryMarker();

  revalidatePath("/", "layout");
  return { ok: true, data: null };
}
