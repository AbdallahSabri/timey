import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { AttendanceRow } from "@/components/dashboard/attendance-rows";
import { EmployeeProgressCard } from "@/components/dashboard/employee-progress-card";

function card(row: Partial<AttendanceRow> = {}, running = false) {
  const full: AttendanceRow = {
    userId: "u1",
    userName: "Sara Ahmed",
    totalSeconds: 44_000,
    expectedSeconds: 50_000,
    ...row,
  };

  return render(
    <ul>
      <EmployeeProgressCard row={full} running={running} href="/reports" />
    </ul>,
  );
}

describe("EmployeeProgressCard", () => {
  it("leads with the percentage, which is the point of the card", () => {
    card({ totalSeconds: 36_000, expectedSeconds: 72_000 });
    expect(screen.getByText("50%")).toBeInTheDocument();
  });

  it("keeps the exact durations under it — the percentage summarises, never records", () => {
    // 15h against 20h: the worked figure, the target and the 5h shortfall are
    // three different strings, so each assertion is about the cell it names.
    card({ totalSeconds: 54_000, expectedSeconds: 72_000 });

    expect(screen.getByText("15:00:00")).toBeInTheDocument();
    expect(screen.getByText(/of 20:00:00/)).toBeInTheDocument();
    expect(screen.getByText("5:00:00")).toBeInTheDocument();
  });

  it("reads past 100% in text while the bar stays full", () => {
    // §9.9.6: the bar clamps because it is a drawing with an end; the number
    // does not, because 150% is the true and interesting reading.
    card({ totalSeconds: 108_000, expectedSeconds: 72_000 });

    expect(screen.getByText("150%")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "100",
    );
  });

  it("does not print a target that was never set", () => {
    // "18:00:00 of 0:00:00" above "No expected hours set" is two readings of
    // one fact, and one of them invents a target.
    card({ totalSeconds: 64_800, expectedSeconds: 0 });

    expect(screen.getByText("18:00:00")).toBeInTheDocument();
    expect(screen.queryByText(/of 0:00:00/)).not.toBeInTheDocument();
  });

  it("shows an absence rather than 0% when nobody set hours", () => {
    // A zero expected is what `mergeExpectedByUser` gives somebody with no
    // schedule. "0%" would claim they achieved none of something asked.
    card({ totalSeconds: 64_800, expectedSeconds: 0 });

    expect(screen.queryByText("0%")).not.toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("No expected hours set")).toBeInTheDocument();
  });

  it("announces no percentage at all when there is no target", () => {
    card({ totalSeconds: 64_800, expectedSeconds: 0 });
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("distinguishes a real zero from no target", () => {
    // Logging nothing against a real target IS a measurement, and it keeps its
    // bar and its percentage.
    card({ totalSeconds: 0, expectedSeconds: 72_000 });

    expect(screen.getByText("0%")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("says behind and ahead in words, with the sign carried by the words", () => {
    const { unmount } = card({ totalSeconds: 54_000, expectedSeconds: 72_000 });
    expect(screen.getByText(/behind/)).toBeInTheDocument();
    // The shortfall renders as a positive duration; "behind" carries the sign,
    // exactly as `formatSecondsHms` requires (it clamps negatives to zero).
    expect(screen.getByText("5:00:00")).toBeInTheDocument();
    unmount();

    card({ totalSeconds: 108_000, expectedSeconds: 72_000 });
    expect(screen.getByText(/ahead/)).toBeInTheDocument();
  });

  it("marks a running timer, and only when there is one", () => {
    const { unmount } = card({}, false);
    expect(screen.queryByText("Running")).not.toBeInTheDocument();
    unmount();

    card({}, true);
    expect(screen.getByText("Running")).toBeInTheDocument();
  });

  it("names a person it cannot read rather than rendering a blank", () => {
    card({ userName: null });
    expect(screen.getByText("Unknown person")).toBeInTheDocument();
  });

  it("links to that person's own report", () => {
    card();
    expect(screen.getByRole("link", { name: /Sara Ahmed/ })).toHaveAttribute(
      "href",
      "/reports",
    );
  });
});
