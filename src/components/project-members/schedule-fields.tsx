"use client";

import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  DEFAULT_WORKING_DAYS,
  weekdayName,
  weekdayShortName,
  weekdaysFrom,
  type Weekday,
} from "@/lib/time/working-days";
import {
  MAX_EXPECTED_DAILY_HOURS,
  type ProjectMemberScheduleInput,
} from "@/lib/validations/project-members";

import type { UseFormRegisterReturn } from "react-hook-form";

/**
 * §3.6.3's two schedule inputs — hours per day and which days — shared by the
 * three places an admin can set them: the assign-and-schedule form, the project
 * page's edit dialog, and the Team page's per-project rows.
 *
 * Written the way `ProjectTaskFields` is, taking a `register()` result and an
 * error rather than the form object itself. Three callers hold three different
 * form shapes; a component that reached into `useForm` would have to be generic
 * over all of them to say the same thing about two fields.
 *
 * **The days are not a `register()`ed input.** `working_days` is an array and
 * seven checkboxes are seven elements, so the value is held by the form and
 * toggled through `setValue` by the caller — which is also what lets the picker
 * render in the company's week order without the *stored* numbering moving with
 * it.
 */
export function ScheduleFields({
  idPrefix,
  hoursField,
  hoursError,
  workingDays,
  onToggleDay,
  daysError,
  weekStartsOn,
  disabled = false,
}: {
  /** Namespaces the ids so several of these can share a page. */
  idPrefix: string;
  hoursField: UseFormRegisterReturn;
  hoursError?: { message?: string };
  workingDays: readonly number[];
  onToggleDay: (day: Weekday, checked: boolean) => void;
  daysError?: { message?: string };
  /** `companies.week_starts_on` — display order only (§3.6.3). */
  weekStartsOn: number;
  disabled?: boolean;
}) {
  const chosen = new Set(workingDays);

  return (
    <>
      <Field data-invalid={hoursError ? true : undefined}>
        <FieldLabel htmlFor={`${idPrefix}-hours`}>Hours per day</FieldLabel>
        <Input
          id={`${idPrefix}-hours`}
          type="number"
          inputMode="decimal"
          step="0.25"
          min={0}
          max={MAX_EXPECTED_DAILY_HOURS}
          autoComplete="off"
          placeholder="0"
          disabled={disabled}
          aria-invalid={hoursError ? true : undefined}
          {...hoursField}
        />
        {hoursError ? (
          <FieldError errors={[hoursError]} />
        ) : (
          <FieldDescription>
            What this person is expected to work on this project, on each of the
            days below. Zero means no target — their hours are recorded and
            nothing is compared against them.
          </FieldDescription>
        )}
      </Field>

      <Field data-invalid={daysError ? true : undefined}>
        {/* A group label rather than a `for=`: seven checkboxes have seven
            labels of their own, and pointing one label at one of them would
            name the group after Monday. */}
        <FieldLabel asChild>
          <span id={`${idPrefix}-days-label`}>Working days</span>
        </FieldLabel>
        <div
          role="group"
          aria-labelledby={`${idPrefix}-days-label`}
          className="flex flex-wrap gap-x-4 gap-y-2"
        >
          {/* Ordered by the company's own week, so a Sunday-start company does
              not read its schedule starting on Monday. The values stored stay
              0–6 dow either way (§3.6.3), which is what makes rotating the
              display safe. */}
          {weekdaysFrom(weekStartsOn).map((day) => (
            <label
              key={day}
              className="flex cursor-pointer items-center gap-2 text-sm select-none"
            >
              <Checkbox
                checked={chosen.has(day)}
                disabled={disabled}
                onCheckedChange={(checked) =>
                  onToggleDay(day, checked === true)
                }
                aria-label={weekdayName(day)}
              />
              <span aria-hidden>{weekdayShortName(day)}</span>
            </label>
          ))}
        </div>
        {daysError ? (
          <FieldError errors={[daysError]} />
        ) : (
          <FieldDescription>
            Expected hours accrue on these days only, counting today in full and
            starting from the day this person was assigned.
          </FieldDescription>
        )}
      </Field>
    </>
  );
}

/**
 * The default a new assignment's form opens on: nothing expected, Mon–Fri
 * ticked.
 *
 * **These are 0014's column DEFAULTs, restated**, and that is what lets the
 * assign form always send a schedule instead of deciding whether to. An admin
 * who ignores both fields submits `{ 0 seconds, Mon–Fri }`, which is byte for
 * byte the row `addProjectMember` would have written with no schedule at all —
 * the action's own comment says the difference between the two is intent
 * rather than data. So there is one code path, and what the admin sees on
 * screen is what lands in the row.
 *
 * Zero rather than a guess at eight, for the reason `NO_EXPECTED_HOURS`
 * gives: a form that quietly proposed a target would turn "I just wanted to
 * assign them" into a schedule nobody chose.
 */
export const EMPTY_SCHEDULE: ProjectMemberScheduleInput = {
  expectedDailyHours: 0,
  workingDays: [...DEFAULT_WORKING_DAYS],
};
