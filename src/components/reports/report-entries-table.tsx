import { formatDayShort } from "@/components/reports/report-days";
import {
  NO_CLIENT_CELL,
  UNKNOWN_PERSON,
  UNKNOWN_PROJECT,
  UNKNOWN_TASK,
} from "@/components/reports/report-rows";
import { DataCard, DataCardList } from "@/components/structure/data-card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ReportEntryRow } from "@/lib/actions/reports";
import { formatSecondsHms } from "@/lib/reports/csv";

/**
 * `"2026-09-01T09:02:11"` → `"09:02"`.
 *
 * A fixed-width slice and not a `Date`, for the reason `lib/reports/columns.ts`
 * gives about the same expression: the value the action hands over is already a
 * company wall clock with no offset, so there is no zone to convert from and
 * `new Date(...)` would invent one — the server's on the first render, the
 * browser's on a hydration, which is exactly the pair that must not disagree.
 *
 * It matters more here than in a CSV. This is the *same* localisation that
 * produced `row.day`, done once in SQL, so the clock on screen can never fall on
 * a different side of midnight from the date the row is filed under. Formatting
 * the instant client-side would reintroduce that gap for every reader whose
 * machine is not set to the company's zone. Seconds are dropped because a
 * timesheet is read to the minute; the exact length is in the Duration column.
 */
function clockOf(localTimestamp: string): string {
  return localTimestamp.slice(11, 16);
}

/** What a running row shows where a closed one shows a time or a length. */
const ABSENT = "—";

/**
 * A label the caller could not read, styled as the absence it stands for.
 *
 * The wording comes from `report-rows.ts` so the two report views name the same
 * missing project the same way, and the muted italic matches `LabelCellText`
 * there for the same reason it exists there: a placeholder must not read like a
 * name.
 */
function LabelText({
  name,
  unknown,
}: {
  name: string | null;
  unknown: string;
}) {
  if (name === null) {
    return <span className="text-muted-foreground italic">{unknown}</span>;
  }

  return <>{name}</>;
}

/**
 * "In progress", in the one colour this app reserves for a timer that is still
 * going (`--live`, amber — `globals.css`).
 *
 * **Not `RunningBadge`, and the difference is the word.** That badge says
 * "Running" beside the stop button on the entry list, where the timer is
 * something you are doing. Here the row is a record, and §9.7's own language —
 * and the `Status` cell of the CSV this view exports — is "In progress", so the
 * screen and the file an admin reconciles it against say the same thing. The
 * amber treatment is deliberately identical; only the noun differs.
 */
function InProgressMarker() {
  return (
    <span className="text-live inline-flex items-center gap-1.5 text-xs font-medium">
      <span className="bg-live size-1.5 shrink-0 rounded-full" aria-hidden />
      In progress
    </span>
  );
}

/**
 * §9.7's entry list: one row per time entry, newest first, one page at a time.
 *
 * **Deliberately not a TanStack table.** `ReportDataTable` uses one because it
 * holds a complete result set — every grouping is bounded, `MAX_REPORT_DAYS`
 * caps the largest at 366 lines — so sorting a column there reorders the whole
 * answer. This is a *page* of a set the server ordered (`started_at DESC,
 * id DESC`) and may be 50 rows out of 312. A sort control over it would reorder
 * a fraction of the answer while looking like it reordered the answer, which is
 * worse than not offering one: the user would be reading "the longest entries"
 * and seeing the longest entries *on page 4*. Re-ordering the whole set is a
 * different query and belongs in the URL, not in a click handler.
 *
 * **No `TableFooter` and no total row, and this is a rule rather than an
 * omission** (§9.7, §12.2): a page of 50 out of 312 cannot carry an honest total
 * of anything, and §12.2's "report totals equal the sum of their own visible
 * line items" stays true here only because there is no total to be wrong. The
 * range's figures are in `ReportSummaryHeader` above, which comes from
 * `report_summary` — closed entries summed, running ones counted separately.
 * Anything added below these rows would be a fourth figure disagreeing with
 * those three.
 *
 * A server component: it renders props and has nothing to hold state about.
 */
