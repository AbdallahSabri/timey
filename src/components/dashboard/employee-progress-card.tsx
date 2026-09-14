import Link from "next/link";

import { ProgressMeter } from "@/components/charts/progress-meter";
import type { AttendanceRow } from "@/components/dashboard/attendance-rows";
import {
  differenceSeconds,
  percentOf,
} from "@/components/reports/report-expected";
import { UNKNOWN_PERSON } from "@/components/reports/report-rows";
import { FIGURE_UNAVAILABLE } from "@/components/structure/stat-tile";
import { formatSecondsHms } from "@/lib/reports/csv";
import { cn } from "@/lib/utils";

/**
 * One employee's month, as a card (`SPEC.md` §9.9, §9.9.6).
 *
 * It replaces a row in a list, and the reason is the percentage. "44:00:00 of
 * 50:00:00" is precise and unreadable at a glance: comparing eleven people
 * means comparing eleven pairs of durations in your head. "88%" is the same
 * fact in a form you can rank by eye, which is what a dashboard is for — and
 * the exact durations stay on the card underneath, because the percentage is
 * the summary and never the record.
 *
 * **The percentage and the bar deliberately disagree above 100%** (§9.9.6).
 * `percentOf` does not clamp and `ProgressMeter` does, so somebody at 150%
 * reads "150%" over a full bar. The bar is a drawing with an end; the number is
 * not. Said here because the mismatch looks like a bug to anyone who sees it
 * before reading `percentOf`.
 *
 * Presentational and server-rendered: it takes integer seconds and formats
 * them, and does no arithmetic that is not in a shared helper.
 */
export function EmployeeProgressCard({
  row,
  running,
  href,
}: {
  row: AttendanceRow;
  /**
   * This person has a timer going right now. The only amber on the card, and
   * only ever a running timer (`CLAUDE.md`) — it is also the card's own answer
   * to §9.9.4's disclosure: their figure is short *because* something is still
   * in flight.
   */
  running: boolean;
  /** Their own row in `/reports`, built by the caller with `reportHref`. */
  href: string;
}) {
  const name = row.userName ?? UNKNOWN_PERSON;
  const percent = percentOf(row.totalSeconds, row.expectedSeconds);
  const difference = differenceSeconds(row.totalSeconds, row.expectedSeconds);
  const behind = difference !== null && difference < 0;

  return (
    <li className="ring-foreground/10 bg-card flex flex-col gap-2 rounded-xl p-3 ring-1">
      <div className="flex items-start justify-between gap-2">
        <Link
          href={href}
          className="focus-visible:ring-ring/50 min-w-0 rounded-sm text-sm font-medium hover:underline focus-visible:ring-3 focus-visible:outline-none"
        >
          <span
            className={cn(
              "block truncate",
              row.userName === null && "text-muted-foreground italic",
            )}
          >
            {name}
          </span>
        </Link>

        {running ? (
          <span className="text-live inline-flex shrink-0 items-center gap-1 text-xs font-medium">
            <span className="bg-live size-1.5 rounded-full" aria-hidden />
            Running
          </span>
        ) : null}
      </div>

      <div className="flex items-baseline gap-2">
        {/* `—` rather than `0%` when nobody set a target: a zero here would
            claim they achieved none of something asked of them (§9.9.6). */}
        <span className="font-mono text-2xl leading-none font-medium tracking-tight tabular-nums">
          {percent === null ? FIGURE_UNAVAILABLE : `${percent}%`}
        </span>
      </div>

      {/* `percent === null` rather than `row.expectedSeconds` decides the
          target, and the difference matters: `ProgressMeter` reads a **zero**
          target as 100% — "nothing was asked and nothing is missing", which is
          right for `MonthProgressCard`'s deliberate zero-hour schedule. Here a
          zero means nobody set hours at all, so a full bar would announce a met
          target directly above a `—` saying there is no target. One predicate
          drives both (§9.9.6). */}
      <ProgressMeter
        valueSeconds={row.totalSeconds}
        targetSeconds={percent === null ? null : row.expectedSeconds}
        ariaLabel={`${name}: hours worked against hours expected`}
      />

      <div className="flex flex-col gap-0.5">
        <span className="font-mono text-xs tabular-nums">
          {formatSecondsHms(row.totalSeconds)}
          {/* `percent` decides this too, not `expectedSeconds !== null`. A zero
              target would otherwise render "18:00:00 of 0:00:00" directly above
              "No expected hours set" — two readings of the same fact, one of
              which states a target that was never set. One predicate governs
              the figure, the bar and this. */}
          {percent === null ? null : (
            <span className="text-muted-foreground">
              {" of "}
              {formatSecondsHms(row.expectedSeconds ?? 0)}
            </span>
          )}
        </span>

        <span className="text-muted-foreground text-xs">
          {/* Three states, and the third is not a number. §9.8.2's
              omit-rather-than-zero rule, in words this time. */}
          {difference === null || percent === null ? (
            "No expected hours set"
          ) : difference === 0 ? (
            "Exactly on target"
          ) : (
            <>
              {/* Ledger green at-or-above, plain text behind. Never amber —
                  that marks a running timer — and never `destructive`: §9.8
                  counts today in full, so reading short is the ordinary state
                  of a Tuesday morning, not a fault. */}
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
      </div>
    </li>
  );
}
