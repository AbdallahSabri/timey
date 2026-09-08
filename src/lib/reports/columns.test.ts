import { describe, expect, it } from "vitest";

import type { ReportEntryRow } from "@/lib/actions/reports";
import {
  csvForReport,
  csvForReportEntries,
  reportEntriesCsvFilename,
} from "@/lib/reports/columns";

/**
 * §9.7's detail export, which is the one CSV shape whose blank cells carry two
 * different meanings — "the label is unreadable" and "the timer is still
 * running" — and therefore the one worth pinning column by column.
 *
 * `csvForReport`'s six aggregate tables are covered through `csv.test.ts`'s
 * `toCsv` cases: they differ from each other only in which fields they read,
 * and the quoting they share is tested there once.
 */
const CLOSED: ReportEntryRow = {
  id: "3f0d3e3a-0e60-4c0e-9b0e-000000000001",
  day: "2026-09-01",
  // No offset and no `Z`: this is already a company wall clock (0013's
  // DEPARTURE 2), which is why the columns slice it rather than parse it.
  startedAt: "2026-09-01T09:02:11",
  endedAt: "2026-09-01T10:32:11",
  durationSeconds: 5_400,
  userId: "3f0d3e3a-0e60-4c0e-9b0e-000000000002",
  userName: "Dana Reyes",
  projectId: "3f0d3e3a-0e60-4c0e-9b0e-000000000003",
  projectName: "Acme Redesign",
  taskId: "3f0d3e3a-0e60-4c0e-9b0e-000000000004",
  taskName: "General",
  clientId: "3f0d3e3a-0e60-4c0e-9b0e-000000000005",
  clientName: "Acme",
  source: "timer",
  note: "kickoff",
};

const HEADER =
  "Date,User,Start,End,Status,Duration (seconds),Duration,Client,Project,Task,Source,Note";

/** The data rows of a document, with the header and the trailing CRLF removed. */
function bodyRows(csv: string): string[] {
  return csv.split("\r\n").slice(1).filter(Boolean);
}

describe("csvForReportEntries — header", () => {
  it("writes the header row in a fixed column order, even with no rows", () => {
    // Pinned exactly: the order is what a saved spreadsheet template and every
    // re-import depend on, so reordering a column is a breaking change and
    // should read as one here.
    expect(csvForReportEntries([])).toBe(`${HEADER}\r\n`);
  });
});

describe("csvForReportEntries — a closed entry", () => {
  it("writes both clocks as HH:MM and both duration columns", () => {
    const csv = csvForReportEntries([CLOSED]);

    expect(csv).toBe(
      `${HEADER}\r\n` +
        "2026-09-01,Dana Reyes,09:02,10:32,,5400,1:30:00,Acme,Acme Redesign,General,timer,kickoff\r\n",
    );
  });

  it("leaves Status empty rather than writing a word like Complete", () => {
    // Blank is the flag's "off": a spreadsheet filter on the non-blank cells of
    // this column is how someone finds every running entry.
    const cells = bodyRows(csvForReportEntries([CLOSED]))[0]?.split(",");

    expect(cells?.[4]).toBe("");
  });

  it("drops the seconds from the clock columns and keeps them in the duration", () => {
    const csv = csvForReportEntries([
      {
        ...CLOSED,
        startedAt: "2026-09-01T09:02:59",
        endedAt: "2026-09-01T10:32:04",
        durationSeconds: 5_345,
      },
    ]);

    // The exact length lives in Duration (seconds), which the database
    // computed; the clock is read to the minute (§9.5's "format at the edge").
    const cells = bodyRows(csv)[0]?.split(",");
    expect(cells?.[2]).toBe("09:02");
    expect(cells?.[3]).toBe("10:32");
    expect(cells?.[5]).toBe("5345");
    expect(cells?.[6]).toBe("1:29:05");
  });

  it("writes the day the entry started, not the day it ended", () => {
    // §5.5: a shift crossing midnight is ONE row, bucketed by its start day, so
    // Date and End can belong to different calendar days.
    const csv = csvForReportEntries([
      {
        ...CLOSED,
        day: "2026-09-01",
        startedAt: "2026-09-01T22:00:00",
        endedAt: "2026-09-02T03:00:00",
        durationSeconds: 18_000,
      },
    ]);

    const cells = bodyRows(csv)[0]?.split(",");
    expect(cells?.[0]).toBe("2026-09-01");
    expect(cells?.[2]).toBe("22:00");
    expect(cells?.[3]).toBe("03:00");
    expect(cells?.[6]).toBe("5:00:00");
  });
});

