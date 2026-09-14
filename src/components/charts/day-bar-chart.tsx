import { formatDayLabel } from "@/components/reports/report-days";
import { formatSecondsHms } from "@/lib/reports/csv";
import { weekdayShortName, type Weekday } from "@/lib/time/working-days";
import { cn } from "@/lib/utils";

/**
 * Hours per day, as a row of columns (`SPEC.md` §9.9).
 *
 * It answers the one question a total cannot: five eight-hour days and one
 * forty-hour Friday produce the same month figure, and only the shape tells
 * them apart.
 *
 * **Hand-rolled, and the accessible reading is the real chart.** There is no
 * charting dependency in this project and §9.9 rules that there will not be
 * one; more to the point, a picture of a bar is worth nothing to a screen
 * reader and nothing in jsdom, which has no layout and would measure every
 * column at zero. So this renders a **list**, each item named with its date and
 * its exact `H:MM:SS`, and paints a `div` behind that name. Everything the
 * chart claims is therefore in the accessible tree, and every claim is
 * assertable in a test.
 *
 * **It shows worked hours and no target, deliberately** (§9.9.2). Expected
 * hours are a *range* quantity — `report_expected_by_user` accrues them from
 * each assignment's `added_at` over the days in a range — and there is no
 * per-day function. Reconstructing a daily target here from a schedule would
 * ignore accrual and put a second, disagreeing figure next to §9.8's.
 *
 * `offDay` dims a day outside the working week, which is a statement about the
 * calendar rather than about what was owed — and it is worded in the **present
 * tense** ("outside working days") for a reason the accrual rule also has:
 * `project_members` keeps no history of a schedule, so the working days known
 * now say nothing about a fortnight when the person may not have been assigned
 * at all. "Was not a working day" would be a claim about that day; this is a
 * claim about the schedule.
 *
 * Presentational and server-rendered.
 */

/** One column. Integer seconds in; the formatting happens here, once (§9.5). */
export type DayBar = {
  /** `YYYY-MM-DD`, a company-local day label (§6.1) — never an instant. */
  day: string;
  totalSeconds: number;
  /** Which weekday to print beneath, in `extract(dow)` numbering (0 = Sunday). */
  weekday: Weekday;
  /** Outside the working week: dimmed, and said so in the accessible name. */
  offDay?: boolean;
  /** The company's today. Outlined rather than filled, and named as today. */
  isToday?: boolean;
};

/**
 * A bar with real hours in it is never invisible.
 *
 * Without a floor, a twenty-minute day against an eight-hour one computes to
 * under 1% and renders as nothing — indistinguishable from a day off, which is
 * the one distinction this chart exists to draw. Two pixels is not a
 * measurement, it is a mark saying "something happened here"; the figure it
 * stands for is in the accessible name, where it is exact.
 */
const MIN_VISIBLE_PERCENT = 4;

export function DayBarChart({
  bars,
  maxSeconds,
  emptyLabel,
  label,
}: {
  bars: DayBar[];
  /**
   * The value a full-height bar represents. The **caller's** decision, so two
   * charts on one page can be put on one scale on purpose; `maxSecondsOf` in
   * `day-series.ts` is the usual answer.
   */
  maxSeconds: number;
  /** Shown instead of the columns when nothing at all was logged in the range. */
  emptyLabel: string;
  /** Names the list for a screen reader — "Hours worked per day", or the team's. */
  label: string;
}) {
  if (bars.length === 0 || maxSeconds === 0) {
    return <p className="text-muted-foreground text-sm">{emptyLabel}</p>;
  }

  return (
    <ul
      role="list"
      aria-label={label}
      className="flex h-32 items-end justify-between gap-1"
    >
      {bars.map((bar) => {
        const percent =
          bar.totalSeconds === 0
            ? 0
            : Math.max(
                MIN_VISIBLE_PERCENT,
                (bar.totalSeconds / maxSeconds) * 100,
              );

        return (
          <li
            key={bar.day}
            // Everything the column says, said in words: the date, the exact
            // duration, and the two states a colour would otherwise carry
            // alone. This is what the test reads and what a screen reader
            // reads, which is the point — they are the same thing.
            aria-label={[
              formatDayLabel(bar.day),
              bar.isToday ? "(today)" : null,
              bar.offDay ? "(outside working days)" : null,
              `: ${formatSecondsHms(bar.totalSeconds)}`,
            ]
              .filter(Boolean)
              .join(" ")
              .replace(" :", ":")}
            className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5"
          >
            <div className="flex w-full flex-1 items-end">
              <div
                className={cn(
                  "w-full rounded-t-sm",
                  // Zero renders as a hairline track rather than as nothing, so
                  // a day with no hours still reads as a day rather than as a
                  // gap in the axis.
                  bar.totalSeconds === 0
                    ? "bg-muted h-px"
                    : bar.offDay
                      ? "bg-chart-1/40"
                      : "bg-chart-1",
                  bar.isToday &&
                    bar.totalSeconds > 0 &&
                    "ring-chart-1 ring-1 ring-offset-1 ring-offset-[var(--card)]",
                )}
                style={
                  bar.totalSeconds === 0 ? undefined : { height: `${percent}%` }
                }
                aria-hidden
              />
            </div>
            <span
              className={cn(
                "text-[0.625rem] leading-none",
                bar.isToday
                  ? "text-foreground font-medium"
                  : "text-muted-foreground",
              )}
              aria-hidden
            >
              {weekdayShortName(bar.weekday).slice(0, 1)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