export function ReportEntriesTable({
  rows,
  showPerson,
  emptyState,
}: {
  rows: ReportEntryRow[];
  /** The person column renders for an admin only — an employee's every row is their own. */
  showPerson: boolean;
  /** What to show instead of an empty grid — worded by the caller, which knows the filters. */
  emptyState: React.ReactNode;
}) {
  if (rows.length === 0) {
    return <div className="text-muted-foreground text-sm">{emptyState}</div>;
  }

  return (
    <>
      {/* Below `md` the same rows as cards — see `DataCard`. Nine columns is a
          horizontal scrub on a phone, and the project and task are what an entry
          is about, so they become the title and the rest are labelled fields. */}
      <DataCardList className="md:hidden">
        {rows.map((row) => (
          <DataCard
            key={row.id}
            title={
              <>
                <LabelText name={row.projectName} unknown={UNKNOWN_PROJECT} />
                {" · "}
                <LabelText name={row.taskName} unknown={UNKNOWN_TASK} />
              </>
            }
            meta={
              <>
                {/* Only manual rows are badged, as on the entry list: timer is
                    the default path, and a badge on nearly every row hides the
                    exception it exists to mark. */}
                {row.source === "manual" ? (
                  <Badge variant="outline">Manual</Badge>
                ) : null}
                {row.endedAt === null ? <InProgressMarker /> : null}
              </>
            }
            fields={[
              { label: "Date", value: formatDayShort(row.day) },
              ...(showPerson
                ? [
                    {
                      label: "Person",
                      value: (
                        <LabelText
                          name={row.userName}
                          unknown={UNKNOWN_PERSON}
                        />
                      ),
                    },
                  ]
                : []),
              {
                label: "Time",
                // The open end reads as an ellipsis rather than a dash: the
                // entry has no end yet, which is not the same as an end this
                // caller cannot see.
                value: `${clockOf(row.startedAt)} – ${
                  row.endedAt === null ? "…" : clockOf(row.endedAt)
                }`,
                numeric: true,
              },
              {
                label: "Duration",
                value:
                  row.durationSeconds === null
                    ? ABSENT
                    : formatSecondsHms(row.durationSeconds),
                numeric: true,
              },
              ...(row.note ? [{ label: "Note", value: row.note }] : []),
            ]}
          />
        ))}
      </DataCardList>

      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              {showPerson ? <TableHead>Person</TableHead> : null}
              <TableHead className="text-right">Start</TableHead>
              <TableHead className="text-right">End</TableHead>
              <TableHead className="text-right">Duration</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Project</TableHead>
              <TableHead>Task</TableHead>
              <TableHead>Note</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  {/* The badges ride with the date rather than with the blank
                      Duration cell, so that the first thing read on a row
                      carries everything unusual about it — the same placement
                      the entry list uses. */}
                  <span className="flex items-center gap-2">
                    {formatDayShort(row.day)}
                    {row.source === "manual" ? (
                      <Badge variant="outline">Manual</Badge>
                    ) : null}
                    {row.endedAt === null ? <InProgressMarker /> : null}
                  </span>
                </TableCell>
                {showPerson ? (
                  <TableCell>
                    <LabelText name={row.userName} unknown={UNKNOWN_PERSON} />
                  </TableCell>
                ) : null}
                <TableCell className="text-right font-mono tabular-nums">
                  {clockOf(row.startedAt)}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {row.endedAt === null ? (
                    <span className="text-muted-foreground">{ABSENT}</span>
                  ) : (
                    clockOf(row.endedAt)
                  )}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {row.durationSeconds === null ? (
                    <span className="text-muted-foreground">{ABSENT}</span>
                  ) : (
                    formatSecondsHms(row.durationSeconds)
                  )}
                </TableCell>
                <TableCell>
                  <LabelText name={row.clientName} unknown={NO_CLIENT_CELL} />
                </TableCell>
                <TableCell className="font-medium">
                  <LabelText name={row.projectName} unknown={UNKNOWN_PROJECT} />
                </TableCell>
                <TableCell>
                  <LabelText name={row.taskName} unknown={UNKNOWN_TASK} />
                </TableCell>
                {/* Truncated to keep the row one line, with the whole note on
                    the element's `title` — clipped is a rendering choice, and
                    dropping the text would be an edit to the record. */}
                <TableCell
                  className="text-muted-foreground max-w-[10rem] truncate lg:max-w-[16rem]"
                  title={row.note ?? undefined}
                >
                  {row.note ?? ABSENT}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          {/* No TableFooter. See the note above: a page cannot total a range. */}
        </Table>
      </div>
    </>
  );
}
