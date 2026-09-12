import { ProgressMeter } from "@/components/charts/progress-meter";
import { differenceSeconds } from "@/components/reports/report-expected";
// The one definition of the headline-figure face, shared with the report
// header and the tiles on both dashboards.
import { FIGURE_CLASS } from "@/components/structure/stat-tile";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatSecondsHms } from "@/lib/reports/csv";
import { cn } from "@/lib/utils";

/**
 * Worked against expected, month to date (`SPEC.md` §9.8).
 *
 * Presentational only: it takes integer seconds and renders them. The bar is
 * `ProgressMeter`, which is where the two guards that used to live here — the
 * 100% clamp and the zero-target case — now are; `/overview`'s attendance card
 * has one per person and must not re-derive them. The fetching is the page's
 * job, and the worked figure it is handed comes from
 * `report_summary` — the same aggregate `/reports` reads — because a dashboard
 * number that could disagree with the report behind it would be worse than no
 * number at all.
 *
 * Two captions here are load-bearing rather than decorative, and both exist
 * because the figures are *correct* in a way that reads wrong:
 *
 *   * **Today is counted whole** (§9.8). At 9am on a working day the expected
 *     figure already includes the whole day, so an employee who is exactly on
 *     schedule still reads as a day behind. Saying so costs a line; making the
 *     arithmetic prorate instead would make the number move while you look at
 *     it and make two people's figures incomparable unless you also knew when
 *     each was rendered.
 *   * **A running timer counts for nothing** (§9.4). `report_summary` sums
 *     closed entries only, so someone four hours into an unstopped timer sees a
 *     figure that has not moved since this morning. Unexplained, that looks
 *     like lost work.
 */

const TARGET_CLASS = "font-mono text-base tabular-nums text-muted-foreground";

export function MonthProgressCard({
  workedSeconds,
  expectedSeconds,
  runningCount,
  monthLabel,
}: {
  workedSeconds: number;
  /**
   * `null` when this person has no schedule on any project — a real state, and
   * not the same as zero. Zero expected means somebody set a schedule of no
   * hours; null means nobody has said anything yet, and the card must not
   * imply the employee is spectacularly ahead of a target that does not exist.
   */
  expectedSeconds: number | null;
  runningCount: number;
  monthLabel: string;
}) {
  const hasTarget = expectedSeconds !== null;
  const difference = differenceSeconds(workedSeconds, expectedSeconds) ?? 0;
  const isBehind = difference < 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>This month</CardTitle>
        <CardDescription>{monthLabel}</CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className={FIGURE_CLASS}>
            {formatSecondsHms(workedSeconds)}
          </span>
          {hasTarget ? (
            <span className={TARGET_CLASS}>
              of {formatSecondsHms(expectedSeconds)}
            </span>
          ) : null}
        </div>

        {hasTarget ? (
          <>
            <ProgressMeter
              valueSeconds={workedSeconds}
              targetSeconds={expectedSeconds}
              ariaLabel="Hours worked against hours expected this month"
            />

            <p className="text-sm">
              <span
                className={cn(
                  "font-mono tabular-nums",
                  isBehind ? "text-foreground" : "text-primary",
                )}
              >
                {formatSecondsHms(Math.abs(difference))}
              </span>{" "}
              <span className="text-muted-foreground">
                {difference === 0
                  ? "difference — exactly on target"
                  : isBehind
                    ? "behind the expected hours so far"
                    : "ahead of the expected hours so far"}
              </span>
            </p>
          </>
        ) : (
          <p className="text-muted-foreground text-sm">
            No expected hours have been set for your projects yet, so there is
            nothing to compare this against. An admin sets them per project.
          </p>
        )}

        <div className="text-muted-foreground flex flex-col gap-1 text-xs">
          {hasTarget ? (
            <p>Expected hours count today in full, however early it is.</p>
          ) : null}
          {runningCount > 0 ? (
            <p>
              A timer is running now and is not counted yet — time is added when
              you stop it.
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
