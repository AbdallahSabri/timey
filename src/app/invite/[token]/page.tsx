import Link from "next/link";

import { nextParam } from "@/components/auth/next-path";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { AcceptInvitationButton } from "@/components/invitations/accept-invitation-button";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getCurrentMember } from "@/lib/actions/companies";
import { previewInvitation } from "@/lib/actions/invitations";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Invitation · Timey",
};

function formatExpiry(expiresAt: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(expiresAt));
}

function withArticle(role: string): string {
  return /^[aeiou]/i.test(role) ? `an ${role}` : `a ${role}`;
}

function InviteCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        {children ? <CardContent>{children}</CardContent> : null}
        {footer ? (
          <CardFooter className="flex-wrap gap-3">{footer}</CardFooter>
        ) : null}
      </Card>
    </main>
  );
}

/**
 * §8.1 Path B — the one page reachable in every auth state, because middleware
 * lets `/invite/` through for signed-out visitors, limbo users, and users who
 * already belong to a company alike (see `src/lib/supabase/middleware.ts`).
 * That is five different visitors on one URL:
 *
 * 1. the link matches nothing — mistyped, revoked (§8.4: revoke deletes the
 *    row), or never issued. Deliberately not distinguished: `previewInvitation`
 *    reports all three as `data: null` and telling them apart would make this
 *    page a better oracle than it already is.
 * 2. the link was already used.
 * 3. the link expired (§8.4, 7 days). Stated with its date, because "ask for a
 *    new one" is actionable in a way that "invalid link" is not.
 * 4. the visitor already belongs to a company (§2, §8.4).
 * 5. the visitor is signed out, or signed in and in limbo (§8.3) — the two
 *    states that can still act on the invitation.
 *
 * The expiry shown here is display only. Every one of these conditions is
 * re-checked inside `accept_invitation()` at redemption (§8.4), which is where
 * they are actually enforced — this page decides what to render, not what is
 * permitted.
 */
export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const [previewResult, memberResult] = await Promise.all([
    previewInvitation(token),
    // Safe to call signed-out: `data: null` there means "nobody is signed in",
    // not an error.
    getCurrentMember(),
  ]);

  if (!previewResult.ok) {
    return (
      <InviteCard
        title="Something went wrong"
        description={previewResult.error}
      />
    );
  }

  const invitation = previewResult.data;

  if (!invitation) {
    return (
      <InviteCard
        title="This invitation isn't valid"
        description="The link may have been mistyped, already used, or revoked. Ask whoever invited you to send a new one."
      />
    );
  }

  if (invitation.accepted) {
    return (
      <InviteCard
        title="This invitation has already been used"
        description={`Someone already joined ${invitation.companyName} with this link. Invitations work once.`}
        footer={
          <Button asChild variant="outline">
            <Link href="/sign-in">Sign in</Link>
          </Button>
        }
      />
    );
  }

  if (invitation.expired) {
    return (
      <InviteCard
        title="This invitation has expired"
        description={`The link to join ${invitation.companyName} expired on ${formatExpiry(invitation.expiresAt)}. Ask your admin to send a new one.`}
      />
    );
  }

  // A failed read falls back to the signed-out affordances rather than
  // guessing: the sign-in page bounces an already-authenticated visitor to
  // where they belong, so the worst case is one extra hop.
  const member = memberResult.ok ? memberResult.data : null;

  /*
   * §2 / §8.4: one company for the life of the account. `acceptInvitation`
   * refuses this with exactly this sentence — but the outcome is already known
   * here, so it is stated as the page rather than hidden behind a button whose
   * only possible result is that refusal. Matching the action's wording keeps
   * the two paths from reading like different rules.
   *
   * Signing out is offered because it is the real remedy: the invitation was
   * sent to an address, and only an account holding that address can redeem it
   * (§8.4.1).
   */
  if (member?.company) {
    return (
      <InviteCard
        title="You already belong to a company"
        description={`Timey accounts belong to one company for the life of the account, and yours is already in ${member.company.name}. To join ${invitation.companyName}, sign in as ${invitation.email} — or ask an admin there to invite the address you use now.`}
        footer={
          <>
            <Button asChild variant="outline">
              <Link href="/dashboard">Back to Timey</Link>
            </Button>
            <SignOutButton variant="ghost" redirectTo={`/invite/${token}`}>
              Sign out
            </SignOutButton>
          </>
        }
      />
    );
  }

  const invited = (
    <div className="flex flex-col gap-2 text-sm">
      <p className="text-muted-foreground">
        Invited address{" "}
        <span className="text-foreground font-medium">{invitation.email}</span>
      </p>
      <p className="text-muted-foreground">
        Expires {formatExpiry(invitation.expiresAt)}
      </p>
    </div>
  );

  // Signed in with no company (§8.3) — the state that can accept.
  if (member) {
    return (
      <InviteCard
        title={`Join ${invitation.companyName}`}
        description={`You've been invited to join ${invitation.companyName} as ${withArticle(invitation.role)}.`}
        footer={
          <AcceptInvitationButton
            token={token}
            companyName={invitation.companyName}
          />
        }
      >
        {invited}
      </InviteCard>
    );
  }

  // Signed out. Both destinations carry the token so auth lands back here
  // rather than on `/onboarding`, where a new account would create a second
  // company instead of joining this one.
  const next = nextParam(`/invite/${token}`);

  return (
    <InviteCard
      title={`You've been invited to join ${invitation.companyName}`}
      description={`The invitation is for ${withArticle(invitation.role)} account. Create an account or sign in with ${invitation.email} to accept it.`}
      footer={
        <>
          <Button asChild>
            <Link href={`/sign-up${next}`}>Create an account</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/sign-in${next}`}>Sign in</Link>
          </Button>
        </>
      }
    >
      {invited}
    </InviteCard>
  );
}
