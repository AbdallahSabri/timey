import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ProjectMemberList } from "@/components/project-members/project-member-list";
import type { ProjectMemberRow } from "@/components/project-members/project-member-list";

vi.mock("@/lib/actions/project-members", () => ({
  removeProjectMember: vi.fn(),
  updateProjectMemberSchedule: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

function member(overrides: Partial<ProjectMemberRow> = {}): ProjectMemberRow {
  return {
    userId: "22222222-2222-4222-8222-222222222222",
    fullName: "Dana Reyes",
    role: "employee",
    status: "active",
    addedAt: "2026-09-01T00:00:00.000Z",
    addedLabel: "1 Sept 2026",
    expectedDailySeconds: 14_400,
    workingDays: [1, 2, 4, 5],
    ...overrides,
  };
}

function renderList(
  members: ProjectMemberRow[],
  props: { canManage?: boolean; weekStartsOn?: number } = {},
) {
  render(
    <ProjectMemberList
      projectId={PROJECT_ID}
      projectName="Acme Redesign"
      members={members}
      canManage={props.canManage ?? true}
      weekStartsOn={props.weekStartsOn ?? 1}
    />,
  );
}

/**
 * The rows render twice — as `DataCard`s below `md` and as a table above it —
 * so anything on a row is in the DOM twice under jsdom, which applies no
 * breakpoints. Scoping to the table is what makes a count assertion mean one
 * row rather than two.
 */
function tableRow(name: string) {
  const table = screen.getByRole("table");
  return within(table).getByRole("row", { name: new RegExp(name) });
}

describe("ProjectMemberList — schedules (§3.6.3)", () => {
  it("states the schedule as hours and named days", () => {
    renderList([member()]);

    // `formatWorkingDays` in the company's week order, which for a Monday-start
    // company skips Wednesday between Tue and Thu.
    expect(
      within(tableRow("Dana Reyes")).getByText("4h/day · Mon, Tue, Thu, Fri"),
    ).toBeInTheDocument();
  });

  it("orders the days by the company's week rather than by dow", () => {
    renderList([member({ workingDays: [0, 1, 5] })], { weekStartsOn: 0 });

    // A Sunday-start company reads Sunday first. The stored array is the same
    // 0–6 dow either way (§3.6.3) — only the reading order moves.
    expect(
      within(tableRow("Dana Reyes")).getByText("4h/day · Sun, Mon, Fri"),
    ).toBeInTheDocument();
  });

  it("says 'No expected hours' rather than '0h/day' when none are set", () => {
    // An unset schedule and a deliberate zero are indistinguishable in the
    // column, so the wording has to be true of both. "0h/day" would assert
    // that somebody chose zero.
    renderList([member({ expectedDailySeconds: 0 })]);

    const row = tableRow("Dana Reyes");
    expect(within(row).getByText("No expected hours")).toBeInTheDocument();
    expect(within(row).queryByText(/0h\/day/)).not.toBeInTheDocument();
  });

  it("writes a fractional schedule without trailing zeroes", () => {
    renderList([member({ expectedDailySeconds: 12_600 })]);

    expect(
      within(tableRow("Dana Reyes")).getByText(/^3\.5h\/day/),
    ).toBeInTheDocument();
  });

  it("offers an edit control to an admin who can manage the project", () => {
    renderList([member()]);

    expect(
      within(tableRow("Dana Reyes")).getByRole("button", {
        name: /edit hours/i,
      }),
    ).toBeInTheDocument();
  });

  it("opens the schedule dialog when the edit control is used", async () => {
    // The seam between the button and the form: every other test here asserts
    // the control *exists*, and none of them press it. A dialog that never
    // opens looks exactly like a button that does nothing.
    const user = userEvent.setup();
    renderList([member()]);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(
      within(tableRow("Dana Reyes")).getByRole("button", {
        name: /edit hours/i,
      }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: /expected hours for dana/i }),
    ).toBeInTheDocument();
  });

  it("opens the dialog on the row's own stored hours", async () => {
    const user = userEvent.setup();
    renderList([member({ expectedDailySeconds: 12_600 })]);

    await user.click(
      within(tableRow("Dana Reyes")).getByRole("button", {
        name: /edit hours/i,
      }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText(/hours per day/i)).toHaveValue(3.5);
  });

  it("closes the dialog again when the edit is abandoned", async () => {
    const user = userEvent.setup();
    renderList([member()]);

    await user.click(
      within(tableRow("Dana Reyes")).getByRole("button", {
        name: /edit hours/i,
      }),
    );
    await screen.findByRole("dialog");

    await user.click(screen.getByRole("button", { name: /cancel/i }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("offers no edit control on an archived project, where nothing can change", () => {
    // `canManage` is false for an archived project. The schedule still reads,
    // because the row is still real — it just cannot be rewritten.
    renderList([member()], { canManage: false });

    expect(
      screen.queryByRole("button", { name: /edit hours/i }),
    ).not.toBeInTheDocument();
    expect(
      within(tableRow("Dana Reyes")).getByText("4h/day · Mon, Tue, Thu, Fri"),
    ).toBeInTheDocument();
  });
});
