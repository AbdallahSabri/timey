import { formatSecondsHms } from "@/lib/reports/csv";
import { cn } from "@/lib/utils";

/**
 * Where the time went — a labelled row per bucket, longest first
 * (`SPEC.md` §9.9).
 *
 * **Bars rather than a pie, deliberately.** A pie at phone width needs either
 * a legend (which moves every label away from the slice it names) or leader
 * lines (which collide), and it makes six similar values impossible to rank by
 * eye. A horizontal bar keeps the name, the bar and the exact duration on one
 * line at every width, and ranking is what this card is for.
 *
 * **It renders no total, and that is a rule** (§12.2, `BLOCKERS.md` D-16). The
 * list is usually truncated — `topNWithOther` collapses the tail — and a sum
 * under a truncated list is either wrong or silently about rows that are not on
 * screen. The range's total is a `StatTile` elsewhere on the page, from
 * `report_summary`, which is the sanctioned source (§9.8.1).
 *
 * Bars are scaled against the **largest row**, not against the total, so the
 * top row always fills the track. Scaling by the total would leave every bar
 * short whenever the work is evenly spread, which reads as "nothing much
 * happened" rather than as "it was spread evenly".
 *
 * Rendered as a `<dl>` so each duration is programmatically tied to the label
 * it belongs to, the way `DataCard` does it — not merely sitting next to it.
 *
 * Presentational and server-rendered.
 */

/** The colour ramp, walked in order. Green through amber — `globals.css`. */
const BAR_COLOURS = [
  "bg-chart-1",
  "bg-chart-2",
  "bg-chart-3",
  "bg-chart-4",
  "bg-chart-5",
] as const;

/**
 * What a row the caller could not name is drawn in.
 *
 * Neutral rather than the next colour in the ramp, and it covers two different
 * absences on purpose: a project whose name RLS hid (`report-rows.ts`'s
 * `UNKNOWN_PROJECT`) and `topNWithOther`'s collapsed tail. Neither is a project
 * you could click through to, and giving either a project's colour would claim
 * it was one.
 */
const MUTED_COLOUR = "bg-muted-foreground/30";

export type ProportionRow = {
  key: string;
  label: string;
  totalSeconds: number;
  /** A placeholder standing in for a name, not a name. Drawn neutral, set italic. */
  muted?: boolean;
};

export function ProportionBarList({
  rows,
  maxSeconds,
  emptyLabel,
}: {
  rows: ProportionRow[];
  /**
   * The value a full-width bar represents — the largest row's total. The
   * caller's decision, so the same reasoning as `DayBarChart` applies:
   * `maxSecondsOf` in `day-series.ts` is the usual answer.
   */
  maxSeconds: number;
  emptyLabel: string;
}) {
  if (rows.length === 0 || maxSeconds === 0) {
    return <p className="text-muted-foreground text-sm">{emptyLabel}</p>;
  }

  return (
    <dl className="flex flex-col gap-2.5">
      {rows.map((row, index) => (
        <div key={row.key} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3">
            <dt
              className={cn(
                "min-w-0 truncate text-sm",
                row.muted && "text-muted-foreground italic",
              )}
            >
              {row.label}
            </dt>
            <dd className="shrink-0 font-mono text-sm tabular-nums">
              {formatSecondsHms(row.totalSeconds)}
            </dd>
          </div>
          <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
            <div
              className={cn(
                "h-full rounded-full",
                row.muted
                  ? MUTED_COLOUR
                  : (BAR_COLOURS[index % BAR_COLOURS.length] ?? BAR_COLOURS[0]),
              )}
              style={{
                width: `${Math.min(100, (row.totalSeconds / maxSeconds) * 100)}%`,
              }}
              aria-hidden
            />
          </div>
        </div>
      ))}
    </dl>
  );
}
