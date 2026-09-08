import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ReportDataTable } from "@/components/reports/report-data-table";
import { describeReport } from "@/components/reports/report-rows";

/** The by-project shape, which carries both a name and a client — and both nulls. */
function projectModel() {
  return describeReport({
    grouping: "project",
    rows: [
      {
        projectId: "p1",
        projectName: "Website",
        clientId: "c1",
        clientName: "Acme",
        entryCount: 4,
        totalSeconds: 37800,
      },
      {
        projectId: "p2",
        projectName: "Internal",
        clientId: null,
        clientName: null,
        entryCount: 1,
        totalSeconds: 3600,
      },
      {
        projectId: "p3",
        projectName: null,
        clientId: null,
        clientName: null,
        entryCount: 2,
        totalSeconds: 27000,
      },
    ],
  });
}

function bodyRows() {
  const [body] = screen.getAllByRole("rowgroup").slice(1);
  return within(body as HTMLElement).getAllByRole("row");
}

function cellsOf(row: HTMLElement) {
  return within(row)
    .getAllByRole("cell")
    .map((cell) => cell.textContent);
}

describe("ReportDataTable", () => {
  it("renders every line item and a footer that sums them", () => {
    render(<ReportDataTable model={projectModel()} emptyState="nothing" />);

    expect(bodyRows()).toHaveLength(3);

    // 37800 + 3600 + 27000 = 68400 = 19:00:00. The header above this table gets
    // the same number from `report_summary` in SQL; §12.2 asks that they agree,
    // and this is the half that is computed from what is actually on screen.
    const footer = screen.getByRole("row", { name: /total/i });
    expect(within(footer).getByText("19:00:00")).toBeInTheDocument();
    expect(within(footer).getByText("7")).toBeInTheDocument();
  });

  it("formats durations as H:MM:SS from integer seconds", () => {
    render(<ReportDataTable model={projectModel()} emptyState="nothing" />);

    expect(screen.getByText("10:30:00")).toBeInTheDocument();
    expect(screen.getByText("7:30:00")).toBeInTheDocument();
  });

  it("names an unreadable label instead of leaving the cell blank", () => {
    render(<ReportDataTable model={projectModel()} emptyState="nothing" />);

    expect(screen.getByText("Unknown project")).toBeInTheDocument();
    // Two rows have no client label; neither says "null" and neither says
    // "Internal", which would be a claim this data cannot support.
    expect(screen.getAllByText("—")).toHaveLength(2);
    expect(screen.queryByText("null")).not.toBeInTheDocument();
  });

  it("sorts by a label column, ascending then descending", async () => {
    const user = userEvent.setup();
    render(<ReportDataTable model={projectModel()} emptyState="nothing" />);

    await user.click(screen.getByRole("button", { name: /project/i }));

    expect(bodyRows().map((row) => cellsOf(row)[0])).toStrictEqual([
      "Internal",
      "Unknown project",
      "Website",
    ]);

    await user.click(screen.getByRole("button", { name: /project/i }));

    expect(bodyRows().map((row) => cellsOf(row)[0])).toStrictEqual([
      "Website",
      "Unknown project",
      "Internal",
    ]);
  });

  it("sorts a duration column numerically, not by its formatted text", async () => {
    const user = userEvent.setup();
    render(<ReportDataTable model={projectModel()} emptyState="nothing" />);

    await user.click(screen.getByRole("button", { name: /duration/i }));

    // Longest first: a numeric column toggles descending first, which is the
    // question anyone clicking "Duration" is asking. The ordering is what
    // matters here — sorted as the *rendered* strings, "10:30:00" would sort
    // below "7:30:00" in both directions, which is why the accessor is the
    // integer and the formatting happens in the cell (§9.5).
    expect(bodyRows().map((row) => cellsOf(row).at(-1))).toStrictEqual([
      "10:30:00",
      "7:30:00",
      "1:00:00",
    ]);

    await user.click(screen.getByRole("button", { name: /duration/i }));

    expect(bodyRows().map((row) => cellsOf(row).at(-1))).toStrictEqual([
      "1:00:00",
      "7:30:00",
      "10:30:00",
    ]);
  });

  it("marks the sorted column for assistive technology", async () => {
    const user = userEvent.setup();
    render(<ReportDataTable model={projectModel()} emptyState="nothing" />);

    const header = screen.getByRole("columnheader", { name: /project/i });
    expect(header).toHaveAttribute("aria-sort", "none");

    await user.click(within(header).getByRole("button"));
    expect(header).toHaveAttribute("aria-sort", "ascending");
  });

  it("sorts a day grouping by its ISO value, not by the words on screen", async () => {
    const user = userEvent.setup();
    render(
      <ReportDataTable
        model={describeReport({
          grouping: "day",
          rows: [
            { day: "2026-08-10", entryCount: 1, totalSeconds: 60 },
            { day: "2026-09-01", entryCount: 1, totalSeconds: 60 },
            { day: "2026-04-02", entryCount: 1, totalSeconds: 60 },
          ],
        })}
        emptyState="nothing"
      />,
    );

    await user.click(screen.getByRole("button", { name: /date/i }));

    // Alphabetical on "Mon, 10 Aug 2026" would put April after August.
    expect(bodyRows().map((row) => cellsOf(row)[0])).toStrictEqual([
      "Thu, 2 Apr 2026",
      "Mon, 10 Aug 2026",
      "Tue, 1 Sept 2026",
    ]);
  });

  it("explains an empty range instead of showing an empty grid", () => {
    render(
      <ReportDataTable
        model={{ labelHeaders: ["Project", "Client"], rows: [] }}
        emptyState="No time logged in this range."
      />,
    );

    expect(
      screen.getByText("No time logged in this range."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

/** The by-user shape, which is one of the two that carry §9.8's attendance pair. */
function userModel(
  expected: [number | null, number | null, number | null] = [
    72_000, 36_000, 3_600,
  ],
) {
  return describeReport({
    grouping: "user",
    rows: [
      {
        userId: "u1",
        userName: "Ada",
        entryCount: 4,
        totalSeconds: 36_000,
        expectedSeconds: expected[0],
      },
      {
        userId: "u2",
        userName: "Grace",
        entryCount: 2,
        totalSeconds: 36_000,
        expectedSeconds: expected[1],
      },
      {
        userId: "u3",
        userName: "Katherine",
        entryCount: 1,
        totalSeconds: 7_200,
        expectedSeconds: expected[2],
      },
    ],
  });
}

describe("ReportDataTable — expected hours (§9.8)", () => {
  it("adds Expected and Difference to a per-person grouping", () => {
    render(<ReportDataTable model={userModel()} emptyState="nothing" />);

    expect(
      screen.getByRole("columnheader", { name: /expected/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: /difference/i }),
    ).toBeInTheDocument();
  });

  it("carries the sign explicitly, since the formatter clamps negatives", () => {
    render(<ReportDataTable model={userModel()} emptyState="nothing" />);

    // Ada worked 10:00:00 of 20:00:00. Passed raw to `formatSecondsHms` this
    // would render "0:00:00" — "no difference" — for a ten-hour shortfall.
    expect(screen.getByText("−10:00:00")).toBeInTheDocument();
    // Grace is exactly on target, and Katherine is an hour ahead.
    expect(screen.getByText("+0:00:00")).toBeInTheDocument();
    expect(screen.getByText("+1:00:00")).toBeInTheDocument();
  });

  it("sorts Difference numerically, not by its formatted text", async () => {
    const user = userEvent.setup();
    render(<ReportDataTable model={userModel()} emptyState="nothing" />);

    await user.click(screen.getByRole("button", { name: /difference/i }));

    // Largest surplus first. Sorted as strings, the "−" prefix would group
    // every shortfall together and call that an ordering.
    expect(bodyRows().map((row) => cellsOf(row).at(-1))).toStrictEqual([
      "+1:00:00",
      "+0:00:00",
      "−10:00:00",
    ]);

    await user.click(screen.getByRole("button", { name: /difference/i }));

    expect(bodyRows().map((row) => cellsOf(row).at(-1))).toStrictEqual([
      "−10:00:00",
      "+0:00:00",
      "+1:00:00",
    ]);
  });

  it("marks the Difference column for assistive technology when sorted", async () => {
    const user = userEvent.setup();
    render(<ReportDataTable model={userModel()} emptyState="nothing" />);

    const header = screen.getByRole("columnheader", { name: /difference/i });
    expect(header).toHaveAttribute("aria-sort", "none");

    await user.click(within(header).getByRole("button"));
    expect(header).toHaveAttribute("aria-sort", "descending");
  });

  it("totals expected in the footer alongside the hours worked", () => {
    render(<ReportDataTable model={userModel()} emptyState="nothing" />);

    // 72000 + 36000 + 3600 = 111600 = 31:00:00 expected against
    // 36000 + 36000 + 7200 = 79200 = 22:00:00 worked, so 9 hours behind.
    const footer = screen.getByRole("row", { name: /total/i });
    expect(within(footer).getByText("31:00:00")).toBeInTheDocument();
    expect(within(footer).getByText("−9:00:00")).toBeInTheDocument();
  });

  it("OMITS both columns when expected is null, rather than showing zero", () => {
    // §9.8.2's task filter. A zero would assert that nothing was expected,
    // which is a stronger and falser claim than showing nothing at all.
    render(
      <ReportDataTable
        model={userModel([null, null, null])}
        emptyState="nothing"
      />,
    );

    expect(
      screen.queryByRole("columnheader", { name: /expected/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("columnheader", { name: /difference/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("0:00:00")).not.toBeInTheDocument();
    expect(screen.queryByText("+0:00:00")).not.toBeInTheDocument();
  });

  it("shows no attendance columns on a grouping nobody owes hours against", () => {
    // By project there is no person for a schedule to belong to (§3.6.3), so
    // `describeReport` writes null and the columns never appear.
    render(<ReportDataTable model={projectModel()} emptyState="nothing" />);

    expect(
      screen.queryByRole("columnheader", { name: /expected/i }),
    ).not.toBeInTheDocument();
  });
});
