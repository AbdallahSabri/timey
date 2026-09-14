import { cn } from "@/lib/utils";

/**
 * Worked against a target, as one bar (`SPEC.md` §9.8, §9.9).
 *
 * Extracted from `MonthProgressCard`, which had the only copy of this and now
 * renders through it — as does `/overview`'s attendance card, where there is
 * one per person. Both of its guards came with it, because both are about
 * telling the truth rather than about looking right:
 *
 *   * **The fill is clamped to 100%.** Somebody 30 hours over a 20-hour target
 *     would otherwise paint past the end of the track, which reads as a
 *     rendering fault rather than as a surplus. The surplus is stated in words
 *     beside the bar; the bar itself only ever shows progress to the target.
 *   * **A zero target reads full, not empty.** Nothing was asked for, so
 *     nothing is missing — and the alternative is a division by zero.
 *
 * **A null target is a third state, and it is not a meter at all.** Null means
 * nobody has set a schedule (§3.6.3). A bar that reported 100% there would
 * claim someone had met a target that does not exist — and one that reports
 * **0%** makes the same false claim inverted, which is worse, because it is the
 * one a screen reader actually announces: "hours worked against hours
 * expected, 0 percent" for somebody nobody ever gave a schedule. §9.8.2's rule
 * is to omit rather than to zero, so on null this renders an empty track with
 * **no `progressbar` role and no `aria-valuenow`** — there is no percentage to
 * report, so none is reported, and the caller's own words carry the state.
 *
 * The guard lives here rather than in each caller on purpose.
 * `MonthProgressCard` had it (`hasTarget`) and `/overview`'s attendance card
 * did not, which is exactly the drift that happens when a rule about a
 * component is enforced outside it.
 *
 * Presentational and server-rendered: integer seconds in, no state, no fetch.
 */
export function ProgressMeter({
  valueSeconds,
  targetSeconds,
  ariaLabel,
  className,
}: {
  valueSeconds: number;
  /** `null` = no target set. See above — not the same as `0`. */
  targetSeconds: number | null;
  /**
   * What the bar is measuring, in words. Required rather than optional: the
   * figures beside a meter are readable on their own, and a `progressbar` with
   * no name is a percentage of nothing to anyone not looking at the screen.
   */
  ariaLabel: string;
  className?: string;
}) {
  const track = cn(
    "bg-muted h-2 w-full overflow-hidden rounded-full",
    className,
  );

  // No target: a track and nothing else. Not a `progressbar`, because there is
  // no value for one to report — see above.
  if (targetSeconds === null) {
    return <div className={track} />;
  }

  const percent =
    targetSeconds === 0
      ? 100
      : Math.min(100, Math.max(0, (valueSeconds / targetSeconds) * 100));

  return (
    <div
      className={track}
      role="progressbar"
      aria-valuenow={Math.round(percent)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={ariaLabel}
    >
      <div
        className="bg-primary h-full rounded-full transition-[width]"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
