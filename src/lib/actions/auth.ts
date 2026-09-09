"use server";

import { isAuthSessionMissingError } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

import { PENDING_NEXT_KEY, safeNextPath } from "@/components/auth/next-path";
import { clearRecoveryCookie } from "@/lib/auth/recovery";
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

function updatePasswordErrorMessage(error: AuthError): string {
  // Checked before the switch, because this one does not have a code. With no
  // session `updateUser` returns `AuthSessionMissingError`, whose `code` is
  // `undefined` and whose `status` is 400 — so it would fall to `default` and
  // be reported as a generic failure, when the actual cause (the recovery
  // session is gone) has a specific and actionable answer.
  if (isAuthSessionMissingError(error)) {
    return "That reset link has expired. Request a new one.";
  }

  switch (error.code) {
    case "session_not_found":
    case "bad_jwt":
    case "session_expired":
      return "That reset link has expired. Request a new one.";
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

  revalidatePath("/", "layout");
  return { ok: true, data: null };
}

/**
 * §8.5. Sets the new password on the session `/auth/reset` created. There is no
 * old-password field because there is no old password to check against: the
 * emailed token was the proof, and GoTrue holds the only session that lets this
 * call succeed at all.
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

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      return { ok: false, error: updatePasswordErrorMessage(error) };
    }

    // The marker has done its job. Cleared so a back button lands on
    // `/forgot-password` rather than a second form that would only report
    // `same_password`.
    await clearRecoveryCookie();
  } catch {
    return { ok: false, error: NOT_CONFIGURED };
  }

  revalidatePath("/", "layout");
  return { ok: true, data: null };
}
