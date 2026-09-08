import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MonthProgressCard } from "@/components/dashboard/month-progress-card";

/**
 * The card's whole job is to make a correct pair of numbers read correctly.
 * Most of these tests are therefore about the sentences, not the figures: a
 * shortfall that is really an unstopped timer, or really "today counted in
 * full", is the failure mode this component exists to prevent (`SPEC.md`
 * §9.8.2).
 */

const MONTH = "1 – 8 September 2026";

describe("MonthProgressCard", () => {
  it("shows worked against expected in the user's own terms", () => {
    render(
      <MonthProgressCard
        workedSeconds={58540} // 16:15:40
        expectedSeconds={72000} // 20:00:00
        runningCount={0}
        monthLabel={MONTH}
      />,
    );

    expect(screen.getByText("16:15:40")).toBeInTheDocument();
    expect(screen.getByText("of 20:00:00")).toBeInTheDocument();
  });

  it("states a shortfall as a positive duration plus the word behind", () => {
    // 20:00:00 - 16:15:40 = 3:44:20. formatSecondsHms clamps negatives to zero,
    // so the sign has to be carried by the words, not by the formatter.
    render(
      <MonthProgressCard
        workedSeconds={58540}
        expectedSeconds={72000}
        runningCount={0}
        monthLabel={MONTH}
      />,
    );

    expect(screen.getByText("3:44:20")).toBeInTheDocument();
    expect(
      screen.getByText(/behind the expected hours so far/),
    ).toBeInTheDocument();
  });

  it("states a surplus as ahead", () => {
    render(
      <MonthProgressCard
        workedSeconds={72940}
        expectedSeconds={72000}
        runningCount={0}
        monthLabel={MONTH}
      />,
    );

    expect(screen.getByText("0:15:40")).toBeInTheDocument();
    expect(
      screen.getByText(/ahead of the expected hours so far/),
    ).toBeInTheDocument();
  });

  it("says on target when the two are equal", () => {
    render(
      <MonthProgressCard
        workedSeconds={72000}
        expectedSeconds={72000}
        runningCount={0}
        monthLabel={MONTH}
      />,
    );

    expect(screen.getByText(/exactly on target/)).toBeInTheDocument();
  });

  it("always explains that today is counted in full", () => {
    render(
      <MonthProgressCard
        workedSeconds={58540}
        expectedSeconds={72000}
        runningCount={0}
        monthLabel={MONTH}
      />,
    );

    expect(screen.getByText(/count today in full/)).toBeInTheDocument();
  });

  it("explains the running timer only when one is running", () => {
    const { rerender } = render(
      <MonthProgressCard
        workedSeconds={58540}
        expectedSeconds={72000}
        runningCount={0}
        monthLabel={MONTH}
      />,
    );

    expect(screen.queryByText(/timer is running now/)).not.toBeInTheDocument();

    rerender(
      <MonthProgressCard
        workedSeconds={58540}
        expectedSeconds={72000}
        runningCount={1}
        monthLabel={MONTH}
      />,
    );

    expect(screen.getByText(/timer is running now/)).toBeInTheDocument();
  });

  it("distinguishes no schedule from a zero schedule", () => {
    // null means nobody has set anything; the card must not imply the employee
    // is spectacularly ahead of a target that does not exist.
    const { rerender } = render(
      <MonthProgressCard
        workedSeconds={58540}
        expectedSeconds={null}
        runningCount={0}
        monthLabel={MONTH}
      />,
    );

    expect(
      screen.getByText(/No expected hours have been set/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByText(/of 0:00:00/)).not.toBeInTheDocument();

    rerender(
      <MonthProgressCard
        workedSeconds={58540}
        expectedSeconds={0}
        runningCount={0}
        monthLabel={MONTH}
      />,
    );

    expect(screen.getByText("of 0:00:00")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("reports progress as a clamped percentage", () => {
    render(
      <MonthProgressCard
        workedSeconds={36000}
        expectedSeconds={72000}
        runningCount={0}
        monthLabel={MONTH}
      />,
    );

    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "50",
    );
  });

  it("does not paint past the end of the track when someone overshoots", () => {
    render(
      <MonthProgressCard
        workedSeconds={720000}
        expectedSeconds={72000}
        runningCount={0}
        monthLabel={MONTH}
      />,
    );

    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "100",
    );
  });

  it("treats a zero-hour target as met rather than dividing by zero", () => {
    render(
      <MonthProgressCard
        workedSeconds={0}
        expectedSeconds={0}
        runningCount={0}
        monthLabel={MONTH}
      />,
    );

    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "100",
    );
    expect(screen.getByText(/exactly on target/)).toBeInTheDocument();
  });
});
