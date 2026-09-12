import { describe, expect, it } from "vitest";

import { fillDaySeries, maxSecondsOf } from "@/components/charts/day-series";

describe("fillDaySeries", () => {
  it("inserts a zero day for every day the report had no row for", () => {
    // `report_by_day` returns only days with entries, so this is the ordinary
    // case rather than an edge one.
    const series = fillDaySeries(
      [
        { day: "2026-09-07", totalSeconds: 28_800 },
        { day: "2026-09-09", totalSeconds: 14_400 },
      ],
      "2026-09-07",
      "2026-09-10",
    );

    expect(series).toEqual([
      { day: "2026-09-07", totalSeconds: 28_800 },
      { day: "2026-09-08", totalSeconds: 0 },
      { day: "2026-09-09", totalSeconds: 14_400 },
      { day: "2026-09-10", totalSeconds: 0 },
    ]);
  });

  it("includes both ends of the range", () => {
    const series = fillDaySeries([], "2026-09-07", "2026-09-07");
    expect(series).toEqual([{ day: "2026-09-07", totalSeconds: 0 }]);
  });

  it("counts fourteen days for a fourteen-day window", () => {
    // The dashboards ask for `addDays(today, -13) .. today`; if this is 13 or
    // 15 the label on the card is wrong.
    expect(fillDaySeries([], "2026-09-01", "2026-09-14")).toHaveLength(14);
  });

  it("crosses a month boundary without losing or repeating a day", () => {
    const series = fillDaySeries([], "2026-08-30", "2026-09-02");
    expect(series.map((row) => row.day)).toEqual([
      "2026-08-30",
      "2026-08-31",
      "2026-09-01",
      "2026-09-02",
    ]);
  });

  it("drops a row outside the range rather than widening the axis", () => {
    // A chart labelled "last 14 days" must be 14 days long whatever arrives.
    const series = fillDaySeries(
      [
        { day: "2026-08-01", totalSeconds: 36_000 },
        { day: "2026-09-08", totalSeconds: 3_600 },
      ],
      "2026-09-07",
      "2026-09-08",
    );

    expect(series).toEqual([
      { day: "2026-09-07", totalSeconds: 0 },
      { day: "2026-09-08", totalSeconds: 3_600 },
    ]);
  });

  it("is empty for an inverted or unreal range instead of looping", () => {
    expect(fillDaySeries([], "2026-09-10", "2026-09-07")).toEqual([]);
    expect(fillDaySeries([], "2026-02-30", "2026-03-02")).toEqual([]);
    expect(fillDaySeries([], "not-a-day", "2026-03-02")).toEqual([]);
  });
});

describe("maxSecondsOf", () => {
  it("finds the tallest bar", () => {
    expect(maxSecondsOf([{ totalSeconds: 100 }, { totalSeconds: 900 }])).toBe(
      900,
    );
  });

  it("is zero for an empty or all-zero series, never undefined", () => {
    // The chart divides by this, so the all-zero case has to have one answer.
    expect(maxSecondsOf([])).toBe(0);
    expect(maxSecondsOf([{ totalSeconds: 0 }, { totalSeconds: 0 }])).toBe(0);
  });
});
