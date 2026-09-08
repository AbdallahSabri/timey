import { describe, expect, test } from "vitest";

import { projectMemberScheduleSchema } from "./project-members";

/**
 * The boundary these tests defend is §9.5: hours are what a person types, and
 * integer seconds are what gets stored and compared against
 * `sum(duration_seconds)`. If the conversion is ever wrong, the failure is not
 * an error — it is an attendance figure that is quietly off, which is the one
 * kind of bug a timesheet cannot survive.
 */

function parse(input: unknown) {
  return projectMemberScheduleSchema.safeParse(input);
}

describe("expectedDailyHours → expectedDailySeconds", () => {
  test("whole hours", () => {
    const result = parse({
      expectedDailyHours: 4,
      workingDays: [1, 2, 3, 4, 5],
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data.expectedDailySeconds).toBe(14400);
  });

  test("half hours, because 7.5h contracts are ordinary", () => {
    const result = parse({ expectedDailyHours: 3.5, workingDays: [1] });
    expect(result.success && result.data.expectedDailySeconds).toBe(12600);
  });

  test("quarter hours land on an exact second", () => {
    const result = parse({ expectedDailyHours: 0.25, workingDays: [1] });
    expect(result.success && result.data.expectedDailySeconds).toBe(900);
  });

  test("a numeric input arriving as a string is accepted", () => {
    // `<input type="number">` submits a string; the form is typed
    // useForm<Input, unknown, Values> precisely because of this.
    const result = parse({ expectedDailyHours: "4", workingDays: [1] });
    expect(result.success && result.data.expectedDailySeconds).toBe(14400);
  });

  test("zero is valid and means no target", () => {
    const result = parse({ expectedDailyHours: 0, workingDays: [1] });
    expect(result.success && result.data.expectedDailySeconds).toBe(0);
  });

  test("a blank field is refused rather than coerced to zero", () => {
    // z.coerce would make "" into 0 — a *valid* schedule meaning "no target" —
    // so an untouched field would silently clear one.
    expect(parse({ expectedDailyHours: "", workingDays: [1] }).success).toBe(
      false,
    );
  });

  test("negative and over-24 are refused, matching the column CHECK", () => {
    expect(parse({ expectedDailyHours: -1, workingDays: [1] }).success).toBe(
      false,
    );
    expect(parse({ expectedDailyHours: 25, workingDays: [1] }).success).toBe(
      false,
    );
  });

  test("exactly 24 is the boundary and is allowed", () => {
    const result = parse({ expectedDailyHours: 24, workingDays: [1] });
    expect(result.success && result.data.expectedDailySeconds).toBe(86400);
  });

  test("no output field is called hours while holding seconds", () => {
    const result = parse({ expectedDailyHours: 4, workingDays: [1] });
    expect(result.success && "expectedDailyHours" in result.data).toBe(false);
  });
});

describe("workingDays", () => {
  test("sorted and de-duplicated, mirroring the normalising trigger", () => {
    const result = parse({
      expectedDailyHours: 4,
      workingDays: [5, 1, 4, 1, 2],
    });
    expect(result.success && result.data.workingDays).toEqual([1, 2, 4, 5]);
  });

  test("empty is legal — no working days on this project", () => {
    const result = parse({ expectedDailyHours: 4, workingDays: [] });
    expect(result.success && result.data.workingDays).toEqual([]);
  });

  test("rejects a day outside Sunday–Saturday", () => {
    expect(parse({ expectedDailyHours: 4, workingDays: [7] }).success).toBe(
      false,
    );
    expect(parse({ expectedDailyHours: 4, workingDays: [-1] }).success).toBe(
      false,
    );
  });

  test("rejects a fractional day", () => {
    expect(parse({ expectedDailyHours: 4, workingDays: [1.5] }).success).toBe(
      false,
    );
  });

  test("rejects more than seven entries even before de-duplication", () => {
    expect(
      parse({ expectedDailyHours: 4, workingDays: [0, 1, 2, 3, 4, 5, 6, 1] })
        .success,
    ).toBe(false);
  });
});
