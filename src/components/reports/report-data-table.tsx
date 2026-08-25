"use client";

import {
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon } from "lucide-react";
import { useMemo, type ReactNode } from "react";

import {
  totalsOf,
  type ReportCell,
  type ReportRow,
  type ReportTableModel,
} from "@/components/reports/report-rows";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatSecondsHms } from "@/lib/reports/csv";
import { cn } from "@/lib/utils";

/**
 * The §9.3 groupings, rendered as one sortable grid.
 *
 * **Sorting is the only interactive feature registered**, and in TanStack v9
 * that is a literal statement: features are opted into one at a time, so
 * pagination, column visibility and filtering do not exist on this table rather
 * than existing and being switched off. Nothing here needs them — a grouping
 * over one company's timesheet is tens of rows, the date range *is* the filter,
 * and `MAX_REPORT_DAYS` already caps a by-day report at 366 lines. Every row
 * being on screen is also what makes the footer honest: it is the sum of the
 * visible line items (§12.2), not of a page of them.
 *
 * The server already sorts each grouping sensibly (day ascending, everything
 * else by label), so no initial sort is imposed — clicking a header is an
 * override, not the first ordering anyone sees.
 */
const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
});

const helper = createColumnHelper<typeof features, ReportRow>();

/** Right-aligned and tabular; the two columns that are numbers, not names. */
const NUMERIC_COLUMN_IDS = new Set(["entries", "duration"]);

function LabelCellText({ cell }: { cell: ReportCell | undefined }) {
  if (!cell) {
    return null;
  }

  // A placeholder is styled as the absence it stands for. §7 elsewhere in this
  // app renders an unreadable label as a muted "—"; the words differ here
  // because a report row has to say *what* is unknown, but the visual weight is
  // the same — it must not read like a name.
  return (
    <span className={cn(cell.muted && "text-muted-foreground italic")}>
      {cell.text}
    </span>
  );
}

export function ReportDataTable({
  model,
  emptyState,
}: {
  model: ReportTableModel;
  /** What to show instead of an empty grid — worded by the caller, which knows the filters. */
  emptyState: ReactNode;
}) {
  const { labelHeaders, rows } = model;

  const columns = useMemo(
    () =>
      helper.columns([
        ...labelHeaders.map((header, index) =>
          helper.accessor(
            (row: ReportRow) => row.labels[index]?.sortKey ?? "",
            {
              id: `label-${index}`,
              header,
              cell: (context) => (
                <LabelCellText cell={context.row.original.labels[index]} />
              ),
            },
          ),
        ),
        helper.accessor((row: ReportRow) => row.entryCount, {
          id: "entries",
          header: "Entries",
          cell: (context) => context.row.original.entryCount,
        }),
        helper.accessor((row: ReportRow) => row.totalSeconds, {
          id: "duration",
          header: "Duration",
          // §9.5 — summed as integer seconds all the way here, formatted only
          // at the edge, by the same function the CSV uses.
          cell: (context) =>
            formatSecondsHms(context.row.original.totalSeconds),
        }),
      ]),
    [labelHeaders],
  );

  const table = useTable({ features, columns, data: rows });

  if (rows.length === 0) {
    return <div className="text-muted-foreground text-sm">{emptyState}</div>;
  }

  const totals = totalsOf(rows);

  return (
    <Table>
      <TableHeader>
        {table.getHeaderGroups().map((group) => (
          <TableRow key={group.id}>
            {group.headers.map((header) => {
              const sorted = header.column.getIsSorted();
              const numeric = NUMERIC_COLUMN_IDS.has(header.column.id);

              return (
                <TableHead
                  key={header.id}
                  aria-sort={
                    sorted === "asc"
                      ? "ascending"
                      : sorted === "desc"
                        ? "descending"
                        : "none"
                  }
                  className={cn(numeric && "text-right")}
                >
                  {header.isPlaceholder ? null : (
                    <button
                      type="button"
                      onClick={header.column.getToggleSortingHandler()}
                      className={cn(
                        "hover:text-foreground inline-flex items-center gap-1 transition-colors",
                        numeric && "flex-row-reverse",
                      )}
                    >
                      <table.FlexRender header={header} />
                      {sorted === "asc" ? (
                        <ArrowUpIcon className="size-3.5" aria-hidden />
                      ) : sorted === "desc" ? (
                        <ArrowDownIcon className="size-3.5" aria-hidden />
                      ) : (
                        <ChevronsUpDownIcon
                          className="size-3.5 opacity-40"
                          aria-hidden
                        />
                      )}
                    </button>
                  )}
                </TableHead>
              );
            })}
          </TableRow>
        ))}
      </TableHeader>

      <TableBody>
        {table.getRowModel().rows.map((row) => (
          <TableRow key={row.original.key}>
            {row.getAllCells().map((cell) => (
              <TableCell
                key={cell.id}
                className={cn(
                  NUMERIC_COLUMN_IDS.has(cell.column.id)
                    ? "text-right font-mono tabular-nums"
                    : "font-medium",
                )}
              >
                <table.FlexRender cell={cell} />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>

      <TableFooter>
        <TableRow>
          <TableCell colSpan={labelHeaders.length}>Total</TableCell>
          <TableCell className="text-right font-mono tabular-nums">
            {totals.entryCount}
          </TableCell>
          <TableCell className="text-right font-mono tabular-nums">
            {formatSecondsHms(totals.totalSeconds)}
          </TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  );
}
