import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TeamProgressCard } from "@/components/dashboard/team-progress-card";

const COUNTS = { behind: 9, ahead: 2, onTarget: 1, noTarget: 0 };

function card(
  props: Partial<React.ComponentProps<typeof TeamProgressCard>> = {},
) {
  return render(
    <TeamProgressCard
      workedSeconds={36_000}
      expectedSeconds={72_000}
      counts={COUNTS}
      rangeLabel="1 – 12 Sept 2026"
      runningCount={0}
      {...props}
    />,
  );
}

describe("TeamProgressCard", () => {
  it("states the team's share and both figures behind it", () => {
    card();

    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText("10:00:00")).toBeInTheDocument();
    expect(screen.getByText(/of 20:00:00/)).toBeInTheDocument();
  });

  it("shows the partition an admin acts on", () => {
    card();

    expect(screen.getByText("9")).toBeInTheDocument();
    expect(screen.getByText("behind")).toBeInTheDocument();
    expect(screen.getByText("ahead")).toBeInTheDocument();
    expect(screen.getByText("on target")).toBeInTheDocument();
  });

  it("hides the no-target count when nobody is missing a schedule", () => {
    card();
    expect(screen.queryByText("with no hours set")).not.toBeInTheDocument();
  });

  it("says who is outside the target when somebody is", () => {
    // They are excluded from `expectedSeconds`, so the figure would otherwise
    // silently describe fewer people than the grid below shows.
    card({ counts: { ...COUNTS, noTarget: 2 } });

    expect(screen.getByText("with no hours set")).toBeInTheDocument();
    expect(
      screen.getByText(/2 people have no expected hours set/),
    ).toBeInTheDocument();
  });

  it("always carries §9.8.2's today-in-full disclosure", () => {
    card();
    expect(
      screen.getByText(/Expected hours count today in full/),
    ).toBeInTheDocument();
  });

  it("discloses running timers only when some are running", () => {
    const { unmount } = card({ runningCount: 0 });
    expect(screen.queryByText(/running now/)).not.toBeInTheDocument();
    unmount();

    card({ runningCount: 1 });
    expect(
      screen.getByText("One timer is running now and is not counted yet."),
    ).toBeInTheDocument();
  });

  it("pluralises the running disclosure", () => {
    card({ runningCount: 3 });
    expect(
      screen.getByText("3 timers are running now and are not counted yet."),
    ).toBeInTheDocument();
  });

  it("announces no percentage, no bar and no target when nobody is scheduled", () => {
    // The first-run state this card sits under the setup card for. All three
    // must agree: a `—` above a full bar, or above "of 0:00:00", is the same
    // lie told twice (§9.9.6).
    card({
      workedSeconds: 64_800,
      expectedSeconds: null,
      counts: { behind: 0, ahead: 0, onTarget: 0, noTarget: 12 },
    });

    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByText(/of 0:00:00/)).not.toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });

  it("sums only the scheduled people, so the share is a ratio of one population", () => {
    // The defect this guards: pairing a company-wide worked total with an
    // expected figure only scheduled people contribute to lets somebody with
    // no target push the team past 100% while every card sits below it.
    card({
      workedSeconds: 36_000,
      expectedSeconds: 72_000,
      counts: { ...COUNTS, noTarget: 1 },
    });

    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(
      screen.getByText(
        /One person has no expected hours set, so neither their hours nor a target are in these figures/,
      ),
    ).toBeInTheDocument();
  });
});
