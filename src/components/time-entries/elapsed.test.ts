import { describe, expect, it } from "vitest";

import {
  DEFAULT_MAX_TIMER_HOURS,
  elapsedSeconds,
  formatApproxHours,
  formatClock,
  isStale,
} from "@/components/time-entries/elapsed";

const STARTED_AT = "2026-08-24T09:00:00.000Z";
const startedMs = Date.parse(STARTED_AT);

describe("elapsedSeconds", () => {
  it("counts from the server's started_at to the client's now", () => {
    expect(elapsedSeconds(STARTED_AT, startedMs)).toBe(0);
    expect(elapsedSeconds(STARTED_AT, startedMs + 1_000)).toBe(1);
    expect(elapsedSeconds(STARTED_AT, startedMs + 3_723_000)).toBe(3723);
  });

  it("clamps a client clock running behind the server (§5.3)", () => {
    expect(elapsedSeconds(STARTED_AT, startedMs - 30_000)).toBe(0);
  });

  it("treats an unparseable timestamp as zero rather than NaN", () => {
    expect(elapsedSeconds("not a date", startedMs)).toBe(0);
  });
});

describe("formatClock", () => {
  it("renders H:MM:SS", () => {
    expect(formatClock(0)).toBe("0:00:00");
    expect(formatClock(59)).toBe("0:00:59");
    expect(formatClock(3723)).toBe("1:02:03");
  });

  it("grows past a day instead of wrapping", () => {
    expect(formatClock(26 * 3600)).toBe("26:00:00");
  });
});

describe("formatApproxHours", () => {
  it("names whole hours for the stale prompt (§5.4)", () => {
    expect(formatApproxHours(19 * 3600 + 42 * 60)).toBe("19 hours");
    expect(formatApproxHours(3600)).toBe("1 hour");
  });

  it("falls back to minutes below an hour", () => {
    expect(formatApproxHours(90)).toBe("1 minute");
    expect(formatApproxHours(600)).toBe("10 minutes");
  });
});

describe("isStale", () => {
  it("is false at exactly the threshold and true past it", () => {
    const threshold = DEFAULT_MAX_TIMER_HOURS * 3600;
    expect(isStale(threshold, DEFAULT_MAX_TIMER_HOURS)).toBe(false);
    expect(isStale(threshold + 1, DEFAULT_MAX_TIMER_HOURS)).toBe(true);
  });

  it("follows the company's own threshold when one is passed", () => {
    expect(isStale(9 * 3600, 8)).toBe(true);
    expect(isStale(9 * 3600, 24)).toBe(false);
  });
});
