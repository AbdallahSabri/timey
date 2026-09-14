import { cn } from "@/lib/utils";

/**
 * One figure with a label above it and a qualifier under it — the shape every
 * headline number in this app is already rendered in.
 *
 * It lives in `structure/` beside `DataCard` rather than in `charts/` because
 * it is not a chart: it is a composition of primitives shared between
 * `/reports`' summary header and both of §9.9's dashboards, and the reason to
 * extract it was that `FIGURE_CLASS` had been **copied verbatim** into two
 * files and was about to go into two more.
 *
 * The caption is where this app does most of its honest work — §9.8.2's two
 * disclosures, §9.4's running-entry exclusion, "closed entries in this range" —
 * so it is a `ReactNode` rather than a string. It is **omitted entirely when
 * absent** rather than rendered empty: the grid stretches its items, so a
 * missing caption costs no alignment, and an empty `span` would be a node a
 * screen reader walks into for nothing.
 */

/**
 * What a figure reads as when the read behind it failed.
 *
 * **Not `0:00:00`**, which is the whole point of having a constant for it: a
 * zero is a measurement and this is the absence of one, and on a timesheet the
 * difference is the difference between "you logged nothing" and "we don't
 * know". `report-rows.ts` draws the same distinction for a label RLS hid and
 * uses the same glyph for it.
 */
export const FIGURE_UNAVAILABLE = "—";

/** The figures are set alike, and like the running clock they echo. */
export const FIGURE_CLASS =
  "font-mono text-3xl leading-none font-medium tracking-tight tabular-nums";

/**
 * A row of tiles that pairs up before it spreads out.
 *
 * Four figures crushed into quarters of a phone-width card are unreadable, so
 * they go two-up first and only fan out where there is room — the responsive
 * shape `ReportSummaryHeader` arrived at for exactly this reason.
 */
export function StatTileGrid({
  columns,
  className,
  children,
}: {
  columns: 3 | 4;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "grid gap-6",
        columns === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2 lg:grid-cols-4",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function StatTile({
  label,
  figure,
  caption,
  live = false,
}: {
  label: string;
  /**
   * Already formatted. Durations arrive through `formatSecondsHms` and counts
   * as plain numbers; this component does no arithmetic and no formatting, so
   * §9.5's "format at the edge" has exactly one edge.
   */
  figure: React.ReactNode;
  caption?: React.ReactNode;
  /**
   * Amber. **For a running timer and nothing else** (`CLAUDE.md`), and only
   * when there is one — a zero is not a running timer, so the caller passes
   * `live` conditionally rather than always. `ReportSummaryHeader` set that
   * precedent and this preserves it rather than widening the token's meaning.
   */
  live?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground text-sm">{label}</span>
      <span className={cn(FIGURE_CLASS, live && "text-live")}>{figure}</span>
      {caption ? (
        <span className="text-muted-foreground text-xs">{caption}</span>
      ) : null}
    </div>
  );
}