describe("csvForReportEntries — a running entry", () => {
  const RUNNING: ReportEntryRow = {
    ...CLOSED,
    endedAt: null,
    durationSeconds: null,
    note: null,
  };

  it("leaves End and both duration columns empty and marks the row in progress", () => {
    const csv = csvForReportEntries([RUNNING]);

    expect(csv).toBe(
      `${HEADER}\r\n` +
        "2026-09-01,Dana Reyes,09:02,,In progress,,,Acme,Acme Redesign,General,timer,\r\n",
    );
  });

  it("never writes a zero duration for a running entry", () => {
    // A 0 would be a completed zero-length entry, which sums silently and
    // wrongly — 0013's DEPARTURE 1 and §9.4.
    const cells = bodyRows(csvForReportEntries([RUNNING]))[0]?.split(",");

    expect(cells?.[5]).toBe("");
    expect(cells?.[6]).toBe("");
  });

  it("distinguishes a running row from a closed one only by Status, not by blankness", () => {
    // The point of the Status column: an unreadable label is also blank, so
    // emptiness alone cannot carry "in progress".
    const csv = csvForReportEntries([RUNNING, CLOSED]);
    const rows = bodyRows(csv);

    expect(rows[0]?.split(",")[4]).toBe("In progress");
    expect(rows[1]?.split(",")[4]).toBe("");
  });
});

describe("csvForReportEntries — labels the caller cannot read", () => {
  it("writes an empty cell for a label that came back null, never a placeholder", () => {
    // §2.3 keeps a removed employee's entries while §3.6.1 takes away their
    // `projects` SELECT, so their own hours arrive with no project label. A
    // string like "Unknown project" would be indistinguishable from a real name
    // in a re-imported file.
    const csv = csvForReportEntries([{ ...CLOSED, projectName: null }]);

    expect(bodyRows(csv)[0]?.split(",")[8]).toBe("");
    expect(csv).not.toMatch(/unknown/i);
    expect(csv).not.toContain("—");
  });

  it("writes an empty Client cell for an internal project without claiming it is internal", () => {
    // §3.4's nullable `projects.client_id` and an unreadable client row are
    // indistinguishable here, so neither may be asserted.
    const csv = csvForReportEntries([
      { ...CLOSED, clientId: null, clientName: null },
    ]);

    expect(bodyRows(csv)[0]?.split(",")[7]).toBe("");
    expect(csv).not.toMatch(/internal/i);
  });

  it("still writes every other cell on a row with unreadable labels", () => {
    const csv = csvForReportEntries([
      { ...CLOSED, userName: null, projectName: null, taskName: null },
    ]);

    expect(bodyRows(csv)[0]).toBe(
      "2026-09-01,,09:02,10:32,,5400,1:30:00,Acme,,,timer,kickoff",
    );
  });
});

describe("csvForReportEntries — free text", () => {
  it("quotes a note containing a comma and doubles an embedded quote", () => {
    // `csv.ts` owns the escaping; this proves a note reaches it unmangled and
    // cannot split the record into two.
    const csv = csvForReportEntries([
      { ...CLOSED, note: 'Fixed the "sync, retry" bug' },
    ]);

    expect(csv).toBe(
      `${HEADER}\r\n` +
        "2026-09-01,Dana Reyes,09:02,10:32,,5400,1:30:00,Acme,Acme Redesign,General,timer," +
        '"Fixed the ""sync, retry"" bug"\r\n',
    );
  });

  it("keeps a multi-line note inside its quoted field", () => {
    const csv = csvForReportEntries([
      { ...CLOSED, note: "line one\r\nline two" },
    ]);

    // Two records — the header and one row — not three.
    expect(csv.split("\r\n").filter(Boolean)).toHaveLength(3);
    expect(csv).toContain('"line one\r\nline two"');
  });

  it("writes the source as the database's own token", () => {
    // The column exists to be filtered on; a prettified word would not match
    // what any other query calls it (§3.7's `entry_source`).
    const csv = csvForReportEntries([{ ...CLOSED, source: "manual" }]);

    expect(bodyRows(csv)[0]?.split(",")[10]).toBe("manual");
  });
});

