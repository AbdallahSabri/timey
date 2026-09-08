import { describe, expect, it } from "vitest";

import {
  differenceSeconds,
  mergeExpectedByUser,
  mergeExpectedByUserProject,
} from "@/components/reports/report-expected";
import type {
  ActualUserProjectTotals,
  ActualUserTotals,
  ExpectedForUser,
  ExpectedForUserProject,
} from "@/components/reports/report-expected";

/**
 * The case worth writing tests for is the one an inner join loses: a person
 * with a schedule and no entries. Everything else in here is bookkeeping around
 * that, and the ordering assertions exist so the rows SQL sorted keep the order
 * SQL gave them.
 */

const SARA = "11111111-1111-4111-8111-111111111111";
const OMAR = "22222222-2222-4222-8222-222222222222";
const LINA = "33333333-3333-4333-8333-333333333333";
const ACME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TOOLS = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function actual(
  userId: string,
  userName: string | null,
  totalSeconds: number,
  entryCount = 1,
): ActualUserTotals {
  return { userId, userName, entryCount, totalSeconds };
}

function expectedFor(
  userId: string,
  userName: string | null,
  expectedSeconds: number,
): ExpectedForUser {
  return { userId, userName, expectedSeconds };
}

describe("mergeExpectedByUser", () => {
  it("attaches expected to a person who logged time", () => {
    const rows = mergeExpectedByUser(
      [actual(SARA, "Sara Idris", 58540)],
      [expectedFor(SARA, "Sara Idris", 72000)],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.totalSeconds).toBe(58540);
    expect(rows[0]?.expectedSeconds).toBe(72000);
  });

  it("keeps a person who was expected to work and logged nothing", () => {
    // The union case. An inner join drops exactly the row an attendance report
    // exists to surface (SPEC.md §9.8.3).
    const rows = mergeExpectedByUser(
      [actual(SARA, "Sara Idris", 58540)],
      [
        expectedFor(SARA, "Sara Idris", 72000),
        expectedFor(LINA, "Lina Farah", 72000),
      ],
    );

    expect(rows).toHaveLength(2);
    const lina = rows.find((row) => row.userId === LINA);
    expect(lina?.totalSeconds).toBe(0);
    expect(lina?.entryCount).toBe(0);
    expect(lina?.expectedSeconds).toBe(72000);
    expect(lina?.userName).toBe("Lina Farah");
  });

  it("treats no schedule as expecting zero, not as unknown", () => {
    const rows = mergeExpectedByUser([actual(OMAR, "Omar Haddad", 3600)], []);
    expect(rows[0]?.expectedSeconds).toBe(0);
  });

  it("keeps the order SQL gave the rows that came from SQL", () => {
    // 0007 orders by total_seconds desc; re-sorting here in a second language
    // with a different collation is how the two drift apart.
    const rows = mergeExpectedByUser(
      [actual(OMAR, "Omar Haddad", 90000), actual(SARA, "Sara Idris", 58540)],
      [expectedFor(SARA, "Sara Idris", 72000)],
    );

    expect(rows.map((row) => row.userId)).toEqual([OMAR, SARA]);
  });

  it("appends the zero-worked rows after every row with hours", () => {
    const rows = mergeExpectedByUser(
      [actual(SARA, "Sara Idris", 1)],
      [expectedFor(LINA, "Lina Farah", 72000)],
    );

    expect(rows.map((row) => row.userId)).toEqual([SARA, LINA]);
  });

  it("orders the missing people by the size of what is missing", () => {
    const rows = mergeExpectedByUser(
      [],
      [
        expectedFor(SARA, "Sara Idris", 36000),
        expectedFor(LINA, "Lina Farah", 72000),
        expectedFor(OMAR, "Omar Haddad", 54000),
      ],
    );

    expect(rows.map((row) => row.userId)).toEqual([LINA, OMAR, SARA]);
  });

  it("sorts an unreadable name last among equal shortfalls", () => {
    // §2.3 keeps a removed employee's rows while §3.6.1 takes away the name.
    const rows = mergeExpectedByUser(
      [],
      [expectedFor(SARA, null, 72000), expectedFor(LINA, "Lina Farah", 72000)],
    );

    expect(rows.map((row) => row.userId)).toEqual([LINA, SARA]);
  });

  it("never emits the same person twice", () => {
    const rows = mergeExpectedByUser(
      [actual(SARA, "Sara Idris", 58540)],
      [expectedFor(SARA, "Sara Idris", 72000)],
    );

    expect(rows.filter((row) => row.userId === SARA)).toHaveLength(1);
  });

  it("mutates neither input", () => {
    const actualRows = [actual(SARA, "Sara Idris", 58540)];
    const expectedRows = [
      expectedFor(LINA, "Lina Farah", 72000),
      expectedFor(SARA, "Sara Idris", 36000),
    ];
    const snapshot = expectedRows.map((row) => row.userId);

    mergeExpectedByUser(actualRows, expectedRows);

    expect(actualRows).toHaveLength(1);
    expect(expectedRows.map((row) => row.userId)).toEqual(snapshot);
  });
});

