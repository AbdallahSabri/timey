import { ProgressMeter } from "@/components/charts/progress-meter";
import {
  byShortfall,
  type AttendanceRow,
} from "@/components/dashboard/attendance-rows";
import { differenceSeconds } from "@/components/reports/report-expected";
import { UNKNOWN_PERSON } from "@/components/reports/report-rows";
import { formatSecondsHms } from "@/lib/reports/csv";
import { cn } from "@/lib/utils";

/**
 * The team's month against what was expected of it, worst first
 * (`SPEC.md` §9.8, §9.9).
 *
 * **Every row comes from `getReportByUser`, which is already a union rather
 * than a join** (§9.8.3): `report_by_user` returns only people who logged
 * something, and `mergeExpectedByUser` appends the people who were expected to
 * work and logged nothing. Those appended rows are the whole reason an
 * attendance view exists, and they are also the ones `byShortfall` floats to
 * the top — a person with a zero total sorts *last* in SQL's
 * `total_seconds desc`, which is exactly backwards here.
 *
 * **It is truncated and therefore carries no total** (§12.2, `BLOCKERS.md`
 * D-16): a sum under eight of fourteen people would be a figure about rows that
 * are not on screen. The link to `/reports` is where the whole set lives, with
 * its own footer total that does sum its own visible rows.
 *
 * Presentational and server-rendered; the page fetches and the caller words the
 * §9.8.2 disclosures that go under it.
 */
export function TeamAttendanceList({
  rows,
  limit,
  emptyLabel,
}: {
  rows: AttendanceRow[];
  /** How many people fit the card. The caller says whether it truncated. */
  limit: number;
  emptyLabel: string;
}) {
  if (rows.length === 0) {
    return <p className="text-muted-foreground text-sm">{emptyLabel}</p>;
  }

  return (
    <ul role="list" className="flex flex-col gap-3">
      {byShortfall(rows)
        .slice(0, limit)
        .map((row) => {
          const difference = differenceSeconds(
            row.totalSeconds,
            row.expectedSeconds,
          );
          const behind = difference !== null && difference < 0;

          return (
            <li key={row.userId} className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span
                  className={cn(
                    "min-w-0 truncate text-sm font-medium",
                    row.userName === null && "text-muted-foreground italic",
                  )}
                >
                  {row.userName ?? UNKNOWN_PERSON}
                </span>

                <span className="font-mono text-sm tabular-nums">
                  {formatSecondsHms(row.totalSeconds)}
                  {row.expectedSeconds === null ? null : (
                    <span className="text-muted-foreground">
                      {" "}
                      of {formatSecondsHms(row.expectedSeconds)}
                    </span>
                  )}
                </span>
              </div>

              <ProgressMeter
                valueSeconds={row.totalSeconds}
                targetSeconds={row.expectedSeconds}
                ariaLabel={`${row.userName ?? UNKNOWN_PERSON}: hours worked against hours expected`}
              />

              <span className="text-muted-foreground text-xs">
                {/* Three states, and the third is not a number. Null expected
                    means nobody has set a schedule (§3.6.3) — not that zero
                    hours were asked for, which is what rendering `0:00:00`
                    here would claim (§9.8.2's omit-rather-than-zero rule). */}
                {difference === null ? (
                  "No expected hours set"
                ) : difference === 0 ? (
                  "Exactly on target"
                ) : (
                  <>
                    {/* Ledger green at-or-above, plain text behind, never
                        amber — that marks a running timer and nothing else.
                        Never `destructive` either: §9.8 counts today in full,
                        so reading short is the ordinary state of a Tuesday
                        morning. */}
                    <span
                      className={cn(
                        "font-mono tabular-nums",
                        behind ? "text-foreground" : "text-primary",
                      )}
                    >
                      {formatSecondsHms(Math.abs(difference))}
                    </span>{" "}
                    {behind ? "behind" : "ahead"}
                  </>
                )}
              </span>
            </li>
          );
        })}
    </ul>
  );
}
