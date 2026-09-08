import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ReportSummaryHeader } from "@/components/reports/report-summary";
import type { ReportSummary } from "@/lib/actions/reports";

function summary(overrides: Partial<ReportSummary> = {}): ReportSummary {
  return {
    entryCount: 12,
    totalSeconds: 36_000,
    runningCount: 0,
    expectedSeconds: null,
    ...overrides,
  };
}

describe("ReportSummaryHeader — the Expected figure (§9.8.1)", () => {
  it("keeps the original three figures when there is no expected", () => {
    render(
      <ReportSummaryHeader summary={summary()} rangeLabel="1–30 Sept 2026" />,
    );

    expect(screen.getByText("10:00:00")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("No timers in flight")).toBeInTheDocument();
    expect(screen.queryByText("Expected")).not.toBeInTheDocument();
  });

  it("OMITS the figure rather than showing zero for a team-wide report", () => {
    // Null means the report does not resolve to one person, or a task filter
    // made expected undefined. A zero would claim nothing was expected.
    render(
      <ReportSummaryHeader
        summary={summary({ expectedSeconds: null })}
        rangeLabel="1–30 Sept 2026"
      />,
    );

    expect(screen.queryByText("Expected")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/behind|ahead|on target/i),
    ).not.toBeInTheDocument();
  });

  it("adds a fourth figure when the report is about one person", () => {
    render(
      <ReportSummaryHeader
        summary={summary({ expectedSeconds: 72_000 })}
        rangeLabel="1–30 Sept 2026"
      />,
    );

    expect(screen.getByText("Expected")).toBeInTheDocument();
    expect(screen.getByText("20:00:00")).toBeInTheDocument();
    // 10:00:00 worked against 20:00:00 expected, so the figure appears twice —
    // once as the total and once as the shortfall. `formatSecondsHms` clamps a
    // negative to "0:00:00", so the shortfall is the absolute value with the
    // direction said in words rather than carried by the number.
    expect(screen.getAllByText("10:00:00")).toHaveLength(2);
    expect(screen.getByText(/behind/)).toBeInTheDocument();
  });

  it("names a surplus as ahead, in the ledger green reserved for it", () => {
    render(
      <ReportSummaryHeader
        summary={summary({ totalSeconds: 79_200, expectedSeconds: 72_000 })}
        rangeLabel="1–30 Sept 2026"
      />,
    );

    expect(screen.getByText(/ahead/)).toBeInTheDocument();
    // Never `--live`, which marks a running timer and nothing else.
    expect(screen.getByText("2:00:00")).toHaveClass("text-primary");
  });

  it("says exactly on target rather than showing a signed zero", () => {
    render(
      <ReportSummaryHeader
        summary={summary({ totalSeconds: 72_000, expectedSeconds: 72_000 })}
        rangeLabel="1–30 Sept 2026"
      />,
    );

    expect(screen.getByText("Exactly on target")).toBeInTheDocument();
  });

  it("still discloses a running timer beside the expected figure (§9.8.2)", () => {
    // The worked side excludes running entries and the expected side counts
    // today in full, so somebody mid-timer reads as behind. The third figure
    // is what says so.
    render(
      <ReportSummaryHeader
        summary={summary({ runningCount: 1, expectedSeconds: 72_000 })}
        rangeLabel="1–30 Sept 2026"
      />,
    );

    expect(screen.getByText("Not counted until stopped")).toBeInTheDocument();
  });
});
