import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DayBarChart, type DayBar } from "@/components/charts/day-bar-chart";

const LABEL = "Hours worked per day";

/**
 * 2026-08-10 is a Monday, so the weekdays here run Mon, Tue, Wed.
 *
 * August rather than September on purpose: `en-GB` abbreviates September as
 * "Sept", and a test that hardcoded it would be asserting an ICU detail rather
 * than this component's behaviour. `report-days.test.ts` dodges the same trap
 * the same way.
 */
function bars(overrides: Partial<DayBar>[] = []): DayBar[] {
  const base: DayBar[] = [
    { day: "2026-08-10", totalSeconds: 28_800, weekday: 1 },
    { day: "2026-08-11", totalSeconds: 0, weekday: 2 },
    { day: "2026-08-12", totalSeconds: 14_400, weekday: 3 },
  ];

  return base.map((bar, index) => ({ ...bar, ...overrides[index] }));
}

describe("DayBarChart", () => {
  it("names every column with its date and its exact duration", () => {
    // The accessible name IS the chart: jsdom has no layout, so a height is
    // unassertable and unreadable. Anything the picture claims has to be here.
    render(
      <DayBarChart
        bars={bars()}
        maxSeconds={28_800}
        label={LABEL}
        emptyLabel="—"
      />,
    );

    expect(
      screen.getByRole("listitem", { name: "Mon, 10 Aug 2026: 8:00:00" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("listitem", { name: "Wed, 12 Aug 2026: 4:00:00" }),
    ).toBeInTheDocument();
  });

  it("renders a day with no hours as a column, not as a gap", () => {
    // A missing column would misalign the axis and read as a shorter range.
    render(
      <DayBarChart
        bars={bars()}
        maxSeconds={28_800}
        label={LABEL}
        emptyLabel="—"
      />,
    );

    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(
      screen.getByRole("listitem", { name: "Tue, 11 Aug 2026: 0:00:00" }),
    ).toBeInTheDocument();
  });

  it("says which column is today in words, not only in colour", () => {
    render(
      <DayBarChart
        bars={bars([{}, {}, { isToday: true }])}
        maxSeconds={28_800}
        label={LABEL}
        emptyLabel="—"
      />,
    );

    expect(
      screen.getByRole("listitem", {
        name: "Wed, 12 Aug 2026 (today): 4:00:00",
      }),
    ).toBeInTheDocument();
  });

  it("says a dimmed column is outside the working days, not a day of no work", () => {
    // Dimming alone cannot distinguish "you weren't due in" from "you logged
    // nothing", and those read completely differently.
    render(
      <DayBarChart
        bars={bars([{}, { offDay: true }, {}])}
        maxSeconds={28_800}
        label={LABEL}
        emptyLabel="—"
      />,
    );

    expect(
      screen.getByRole("listitem", {
        name: "Tue, 11 Aug 2026 (outside working days): 0:00:00",
      }),
    ).toBeInTheDocument();
  });

  it("names the list so the columns have a subject", () => {
    render(
      <DayBarChart
        bars={bars()}
        maxSeconds={28_800}
        label={LABEL}
        emptyLabel="—"
      />,
    );
    expect(screen.getByRole("list", { name: LABEL })).toBeInTheDocument();
  });

  it("shows the empty state when nothing at all was logged", () => {
    // `maxSeconds` of zero would otherwise be a division by zero, and a row of
    // invisible columns says less than a sentence.
    render(
      <DayBarChart
        bars={bars([
          { totalSeconds: 0 },
          { totalSeconds: 0 },
          { totalSeconds: 0 },
        ])}
        maxSeconds={0}
        label={LABEL}
        emptyLabel="No time logged in the last 14 days."
      />,
    );

    expect(
      screen.getByText("No time logged in the last 14 days."),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("shows the empty state for an empty range rather than an empty list", () => {
    render(
      <DayBarChart
        bars={[]}
        maxSeconds={28_800}
        label={LABEL}
        emptyLabel="Nothing yet."
      />,
    );

    expect(screen.getByText("Nothing yet.")).toBeInTheDocument();
  });

  it("keeps a very short day visible", () => {
    // Five minutes against an eight-hour day is 1% and would render as nothing
    // — indistinguishable from a day off, which is the distinction this chart
    // exists to draw. The floor is a mark, not a measurement; the exact figure
    // is in the accessible name.
    render(
      <DayBarChart
        bars={[{ day: "2026-08-10", totalSeconds: 300, weekday: 1 }]}
        maxSeconds={28_800}
        label={LABEL}
        emptyLabel="—"
      />,
    );

    const bar = screen
      .getByRole("listitem", { name: "Mon, 10 Aug 2026: 0:05:00" })
      .querySelector("[style]");

    expect(bar).toHaveStyle({ height: "4%" });
  });

  it("scales a day that is tall enough proportionally", () => {
    // Above the floor the height is the real ratio — half of the tallest bar.
    render(
      <DayBarChart
        bars={[{ day: "2026-08-10", totalSeconds: 14_400, weekday: 1 }]}
        maxSeconds={28_800}
        label={LABEL}
        emptyLabel="—"
      />,
    );

    const bar = screen
      .getByRole("listitem", { name: "Mon, 10 Aug 2026: 4:00:00" })
      .querySelector("[style]");

    expect(bar).toHaveStyle({ height: "50%" });
  });

  it("gives a zero day no height at all, only a hairline track", () => {
    // The floor must not apply to zero: a 4%-tall bar on a day nobody worked
    // would be the exact lie the floor exists to prevent, in reverse.
    render(
      <DayBarChart
        bars={[{ day: "2026-08-10", totalSeconds: 0, weekday: 1 }]}
        maxSeconds={28_800}
        label={LABEL}
        emptyLabel="—"
      />,
    );

    const item = screen.getByRole("listitem", {
      name: "Mon, 10 Aug 2026: 0:00:00",
    });

    expect(item.querySelector("[style]")).toBeNull();
  });
});
