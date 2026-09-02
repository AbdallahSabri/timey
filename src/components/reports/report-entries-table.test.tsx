import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ReportEntriesTable } from "@/components/reports/report-entries-table";
import {
  UNKNOWN_PROJECT,
  UNKNOWN_TASK,
} from "@/components/reports/report-rows";
import type { ReportEntryRow } from "@/lib/actions/reports";

/**
 * A closed entry, with every label readable.
 *
 * The timestamps are company wall clock and carry no offset, which is the whole
 * point of them: whatever zone this test runs in, `09:02` is what the row must
 * read.
 */
const CLOSED: ReportEntryRow = {
  id: "e1",
  day: "2026-09-01",
  startedAt: "2026-09-01T09:02:11",
  endedAt: "2026-09-01T12:32:11",
  durationSeconds: 12600,
  userId: "u1",
  userName: "Dana Reyes",
  projectId: "p1",
  projectName: "Acme Redesign",
  taskId: "t1",
  taskName: "General",
  clientId: "c1",
  clientName: "Acme",
  source: "timer",
  note: "Kickoff call",
};

const RUNNING: ReportEntryRow = {
  ...CLOSED,
  id: "e2",
  startedAt: "2026-09-01T14:00:00",
  endedAt: null,
  durationSeconds: null,
  note: null,
};

/**
 * The `md`-and-up table.
 *
 * Both shapes are in the DOM at once here: the split is `md:hidden` against
 * `hidden md:block`, which is CSS jsdom does not apply, so the cards below are
 * rendered too. Every assertion is therefore scoped to one shape or the other —
 * an unscoped `getByText` would pass on either one's copy of the same text.
 */
function table() {
  return screen.getByRole("table");
}

/** The below-`md` cards — `DataCardList` is a `ul`, one `li` per entry. */
function cards() {
  return within(screen.getByRole("list")).getAllByRole("listitem");
}

/** One card's `dt`/`dd` pairs, as the labelled fields they are rendered as. */
function fieldsOf(card: HTMLElement): Record<string, string> {
  return Object.fromEntries(
    within(card)
      .getAllByRole("term")
      .map((term) => [
        term.textContent ?? "",
        term.nextElementSibling?.textContent ?? "",
      ]),
  );
}

function bodyRows() {
  const [body] = within(table()).getAllByRole("rowgroup").slice(1);
  return within(body as HTMLElement).getAllByRole("row");
}

function cellsOf(row: HTMLElement) {
  return within(row)
    .getAllByRole("cell")
    .map((cell) => cell.textContent);
}

