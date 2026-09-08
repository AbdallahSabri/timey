"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import {
  EMPTY_SCHEDULE,
  ScheduleFields,
} from "@/components/project-members/schedule-fields";
import { nativeSelectClassName } from "@/components/structure/select-class";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import type { CompanyMember } from "@/lib/actions/companies";
import { addProjectMember } from "@/lib/actions/project-members";
import { type Weekday } from "@/lib/time/working-days";
import {
  projectMemberScheduleSchema,
  type ProjectMemberScheduleInput,
  type ProjectMemberScheduleValues,
} from "@/lib/validations/project-members";

/**
 * The candidate list is everyone in the company who is not already on this
 * project — `listMembers()` minus `listProjectMembers()`, diffed by the page.
 * No server action exists for that anti-join and none is asked for: a company's
 * headcount is not a scale problem, and a second query shape would be a second
 * thing to keep correct.
 *
 * Deactivated members stay in the list, marked. §2.3 keeps them for their
 * history and nothing in the schema refuses their assignment, so filtering them
 * out here would be this component inventing a rule.
 *
 * **Assigning and scheduling are one submit** (§3.6.3). `addProjectMember`
 * takes an optional schedule precisely so the two are one row version rather
 * than an insert followed by an update — an admin who fills both in never sees
 * a moment where somebody is assigned with hours nobody chose.
 *
 * The schedule fields default to 0h/day on Mon–Fri, which is 0014's column
 * DEFAULTs restated (`EMPTY_SCHEDULE`), so ignoring them writes exactly the row
 * this form used to write before it had them. That is why the schedule is
 * always sent rather than conditionally omitted: the two are the same data, and
 * one code path cannot disagree with itself.
 *
 * The person picker stays outside `react-hook-form` — it is one `<select>` of
 * opaque ids with no schema to resolve against, and `addProjectMember`
 * validates the uuid itself. The form below it exists for the schedule, which
 * does have one.
 */
export function AddProjectMemberForm({
  projectId,
  candidates,
  weekStartsOn,
}: {
  projectId: string;
  candidates: CompanyMember[];
  /** `companies.week_starts_on` — orders the day picker's checkboxes only. */
  weekStartsOn: number;
}) {
  const router = useRouter();
  const [userId, setUserId] = useState("");

  const form = useForm<
    ProjectMemberScheduleInput,
    unknown,
    ProjectMemberScheduleValues
  >({
    resolver: zodResolver(projectMemberScheduleSchema),
    defaultValues: EMPTY_SCHEDULE,
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

    setValue(
      "workingDays",
      [...next].sort((a, b) => a - b),
      { shouldDirty: true },
    );
  }

  /**
   * Takes no argument for the reason `MemberScheduleDialog` gives: the action's
   * schedule parameter is the untransformed input, because it re-runs the
   * schema server-side rather than trusting a client's hours→seconds
   * conversion. The form sends what it holds.
   */
  async function onSubmit() {
    const candidate = candidates.find((member) => member.id === userId);
    if (!candidate) {
      return;
    }

    const result = await addProjectMember(
      projectId,
      candidate.id,
      form.getValues(),
    );

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    toast.success(`${candidate.fullName} can now log time to this project.`);
    setUserId("");
    form.reset(EMPTY_SCHEDULE);
    router.refresh();
  }

  if (candidates.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Everyone in your company is already assigned to this project.
      </p>
    );
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="project-member">Add someone</FieldLabel>
          <select
            id="project-member"
            className={nativeSelectClassName}
            value={userId}
            disabled={isSubmitting}
            onChange={(event) => setUserId(event.target.value)}
          >
            <option value="">Select a person…</option>
            {candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.fullName}
                {candidate.status === "active" ? "" : " (inactive)"}
              </option>
            ))}
          </select>
          <FieldDescription>
            Assignment is what allows logging time — admins included. Being an
            admin shows every project; it does not put you on one.
          </FieldDescription>
        </Field>

        <ScheduleFields
          idPrefix="add-project-member"
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

        <Button
          type="submit"
          className="self-start"
          disabled={isSubmitting || userId === ""}
        >
          {isSubmitting ? "Adding…" : "Add to project"}
        </Button>
      </FieldGroup>
    </form>
  );
}
