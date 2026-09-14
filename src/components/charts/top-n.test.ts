import { describe, expect, it } from "vitest";

import { OTHER_LABEL, topNWithOther } from "@/components/charts/top-n";

/** Rows arrive largest-first, the way every §9.3 function orders them. */
function rows(...seconds: number[]) {
  return seconds.map((totalSeconds, index) => ({
    key: `k${index}`,
    label: `Project ${index}`,
    muted: false,
    totalSeconds,
  }));
}

describe("topNWithOther", () => {
  it("collapses a long tail into one Other row", () => {
    const result = topNWithOther(rows(90, 80, 70, 60, 50, 40, 30, 20, 10), 6);

    expect(result).toHaveLength(7);
    expect(result.slice(0, 6).map((row) => row.label)).toEqual([
      "Project 0",
      "Project 1",
      "Project 2",
      "Project 3",
      "Project 4",
      "Project 5",
    ]);
    expect(result[6]?.label).toBe(`${OTHER_LABEL} (3)`);
  });

  it("gives Other exactly the tail's seconds", () => {
    // The one arithmetic claim this function makes. 30 + 20 + 10.
    const result = topNWithOther(rows(90, 80, 70, 60, 50, 40, 30, 20, 10), 6);
    expect(result[6]?.totalSeconds).toBe(60);
  });

  it("leaves a short list completely alone", () => {
    const input = rows(90, 80, 70);
    expect(topNWithOther(input, 6)).toEqual(input);
    expect(topNWithOther([], 6)).toEqual([]);
  });

  it("shows a tail of one by its own name rather than as Other", () => {
    // Relabelling a single project "Other" hides a name and saves no space.
    const result = topNWithOther(rows(90, 80, 70, 60, 50, 40, 30), 6);

    expect(result).toHaveLength(7);
    expect(result[6]?.label).toBe("Project 6");
  });

  it("omits Other when the whole tail logged nothing", () => {
    const result = topNWithOther(rows(90, 80, 70, 60, 50, 40, 0, 0, 0), 6);

    expect(result).toHaveLength(6);
    expect(result.some((row) => row.label.startsWith(OTHER_LABEL))).toBe(false);
  });

  it("lets Other outgrow every row it collapsed", () => {
    // Ten roughly equal projects: the tail outweighs any single head row, so a
    // caller scaling bars against the largest value draws the longest bar last.
    // Honest, but it is why neither card claims "longest first".
    const result = topNWithOther(rows(10, 9, 8, 7, 6, 5, 5, 5, 5, 5), 6);
    const other = result[6];

    expect(other?.totalSeconds).toBe(20);
    expect(other?.totalSeconds).toBeGreaterThan(result[0]?.totalSeconds ?? 0);
  });

  it("marks Other as muted, so it is not drawn as a project", () => {
    const result = topNWithOther(rows(90, 80, 70, 60, 50, 40, 30, 20, 10), 6);
    expect(result[6]?.muted).toBe(true);
  });

  it("does not re-sort the rows it was given", () => {
    // SQL established the order (`total_seconds desc`, then label, then id — a
    // total order). Re-sorting here would be a second, colliding opinion.
    const input = rows(10, 90, 50);
    expect(topNWithOther(input, 6).map((row) => row.totalSeconds)).toEqual([
      10, 90, 50,
    ]);
  });
});
