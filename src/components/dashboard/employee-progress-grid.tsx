import {
  byShortfall,
  type AttendanceRow,
} from "@/components/dashboard/attendance-rows";
import { EmployeeProgressCard } from "@/components/dashboard/employee-progress-card";
import {
  reportHref,
  resolveReportQuery,
} from "@/components/reports/report-params";

/**
 * Every employee's month, worst first (`SPEC.md` §9.9, §9.9.3).
 *
 * **It renders every row, and the absence of a limit is load-bearing.** The
 * card this replaced showed the worst eight and linked away for the rest, which
 * is why it carried no total: §12.2 asks that a total equal the sum of its own
 * visible line items, and a sum over eight of eleven people is a figure about
 * rows that are not on screen. `TeamProgressCard` above this grid *does* carry
 * a total, and showing everybody is what entitles it to. The trade is a longer
 * page for a large team, taken deliberately — `/reports` already renders the
 * same set as table rows, and the link to it stays for the sortable view.
 *
 * Ordering is `byShortfall`, the one place in this codebase that deliberately
 * re-sorts a SQL result: `report_by_user` returns `total_seconds desc`, which
 * puts the person who logged nothing **last**, and they are exactly who an
 * attendance surface exists to show first.
 *
 * A `<ul>` rather than a bare grid of divs, because it is a list of people and
 * the cards are its items; `EmployeeProgressCard` renders the `<li>`.
 */
export function EmployeeProgressGrid({
  rows,
  runningUserIds,
  from,
  to,
  emptyLabel,
  label,
}: {
  rows: AttendanceRow[];
  /** Who has a timer going, from `listRunningTimers()` — already on the page. */
  runningUserIds: ReadonlySet<string>;
  /** The range each card's `/reports` link should open on. */
  from: string;
  to: string;
  emptyLabel: string;
  /** Names the list for a screen reader. */
  label: string;
}) {
  if (rows.length === 0) {
    return <p className="text-muted-foreground text-sm">{emptyLabel}</p>;
  }

  // Built once here rather than per card: every "see this person" link is the
  // same query with one parameter swapped, and `reportHref` is the only
  // sanctioned way to build one — a hand-assembled string would silently lose a
  // report parameter the day a seventh is added.
  const baseQuery = resolveReportQuery({}, { from, to });

  return (
    <ul
      role="list"
      aria-label={label}
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
    >
      {byShortfall(rows).map((row) => (
        <EmployeeProgressCard
          key={row.userId}
          row={row}
          running={runningUserIds.has(row.userId)}
          href={reportHref(baseQuery, { grouping: "user", userId: row.userId })}
        />
      ))}
    </ul>
  );
}
