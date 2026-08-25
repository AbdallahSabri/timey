import { describe, expect, it } from "vitest";

import {
  describeReport,
  NO_CLIENT_CELL,
  NO_CLIENT_GROUP,
  totalsOf,
  UNKNOWN_PERSON,
  UNKNOWN_PROJECT,
  UNKNOWN_TASK,
} from "@/components/reports/report-rows";

describe("describeReport — readable labels", () => {
  it("keeps the CSV's column order for each grouping", () => {
    // `lib/reports/columns.ts` puts the project before the task and the client
    // after the project. Screen and file are read the same way round.
    expect(
      describeReport({ grouping: "task", rows: [] }).labelHeaders,
    ).toStrictEqual(["Project", "Task"]);
    expect(
      describeReport({ grouping: "user-project", rows: [] }).labelHeaders,
    ).toStrictEqual(["Person", "Project", "Client"]);
  });

  it("sorts a day by its ISO value while showing a readable date", () => {
    const model = describeReport({
      grouping: "day",
      rows: [{ day: "2026-08-25", entryCount: 2, totalSeconds: 3600 }],
    });

    expect(model.rows[0]?.labels[0]?.text).toContain("25 Aug 2026");
    expect(model.rows[0]?.labels[0]?.sortKey).toBe("2026-08-25");
    expect(model.rows[0]?.labels[0]?.muted).toBe(false);
  });

  it("carries the entry count and integer seconds through untouched", () => {
    const model = describeReport({
      grouping: "user",
      rows: [
        { userId: "u1", userName: "Ada", entryCount: 3, totalSeconds: 22450 },
      ],
    });

    expect(model.rows[0]).toMatchObject({
      key: "u1",
      entryCount: 3,
      totalSeconds: 22450,
    });
  });
});

describe("describeReport — labels the caller cannot read", () => {
  // Every case below is reachable in production, not hypothetical: §2.3 keeps a
  // removed employee's entries while §3.6.1 takes away their `projects` SELECT,
  // so their own hours come back with no project label at all.

  it("names a missing project rather than rendering nothing", () => {
    const model = describeReport({
      grouping: "project",
      rows: [
        {
          projectId: "p1",
          projectName: null,
          clientId: null,
          clientName: null,
          entryCount: 1,
          totalSeconds: 22450,
        },
      ],
    });

    expect(model.rows[0]?.labels[0]).toMatchObject({
      text: UNKNOWN_PROJECT,
      muted: true,
    });
    // The hours survive the missing label — the row is never dropped.
    expect(model.rows[0]?.totalSeconds).toBe(22450);
  });

  it("names a missing task and a missing person", () => {
    const tasks = describeReport({
      grouping: "task",
      rows: [
        {
          taskId: "t1",
          taskName: null,
          projectId: "p1",
          projectName: null,
          entryCount: 1,
          totalSeconds: 60,
        },
      ],
    });

    expect(tasks.rows[0]?.labels.map((label) => label.text)).toStrictEqual([
      UNKNOWN_PROJECT,
      UNKNOWN_TASK,
    ]);

    const users = describeReport({
      grouping: "user",
      rows: [{ userId: "u1", userName: null, entryCount: 1, totalSeconds: 60 }],
    });

    expect(users.rows[0]?.labels[0]?.text).toBe(UNKNOWN_PERSON);
  });

  it("renders an absent client as an absence, never as 'Internal'", () => {
    // The null client mixes genuinely internal projects (§3.4) with projects
    // whose client this caller cannot read. Calling it "Internal" would be a
    // confident claim about the second kind.
    const byClient = describeReport({
      grouping: "client",
      rows: [
        { clientId: null, clientName: null, entryCount: 4, totalSeconds: 7200 },
      ],
    });

    expect(byClient.rows[0]?.labels[0]?.text).toBe(NO_CLIENT_GROUP);
    expect(byClient.rows[0]?.labels[0]?.text).not.toMatch(/internal/i);
    expect(byClient.rows[0]?.key).toBe("no-client");

    const byProject = describeReport({
      grouping: "project",
      rows: [
        {
          projectId: "p1",
          projectName: "Internal tooling",
          clientId: null,
          clientName: null,
          entryCount: 1,
          totalSeconds: 60,
        },
      ],
    });

    // As an attribute of another row it is a dash, not a sentence.
    expect(byProject.rows[0]?.labels[1]?.text).toBe(NO_CLIENT_CELL);
  });

  it("never renders the string 'null' anywhere", () => {
    const model = describeReport({
      grouping: "user-project",
      rows: [
        {
          userId: "u1",
          userName: null,
          projectId: "p1",
          projectName: null,
          clientId: null,
          clientName: null,
          entryCount: 1,
          totalSeconds: 60,
        },
      ],
    });

    for (const label of model.rows[0]?.labels ?? []) {
      expect(label.text).not.toBe("null");
      expect(label.text.length).toBeGreaterThan(0);
      expect(label.muted).toBe(true);
    }
  });
});

describe("totalsOf", () => {
  it("sums integer seconds, so the footer matches the header", () => {
    const totals = totalsOf([
      { key: "a", labels: [], entryCount: 2, totalSeconds: 3661 },
      { key: "b", labels: [], entryCount: 1, totalSeconds: 59 },
    ]);

    // §9.5 — summed as integers. Summing 1.0169 + 0.0164 hours and multiplying
    // back is how a total stops matching its own line items.
    expect(totals).toStrictEqual({ entryCount: 3, totalSeconds: 3720 });
  });

  it("is zero for no rows", () => {
    expect(totalsOf([])).toStrictEqual({ entryCount: 0, totalSeconds: 0 });
  });
});
