import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  ProportionBarList,
  type ProportionRow,
} from "@/components/charts/proportion-bar-list";

const ROWS: ProportionRow[] = [
  { key: "a", label: "Acme · Redesign", totalSeconds: 66_000 },
  { key: "b", label: "Internal · Admin", totalSeconds: 21_900 },
];

describe("ProportionBarList", () => {
  it("ties each duration to the label it belongs to", () => {
    // A `dl` rather than two columns of text: the association is in the markup,
    // not only in the alignment.
    render(
      <ProportionBarList rows={ROWS} maxSeconds={66_000} emptyLabel="—" />,
    );

    expect(screen.getByText("Acme · Redesign")).toBeInTheDocument();
    expect(screen.getByText("18:20:00")).toBeInTheDocument();
    expect(screen.getByText("Internal · Admin")).toBeInTheDocument();
    expect(screen.getByText("6:05:00")).toBeInTheDocument();
  });

  it("renders no total", () => {
    // §12.2 / D-16: the list is usually truncated by `topNWithOther`, so a sum
    // here would be about rows that are not on screen. The total lives in a
    // StatTile fed by `report_summary`.
    render(
      <ProportionBarList rows={ROWS} maxSeconds={66_000} emptyLabel="—" />,
    );

    // 66000 + 21900 = 87900 = 24:25:00. It must appear nowhere.
    expect(screen.queryByText("24:25:00")).not.toBeInTheDocument();
    expect(screen.queryByText(/total/i)).not.toBeInTheDocument();
  });

  it("scales bars against the largest row, so the top row fills the track", () => {
    // Scaling by the total would leave every bar short when work is spread
    // evenly, which reads as "nothing happened".
    const { container } = render(
      <ProportionBarList rows={ROWS} maxSeconds={66_000} emptyLabel="—" />,
    );

    const bars = container.querySelectorAll("[style]");
    expect(bars[0]).toHaveStyle({ width: "100%" });
  });

  it("renders a hidden name as its placeholder word, never blank", () => {
    // `report-rows.ts`: a missing name reads "Unknown project" — never blank,
    // never the string "null", and never the row silently dropped.
    render(
      <ProportionBarList
        rows={[
          {
            key: "x",
            label: "Unknown project",
            totalSeconds: 3_600,
            muted: true,
          },
        ]}
        maxSeconds={3_600}
        emptyLabel="—"
      />,
    );

    const label = screen.getByText("Unknown project");
    expect(label).toBeInTheDocument();
    expect(label).toHaveClass("italic");
  });

  it("draws a muted row neutral rather than giving it a project's colour", () => {
    const { container } = render(
      <ProportionBarList
        rows={[
          { key: "o", label: "Other (3)", totalSeconds: 3_600, muted: true },
        ]}
        maxSeconds={3_600}
        emptyLabel="—"
      />,
    );

    const bar = container.querySelector("[style]");
    expect(bar).not.toHaveClass("bg-chart-1");
    expect(bar).toHaveClass("bg-muted-foreground/30");
  });

  it("walks the chart ramp so adjacent rows are distinguishable", () => {
    const { container } = render(
      <ProportionBarList
        rows={[
          { key: "a", label: "A", totalSeconds: 300 },
          { key: "b", label: "B", totalSeconds: 200 },
        ]}
        maxSeconds={300}
        emptyLabel="—"
      />,
    );

    const bars = container.querySelectorAll("[style]");
    expect(bars[0]).toHaveClass("bg-chart-1");
    expect(bars[1]).toHaveClass("bg-chart-2");
  });

  it("shows the empty state rather than an empty list", () => {
    render(
      <ProportionBarList
        rows={[]}
        maxSeconds={0}
        emptyLabel="Nothing logged yet."
      />,
    );

    expect(screen.getByText("Nothing logged yet.")).toBeInTheDocument();
  });

  it("shows the empty state rather than dividing by zero", () => {
    render(
      <ProportionBarList
        rows={[{ key: "a", label: "A", totalSeconds: 0 }]}
        maxSeconds={0}
        emptyLabel="Nothing logged yet."
      />,
    );

    expect(screen.getByText("Nothing logged yet.")).toBeInTheDocument();
  });
});
