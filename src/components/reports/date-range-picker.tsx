"use client";

import { CalendarIcon } from "lucide-react";
import { useState } from "react";

import {
  addDays,
  dateToDayString,
  dayStringToDate,
  endOfMonth,
  formatDayRange,
  startOfMonth,
} from "@/components/reports/report-days";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import type { DateRange } from "react-day-picker";

/**
 * §9.2's date range — "company-local days, inclusive" — as the calendar §12.3
 * has been listing since v1.1.
 *
 * **No timezone arithmetic happens here.** The control produces two
 * `YYYY-MM-DD` labels and the server buckets entries into them with
 * `(started_at AT TIME ZONE c.timezone)::date` (§6.1). What the browser's own
 * zone is used for is exactly one thing: reading which cell was clicked, since
 * `react-day-picker` reports a click as local midnight of that cell
 * (`dateToDayString` is why that never becomes a UTC off-by-one).
 *
 * The presets are anchored to the company's today, passed in from the server,
 * not to `new Date()` in the browser — a person in another country looking at a
 * Cairo company's report gets Cairo's "this month" (§6.2 puts per-user zones out
 * of scope, so the company's is the only one that exists).
 *
 * `resetOnSelect` makes the first click after a complete range start a new one
 * rather than dragging whichever end happens to be nearer. Without it, clicking
 * a day inside an existing range silently moves one boundary and applies
 * immediately, which is a report nobody asked for.
 */
export function DateRangePicker({
  from,
  to,
  today,
  onSelect,
  disabled = false,
}: {
  from: string;
  to: string;
  /** Today in the company timezone, resolved on the server. */
  today: string;
  onSelect: (range: { from: string; to: string }) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>(undefined);

  const applied: DateRange | undefined = dayStringToDate(from)
    ? { from: dayStringToDate(from), to: dayStringToDate(to) }
    : undefined;

  // The draft only exists while the popover is open; reopening re-derives from
  // whatever the URL now says, so a range applied in one visit is the starting
  // point of the next.
  const selected = draft ?? applied;

  function handleOpenChange(next: boolean) {
    if (next) {
      setDraft(undefined);
    }
    setOpen(next);
  }

  function handleRangeSelect(range: DateRange | undefined) {
    setDraft(range);

    if (range?.from && range.to) {
      onSelect({
        from: dateToDayString(range.from),
        to: dateToDayString(range.to),
      });
      setOpen(false);
    }
  }

  function apply(range: { from: string; to: string }) {
    setDraft(undefined);
    onSelect(range);
    setOpen(false);
  }

  const presets: { label: string; range: { from: string; to: string } }[] = [
    { label: "Today", range: { from: today, to: today } },
    { label: "Last 7 days", range: { from: addDays(today, -6), to: today } },
    { label: "Last 30 days", range: { from: addDays(today, -29), to: today } },
    {
      label: "This month",
      range: { from: startOfMonth(today), to: today },
    },
    {
      label: "Last month",
      range: {
        from: startOfMonth(addDays(startOfMonth(today), -1)),
        to: endOfMonth(addDays(startOfMonth(today), -1)),
      },
    },
  ];

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className="justify-start font-normal"
          aria-label="Change the report date range"
        >
          <CalendarIcon aria-hidden />
          {formatDayRange(from, to)}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="flex w-auto flex-col gap-3 p-3 sm:flex-row"
      >
        <div className="flex flex-row flex-wrap gap-1 sm:w-40 sm:flex-col">
          {presets.map((preset) => (
            <Button
              key={preset.label}
              type="button"
              variant="ghost"
              size="sm"
              className="justify-start font-normal"
              onClick={() => apply(preset.range)}
            >
              {preset.label}
            </Button>
          ))}
        </div>
        <Calendar
          mode="range"
          resetOnSelect
          numberOfMonths={2}
          defaultMonth={dayStringToDate(from)}
          selected={selected}
          onSelect={handleRangeSelect}
          autoFocus
          className="p-0"
        />
      </PopoverContent>
    </Popover>
  );
}
