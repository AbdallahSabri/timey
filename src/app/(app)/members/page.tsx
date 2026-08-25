import { InviteMemberForm } from "@/components/invitations/invite-member-form";
import { PendingInvitationList } from "@/components/invitations/pending-invitation-list";
import type { PendingInvitationRow } from "@/components/invitations/pending-invitation-list";
import { MemberList } from "@/components/members/member-list";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getCurrentMember, listMembers } from "@/lib/actions/companies";
import { listInvitations } from "@/lib/actions/invitations";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Team · Timey",
};

function formatExpiry(expiresAt: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(expiresAt));
}

/**
 * Everyone in the company can see who else is in it (§4.2 makes `profiles`
 * SELECT company-wide); only an admin gets the controls. That split is a
 * convenience, not a gate — `updateMemberRole`, `setMemberStatus`,
 * `createInvitation` and `revokeInvitation` are all admin-gated in Postgres,
 * and `listInvitations` returns an empty list to an employee because the
 * SELECT policy is admin-only, not because this page decided so. If the role
 * read below is ever wrong, the database still refuses; the wrong button is a
 * cosmetic bug, not a permission one.
 */
export default async function MembersPage() {
  const [memberResult, membersResult, invitationsResult] = await Promise.all([
    getCurrentMember(),
    listMembers(),
    listInvitations(),
  ]);

  const currentMember = memberResult.ok ? memberResult.data : null;
  const isAdmin =
    currentMember?.role === "admin" && currentMember.status === "active";

  const invitations: PendingInvitationRow[] = invitationsResult.ok
    ? invitationsResult.data.map((invitation) => ({
        ...invitation,
        expiresLabel: formatExpiry(invitation.expiresAt),
      }))
    : [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Team</h1>
        <p className="text-muted-foreground text-sm">
          {currentMember?.company
            ? `Everyone in ${currentMember.company.name}.`
            : "Everyone in your company."}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardDescription>
            Removing someone deactivates them — they lose access and keep their
            recorded time.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {membersResult.ok ? (
            <MemberList
              members={membersResult.data}
              currentUserId={currentMember?.id ?? null}
              canManage={isAdmin}
            />
          ) : (
            <p className="text-destructive text-sm">{membersResult.error}</p>
          )}
        </CardContent>
      </Card>

      {isAdmin ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Invite someone</CardTitle>
              <CardDescription>
                An invitation is valid for 7 days and can be used once, by the
                address it was sent to.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <InviteMemberForm />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Pending invitations</CardTitle>
              <CardDescription>
                Revoking one stops its link working immediately.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {invitationsResult.ok ? (
                <PendingInvitationList invitations={invitations} />
              ) : (
                <p className="text-destructive text-sm">
                  {invitationsResult.error}
                </p>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
