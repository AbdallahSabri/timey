import { formatClock } from "@/components/time-entries/elapsed";
import { formatStartedAt } from "@/components/time-entries/format-entry";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { TimeEntryWithLabels } from "@/lib/actions/time-entries";

/**
 * The signed-in user's own recent entries — a work log, not a report. §9's
 * groupings, date ranges and company-local day buckets belong to Phase 8, and
 * this table deliberately computes no total at all: §9.4 excludes running
 * entries from every sum, and the cheapest way to honour that here is to sum
 * nothing.
 *
 * **No row is editable and none should become so.** §7.1 allows an employee to
 * edit the note on their own entry and nothing else once it closes; times on a
 * closed entry go through a correction request (Phase 7), refused at the
 * database rather than merely hidden here (§7.2). An edit control on these rows
 * would be a control whose only outcome is a permission error.
 *
 * A label reads "—" when the project or task embed came back null: an employee
 * removed from a project keeps their entries (§2.3) but loses SELECT on the
 * project row, so their own history can legitimately arrive without a name.
 */
export function EntryList({
  entries,
  timezone,
}: {
  entries: TimeEntryWithLabels[];
  timezone: string | null;
}) {
  if (entries.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Nothing logged yet. Start a timer above and it will show up here.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Started</TableHead>
          <TableHead>Project</TableHead>
          <TableHead>Task</TableHead>
          <TableHead>Note</TableHead>
          <TableHead className="text-right">Duration</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => (
          <TableRow key={entry.id}>
            <TableCell className="whitespace-nowrap">
              {formatStartedAt(entry.startedAt, timezone)}
            </TableCell>
            <TableCell className="font-medium">
              {entry.project?.name ?? "—"}
            </TableCell>
            <TableCell>{entry.task?.name ?? "—"}</TableCell>
            <TableCell className="text-muted-foreground max-w-[16rem] truncate">
              {entry.note ?? "—"}
            </TableCell>
            <TableCell className="text-right font-mono tabular-nums">
              {entry.durationSeconds === null ? (
                <Badge variant="secondary">Running</Badge>
              ) : (
                formatClock(entry.durationSeconds)
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
