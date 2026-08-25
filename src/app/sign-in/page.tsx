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
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next } = await searchParams;
  const destination = Array.isArray(next) ? next[0] : next;

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
          <SignInForm next={destination} />
        </CardContent>
        <CardFooter>
          <p className="text-muted-foreground text-sm">
            No account yet?{" "}
            <Link
              href={`/sign-up${nextParam(destination)}`}
              className="text-foreground underline underline-offset-4"
            >
              Create one
            </Link>
          </p>
        </CardFooter>
      </Card>
    </main>
  );
}
