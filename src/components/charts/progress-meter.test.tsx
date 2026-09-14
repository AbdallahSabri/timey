import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProgressMeter } from "@/components/charts/progress-meter";

const LABEL = "Hours worked against hours expected";

function meter(
  props: Partial<React.ComponentProps<typeof ProgressMeter>> = {},
) {
  render(
    <ProgressMeter
      valueSeconds={36_000}
      targetSeconds={72_000}
      ariaLabel={LABEL}
      {...props}
    />,
  );

  return screen.getByRole("progressbar", { name: LABEL });
}

describe("ProgressMeter", () => {
  it("reports progress toward the target as a percentage", () => {
    expect(meter()).toHaveAttribute("aria-valuenow", "50");
  });

  it("clamps an overshoot at 100 rather than painting past the track", () => {
    // 30 hours against a 20-hour target. The surplus is stated in words by the
    // caller; the bar never runs past its end.
    expect(
      meter({ valueSeconds: 108_000, targetSeconds: 72_000 }),
    ).toHaveAttribute("aria-valuenow", "100");
  });

  it("reads full for a zero target instead of dividing by zero", () => {
    // Nothing was asked for, so nothing is missing.
    expect(meter({ valueSeconds: 0, targetSeconds: 0 })).toHaveAttribute(
      "aria-valuenow",
      "100",
    );
  });

  it("reports no percentage at all when there is no target", () => {
    // Null is "nobody set a schedule". 100% would claim a target that does not
    // exist had been met, and 0% is the same false claim inverted — and it is
    // the one a screen reader reads out. §9.8.2 omits rather than zeroes, so
    // there is no `progressbar` here to announce anything.
    render(
      <ProgressMeter
        valueSeconds={36_000}
        targetSeconds={null}
        ariaLabel={LABEL}
      />,
    );

    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("never reports a negative value", () => {
    expect(
      meter({ valueSeconds: -100, targetSeconds: 72_000 }),
    ).toHaveAttribute("aria-valuenow", "0");
  });

  it("carries the full min and max so the value is interpretable", () => {
    const bar = meter();
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
  });
});
