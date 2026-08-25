import { Card, CardContent } from "@/components/ui/card";
import type { ReportSummary } from "@/lib/actions/reports";
import { formatSecondsHms } from "@/lib/reports/csv";

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
 */
export function ReportSummaryHeader({
  summary,
  rangeLabel,
}: {
  summary: ReportSummary;
  rangeLabel: string;
}) {
  return (
    <Card>
      <CardContent className="grid gap-6 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-sm">Total time</span>
          <span className="font-mono text-3xl tabular-nums">
            {formatSecondsHms(summary.totalSeconds)}
          </span>
          <span className="text-muted-foreground text-xs">{rangeLabel}</span>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-sm">Entries</span>
          <span className="font-mono text-3xl tabular-nums">
            {summary.entryCount}
          </span>
          <span className="text-muted-foreground text-xs">
            Closed entries in this range
          </span>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-sm">Running now</span>
          <span className="font-mono text-3xl tabular-nums">
            {summary.runningCount}
          </span>
          <span className="text-muted-foreground text-xs">
            {summary.runningCount === 0
              ? "No timers in flight"
              : "Not counted until stopped"}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
