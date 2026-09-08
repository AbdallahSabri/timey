import { differenceSeconds } from "@/components/reports/report-expected";
import { Card, CardContent } from "@/components/ui/card";
import type { ReportSummary } from "@/lib/actions/reports";
import { formatSecondsHms } from "@/lib/reports/csv";
import { cn } from "@/lib/utils";

/** The figures are set alike, and like the running clock they echo. */
const FIGURE_CLASS =
  "font-mono text-3xl leading-none font-medium tracking-tight tabular-nums";

/**
 * §9.4's header figures, above whichever grouping is on screen.
 *
 * The point of putting them here is §12.2's check — "report totals equal the sum
 * of their own visible line items" — being answerable by looking rather than by
 * adding up a column. This number comes from `report_summary`, a separate
 * aggregate with no GROUP BY; the table's footer sums the rows the user can
 * actually see. Two independent paths to the same figure, one above the other.
 *
 * **`runningCount` is deliberately outside the total, not folded into it.** A
 * running entry contributes zero to every report (§9.4, §5.4) because its
 * duration does not exist yet — `duration_seconds` is NULL while `ended_at` is.
 * Hiding that would make a day look short for a reason nobody could see; showing
 * it as a third figure says "and this much is still in flight".
 *
 * **Expected is a fourth figure that is often absent, and its absence is the
 * point** (§9.8.1). `getReportSummary` returns a number only when the report
 * resolves to exactly one person — always for an employee, and for an admin who
 * has set the person filter — and null otherwise, including under a task filter.
 * A team-wide expected total would be a capacity figure sitting beside a worked
 * total it does not correspond to line for line, which the By person column
 * answers properly instead. So the figure is omitted rather than zeroed, for the
 * same reason the table omits its two columns.
 *
 * §9.8.2's running-timer disclosure is already carried by the third figure:
 * whenever `runningCount > 0` it reads "Not counted until stopped", in the same
 * card and at the same weight as the Expected figure it qualifies. Repeating it
 * under Expected would be two sentences for one fact.
 */
export function ReportSummaryHeader({
  summary,
  rangeLabel,
}: {
  summary: ReportSummary;
  rangeLabel: string;
}) {
  const expectedSeconds = summary.expectedSeconds;
  const difference = differenceSeconds(summary.totalSeconds, expectedSeconds);
  const behind = difference !== null && difference < 0;

  return (
    <Card>
      {/* Three figures stay on one row as they always have. A fourth would
          crush them into quarters of a phone-width card, so it pairs them two
          up first and only spreads to four where there is room. */}
      <CardContent
        className={cn(
          "grid gap-6",
          expectedSeconds === null
            ? "sm:grid-cols-3"
            : "sm:grid-cols-2 lg:grid-cols-4",
        )}
      >
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-sm">Total time</span>
          <span className={FIGURE_CLASS}>
            {formatSecondsHms(summary.totalSeconds)}
          </span>
          <span className="text-muted-foreground text-xs">{rangeLabel}</span>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-sm">Entries</span>
          <span className={FIGURE_CLASS}>{summary.entryCount}</span>
          <span className="text-muted-foreground text-xs">
            Closed entries in this range
          </span>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-sm">Running now</span>
          {/* Amber only when there is something in flight — the colour marks a
              live timer, and a zero is not one. */}
          <span
            className={cn(
              FIGURE_CLASS,
              summary.runningCount > 0 && "text-live",
            )}
          >
            {summary.runningCount}
          </span>
          <span className="text-muted-foreground text-xs">
            {summary.runningCount === 0
              ? "No timers in flight"
              : "Not counted until stopped"}
          </span>
        </div>

        {expectedSeconds === null ? null : (
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground text-sm">Expected</span>
            <span className={FIGURE_CLASS}>
              {formatSecondsHms(expectedSeconds)}
            </span>
            <span className="text-muted-foreground text-xs">
              {difference === null || difference === 0 ? (
                "Exactly on target"
              ) : (
                <>
                  {/* Ledger green for at-or-above, plain text for behind — and
                      never amber, which marks a running timer and nothing else.
                      Not `destructive` either: §9.8 counts today in full, so a
                      figure that reads short is the ordinary state of a
                      Tuesday morning rather than a fault. */}
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
        )}
      </CardContent>
    </Card>
  );
}
