import { describe, expect, it } from "vitest";

import {
  byShortfall,
  teamTotals,
  type AttendanceRow,
} from "@/components/dashboard/attendance-rows";
import { percentOf } from "@/components/reports/report-expected";

function row(
  userName: string | null,
  totalSeconds: number,
  expectedSeconds: number | null,
): AttendanceRow {
  return { userId: `id-${userName}`, userName, totalSeconds, expectedSeconds };
}

const names = (rows: AttendanceRow[]) => rows.map((r) => r.userName);

describe("byShortfall", () => {
  it("puts the biggest shortfall first", () => {
    const sorted = byShortfall([
      row("Slightly behind", 68_400, 72_000), // -1:00:00
      row("Far behind", 36_000, 72_000), // -10:00:00
      row("On target", 72_000, 72_000), // 0
    ]);

    expect(names(sorted)).toEqual([
      "Far behind",
      "Slightly behind",
      "On target",
    ]);
  });

  it("ranks somebody who logged nothing above somebody merely behind", () => {
    // This is the whole reason the helper exists: SQL's `total_seconds desc`
    // sorts the person with a zero total *last*, which is backwards for a card
    // whose job is to surface them (§9.8.3's union row).
    const sorted = byShortfall([
      row("Logged a little", 68_400, 72_000),
      row("Logged nothing", 0, 72_000),
    ]);

    expect(names(sorted)).toEqual(["Logged nothing", "Logged a little"]);
  });

  it("puts surpluses after every shortfall, smallest surplus first", () => {
    const sorted = byShortfall([
      row("Way ahead", 108_000, 72_000), // +10:00:00
      row("Just ahead", 75_600, 72_000), // +1:00:00
      row("Behind", 70_000, 72_000), // -0:33:20
    ]);

    expect(names(sorted)).toEqual(["Behind", "Just ahead", "Way ahead"]);
  });

  it("puts people with no target last, however much they logged", () => {
    // Null is "nobody set a schedule", which is not a standing — not a
    // spectacular surplus, which is what treating it as zero would imply.
    const sorted = byShortfall([
      row("No schedule", 360_000, null),
      row("Ahead", 108_000, 72_000),
      row("Behind", 36_000, 72_000),
    ]);

    expect(names(sorted)).toEqual(["Behind", "Ahead", "No schedule"]);
  });

  it("distinguishes a zero target from no target", () => {
    // A schedule of no hours is an answer somebody gave; it ranks as on-target.
    const sorted = byShortfall([
      row("No schedule", 0, null),
      row("Zero-hour schedule", 0, 0),
    ]);

    expect(names(sorted)).toEqual(["Zero-hour schedule", "No schedule"]);
  });

  it("breaks ties by name so the order is stable across renders", () => {
    const sorted = byShortfall([
      row("Zoe", 36_000, 72_000),
      row("Adam", 36_000, 72_000),
    ]);

    expect(names(sorted)).toEqual(["Adam", "Zoe"]);
  });

  it("sorts an unreadable name last among its ties, matching nulls last", () => {
    const sorted = byShortfall([
      row(null, 36_000, 72_000),
      row("Adam", 36_000, 72_000),
    ]);

    expect(names(sorted)).toEqual(["Adam", null]);
  });

  it("does not mutate its input", () => {
    const input = [row("Zoe", 36_000, 72_000), row("Adam", 72_000, 72_000)];
    const before = names(input);

    byShortfall(input);

    expect(names(input)).toEqual(before);
  });
});

describe("teamTotals", () => {
  it("sums both sides across the rows that have a target", () => {
    const totals = teamTotals([
      row("Behind", 36_000, 72_000),
      row("Ahead", 108_000, 72_000),
    ]);

    expect(totals.workedSeconds).toBe(144_000);
    expect(totals.expectedSeconds).toBe(144_000);
  });

  it("keeps the worked side to the same people as the expected side", () => {
    // The ratio the team card shows has to describe one population. If an
    // unscheduled person's hours landed in the numerator, a contractor could
    // push the team past 100% while every individual card sat below it.
    const totals = teamTotals([
      row("Scheduled", 72_000, 72_000),
      row("No schedule", 360_000, 0),
    ]);

    expect(totals.workedSeconds).toBe(72_000);
    expect(totals.expectedSeconds).toBe(72_000);
  });

  it("reports no target at all rather than a zero one", () => {
    // Zero would be a target of no hours, which somebody chose. Null is "there
    // is nothing to be a share of", and the card renders it as an absence.
    const totals = teamTotals([row("No schedule", 64_800, 0)]);

    expect(totals.expectedSeconds).toBe(null);
    expect(totals.workedSeconds).toBe(0);
  });

  it("partitions every row into exactly one of the four counts", () => {
    const rows = [
      row("Behind", 36_000, 72_000),
      row("Also behind", 0, 72_000),
      row("Ahead", 108_000, 72_000),
      row("On target", 72_000, 72_000),
      row("No schedule", 64_800, 0),
      row("No target at all", 10, null),
    ];
    const totals = teamTotals(rows);

    expect(totals.behind).toBe(2);
    expect(totals.ahead).toBe(1);
    expect(totals.onTarget).toBe(1);
    expect(totals.noTarget).toBe(2);
    expect(
      totals.behind + totals.ahead + totals.onTarget + totals.noTarget,
    ).toBe(rows.length);
  });

  it("leaves a no-target row out of both sums entirely", () => {
    const totals = teamTotals([
      row("Scheduled", 36_000, 72_000),
      row("No schedule", 500_000, 0),
    ]);

    expect(totals.expectedSeconds).toBe(72_000);
    expect(totals.workedSeconds).toBe(36_000);
  });

  it("agrees with percentOf about who has no target", () => {
    // The count and the dashes on the cards are driven by the same predicate,
    // so they cannot drift apart.
    const totals = teamTotals([row("No schedule", 64_800, 0)]);

    expect(totals.noTarget).toBe(1);
    expect(percentOf(64_800, 0)).toBe(null);
  });

  it("is all zeroes for an empty team", () => {
    expect(teamTotals([])).toEqual({
      workedSeconds: 0,
      expectedSeconds: null,
      behind: 0,
      ahead: 0,
      onTarget: 0,
      noTarget: 0,
    });
  });
});
