import { describe, expect, it } from "vitest";

import { toDateTimeLocalValue } from "@/components/time-entries/datetime-local";

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
