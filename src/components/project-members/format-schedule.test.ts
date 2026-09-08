import { describe, expect, it } from "vitest";

import {
  formatDailyHours,
  formatSchedule,
  NO_EXPECTED_HOURS,
  weeklySecondsOf,
} from "@/components/project-members/format-schedule";

describe("formatDailyHours", () => {
  it("reads a whole number of hours as one", () => {
    expect(formatDailyHours(14_400)).toBe("4h/day");
  });

  it("keeps a half hour and drops the trailing zeroes", () => {
    expect(formatDailyHours(12_600)).toBe("3.5h/day");
    expect(formatDailyHours(27_000)).toBe("7.5h/day");
  });

  it("handles a quarter hour, the finest schedule anyone writes down", () => {
    expect(formatDailyHours(900)).toBe("0.25h/day");
  });
});

describe("formatSchedule", () => {
  it("names the hours and the days in the company's week order", () => {
    expect(formatSchedule(14_400, [1, 2, 4, 5], 1)).toBe(
      "4h/day · Mon, Tue, Thu, Fri",
    );
  });

  it("rotates for a Sunday-start company without changing what is stored", () => {
    // Same array, same meaning, different reading order (§3.6.3).
    expect(formatSchedule(14_400, [0, 1, 5], 0)).toBe("4h/day · Sun, Mon, Fri");
    expect(formatSchedule(14_400, [0, 1, 5], 1)).toBe("4h/day · Mon, Fri, Sun");
  });

  it("says no expected hours rather than 0h/day", () => {
    // An unset schedule and a deliberate zero are the same value in the
    // column, so the wording has to be true of both.
    expect(formatSchedule(0, [1, 2, 3, 4, 5], 1)).toBe(NO_EXPECTED_HOURS);
    expect(formatSchedule(0, [], 1)).toBe(NO_EXPECTED_HOURS);
  });

  it("lets real hours with no working days say so", () => {
    // Not the same statement as zero hours: somebody chose days, and chose
    // none of them.
    expect(formatSchedule(14_400, [], 1)).toBe("4h/day · No working days");
  });
});

describe("weeklySecondsOf", () => {
  it("multiplies the daily seconds by the number of working days", () => {
    expect(
      weeklySecondsOf({ expectedDailySeconds: 14_400, workingDays: [1, 2, 3] }),
    ).toBe(43_200);
  });

  it("is zero when either half is empty", () => {
    expect(
      weeklySecondsOf({ expectedDailySeconds: 14_400, workingDays: [] }),
    ).toBe(0);
    expect(
      weeklySecondsOf({ expectedDailySeconds: 0, workingDays: [1, 2, 3] }),
    ).toBe(0);
  });

  it("stays in integer seconds so a sum cannot drift (§9.5)", () => {
    // 3.5h/day over four days is 14 hours exactly. Summed as hours and
    // converted back, this is where a timesheet stops matching its own lines.
    const seconds = weeklySecondsOf({
      expectedDailySeconds: 12_600,
      workingDays: [1, 2, 4, 5],
    });

    expect(seconds).toBe(50_400);
    expect(Number.isInteger(seconds)).toBe(true);
  });
});
