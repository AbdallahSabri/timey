import { SignOutButton } from "@/components/auth/sign-out-button";
import { CreateCompanyForm } from "@/components/onboarding/create-company-form";
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
  title: "Create your company · Timey",
};

/**
 * The zone list is built on the server and handed down so both renders read
 * from one source; the browser's own zone is applied after hydration.
 */
function timezones(): string[] {
  try {
    return [...Intl.supportedValuesOf("timeZone")];
  } catch {
    return ["UTC"];
  }
}

export default function OnboardingPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle>Create your company</CardTitle>
          <CardDescription>
            Everything in Timey belongs to a company. Yours takes a moment to
            set up, and you&apos;ll be its admin.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CreateCompanyForm timezones={timezones()} />
        </CardContent>
        <CardFooter className="justify-between gap-4">
          {/*
            Without this, a signed-in user with no company is stuck: middleware
            (§8.3) bounces them back here from every other route, sign-in
            included. Signing out is the only way off this page.
          */}
          <p className="text-muted-foreground text-sm">
            Joining an existing team? Ask an admin for an invitation.
          </p>
          <SignOutButton variant="ghost" />
        </CardFooter>
      </Card>
    </main>
  );
}
