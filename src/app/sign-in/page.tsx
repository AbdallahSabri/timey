import Link from "next/link";

import { nextParam } from "@/components/auth/next-path";
import { SignInForm } from "@/components/auth/sign-in-form";
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
  title: "Sign in · Timey",
};

/**
 * `?next=` is read here and handed down rather than pulled from
 * `useSearchParams()` in the form, which would need a Suspense boundary and
 * would move a URL-derived value into a client hook for no gain. The value is
 * validated at the point of navigation (`safeNextPath`), not here — carrying
 * it through a link is harmless; navigating to it is what needs the check.
 */
/**
 * `error=confirmation_failed` arrives from `/auth/confirm` (`BLOCKERS.md`
 * N-3) when a signup confirmation link's token was invalid, expired, or
 * already used — the one failure that route can reach on a page it does not
 * own. Shown once, from the URL; there is nothing to clear it beyond
 * navigating away.
 */
const SEARCH_PARAM_ERRORS: Record<string, string> = {
  confirmation_failed:
    "That confirmation link is invalid or has expired. Sign in, or sign up again to get a new one.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{
    next?: string | string[];
    error?: string | string[];
  }>;
}) {
  const { next, error } = await searchParams;
  const destination = Array.isArray(next) ? next[0] : next;
  const errorCode = Array.isArray(error) ? error[0] : error;
  const errorMessage = errorCode ? SEARCH_PARAM_ERRORS[errorCode] : undefined;

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle>Sign in to Timey</CardTitle>
          <CardDescription>
            Track time against your projects and tasks.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {errorMessage ? (
            <p className="text-destructive mb-4 text-sm">{errorMessage}</p>
          ) : null}
          <SignInForm next={destination} />
        </CardContent>
        {/* Stacked rather than sat side by side: two short sentences on one
            row wrap into each other at phone widths, and the second line is
            the one a locked-out user is scanning for. */}
        <CardFooter className="flex-col items-start gap-1">
          <p className="text-muted-foreground text-sm">
            No account yet?{" "}
            <Link
              href={`/sign-up${nextParam(destination)}`}
              className="text-foreground underline underline-offset-4"
            >
              Create one
            </Link>
          </p>
          {/* No `next`: recovery lands on `/reset-password` by way of the
              emailed link, which carries no destination of its own (§8.5). */}
          <p className="text-muted-foreground text-sm">
            <Link
              href="/forgot-password"
              className="text-foreground underline underline-offset-4"
            >
              Forgot your password?
            </Link>
          </p>
        </CardFooter>
      </Card>
    </main>
  );
}
