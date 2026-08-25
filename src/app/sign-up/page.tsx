import Link from "next/link";

import { nextParam } from "@/components/auth/next-path";
import { SignUpForm } from "@/components/auth/sign-up-form";
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
  title: "Sign up · Timey",
};

/** See `/sign-in`'s page for why `?next=` is read here rather than in the form. */
export default async function SignUpPage({
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
          <CardTitle>Create your Timey account</CardTitle>
          <CardDescription>
            {destination
              ? "You'll pick up where you left off once your account exists."
              : "You'll set up your company on the next step."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignUpForm next={destination} />
        </CardContent>
        <CardFooter>
          <p className="text-muted-foreground text-sm">
            Already have an account?{" "}
            <Link
              href={`/sign-in${nextParam(destination)}`}
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