describe("ReportEntriesTable", () => {
  it("renders a closed row's start, end and duration", () => {
    render(
      <ReportEntriesTable
        rows={[CLOSED]}
        showPerson={false}
        emptyState="none"
      />,
    );

    // 12600s = 3:30:00, from `formatSecondsHms` — the same function the CSV and
    // the grouped tables format with, so all three read alike.
    expect(cellsOf(bodyRows()[0] as HTMLElement)).toStrictEqual([
      "1 Sept 2026",
      "09:02",
      "12:32",
      "3:30:00",
      "Acme",
      "Acme Redesign",
      "General",
      "Kickoff call",
    ]);
  });

  it("marks a running row in progress and gives it no end and no duration", () => {
    render(
      <ReportEntriesTable
        rows={[RUNNING]}
        showPerson={false}
        emptyState="none"
      />,
    );

    const cells = cellsOf(bodyRows()[0] as HTMLElement);

    // §9.7: a running entry is shown and marked, and carries neither an end nor
    // a length — `duration_seconds` is NULL until it is stopped, and a 0 here
    // would be a completed zero-length entry that sums silently and wrongly.
    expect(cells[0]).toContain("In progress");
    expect(cells[2]).toBe("—");
    expect(cells[3]).toBe("—");
    expect(within(table()).queryByText("0:00:00")).not.toBeInTheDocument();
  });

  it("names an unreadable label instead of leaving the cell blank", () => {
    render(
      <ReportEntriesTable
        rows={[{ ...CLOSED, projectName: null }]}
        showPerson={false}
        emptyState="none"
      />,
    );

    // The wording is `report-rows.ts`'s, shared with the grouped tables so the
    // same missing project is named the same way in both views.
    expect(within(table()).getByText(UNKNOWN_PROJECT)).toBeInTheDocument();
    expect(within(table()).queryByText("null")).not.toBeInTheDocument();
  });

  it("omits the person column for an employee and includes it for an admin", () => {
    const { rerender } = render(
      <ReportEntriesTable
        rows={[CLOSED]}
        showPerson={false}
        emptyState="none"
      />,
    );

    expect(
      within(table()).queryByRole("columnheader", { name: "Person" }),
    ).not.toBeInTheDocument();
    expect(within(table()).queryByText("Dana Reyes")).not.toBeInTheDocument();

    rerender(
      <ReportEntriesTable rows={[CLOSED]} showPerson emptyState="none" />,
    );

    expect(
      within(table()).getByRole("columnheader", { name: "Person" }),
    ).toBeInTheDocument();
    expect(within(table()).getByText("Dana Reyes")).toBeInTheDocument();
  });

  it("restates a closed row as a card with its range and duration", () => {
    render(
      <ReportEntriesTable
        rows={[CLOSED]}
        showPerson={false}
        emptyState="none"
      />,
    );

    // Nine columns do not fit a phone, so start and end become one Time field.
    // The clocks are the same fixed-width slice the table takes, off the same
    // offset-free wall clock — the card cannot read 10:02 where the row reads
    // 09:02.
    expect(fieldsOf(cards()[0] as HTMLElement)).toStrictEqual({
      Date: "1 Sept 2026",
      Time: "09:02 – 12:32",
      Duration: "3:30:00",
      Note: "Kickoff call",
    });
  });

  it("gives a running row's card an open end rather than a missing one", () => {
    render(
      <ReportEntriesTable
        rows={[RUNNING]}
        showPerson={false}
        emptyState="none"
      />,
    );

    const card = cards()[0] as HTMLElement;

    // The ellipsis is deliberate and is not the table's "—": this entry has no
    // end *yet*, which is a different statement from an end this caller cannot
    // see. The duration stays absent for the §9.7 reason the table's does.
    expect(within(card).getByText("In progress")).toBeInTheDocument();
    expect(fieldsOf(card).Time).toBe("14:00 – …");
    expect(fieldsOf(card).Duration).toBe("—");
    expect(within(card).queryByText("0:00:00")).not.toBeInTheDocument();
  });

  it("names an unreadable label in the card title instead of leaving it blank", () => {
    render(
      <ReportEntriesTable
        rows={[{ ...CLOSED, projectName: null, taskName: null }]}
        showPerson={false}
        emptyState="none"
      />,
    );

    const card = cards()[0] as HTMLElement;

    // The project and task are what an entry is about, so on a card they are
    // the title — and a title is exactly where a blank would read as a name
    // that is simply short.
    expect(within(card).getByText(UNKNOWN_PROJECT)).toBeInTheDocument();
    expect(within(card).getByText(UNKNOWN_TASK)).toBeInTheDocument();
    expect(within(card).queryByText("null")).not.toBeInTheDocument();
  });

  it("omits the person field on a card for an employee and includes it for an admin", () => {
    const { rerender } = render(
      <ReportEntriesTable
        rows={[CLOSED]}
        showPerson={false}
        emptyState="none"
      />,
    );

    expect(fieldsOf(cards()[0] as HTMLElement)).not.toHaveProperty("Person");
    expect(
      within(cards()[0] as HTMLElement).queryByText("Dana Reyes"),
    ).toBeNull();

    rerender(
      <ReportEntriesTable rows={[CLOSED]} showPerson emptyState="none" />,
    );

    expect(fieldsOf(cards()[0] as HTMLElement).Person).toBe("Dana Reyes");
  });

  it("carries no total row, on any page", () => {
    render(
      <ReportEntriesTable
        rows={[CLOSED, RUNNING]}
        showPerson
        emptyState="none"
      />,
    );

    // Asserted rather than merely omitted: §9.7 forbids a footer here because a
    // page of 50 rows out of 312 cannot total anything honestly, and §12.2's
    // "totals equal the sum of their own visible line items" holds only while
    // there is no total to be wrong. A future helpful footer should break this.
    expect(
      screen.queryByRole("row", { name: /total/i }),
    ).not.toBeInTheDocument();
    expect(table().querySelector("tfoot")).toBeNull();
  });

  it("explains an empty range instead of showing an empty grid", () => {
    render(
      <ReportEntriesTable
        rows={[]}
        showPerson
        emptyState="No entries in this range."
      />,
    );

    expect(screen.getByText("No entries in this range.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