describe("mergeExpectedByUserProject", () => {
  function actualPair(
    userId: string,
    projectId: string,
    totalSeconds: number,
  ): ActualUserProjectTotals {
    return {
      userId,
      userName: "Sara Idris",
      projectId,
      projectName: projectId === ACME ? "Acme redesign" : "Internal tools",
      clientId: null,
      clientName: null,
      entryCount: 1,
      totalSeconds,
    };
  }

  function expectedPair(
    userId: string,
    projectId: string,
    expectedSeconds: number,
  ): ExpectedForUserProject {
    return {
      userId,
      userName: "Sara Idris",
      projectId,
      projectName: projectId === ACME ? "Acme redesign" : "Internal tools",
      clientId: null,
      clientName: null,
      expectedSeconds,
    };
  }

  it("keys on the pair, so one person can appear per project", () => {
    const rows = mergeExpectedByUserProject(
      [actualPair(SARA, ACME, 44140), actualPair(SARA, TOOLS, 14400)],
      [expectedPair(SARA, ACME, 57600), expectedPair(SARA, TOOLS, 14400)],
    );

    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.projectId === ACME)?.expectedSeconds).toBe(
      57600,
    );
    expect(rows.find((row) => row.projectId === TOOLS)?.expectedSeconds).toBe(
      14400,
    );
  });

  it("adds a project the person is scheduled on but logged nothing against", () => {
    const rows = mergeExpectedByUserProject(
      [actualPair(SARA, ACME, 44140)],
      [expectedPair(SARA, ACME, 57600), expectedPair(SARA, TOOLS, 14400)],
    );

    expect(rows).toHaveLength(2);
    const tools = rows.find((row) => row.projectId === TOOLS);
    expect(tools?.totalSeconds).toBe(0);
    expect(tools?.expectedSeconds).toBe(14400);
    expect(tools?.projectName).toBe("Internal tools");
  });

  it("does not confuse the same project across two people", () => {
    const rows = mergeExpectedByUserProject(
      [actualPair(SARA, ACME, 44140)],
      [expectedPair(OMAR, ACME, 57600)],
    );

    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.userId === SARA)?.expectedSeconds).toBe(0);
    expect(rows.find((row) => row.userId === OMAR)?.totalSeconds).toBe(0);
  });
});

describe("differenceSeconds", () => {
  it("is negative when behind", () => {
    expect(differenceSeconds(58540, 72000)).toBe(-13460);
  });

  it("is positive when ahead", () => {
    expect(differenceSeconds(72940, 72000)).toBe(940);
  });

  it("is null when expected is not a meaningful quantity", () => {
    // §9.8.2: under a task filter there is no such thing as hours owed, and a
    // zero would assert that nothing was expected.
    expect(differenceSeconds(58540, null)).toBeNull();
  });
});