describe("csvForReportEntries — many rows", () => {
  it("writes one CRLF-terminated row per entry, in the order given", () => {
    const csv = csvForReportEntries([
      { ...CLOSED, id: "a", day: "2026-09-02" },
      { ...CLOSED, id: "b", day: "2026-09-01" },
    ]);

    const rows = bodyRows(csv);
    expect(rows).toHaveLength(2);
    // Newest first is the RPC's `started_at desc, id desc`; this file preserves
    // whatever order it is handed and imposes none of its own.
    expect(rows[0]?.startsWith("2026-09-02")).toBe(true);
    expect(rows[1]?.startsWith("2026-09-01")).toBe(true);
  });
});

describe("reportEntriesCsvFilename", () => {
  it("names the file for the range rather than for a grouping", () => {
    expect(reportEntriesCsvFilename("2026-08-01", "2026-08-31")).toBe(
      "timey-entries-2026-08-01-to-2026-08-31.csv",
    );
  });

  it("carries nothing that could break out of the Content-Disposition quotes", () => {
    // A property of the validated input (`reportDaySchema` matches
    // ^\d{4}-\d{2}-\d{2}$), restated here so that widening the dates without
    // revisiting the header is caught.
    const filename = reportEntriesCsvFilename("2026-08-01", "2026-08-01");

    expect(filename).toMatch(/^timey-entries-[\d-]+-to-[\d-]+\.csv$/);
    expect(filename).not.toMatch(/["\r\n;]/);
  });
});

/**
 * §9.8.1's attendance columns, which are the only cells in the aggregate
 * exports whose emptiness is a ruling rather than an unreadable label.
 */
describe("csvForReport — Expected and Difference", () => {
  const ADA = {
    userId: "3f0d3e3a-0e60-4c0e-9b0e-000000000010",
    userName: "Ada Lovelace",
    entryCount: 3,
    totalSeconds: 36_000,
  };

  it("appends both columns after the durations, matching the screen's order", () => {
    const csv = csvForReport({
      grouping: "user",
      rows: [{ ...ADA, expectedSeconds: 72_000 }],
    });

    expect(csv.split("\r\n")[0]).toBe(
      "User,Entries,Duration (seconds),Duration,Expected,Difference",
    );
  });

  it("writes a shortfall with an explicit minus, not clamped to zero", () => {
    // `formatSecondsHms` clamps negatives to "0:00:00". Handed the raw
    // difference it would export "no difference" for a ten-hour shortfall,
    // which is the one value this cell must never read as.
    const csv = csvForReport({
      grouping: "user",
      rows: [{ ...ADA, expectedSeconds: 72_000 }],
    });

    expect(bodyRows(csv)[0]).toBe(
      "Ada Lovelace,3,36000,10:00:00,20:00:00,-10:00:00",
    );
  });

  it("writes a surplus unsigned, so only one direction carries a glyph", () => {
    const csv = csvForReport({
      grouping: "user",
      rows: [{ ...ADA, expectedSeconds: 18_000 }],
    });

    expect(bodyRows(csv)[0]?.endsWith(",5:00:00,5:00:00")).toBe(true);
  });

  it("leaves both cells EMPTY under a task filter, never 0:00:00", () => {
    // §9.8.2 — null means "expected is not a meaningful quantity here", and a
    // zero in a spreadsheet is a value somebody will sum. Empty is the same
    // reading every other blank cell in this file has.
    const csv = csvForReport({
      grouping: "user",
      rows: [{ ...ADA, expectedSeconds: null }],
    });

    expect(bodyRows(csv)[0]).toBe("Ada Lovelace,3,36000,10:00:00,,");
    expect(csv).not.toContain("0:00:00,0:00:00");
  });

  it("carries the same two columns into the user x project cross-tab", () => {
    const csv = csvForReport({
      grouping: "user-project",
      rows: [
        {
          ...ADA,
          projectId: "3f0d3e3a-0e60-4c0e-9b0e-000000000011",
          projectName: "Acme Redesign",
          clientId: "3f0d3e3a-0e60-4c0e-9b0e-000000000012",
          clientName: "Acme",
          expectedSeconds: 36_000,
        },
      ],
    });

    expect(csv.split("\r\n")[0]).toBe(
      "User,Project,Client,Entries,Duration (seconds),Duration,Expected,Difference",
    );
    // Exactly on target reads as an unsigned zero, not as a blank — nothing is
    // missing here, the two figures simply agree.
    expect(bodyRows(csv)[0]?.endsWith(",10:00:00,10:00:00,0:00:00")).toBe(true);
  });
});
