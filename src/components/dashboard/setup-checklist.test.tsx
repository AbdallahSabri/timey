import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SetupChecklist } from "@/components/dashboard/setup-checklist";

// The dialogs mount the real creation forms, which use the app router. Mocked
// only so they can render — no test here submits one.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
}));

const TIP = /Clients hold projects; projects hold the time/;

function checklist(
  props: Partial<React.ComponentProps<typeof SetupChecklist>> = {},
) {
  return render(
    <SetupChecklist
      clientCount={0}
      projectCount={0}
      memberCount={1}
      pendingInvitationCount={0}
      unassignedMemberCount={0}
      clients={[]}
      {...props}
    />,
  );
}

describe("SetupChecklist", () => {
  it("renders the tip on a brand-new company", () => {
    checklist();
    expect(screen.getByText(TIP)).toBeInTheDocument();
  });

  it("still renders the tip once everything is set up", () => {
    // The user asked for a static tip. It is the sentence that explains the
    // order, and the order does not stop being true.
    checklist({ clientCount: 2, projectCount: 4, memberCount: 11 });
    expect(screen.getByText(TIP)).toBeInTheDocument();
  });

  it("lists three steps with their own state while anything is missing", () => {
    checklist({ clientCount: 2, projectCount: 0, memberCount: 1 });

    expect(screen.getByText(/2 clients/)).toBeInTheDocument();
    expect(screen.getAllByText(/None yet/)).toHaveLength(1);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("singularises a count of one", () => {
    checklist({ clientCount: 1, projectCount: 1 });

    expect(screen.getByText(/1 client\b/)).toBeInTheDocument();
    expect(screen.getByText(/1 project\b/)).toBeInTheDocument();
  });

  it("collapses to the buttons once every step has something", () => {
    checklist({ clientCount: 2, projectCount: 4, memberCount: 11 });

    // The steps keep their markup (see below); what goes is the detail.
    expect(screen.queryByText(/Who the work is for/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add a client" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "New project" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Invite someone" }),
    ).toBeInTheDocument();
  });

  it("keeps all three buttons available while still setting up", () => {
    // They are the shortcut, not a reward for finishing.
    checklist();
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });

  it("counts a pending invitation as progress on step three", () => {
    // Somebody invited but not yet accepted means the admin has done their
    // part of that step; the card must not nag them to invite again.
    checklist({ clientCount: 1, projectCount: 1, pendingInvitationCount: 1 });

    expect(screen.queryByText(/Who the work is for/)).not.toBeInTheDocument();
  });

  it("keeps the same three list items in both states", () => {
    // Load-bearing, not cosmetic. React reconciles by element type at a
    // position: if the two states used different wrappers, flipping `complete`
    // would unmount the subtree — and minting an invitation flips it, while
    // the invite form calls `router.refresh()`. The dialog holding the
    // one-time link would go with it.
    const { rerender } = checklist();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);

    rerender(
      <SetupChecklist
        clientCount={2}
        projectCount={4}
        memberCount={11}
        pendingInvitationCount={0}
        unassignedMemberCount={0}
        clients={[]}
      />,
    );

    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("keeps an open invite dialog alive when minting flips the card", () => {
    // The regression this guards: invite -> pendingInvitationCount 0 -> 1 ->
    // `complete` flips -> the dialog unmounts -> the only copy of the token is
    // gone, and only its SHA-256 is stored (§8.4).
    const { rerender } = checklist({ clientCount: 1, projectCount: 1 });

    fireEvent.click(screen.getByRole("button", { name: "Invite someone" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    rerender(
      <SetupChecklist
        clientCount={1}
        projectCount={1}
        memberCount={1}
        pendingInvitationCount={1}
        unassignedMemberCount={0}
        clients={[]}
      />,
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("says nothing about follow-ups when there are none", () => {
    checklist({ clientCount: 2, projectCount: 4, memberCount: 11 });

    expect(
      screen.queryByText(/waiting to be accepted/),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/isn't on any project/)).not.toBeInTheDocument();
  });

  it("surfaces outstanding invitations, with somewhere to go", () => {
    checklist({ pendingInvitationCount: 2 });

    expect(
      screen.getByText(/2 invitations are waiting to be accepted/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "see who" })).toHaveAttribute(
      "href",
      "/members",
    );
  });

  it("surfaces the invite-to-assign gap, which is the one the schema forces", () => {
    // An accepted member who is on no project cannot log a single minute, and
    // nothing else in the app says so.
    checklist({ memberCount: 3, unassignedMemberCount: 1 });

    expect(
      screen.getByText(
        /1 member isn't on any project yet, so they can't log time/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "open a project to add them" }),
    ).toHaveAttribute("href", "/projects");
  });

  it("pluralises the unassigned line", () => {
    checklist({ memberCount: 5, unassignedMemberCount: 3 });
    expect(
      screen.getByText(/3 members aren't on any project yet/),
    ).toBeInTheDocument();
  });

  it("shows an absence, not 'None yet', when a count could not be read", () => {
    // "None yet" for a company with forty clients would send an admin to create
    // a duplicate. Every other card on this page renders its own error.
    checklist({ clientCount: null, projectCount: 4, memberCount: 11 });

    expect(screen.getByText(/Couldn't be loaded/)).toBeInTheDocument();
    expect(screen.queryByText(/None yet/)).not.toBeInTheDocument();
  });

  it("does not collapse on the strength of a failed read", () => {
    // Collapsing hides the guidance, and an unreadable count is not a finished
    // step.
    checklist({ clientCount: null, projectCount: 4, memberCount: 11 });
    expect(screen.getByText(/Who the work is for/)).toBeInTheDocument();
  });

  it("stays silent about follow-ups it could not read", () => {
    // A null unassigned count rendering as zero would drop the one line that
    // explains why a new employee logs nothing.
    checklist({
      clientCount: 2,
      projectCount: 4,
      memberCount: 11,
      pendingInvitationCount: null,
      unassignedMemberCount: null,
    });

    expect(
      screen.queryByText(/waiting to be accepted/),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/isn't on any project/)).not.toBeInTheDocument();
  });
});
