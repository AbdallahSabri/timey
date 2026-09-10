import Link from "next/link";
import { redirect } from "next/navigation";

import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { isRecoveryUnlocked } from "@/lib/auth/recovery";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Choose a new password · Timey",
};

/**
 * §8.5. Renders only for someone who followed a live recovery link.
 *
 * The gate is the marker cookie `/auth/reset` sets on its way here, matched
 * against the user this request is authenticated as, because this route has to
 * sit in middleware's `PUBLIC_PATHS` for a limbo invitee to reach it at all —
 * and everything else that passes that early return would otherwise get a
 * working change-password form, a surface the product does not offer. The
 * comparison lives in `lib/auth/recovery.ts`, not here: a Server Component
 * calls an action or a helper, it does not query Supabase inline. The cookie is
 * a route gate, not a credential: the authority is the recovery session,
 * without which `updatePassword` refuses regardless.
 *
 * **The refusal is a redirect, not a terminal screen**, and it composes with
 * middleware to land every state somewhere useful: a signed-in member is
 * carried on from `/forgot-password` to `/dashboard`, a limbo invitee to
 * `/onboarding`, and only a signed-out visitor stays to see the request form —
 * with the reason rendered above it. §4.2.2: a page whose every control refuses
 * you is a dead end, so the user should land one click from a new link instead
 * of on a message telling them they cannot be here.
 */
export default async function ResetPasswordPage() {
  if (!(await isRecoveryUnlocked())) {
    redirect("/forgot-password?error=reset_link_invalid");
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle>Choose a new password</CardTitle>
          <CardDescription>
            You&apos;re signed in from your reset link. Set a new password to
            finish.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResetPasswordForm />
        </CardContent>
        <CardFooter>
          <p className="text-muted-foreground text-sm">
            Link expired?{" "}
            <Link
              href="/forgot-password"
              className="text-foreground underline underline-offset-4"
            >
              Request a new one
            </Link>
          </p>
        </CardFooter>
      </Card>
    </main>
  );
}
