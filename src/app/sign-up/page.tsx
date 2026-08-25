import Link from "next/link";

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

export default function SignUpPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle>Create your Timey account</CardTitle>
          <CardDescription>
            You&apos;ll set up your company on the next step.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignUpForm />
        </CardContent>
        <CardFooter>
          <p className="text-muted-foreground text-sm">
            Already have an account?{" "}
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
