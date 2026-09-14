import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { AttendanceRow } from "@/components/dashboard/attendance-rows";
import { EmployeeProgressGrid } from "@/components/dashboard/employee-progress-grid";

function row(
  userName: string,
  totalSeconds: number,
  expectedSeconds: number | null,
): AttendanceRow {
  return { userId: `id-${userName}`, userName, totalSeconds, expectedSeconds };
}

const ROWS = [
  row("Ahead", 108_000, 72_000),
  row("Far behind", 3_600, 72_000),
  row("Slightly behind", 68_400, 72_000),
];

function grid(rows = ROWS, running = new Set<string>()) {
  return render(
    <EmployeeProgressGrid
      rows={rows}
      runningUserIds={running}
      from="2026-09-01"
      to="2026-09-12"
      emptyLabel="Nobody yet."
      label="Every employee"
    />,
  );
}

describe("EmployeeProgressGrid", () => {
  it("renders a card for EVERY employee, with no truncation", () => {
    // The absence of a limit is what entitles the team card above to a total
    // (§12.2). If this ever truncates again, that total becomes a claim about
    // rows that are not on screen.
    grid();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("carries no 'showing N of M' line, because it shows them all", () => {
    grid();
    expect(screen.queryByText(/showing/i)).not.toBeInTheDocument();
  });

  it("orders worst shortfall first, not by hours logged", () => {
    // SQL returns `total_seconds desc`, which would put "Far behind" last —
    // exactly the person an attendance surface exists to surface first.
    grid();
    const names = screen
      .getAllByRole("listitem")
      .map((li) => li.textContent ?? "");

    expect(names[0]).toContain("Far behind");
    expect(names[1]).toContain("Slightly behind");
    expect(names[2]).toContain("Ahead");
  });

  it("names the list so the cards have a subject", () => {
    grid();
    expect(
      screen.getByRole("list", { name: "Every employee" }),
    ).toBeInTheDocument();
  });

  it("marks only the people who actually have a timer running", () => {
    grid(ROWS, new Set(["id-Ahead"]));
    expect(screen.getAllByText("Running")).toHaveLength(1);
  });

  it("gives each card a link carrying that person and the range", () => {
    grid();
    const link = screen.getByRole("link", { name: /Far behind/ });
    const href = link.getAttribute("href") ?? "";

    expect(href).toContain("grouping=user");
    expect(href).toContain("userId=id-Far+behind");
    expect(href).toContain("from=2026-09-01");
    expect(href).toContain("to=2026-09-12");
  });

  it("shows the empty state rather than an empty grid", () => {
    grid([]);
    expect(screen.getByText("Nobody yet.")).toBeInTheDocument();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });
});
