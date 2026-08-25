"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import {
  amendCorrectionSchema,
  type AmendCorrectionInput,
  type AmendCorrectionValues,
} from "@/components/corrections/correction-schemas";
import { toCompanyDateTimeLocalValue } from "@/components/time-entries/datetime-local";
import { ProjectTaskFields } from "@/components/time-entries/project-task-fields";
import { useProjectTasks } from "@/components/time-entries/use-project-tasks";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { submitCorrection } from "@/lib/actions/corrections";
import type { Project } from "@/lib/actions/projects";
import type { TimeEntryWithLabels } from "@/lib/actions/time-entries";

/**
 * §7.1's "Edit times on a **closed** entry — No → correction request", as the
 * form that files the request.
 *
 * **Nothing here writes to the entry**, and that is the whole design: an
 * employee's only path to a closed row's times is a proposal an admin decides
 * on (§7.2 — the database refuses the alternative outright). What this collects
 * is a `kind='amend'` request; the entry changes when, and only when, somebody
 * else approves it.
 *
 * **The two rules the fields encode, both from the `proposed_*` NULL
 * convention:**
 *
 *   * A blank field means "leave this alone", never "clear it". So project,
 *     task and note start empty and say "Leave unchanged" — filling one is how
 *     you propose it.
 *   * The times start **pre-filled with the entry's current values**, in the
 *     company's timezone. They are the field people came to fix, and a blank
 *     `datetime-local` would make correcting one end mean retyping both. The
 *     cost is that an untouched form proposes the times it already has, which
 *     approval applies as a no-op — visible to the admin as an unchanged row in
 *     the before/after, and cheaper than a control whose current value is
 *     invisible.
 *
 * Times are submitted exactly as the browser produced them (`datetime-local`,
 * no `Z`, no offset), the same contract Phase 6's manual entry has. There is no
 * timezone arithmetic in this file — `toCompanyDateTimeLocalValue` only reads
 * the seed in `companies.timezone` so the field agrees with the row it came
 * from, and `submitCorrection` resolves whatever comes back.
 *
 * **And unlike Phase 6, no day is out of bounds.** §7.1's today-only rule
 * governs what may be asserted *without* approval; a correction is the approved
 * path, and `lib/validations/corrections.ts` declines to apply the rule for
 * exactly that reason. The helper text says so, because a user who has just met
 * the manual-entry refusal will assume it applies here too.
 */
export function AmendCorrectionForm({
  entry,
  projects,
  timezone,
  onCompleted,
}: {
  entry: TimeEntryWithLabels;
  projects: Project[];
  timezone: string | null;
  onCompleted?: () => void;
}) {
  const router = useRouter();

  const form = useForm<AmendCorrectionInput, unknown, AmendCorrectionValues>({
    resolver: zodResolver(amendCorrectionSchema),
    defaultValues: {
      kind: "amend",
      timeEntryId: entry.id,
      proposedStartedAt: toCompanyDateTimeLocalValue(entry.startedAt, timezone),
      proposedEndedAt: entry.endedAt
        ? toCompanyDateTimeLocalValue(entry.endedAt, timezone)
        : "",
      proposedProjectId: "",
      proposedTaskId: "",
      proposedNote: "",
      reason: "",
    },
  });

  const {
    formState: { errors, isSubmitting },
    setValue,
    watch,
  } = form;

  const setTaskId = useCallback(
    (taskId: string) => setValue("proposedTaskId", taskId),
    [setValue],
  );

  const taskState = useProjectTasks(
    watch("proposedProjectId") ?? "",
    setTaskId,
  );

  async function onSubmit(values: AmendCorrectionValues) {
    const result = await submitCorrection(values);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    toast.success(
      "Correction requested. An admin reviews it before anything changes.",
    );
    onCompleted?.();
    router.refresh();
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FieldGroup>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <Field
            className="sm:flex-1"
            data-invalid={errors.proposedStartedAt ? true : undefined}
          >
            <FieldLabel htmlFor="amend-started-at">Start</FieldLabel>
            <Input
              id="amend-started-at"
              type="datetime-local"
              aria-invalid={errors.proposedStartedAt ? true : undefined}
              {...form.register("proposedStartedAt")}
            />
            <FieldError
              errors={
                errors.proposedStartedAt
                  ? [errors.proposedStartedAt]
                  : undefined
              }
            />
          </Field>

          <Field
            className="sm:flex-1"
            data-invalid={errors.proposedEndedAt ? true : undefined}
          >
            <FieldLabel htmlFor="amend-ended-at">End</FieldLabel>
            <Input
              id="amend-ended-at"
              type="datetime-local"
              aria-invalid={errors.proposedEndedAt ? true : undefined}
              {...form.register("proposedEndedAt")}
            />
            <FieldError
              errors={
                errors.proposedEndedAt ? [errors.proposedEndedAt] : undefined
              }
            />
          </Field>
        </div>

        <FieldDescription>
          Both times are read in{" "}
          <span className="text-foreground font-medium">
            {timezone ?? "your company's timezone"}
          </span>
          . You can propose a time from any day — that&rsquo;s what a correction
          is for. Time that hasn&rsquo;t happened yet is still refused, and the
          proposal is checked again for overlaps when an admin reviews it.
        </FieldDescription>

        <ProjectTaskFields
          idPrefix="amend"
          projects={projects}
          taskState={taskState}
          projectField={form.register("proposedProjectId")}
          taskField={form.register("proposedTaskId")}
          projectError={
            errors.proposedProjectId
              ? { message: errors.proposedProjectId.message }
              : undefined
          }
          taskError={
            errors.proposedTaskId
              ? { message: errors.proposedTaskId.message }
              : undefined
          }
          projectPlaceholder="Leave unchanged"
          taskPlaceholder="Leave unchanged"
        />

        <FieldDescription>
          Leave both alone to keep{" "}
          <span className="text-foreground font-medium">
            {entry.project?.name ?? "the current project"}
            {entry.task ? ` · ${entry.task.name}` : ""}
          </span>
          . Moving an entry to another project needs a task in that project too,
          so pick both.
        </FieldDescription>

        <Field data-invalid={errors.proposedNote ? true : undefined}>
          <FieldLabel htmlFor="amend-note">Note</FieldLabel>
          <Input
            id="amend-note"
            autoComplete="off"
            placeholder={
              entry.note ? `Currently: ${entry.note}` : "Leave unchanged"
            }
            aria-invalid={errors.proposedNote ? true : undefined}
            {...form.register("proposedNote")}
          />
          {errors.proposedNote ? (
            <FieldError errors={[errors.proposedNote]} />
          ) : (
            <FieldDescription>
              Optional, and only if you want it changed as part of this request.
            </FieldDescription>
          )}
        </Field>

        <Field data-invalid={errors.reason ? true : undefined}>
          <FieldLabel htmlFor="amend-reason">Reason (required)</FieldLabel>
          <Input
            id="amend-reason"
            autoComplete="off"
            placeholder="Why does this entry need changing?"
            aria-invalid={errors.reason ? true : undefined}
            {...form.register("reason")}
          />
          {errors.reason ? (
            <FieldError errors={[errors.reason]} />
          ) : (
            <FieldDescription>
              The admin reviewing this sees only what you write here, so say
              what actually happened.
            </FieldDescription>
          )}
        </Field>

        <Button type="submit" className="self-start" disabled={isSubmitting}>
          {isSubmitting ? "Sending…" : "Request correction"}
        </Button>
      </FieldGroup>
    </form>
  );
}
