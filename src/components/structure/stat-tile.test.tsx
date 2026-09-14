import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  FIGURE_UNAVAILABLE,
  StatTile,
  StatTileGrid,
} from "@/components/structure/stat-tile";

describe("StatTile", () => {
  it("renders the label, the figure and the caption", () => {
    render(
      <StatTile
        label="Total time"
        figure="10:00:00"
        caption="1 – 8 Sept 2026"
      />,
    );

    expect(screen.getByText("Total time")).toBeInTheDocument();
    expect(screen.getByText("10:00:00")).toBeInTheDocument();
    expect(screen.getByText("1 – 8 Sept 2026")).toBeInTheDocument();
  });

  it("omits the caption element entirely when there is none", () => {
    const { container } = render(<StatTile label="Entries" figure={12} />);
    expect(container.querySelectorAll("span")).toHaveLength(2);
  });

  it("sets the figure in the mono tabular face", () => {
    // Durations and clock times are always `font-mono tabular-nums`
    // (`CLAUDE.md`), and a column of figures that does not line up is the whole
    // reason that rule exists.
    render(<StatTile label="Total time" figure="10:00:00" />);

    expect(screen.getByText("10:00:00")).toHaveClass("font-mono");
    expect(screen.getByText("10:00:00")).toHaveClass("tabular-nums");
  });

  it("has one glyph for a figure that could not be read", () => {
    // A zero is a measurement; this is the absence of one. On a timesheet the
    // two must not look alike, so callers pass this rather than `0:00:00` when
    // a read fails.
    expect(FIGURE_UNAVAILABLE).not.toBe("0:00:00");

    render(
      <StatTile
        label="This month"
        figure={FIGURE_UNAVAILABLE}
        caption="Couldn't be loaded"
      />,
    );

    expect(screen.getByText(FIGURE_UNAVAILABLE)).toBeInTheDocument();
    expect(screen.queryByText("0:00:00")).not.toBeInTheDocument();
  });

  it("uses amber only when asked to", () => {
    // `--live` marks a running timer and nothing else, and a zero is not one —
    // so the caller passes `live` conditionally and the default must be plain.
    const { rerender } = render(<StatTile label="Running now" figure={0} />);
    expect(screen.getByText("0")).not.toHaveClass("text-live");

    rerender(<StatTile label="Running now" figure={3} live />);
    expect(screen.getByText("3")).toHaveClass("text-live");
  });
});

describe("StatTileGrid", () => {
  it("pairs four tiles up before fanning them out", () => {
    // Four figures in quarters of a phone-width card are unreadable.
    const { container } = render(
      <StatTileGrid columns={4}>
        <StatTile label="A" figure="1" />
      </StatTileGrid>,
    );

    const grid = container.firstElementChild;
    expect(grid).toHaveClass("sm:grid-cols-2");
    expect(grid).toHaveClass("lg:grid-cols-4");
  });

  it("puts three tiles in one row from `sm` up", () => {
    const { container } = render(
      <StatTileGrid columns={3}>
        <StatTile label="A" figure="1" />
      </StatTileGrid>,
    );

    expect(container.firstElementChild).toHaveClass("sm:grid-cols-3");
  });
});
