import { describe, expect, test } from "vitest";

import {
  DEFAULT_WORKING_DAYS,
  SECONDS_PER_HOUR,
  formatWorkingDays,
  isWorkingDay,
  weekdayName,
  weekdayShortName,
  weekdaysFrom,
} from "./working-days";

/**
 * Everything here is pure: no clock, no timezone, no database. The one thing
 * these tests are really guarding is the numbering — 0 = Sunday, matching
 * Postgres `extract(dow)` and `companies.week_starts_on`. An off-by-one in a
 * weekday map is wrong for a year before anyone notices, because it is only
 * visible on the days it names.
 */

describe("weekday numbering", () => {
  test("0 is Sunday and 6 is Saturday, matching extract(dow)", () => {
    expect(weekdayName(0)).toBe("Sunday");
    expect(weekdayName(1)).toBe("Monday");
    expect(weekdayName(6)).toBe("Saturday");
  });

  test("short names are the picker's labels", () => {
    expect(weekdayShortName(1)).toBe("Mon");
    expect(weekdayShortName(4)).toBe("Thu");
  });

  test("the column default is Monday to Friday", () => {
    expect([...DEFAULT_WORKING_DAYS]).toEqual([1, 2, 3, 4, 5]);
  });

  test("an hour is 3600 seconds and nothing else converts", () => {
    expect(SECONDS_PER_HOUR).toBe(3600);
  });
});

describe("isWorkingDay", () => {
  test("accepts 0 through 6", () => {
    expect([0, 1, 2, 3, 4, 5, 6].every(isWorkingDay)).toBe(true);
  });

  test("rejects out-of-range, fractional and non-finite values", () => {
    expect(isWorkingDay(-1)).toBe(false);
    expect(isWorkingDay(7)).toBe(false);
    expect(isWorkingDay(1.5)).toBe(false);
    expect(isWorkingDay(Number.NaN)).toBe(false);
  });
});

describe("weekdaysFrom", () => {
  test("a Monday-start company reads Mon…Sun", () => {
    expect(weekdaysFrom(1)).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });

  test("a Sunday-start company reads Sun…Sat", () => {
    expect(weekdaysFrom(0)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  test("always returns all seven days exactly once, whatever the start", () => {
    for (const start of [0, 1, 2, 3, 4, 5, 6]) {
      expect([...weekdaysFrom(start)].sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
    }
  });

  test("falls back to Monday for a value the column could never hold", () => {
    // `companies.week_starts_on` is CHECKed to (0,1), so this is unreachable
    // through the database. It is reachable through a stale prop, and a picker
    // that renders nothing is worse than one that renders a conventional week.
    expect(weekdaysFrom(9)).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });
});

describe("formatWorkingDays", () => {
  test("orders by the company's week, not by day number", () => {
    // Sunday-start: Sunday leads. Monday-start: Sunday trails.
    expect(formatWorkingDays([0, 1, 2], 0)).toBe("Sun, Mon, Tue");
    expect(formatWorkingDays([0, 1, 2], 1)).toBe("Mon, Tue, Sun");
  });

  test("renders the user's example schedule", () => {
    expect(formatWorkingDays([1, 2, 4, 5], 1)).toBe("Mon, Tue, Thu, Fri");
  });

  test("input order does not change the output", () => {
    expect(formatWorkingDays([5, 1, 4, 2], 1)).toBe("Mon, Tue, Thu, Fri");
  });

  test("empty is a sentence, not a blank cell", () => {
    // A blank reads as missing data; "No working days" is a statement someone
    // chose to make (SPEC.md §3.6.3).
    expect(formatWorkingDays([], 1)).toBe("No working days");
  });

  test("all seven collapses rather than listing every day", () => {
    expect(formatWorkingDays([0, 1, 2, 3, 4, 5, 6], 1)).toBe("Every day");
  });

  test("ignores a day number the column could not hold", () => {
    expect(formatWorkingDays([1, 2, 99], 1)).toBe("Mon, Tue");
  });
});
