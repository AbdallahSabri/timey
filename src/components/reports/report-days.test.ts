import { describe, expect, it } from "vitest";

import {
  addDays,
  companyToday,
  dateToDayString,
  dayStringToDate,
  endOfMonth,
  formatDayLabel,
  formatDayRange,
  isDayString,
  startOfMonth,
} from "@/components/reports/report-days";

describe("isDayString", () => {
  it("accepts a well-formed day", () => {
    expect(isDayString("2026-08-25")).toBe(true);
  });

  it("rejects a day the calendar does not have", () => {
    // The regex alone would let both through, and Postgres would answer with a
    // 22008 about a date nobody typed.
    expect(isDayString("2026-02-30")).toBe(false);
    expect(isDayString("2026-04-31")).toBe(false);
  });

  it("rejects anything that is not YYYY-MM-DD", () => {
    expect(isDayString("25/08/2026")).toBe(false);
    expect(isDayString("2026-08-25T00:00:00Z")).toBe(false);
    expect(isDayString("")).toBe(false);
  });
});

describe("addDays", () => {
  it("steps forward and back across a month boundary", () => {
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDays("2026-09-01", -1)).toBe("2026-08-31");
  });

  it("steps across a year boundary", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("handles a leap day", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });

  it("counts whole days, not 24-hour blocks in a DST zone", () => {
    // The arithmetic is on UTC midnights, so a zone that shifted its clocks
    // inside this window cannot move the answer — the days are labels (§6.1
    // does the real bucketing in SQL).
    expect(addDays("2026-03-28", 1)).toBe("2026-03-29");
    expect(addDays("2026-10-24", 1)).toBe("2026-10-25");
  });

  it("returns an unusable input unchanged rather than inventing a day", () => {
    expect(addDays("not-a-day", 1)).toBe("not-a-day");
  });
});

describe("startOfMonth / endOfMonth", () => {
  it("finds both ends of a 31-day month", () => {
    expect(startOfMonth("2026-08-25")).toBe("2026-08-01");
    expect(endOfMonth("2026-08-25")).toBe("2026-08-31");
  });

  it("finds the end of a short month", () => {
    expect(endOfMonth("2026-04-10")).toBe("2026-04-30");
    expect(endOfMonth("2026-02-10")).toBe("2026-02-28");
    expect(endOfMonth("2028-02-10")).toBe("2028-02-29");
  });

  it("finds the end of December without rolling the year", () => {
    expect(endOfMonth("2026-12-05")).toBe("2026-12-31");
  });
});

describe("dateToDayString", () => {
  it("reads the browser's own calendar day, not the UTC one", () => {
    // 23:30 local is the next day in UTC anywhere east of Greenwich, and the
    // opposite west of it. `toISOString().slice(0, 10)` is the bug this exists
    // to avoid: the user clicked the 25th and must get the 25th.
    expect(dateToDayString(new Date(2026, 7, 25, 23, 30))).toBe("2026-08-25");
    expect(dateToDayString(new Date(2026, 7, 25, 0, 30))).toBe("2026-08-25");
  });

  it("pads every part", () => {
    expect(dateToDayString(new Date(2026, 0, 3))).toBe("2026-01-03");
  });

  it("round-trips through dayStringToDate", () => {
    expect(dateToDayString(dayStringToDate("2026-08-25") as Date)).toBe(
      "2026-08-25",
    );
  });
});

describe("dayStringToDate", () => {
  it("returns local midnight, which is the cell the calendar highlights", () => {
    const date = dayStringToDate("2026-08-25");

    expect(date?.getFullYear()).toBe(2026);
    expect(date?.getMonth()).toBe(7);
    expect(date?.getDate()).toBe(25);
    expect(date?.getHours()).toBe(0);
  });

  it("returns undefined for a day that isn't one", () => {
    expect(dayStringToDate("2026-02-30")).toBeUndefined();
    expect(dayStringToDate("")).toBeUndefined();
  });
});

describe("formatDayLabel", () => {
  it("names the day the string names, not the day it would be somewhere else", () => {
    // Formatted in UTC on purpose: the label is already a company-local day
    // computed by Postgres, and re-interpreting it in any other zone can move
    // it. This assertion would fail under a negative-offset TZ if it did.
    expect(formatDayLabel("2026-08-25")).toContain("25 Aug 2026");
    expect(formatDayLabel("2026-01-01")).toContain("1 Jan 2026");
  });

  it("leaves an unparseable value alone instead of rendering Invalid Date", () => {
    expect(formatDayLabel("whenever")).toBe("whenever");
  });
});

describe("formatDayRange", () => {
  it("shows both ends", () => {
    expect(formatDayRange("2026-08-01", "2026-08-25")).toBe(
      "1 Aug 2026 – 25 Aug 2026",
    );
  });

  it("collapses a single-day range to one date", () => {
    expect(formatDayRange("2026-08-25", "2026-08-25")).toBe("25 Aug 2026");
  });
});

describe("companyToday", () => {
  it("answers in the company's zone, not the runtime's", () => {
    // 2026-08-25T02:00Z is still the 24th in Los Angeles and already the 25th
    // in Cairo. §6.1: the company's timezone is what "today" means.
    const instant = Date.UTC(2026, 7, 25, 2, 0);

    expect(companyToday("Africa/Cairo", instant)).toBe("2026-08-25");
    expect(companyToday("America/Los_Angeles", instant)).toBe("2026-08-24");
  });

  it("falls back to UTC for a company with no zone on record", () => {
    expect(companyToday(null, Date.UTC(2026, 7, 25, 2, 0))).toBe("2026-08-25");
  });
});
