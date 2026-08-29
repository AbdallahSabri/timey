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
import { getPendingInvitation } from "@/lib/actions/companies";

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

/**
 * Both roles begin with a vowel, so a naive `role === "admin" ? "an" : "a"`
 * yields "a employee". Same rule as `/invite/[token]`'s own `withArticle`,
 * kept independent because a two-line helper shared across a route boundary
 * costs more to find than to restate.
 */
function withArticle(role: string): string {
  return /^[aeiou]/i.test(role) ? `an ${role}` : `a ${role}`;
}

function formatExpiry(expiresAt: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(expiresAt));
}

/**
 * §8.1 Path B, §8.2. Two pages on one route, decided by whether the caller has
 * an invitation outstanding.
 *
 * **Why this page has to know.** Middleware parks every limbo user (§8.3)
 * here, invited or not, and `create_company()` binds the caller as an admin.
 * An invitee who lands here and fills the form loses the role their invitation
 * named and becomes the admin of a second, unwanted company. That is the bug
 * 0012 closes; this branch is the half a person can read.
 *
 * **The form is not merely hidden.** `create_company()` refuses the same case
 * itself (23514, DETAIL `pending_invitation`), so skipping this page changes
 * nothing. Hiding a control is never what enforces a rule here.
 *
 * **No Accept button, deliberately.** Only `token_hash` is stored, so the raw
 * token cannot be recovered, and §8.4.1 wants it that way: the emailed link
 * plus the address together are the evidence of who was invited. Accepting on
 * an address match alone would drop half of that — and with confirmations off
 * the address is unverified too. So this explains and points at the email; it
 * does not offer a shortcut.
 */
export default async function OnboardingPage() {
  const invitation = await getPendingInvitation();

  if (invitation) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-12">
        <Card>
          <CardHeader>
            <CardTitle>
              You&apos;ve been invited to {invitation.companyName}
            </CardTitle>
            <CardDescription>
              Your invitation is for {withArticle(invitation.role)} account.
              Open the link in that invitation email to join — creating a
              company here would make you the admin of a different one instead.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">
              The invitation expires {formatExpiry(invitation.expiresAt)}. If
              you can&apos;t find the email, ask an admin at{" "}
              <span className="text-foreground font-medium">
                {invitation.companyName}
              </span>{" "}
              to send it again.
            </p>
          </CardContent>
          <CardFooter className="justify-between gap-4">
            <p className="text-muted-foreground text-sm">
              Signed in with the wrong address?
            </p>
            <SignOutButton variant="ghost" />
          </CardFooter>
        </Card>
      </main>
    );
  }

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
