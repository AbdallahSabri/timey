import Link from "next/link";

import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Reset your password · Timey",
};

/**
 * `error=reset_link_invalid` arrives from two places, and means the same thing
 * from both: `/auth/reset` when the emailed token was bad, expired or already
 * used, and `/reset-password` when it is reached without the marker cookie that
 * a live link is the only way to get. This page renders the message *above a
 * working request form* — which is why a dead link lands here rather than on a
 * terminal "link expired" screen (§4.2.2: a page whose every control refuses
 * you is a dead end, not a neutral one).
 *
 * Shown once, from the URL; there is nothing to clear it beyond navigating
 * away — same treatment as `/sign-in`'s `confirmation_failed`.
 */
const SEARCH_PARAM_ERRORS: Record<string, string> = {
  reset_link_invalid:
    "That reset link is invalid, has expired, or has already been used. Request another one below.",
};

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const { error } = await searchParams;
  const errorCode = Array.isArray(error) ? error[0] : error;
  const errorMessage = errorCode ? SEARCH_PARAM_ERRORS[errorCode] : undefined;

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle>Reset your password</CardTitle>
          <CardDescription>
            Enter your email address and we&apos;ll send you a link to choose a
            new one.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {errorMessage ? (
            <p className="text-destructive mb-4 text-sm">{errorMessage}</p>
          ) : null}
          <ForgotPasswordForm />
        </CardContent>
        <CardFooter>
          <p className="text-muted-foreground text-sm">
            Remembered it?{" "}
            <Link
              href="/sign-in"
              className="text-foreground underline underline-offset-4"
            >
              Sign in
            </Link>
          </p>
        </CardFooter>
      </Card>
    </main>
  );
}
