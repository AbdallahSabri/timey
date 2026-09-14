import Link from "next/link";

import { AddClientDialog } from "@/components/clients/add-client-dialog";
import { InviteMemberDialog } from "@/components/invitations/invite-member-dialog";
import { NewProjectDialog } from "@/components/projects/new-project-dialog";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { Client } from "@/lib/actions/clients";
import { cn } from "@/lib/utils";

/**
 * How a company gets set up, in the order it has to happen (`SPEC.md` §9.9.7).
 *
 * **The order is not a preference, it is the schema.** A project hangs off a
 * client (or off nothing, which is an internal project); nobody can log time to
 * a project they are not assigned to (§3.6.1); and nobody can be assigned to a
 * project until they have accepted an invitation, because
 * `project_members.(user_id, company_id)` references `profiles` and an invitee
 * has no such row until `accept_invitation()` gives them one. An admin who
 * works it out by failing at it has been failed by the product, and until this
 * card there was no first-run guidance anywhere in the app.
 *
 * **The tip is rendered in both states and never dismissed.** The three buttons
 * stay useful as shortcuts long after the steps are done — they are the only
 * place in the app where all three creation paths sit together — so the card
 * shrinks rather than disappearing once each step has something in it.
 *
 * **The fourth line is the honest part.** Step three invites somebody to the
 * *company*; it cannot put them on a project, and the gap between those two
 * facts is where a new admin gets stuck. So when there is an invitation
 * outstanding, or a member who is on no project, the card says so and links to
 * where it is finished. Those lines appear only when they apply — a permanent
 * warning is one nobody reads.
 *
 * A server component: it renders counts and three dialogs, each of which owns
 * its own open state.
 */
/** "2 clients", "1 client", "None yet" — or an absence when the read failed. */
function countState(count: number | null, one: string, many: string): string {
  if (count === null) return "Couldn't be loaded";
  if (count === 0) return "None yet";
  return `${count} ${count === 1 ? one : many}`;
}

export function SetupChecklist({
  clientCount,
  projectCount,
  memberCount,
  pendingInvitationCount,
  unassignedMemberCount,
  clients,
}: {
  /**
   * **`null` means the read failed, and it is not the same as `0`.** A failed
   * `listClients` rendering as "None yet" would tell an admin with forty
   * clients to create their first one — a confident false statement where every
   * other card on this page shows its own error. So each count is nullable, an
   * unreadable one shows as an absence, and the follow-up lines below stay
   * silent rather than guessing.
   */
  clientCount: number | null;
  projectCount: number | null;
  memberCount: number | null;
  pendingInvitationCount: number | null;
  unassignedMemberCount: number | null;
  /** The project dialog's client picker. Active clients only, from the page. */
  clients: Client[];
}) {
  const steps = [
    {
      n: 1,
      title: "Add a client",
      done: (clientCount ?? 0) > 0,
      state: countState(clientCount, "client", "clients"),
      hint: "Who the work is for. A project with no client is internal.",
      action: <AddClientDialog label="Add a client" />,
    },
    {
      n: 2,
      title: "Create a project",
      done: (projectCount ?? 0) > 0,
      state: countState(projectCount, "project", "projects"),
      hint: "Time is logged against a project's tasks, never against a client.",
      action: <NewProjectDialog clients={clients} label="New project" />,
    },
    {
      n: 3,
      title: "Invite your people",
      done: (memberCount ?? 0) > 1 || (pendingInvitationCount ?? 0) > 0,
      state: [
        countState(memberCount, "member", "members"),
        (pendingInvitationCount ?? 0) > 0
          ? `${pendingInvitationCount} invited`
          : null,
      ]
        .filter(Boolean)
        .join(" · "),
      hint: "Then put them on a project — they can't log time until you do.",
      action: <InviteMemberDialog label="Invite someone" />,
    },
  ];

  // An unreadable count is not a finished step: collapsing the card on the
  // strength of a failed read would hide the guidance precisely when the page
  // is least trustworthy.
  const readable =
    clientCount !== null && projectCount !== null && memberCount !== null;
  const complete = readable && steps.every((step) => step.done);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {complete ? "Adding something new" : "Setting up"}
        </CardTitle>
        {/* The static tip. Present in both states, because it is the sentence
            that explains why the three buttons are in this order. */}
        <CardDescription>
          Clients hold projects; projects hold the time. Create a client, then a
          project for it, then invite the people who will log time to it.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {/* **One `<ol>` and three `<li>`s in both states, and that is not a
            style choice.** React reconciles by element type at a position: if
            the collapsed state used a different wrapper, flipping `complete`
            would unmount this whole subtree and take the open dialogs with it.
            That is not hypothetical — minting an invitation raises
            `pendingInvitationCount` from 0 to 1, which is exactly what flips
            step 3 to done, and `InviteMemberForm` calls `router.refresh()` on
            success. The invite link is rendered once and only its SHA-256 is
            stored (§8.4), so an unmount there destroys the only copy of the
            token and the admin has to revoke and start again.

            So the steps keep their shape and only the detail block comes and
            goes. `{step.action}` stays at the same position in the same `<li>`
            across the flip, and the dialog inside it keeps its state. */}
        <ol
          className={cn(
            "flex",
            complete ? "flex-wrap gap-2" : "flex-col gap-3",
          )}
        >
          {steps.map((step) => (
            <li
              key={step.n}
              className={cn(
                "flex flex-wrap items-center gap-x-4 gap-y-2",
                complete ? "w-auto" : "w-full justify-between",
              )}
            >
              {complete ? null : (
                <div className="flex min-w-0 items-start gap-3">
                  <span
                    className={cn(
                      "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full font-mono text-xs tabular-nums",
                      step.done
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground",
                    )}
                    aria-hidden
                  >
                    {step.n}
                  </span>
                  <div className="flex min-w-0 flex-col">
                    <span className="text-sm font-medium">
                      {step.title}{" "}
                      <span className="text-muted-foreground font-normal">
                        — {step.state}
                      </span>
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {step.hint}
                    </span>
                  </div>
                </div>
              )}
              <div className="shrink-0">{step.action}</div>
            </li>
          ))}
        </ol>

        {/* What is left to finish, and only when something is — and never on
            the strength of a read that failed. `unassignedMemberCount` of null
            would otherwise render as zero and silently drop the one line that
            explains why a new employee cannot log time. */}
        {(pendingInvitationCount ?? 0) > 0 ||
        (unassignedMemberCount ?? 0) > 0 ? (
          <div className="text-muted-foreground flex flex-col gap-1 text-xs">
            {pendingInvitationCount !== null && pendingInvitationCount > 0 ? (
              <p>
                {pendingInvitationCount === 1
                  ? "1 invitation is waiting to be accepted"
                  : `${pendingInvitationCount} invitations are waiting to be accepted`}
                {" — "}
                <Link href="/members" className="underline underline-offset-2">
                  see who
                </Link>
                .
              </p>
            ) : null}
            {unassignedMemberCount !== null && unassignedMemberCount > 0 ? (
              <p>
                {unassignedMemberCount === 1
                  ? "1 member isn't on any project yet, so they can't log time"
                  : `${unassignedMemberCount} members aren't on any project yet, so they can't log time`}
                {" — "}
                <Link href="/projects" className="underline underline-offset-2">
                  open a project to add them
                </Link>
                .
              </p>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
