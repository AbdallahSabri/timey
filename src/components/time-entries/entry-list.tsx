import { EntryCorrectionActions } from "@/components/corrections/entry-correction-actions";
import { DataCard, DataCardList } from "@/components/structure/data-card";
import { formatClock } from "@/components/time-entries/elapsed";
import { formatStartedAt } from "@/components/time-entries/format-entry";
import { RunningBadge } from "@/components/time-entries/running-badge";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Project } from "@/lib/actions/projects";
import type { TimeEntryWithLabels } from "@/lib/actions/time-entries";

/**
 * The signed-in user's own recent entries — a work log, not a report. §9's
 * groupings, date ranges and company-local day buckets are not this table's
 * business, and **this table still computes no total at all**: it is the last
 * N rows rather than a range, so any figure under it would be a total of an
 * arbitrary window, and §9.4 excludes running entries from every sum anyway.
 * The cheapest way to honour both is to sum nothing.
 *
 * **That is not the same as "the dashboard has no totals".** §9.8's month card
 * sits above this list and does show worked against expected — but it is a
 * *report*, reading `report_summary` over an explicit company-local range,
 * which is the sanctioned path (§9.8.1). The rule this comment records is that
 * a total must come from a range someone chose, not from however many rows
 * happen to be on screen; the card obeys it and this table has no range to
 * obey it with.
 *
 * **No row is editable and none should become so.** §7.1 allows an employee to
 * edit the note on their own entry and nothing else once it closes; times on a
 * closed entry go through a correction request, refused at the database rather
 * than merely hidden here (§7.2). An edit control on these rows would be a
 * control whose only outcome is a permission error.
 *
 * Phase 7 adds a menu to closed rows and does not weaken that rule by a word:
 * every item on it either files a request for somebody else to decide, or — for
 * an admin — calls `admin_edit_entry()`, which is a different mechanism with its
 * own audit trail (§7.4), not this table's UPDATE policy relaxed. Running rows
 * get no menu at all; their controls are stop and discard, on the card above.
 *
 * A row carrying a pending request is badged rather than locked. The request
 * changes nothing until it is approved, so the entry below it is still the
 * truth — and a row that silently refused a second request would hide the first
 * one instead of explaining it.
 *
 * A label reads "—" when the project or task embed came back null: an employee
 * removed from a project keeps their entries (§2.3) but loses SELECT on the
 * project row, so their own history can legitimately arrive without a name.
 *
 * **Only manual rows are badged.** `entry_source` is the difference between a
 * measurement and an assertion (§5.3), and it is worth seeing — but a "Timer"
 * badge on nearly every row would be noise that hides the exception it exists to
 * mark. Timer-sourced is the unmarked default, the way it is the default path.
 */
export function EntryList({
  entries,
  timezone,
  projects,
  canAdminEdit,
  pendingCorrectionEntryIds,
}: {
  entries: TimeEntryWithLabels[];
  timezone: string | null;
  /** Offered as the destination of a proposed move; already RLS-scoped. */
  projects: Project[];
  /**
   * §7.4's direct-edit path, shown only to an admin. A convenience and not the
   * gate: `admin_edit_entry()` calls `is_admin()` itself, and an employee who
   * reached the RPC would be refused there.
   */
  canAdminEdit: boolean;
  pendingCorrectionEntryIds: string[];
}) {
  if (entries.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Nothing logged yet. Start a timer above and it will show up here.
      </p>
    );
  }

  const pending = new Set(pendingCorrectionEntryIds);

  return (
    <>
      {/* Below `md` the same rows, restated as cards — see `DataCard`. The
          project and task are the identity of an entry, so they lead; the
          duration is what you came to read, so it is the one numeric field. */}
      <DataCardList className="md:hidden">
        {entries.map((entry) => (
          <DataCard
            key={entry.id}
            title={`${entry.project?.name ?? "—"} · ${entry.task?.name ?? "—"}`}
            meta={
              <>
                {entry.source === "manual" ? (
                  <Badge variant="outline">Manual</Badge>
                ) : null}
                {pending.has(entry.id) ? (
                  <Badge variant="secondary">Correction pending</Badge>
                ) : null}
              </>
            }
            action={
              <EntryCorrectionActions
                entry={entry}
                projects={projects}
                timezone={timezone}
                canAdminEdit={canAdminEdit}
              />
            }
            fields={[
              {
                label: "Started",
                value: formatStartedAt(entry.startedAt, timezone),
                numeric: true,
              },
              {
                label: "Duration",
                value:
                  entry.durationSeconds === null ? (
                    <RunningBadge />
                  ) : (
                    formatClock(entry.durationSeconds)
                  ),
                numeric: entry.durationSeconds !== null,
              },
              ...(entry.note ? [{ label: "Note", value: entry.note }] : []),
            ]}
          />
        ))}
      </DataCardList>

      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Started</TableHead>
              <TableHead>Project</TableHead>
              <TableHead>Task</TableHead>
              <TableHead>Note</TableHead>
              <TableHead className="text-right">Duration</TableHead>
              <TableHead className="w-12">
                <span className="sr-only">Corrections</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell className="whitespace-nowrap">
                  <span className="flex items-center gap-2">
                    <span className="font-mono tabular-nums">
                      {formatStartedAt(entry.startedAt, timezone)}
                    </span>
                    {entry.source === "manual" ? (
                      <Badge variant="outline">Manual</Badge>
                    ) : null}
                    {pending.has(entry.id) ? (
                      <Badge variant="secondary">Correction pending</Badge>
                    ) : null}
                  </span>
                </TableCell>
                <TableCell className="font-medium">
                  {entry.project?.name ?? "—"}
                </TableCell>
                <TableCell>{entry.task?.name ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground max-w-[10rem] truncate lg:max-w-[16rem]">
                  {entry.note ?? "—"}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {entry.durationSeconds === null ? (
                    <RunningBadge />
                  ) : (
                    formatClock(entry.durationSeconds)
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <EntryCorrectionActions
                    entry={entry}
                    projects={projects}
                    timezone={timezone}
                    canAdminEdit={canAdminEdit}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
