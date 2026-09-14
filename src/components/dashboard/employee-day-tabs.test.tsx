import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { AttendanceRow } from "@/components/dashboard/attendance-rows";
import { EmployeeDayTabs } from "@/components/dashboard/employee-day-tabs";

function row(
  userName: string | null,
  userId = `id-${userName}`,
): AttendanceRow {
  return { userId, userName, totalSeconds: 3_600, expectedSeconds: 7_200 };
}

const ROWS = [row("Omar"), row("Sara"), row("Lina")];

function tabs(selectedUserId: string | null = "id-Sara", rows = ROWS) {
  return render(
    <EmployeeDayTabs rows={rows} selectedUserId={selectedUserId}>
      <p>the chart</p>
    </EmployeeDayTabs>,
  );
}

describe("EmployeeDayTabs", () => {
  it("offers one link per employee, in the order it was given", () => {
    tabs();
    const names = screen
      .getAllByRole("link")
      .map((link) => link.textContent ?? "");

    expect(names).toEqual(["Omar", "Sara", "Lina"]);
  });

  it("puts each employee in the URL, so the panel can be linked and bookmarked", () => {
    tabs();
    expect(screen.getByRole("link", { name: "Omar" })).toHaveAttribute(
      "href",
      "/overview?employee=id-Omar",
    );
  });

  it("marks the open one as the current page", () => {
    tabs();
    expect(screen.getByRole("link", { name: "Sara" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Omar" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("names the open employee above their panel", () => {
    tabs();
    expect(screen.getByRole("heading", { name: "Sara" })).toBeInTheDocument();
  });

  it("renders the panel it was given", () => {
    tabs();
    expect(screen.getByText("the chart")).toBeInTheDocument();
  });

  it("does NOT claim to be an ARIA tablist", () => {
    // These navigate; they do not swap a panel in place. `role="tab"` would
    // promise a widget that does, and a screen-reader user who activated one
    // would find the page had moved instead. `report-view-tabs.tsx` takes the
    // same position.
    tabs();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.queryAllByRole("tabpanel")).toHaveLength(0);
    expect(
      screen.getByRole("navigation", { name: "Employee" }),
    ).toBeInTheDocument();
  });

  it("names a person it cannot read rather than rendering a blank tab", () => {
    // The *legitimate* cause of "Unknown person": the profile row is there and
    // its name is not readable. Distinct from a selection that is not in the
    // rows at all, which renders nothing — see the test below.
    render(
      <EmployeeDayTabs rows={[row(null, "id-x")]} selectedUserId="id-x">
        <p>the chart</p>
      </EmployeeDayTabs>,
    );

    expect(
      screen.getByRole("link", { name: "Unknown person" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Unknown person" }),
    ).toBeInTheDocument();
  });

  it("renders nothing at all when there is nobody to show", () => {
    const { container } = tabs(null, []);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing rather than a panel for somebody not in the row", () => {
    // The alternative is a tab row with nothing marked current above a heading
    // reading "Unknown person" — the same string a legitimately unreadable name
    // produces, so the two causes would be indistinguishable and one of them is
    // a stranger's panel by another name (§9.9.8). The page cannot reach this,
    // because `resolveSelectedEmployee` only returns an id from `rows`; this
    // keeps that a property of the component rather than of its caller.
    const { container } = tabs("id-nobody");
    expect(container).toBeEmptyDOMElement();
  });
});
