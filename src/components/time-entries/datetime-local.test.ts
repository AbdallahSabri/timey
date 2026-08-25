import { describe, expect, it } from "vitest";

import {
  toCompanyDateTimeLocalValue,
  toDateTimeLocalValue,
} from "@/components/time-entries/datetime-local";

describe("toDateTimeLocalValue", () => {
  it("produces the format datetime-local accepts, with no zone", () => {
    // Constructed from local components, so this assertion holds in any TZ the
    // suite runs under — which is the point: the value never carries an offset.
    expect(toDateTimeLocalValue(new Date(2026, 7, 25, 14, 32))).toBe(
      "2026-08-25T14:32",
    );
  });

  it("pads every part to a fixed width", () => {
    expect(toDateTimeLocalValue(new Date(2026, 0, 3, 9, 5))).toBe(
      "2026-01-03T09:05",
    );
  });

  it("renders midnight as 00:00, never 24:00", () => {
    expect(toDateTimeLocalValue(new Date(2026, 11, 31, 0, 0))).toBe(
      "2026-12-31T00:00",
    );
  });

  it("reads the browser's local calendar day, not the UTC one", () => {
    const date = new Date(2026, 7, 25, 23, 30);

    // The distinction that `toISOString()` would erase: east of UTC these two
    // disagree about the date, and the field must show the day on the clock in
    // front of the user.
    expect(toDateTimeLocalValue(date).slice(0, 10)).toBe("2026-08-25");
    expect(toDateTimeLocalValue(date)).not.toContain("Z");
  });
});

describe("toCompanyDateTimeLocalValue", () => {
  it("reads a stored instant in the company's timezone, not the browser's", () => {
    // 12:00 UTC is 14:00 in Berlin (CEST) and 05:00 in Los Angeles. The value
    // seeded into the field is the company's clock in both cases, because the
    // server will read whatever comes back as company-local (§6.1).
    expect(
      toCompanyDateTimeLocalValue("2026-08-25T12:00:00Z", "Europe/Berlin"),
    ).toBe("2026-08-25T14:00");
    expect(
      toCompanyDateTimeLocalValue(
        "2026-08-25T12:00:00Z",
        "America/Los_Angeles",
      ),
    ).toBe("2026-08-25T05:00");
  });

  it("carries no zone marker and drops seconds to the control's precision", () => {
    const value = toCompanyDateTimeLocalValue(
      "2026-08-25T12:00:47Z",
      "Europe/Berlin",
    );

    expect(value).toBe("2026-08-25T14:00");
    expect(value).not.toMatch(/Z|[+-]\d{2}:\d{2}$/);
  });

  it("renders midnight as 00:00 and keeps the company-local day", () => {
    // 22:30 UTC is already the next day in Cairo — the date has to move with
    // the time, or the proposal lands on the wrong day (§5.5, §6.1).
    expect(
      toCompanyDateTimeLocalValue("2026-08-25T21:00:00Z", "Africa/Cairo"),
    ).toBe("2026-08-26T00:00");
  });

  it("falls back to UTC for a zone this runtime cannot format", () => {
    expect(toCompanyDateTimeLocalValue("2026-08-25T12:00:00Z", null)).toBe(
      "2026-08-25T12:00",
    );
    expect(
      toCompanyDateTimeLocalValue("2026-08-25T12:00:00Z", "Mars/Olympus_Mons"),
    ).toBe("2026-08-25T12:00");
  });

  it("returns an empty value for an unparseable instant rather than NaN", () => {
    expect(toCompanyDateTimeLocalValue("not a timestamp", "UTC")).toBe("");
  });
});
