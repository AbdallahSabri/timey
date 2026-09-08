"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import {
  EMPTY_SCHEDULE,
  ScheduleFields,
} from "@/components/project-members/schedule-fields";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { updateProjectMemberSchedule } from "@/lib/actions/project-members";
import { SECONDS_PER_HOUR, type Weekday } from "@/lib/time/working-days";
import {
  projectMemberScheduleSchema,
  type ProjectMemberScheduleInput,
  type ProjectMemberScheduleValues,
} from "@/lib/validations/project-members";

/**
 * §3.6.3's schedule, edited on one assignment that already exists.
 *
 * **One assignment, not one person, and one form for both entry points.** The
 * project page opens this inside a dialog; the Team page renders it inline
 * against a row of that person's projects. Both hand it the same
 * `(projectId, userId)` pair and the same action, because the schedule lives on
 * the membership row — so the two surfaces cannot drift into validating or
 * wording anything differently. It is a form rather than a dialog for exactly
 * that reason: the Team page's list is already in a dialog, and a dialog inside
 * a dialog to edit one row of it would be a modal over a modal.
 *
 * The repo's one form pattern: `useForm<Input, unknown, Values>` because
 * `projectMemberScheduleSchema` *transforms* — hours in, integer seconds out
 * (§9.5) — so the two generics genuinely differ.
 *
 * Refusals are rendered verbatim. `updateProjectMemberSchedule` words them,
 * including the one that matters most here: `project_members_update_admin`
 * filters through `USING` rather than raising, so an unauthorised edit comes
 * back from the database as *success* with zero rows, and the action turns that
 * into a sentence instead of a silent no-op that would report "Saved".
 */
export function ScheduleForm({
  projectId,
  userId,
  memberName,
  expectedDailySeconds,
  workingDays,
  weekStartsOn,
  onSaved,
  onCancel,
}: {
  projectId: string;
  userId: string;
  memberName: string;
  expectedDailySeconds: number;
  workingDays: readonly number[];
  /** `companies.week_starts_on` — orders the checkboxes only (§3.6.3). */
  weekStartsOn: number;
  /** Called after the action succeeds — closes the dialog, or the inline editor. */
  onSaved: () => void;
  onCancel: () => void;
}) {
  const router = useRouter();

  const form = useForm<
    ProjectMemberScheduleInput,
    unknown,
    ProjectMemberScheduleValues
  >({
    resolver: zodResolver(projectMemberScheduleSchema),
    // Seconds back to hours, for display only. The round trip is lossless for
    // anything anybody schedules — the schema rounds to the nearest second on
    // the way in — and this value is never what gets stored: submitting sends
    // the field's contents back through the schema on the server.
    defaultValues: {
      expectedDailyHours: expectedDailySeconds / SECONDS_PER_HOUR,
      workingDays: [...workingDays],
    },
  });

  const {
    formState: { errors, isSubmitting },
    setValue,
    watch,
  } = form;

  const chosenDays = watch("workingDays") ?? EMPTY_SCHEDULE.workingDays;

  function toggleDay(day: Weekday, checked: boolean) {
    const next = new Set(chosenDays);
    if (checked) {
      next.add(day);
    } else {
      next.delete(day);
    }

    // Sorted here as well as in the schema and again by
    // `project_members_20_normalize_working_days`. Not redundancy for its own
    // sake: this is the copy the checkboxes read back, and an unsorted array
    // would make the form's own state depend on the order they were clicked.
    setValue(
      "workingDays",
      [...next].sort((a, b) => a - b),
      { shouldDirty: true },
    );
  }

  /**
   * Takes no argument on purpose.
   *
   * `handleSubmit` would hand over the *transformed* values — seconds — but the
   * action's parameter is the untransformed input, because it re-runs
   * `projectMemberScheduleSchema` itself rather than trusting a client's
   * arithmetic. So the form sends what it holds and the server converts, which
   * keeps hours→seconds happening exactly once and on the side that decides.
   * Reaching this at all means the same schema already passed here, so nothing
   * below can fail for a reason the user has not already been shown.
   */
  async function onSubmit() {
    const result = await updateProjectMemberSchedule(
      projectId,
      userId,
      form.getValues(),
    );

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    toast.success(`Updated ${memberName}'s expected hours.`);
    onSaved();
    // The lists that read this row are server-rendered — the project page's
    // member table, and every report carrying an Expected column.
    router.refresh();
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FieldGroup>
        <ScheduleFields
          idPrefix={`schedule-${projectId}-${userId}`}
          hoursField={form.register("expectedDailyHours")}
          hoursError={
            errors.expectedDailyHours
              ? { message: errors.expectedDailyHours.message }
              : undefined
          }
          workingDays={chosenDays}
          onToggleDay={toggleDay}
          daysError={
            errors.workingDays
              ? { message: errors.workingDays.message }
              : undefined
          }
          weekStartsOn={weekStartsOn}
          disabled={isSubmitting}
        />

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={isSubmitting}
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : "Save schedule"}
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}
