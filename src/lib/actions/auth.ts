"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import {
  MIN_PASSWORD_LENGTH,
  signInSchema,
  signUpSchema,
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
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
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
