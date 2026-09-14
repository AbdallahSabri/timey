import { ProgressMeter } from "@/components/charts/progress-meter";
import { percentOf } from "@/components/reports/report-expected";
import {
  FIGURE_CLASS,
  FIGURE_UNAVAILABLE,
} from "@/components/structure/stat-tile";
import { formatSecondsHms } from "@/lib/reports/csv";

/**
 * The scheduled team against what it owed, over the range (`SPEC.md` §9.9.3).
 *
 * **Both figures cover the same people, and neither is the company's total.**
 * They are summed by `teamTotals` over the employee cards rendered beneath —
 * legitimate under §9.9.1 because those line items are all on screen, and
 * required by §12.2 for the same reason — and they deliberately exclude anybody
 * with no schedule. A percentage is a ratio, so its two halves must describe
 * one population: pairing `report_summary`'s company-wide worked total with an
 * expected figure only scheduled people contribute to would let a contractor
 * with no target push the team past 100% while every individual card sat below
 * it.
 *
 * The company-wide worked total is a different claim and keeps its own place —
 * the "Hours this month" tile above, from `report_summary`, §9.8.1's sanctioned
 * source. When somebody has no schedule the two figures differ by exactly their
 * hours, and the card says how many people that is.
 *
 * `expectedSeconds` is `null` when nobody has a schedule at all, which is a
 * first-run state this card sits directly beneath the setup card for. One
 * predicate then governs the share, the meter and the target line together
 * (§9.9.6) — a `—` above a full bar, or above "of 0:00:00", is the same lie
 * told twice.
 *
 * Carries §9.9.4's disclosures, because it pairs worked with expected.
 */
export function TeamProgressCard({
  workedSeconds,
  expectedSeconds,
  counts,
  rangeLabel,
  runningCount,
}: {
  /** Worked by the people who have a target — not the company's total. */
  workedSeconds: number;
  /** `null` when nobody has a schedule at all. Not zero; see `teamTotals`. */
  expectedSeconds: number | null;
  counts: {
    behind: number;
    ahead: number;
    onTarget: number;
    noTarget: number;
  };
  rangeLabel: string;
  /** From `listRunningTimers()`, the page's single source for "is anything running". */
  runningCount: number;
}) {
  const percent = percentOf(workedSeconds, expectedSeconds);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-sm">
            The team, {rangeLabel}
          </span>
          <span className={FIGURE_CLASS}>
            {percent === null ? FIGURE_UNAVAILABLE : `${percent}%`}
          </span>
          <span className="font-mono text-xs tabular-nums">
            {formatSecondsHms(workedSeconds)}
            {/* Governed by `percent`, not by `expectedSeconds !== null`: a
                target of zero would print "of 0:00:00" under a `—`, stating a
                target nobody set (§9.9.6). */}
            {percent === null ? null : (
              <span className="text-muted-foreground">
                {" of "}
                {formatSecondsHms(expectedSeconds ?? 0)}
              </span>
            )}
          </span>
        </div>

        {/* Counts rather than another duration: "9 behind" is the number an
            admin acts on, and it is the same partition the cards below draw.
            Plain text, because "9 behind" already reads correctly in order —
            a `dl` here would need the value before its own label and buy
            nothing a sentence does not. */}
        <div className="text-muted-foreground flex flex-wrap gap-x-5 gap-y-1 text-xs">
          <Count label="behind" value={counts.behind} />
          <Count label="on target" value={counts.onTarget} />
          <Count label="ahead" value={counts.ahead} />
          {counts.noTarget > 0 ? (
            <Count label="with no hours set" value={counts.noTarget} />
          ) : null}
        </div>
      </div>

      {/* A bare track, with no value announced, whenever there is no honest
          percentage to announce — nobody has hours set, or the worked figure
          could not be read. `ProgressMeter` refuses to report a number for a
          null target, which is the same rule §9.9.6 gives the text above. */}
      <ProgressMeter
        valueSeconds={workedSeconds}
        targetSeconds={percent === null ? null : expectedSeconds}
        ariaLabel={`The team: hours worked against hours expected, ${rangeLabel}`}
      />

      <div className="text-muted-foreground flex flex-col gap-1 text-xs">
        <p>Expected hours count today in full, however early it is.</p>
        {runningCount > 0 ? (
          <p>
            {runningCount === 1
              ? "One timer is running now and is not counted yet."
              : `${runningCount} timers are running now and are not counted yet.`}
          </p>
        ) : null}
        {counts.noTarget > 0 ? (
          <p>
            {counts.noTarget === 1
              ? "One person has no expected hours set, so neither their hours nor a target are in these figures."
              : `${counts.noTarget} people have no expected hours set, so neither their hours nor a target are in these figures.`}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <span className="flex items-baseline gap-1">
      <span className="text-foreground font-mono font-medium tabular-nums">
        {value}
      </span>
      {label}
    </span>
  );
}
