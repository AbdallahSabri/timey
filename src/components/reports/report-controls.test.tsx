import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ReportControls } from "@/components/reports/report-controls";
import type { ReportQuery } from "@/components/reports/report-params";
import type { Client } from "@/lib/actions/clients";
import type { CompanyMember } from "@/lib/actions/companies";
import type { Project } from "@/lib/actions/projects";

const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));

vi.mock("@/lib/actions/tasks", () => ({
  // `useFilterTasks` fires on mount. Nothing here picks a project, so the list
  // is never asked for — this only keeps the hook from reaching a real query.
  listTasks: async () => ({ ok: true, data: [] }),
}));

/** A fixed "company today", so the date-range trigger reads the same everywhere. */
const TODAY = "2026-08-25";
const RANGE = { from: "2026-08-01", to: "2026-08-25" };

const MEMBERS: CompanyMember[] = [
  { id: "u1", fullName: "Dana Reyes", role: "admin", status: "active" },
  { id: "u2", fullName: "Sam Okoye", role: "employee", status: "inactive" },
];

const CLIENTS: Client[] = [{ id: "c1", name: "Acme", archivedAt: null }];

const PROJECTS: Project[] = [
  {
    id: "p1",
    name: "Website",
    description: null,
    archivedAt: null,
    client: { id: "c1", name: "Acme" },
  },
];

function query(overrides: Partial<ReportQuery> = {}): ReportQuery {
  return {
    ...RANGE,
    view: "summary",
    grouping: "day",
    userId: "",
    clientId: "",
    projectId: "",
    taskId: "",
    page: 1,
    ...overrides,
  };
}

function renderControls(
  overrides: Partial<ReportQuery> = {},
  { isAdmin = true }: { isAdmin?: boolean } = {},
) {
  return render(
    <ReportControls
      query={query(overrides)}
      today={TODAY}
      isAdmin={isAdmin}
      members={isAdmin ? MEMBERS : []}
      clients={CLIENTS}
      projects={PROJECTS}
      canExport
    />,
  );
}

function groupingNav() {
  return screen.queryByRole("navigation", { name: "Group the report by" });
}

describe("ReportControls", () => {
  it("offers every grouping on the summary view", () => {
    renderControls({ view: "summary" });

    const nav = groupingNav();
    expect(nav).not.toBeNull();
    expect(
      within(nav as HTMLElement)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toStrictEqual([
      "Day",
      "Person",
      "Project",
      "Task",
      "Client",
      "Person × project",
    ]);
  });

  it("marks the grouping on screen", () => {
    renderControls({ view: "summary", grouping: "project" });

    expect(screen.getByRole("link", { name: "Project" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("carries no grouping nav on the detail view", () => {
    renderControls({ view: "detail" });

    // Asserted rather than merely omitted: a grouping is a `GROUP BY`, and
    // §9.7's entry list aggregates nothing — every row is one `time_entries`
    // row. A "by client" here would be a control with no meaning to give it.
    expect(groupingNav()).toBeNull();
  });

  it("keeps the range, the filters and the export in both views", () => {
    const { rerender } = renderControls({ view: "summary" });

    function expectSharedControls() {
      expect(
        screen.getByRole("button", { name: /change the report date range/i }),
      ).toHaveTextContent("1 Aug 2026 – 25 Aug 2026");
      expect(screen.getByRole("combobox", { name: "Client" })).toBeEnabled();
      expect(screen.getByRole("combobox", { name: "Project" })).toBeEnabled();
      expect(screen.getByRole("combobox", { name: "Task" })).toBeDisabled();
      expect(
        screen.getByRole("link", { name: "Export CSV" }),
      ).toBeInTheDocument();
    }

    expectSharedControls();

    rerender(
      <ReportControls
        query={query({ view: "detail" })}
        today={TODAY}
        isAdmin
        members={MEMBERS}
        clients={CLIENTS}
        projects={PROJECTS}
        canExport
      />,
    );

    // The range and the four filters are the same `WHERE` clause in both
    // shapes, so only the grouping row goes away when the view changes — a
    // filter set while grouping by project is still set after switching.
    expect(groupingNav()).toBeNull();
    expectSharedControls();
  });

  it("offers the person filter to an admin in either view", () => {
    const { unmount } = renderControls({ view: "summary" }, { isAdmin: true });

    expect(
      screen.getByRole("combobox", { name: "Person" }),
    ).toBeInTheDocument();

    unmount();
    renderControls({ view: "detail" }, { isAdmin: true });

    expect(
      screen.getByRole("combobox", { name: "Person" }),
    ).toBeInTheDocument();
  });

  it("omits the person filter for an employee in either view", () => {
    const { unmount } = renderControls({ view: "summary" }, { isAdmin: false });

    // §9.2 scopes an employee to themselves in the action and in RLS, so the
    // control would have exactly one possible outcome — worse than no control.
    // The detail view does not loosen that.
    expect(
      screen.queryByRole("combobox", { name: "Person" }),
    ).not.toBeInTheDocument();

    unmount();
    renderControls({ view: "detail" }, { isAdmin: false });

    expect(
      screen.queryByRole("combobox", { name: "Person" }),
    ).not.toBeInTheDocument();
  });
});
