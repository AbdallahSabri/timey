import Link from "next/link";

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

export default function SignInPage() {
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
          <SignInForm />
        </CardContent>
        <CardFooter>
          <p className="text-muted-foreground text-sm">
            No account yet?{" "}
            <Link
              href="/sign-up"
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
