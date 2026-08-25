"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import {
  createCorrectionSchema,
  type CreateCorrectionInput,
  type CreateCorrectionValues,
} from "@/components/corrections/correction-schemas";
import { toDateTimeLocalValue } from "@/components/time-entries/datetime-local";
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

/**
 * §7.1's fourth "No": "Create an entry dated **before today** — No →
 * correction request."
 *
 * This is the twin of Phase 6's manual entry and the difference between them is
 * the whole point of both: **a manual entry is an assertion an employee may
 * make alone, and only about today; this is a proposal about any day, and it
 * only becomes an entry when an admin approves it.** The two therefore look
 * alike on purpose — same fields, same `datetime-local` contract, same
 * company-timezone reading — and differ in exactly one sentence of helper text
 * and in what pressing the button does.
 *
 * Every field is required here, unlike an `amend`, because `create` proposes a
 * whole entry: a proposal that names no project, or only one end of a day, is
 * not something an admin could apply.
 *
 * The seed is the browser's clock, as in Phase 6 — a starting point to edit,
 * never an assertion about which zone is right (`toDateTimeLocalValue`). Anyone
 * filing this is about to change the date anyway; what matters is that the value
 * carries no offset and reaches the server as the wall clock it shows.
 */
function emptyProposal(): CreateCorrectionInput {
  const now = toDateTimeLocalValue(new Date());

  return {
    kind: "create",
    proposedProjectId: "",
    proposedTaskId: "",
    proposedStartedAt: now,
    proposedEndedAt: now,
    proposedNote: "",
    reason: "",
  };
}

export function CreateCorrectionForm({
  projects,
  timezone,
  onCompleted,
}: {
  projects: Project[];
  timezone: string | null;
  onCompleted?: () => void;
}) {
  const router = useRouter();
  const [defaults] = useState(emptyProposal);

  const form = useForm<CreateCorrectionInput, unknown, CreateCorrectionValues>({
    resolver: zodResolver(createCorrectionSchema),
    defaultValues: defaults,
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

  const taskState = useProjectTasks(watch("proposedProjectId"), setTaskId);

  async function onSubmit(values: CreateCorrectionValues) {
    const result = await submitCorrection(values);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    toast.success(
      "Requested. The entry appears on your timesheet once an admin approves it.",
    );
    form.reset(emptyProposal());
    onCompleted?.();
    router.refresh();
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FieldGroup>
        <ProjectTaskFields
          idPrefix="backdated"
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
        />

        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <Field
            className="sm:flex-1"
            data-invalid={errors.proposedStartedAt ? true : undefined}
          >
            <FieldLabel htmlFor="backdated-started-at">Start</FieldLabel>
            <Input
              id="backdated-started-at"
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
            <FieldLabel htmlFor="backdated-ended-at">End</FieldLabel>
            <Input
              id="backdated-ended-at"
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
          proposal is checked for overlaps again when an admin reviews it.
        </FieldDescription>

        <Field data-invalid={errors.proposedNote ? true : undefined}>
          <FieldLabel htmlFor="backdated-note">Note</FieldLabel>
          <Input
            id="backdated-note"
            autoComplete="off"
            placeholder="What did you work on?"
            aria-invalid={errors.proposedNote ? true : undefined}
            {...form.register("proposedNote")}
          />
          <FieldError
            errors={errors.proposedNote ? [errors.proposedNote] : undefined}
          />
        </Field>

        <Field data-invalid={errors.reason ? true : undefined}>
          <FieldLabel htmlFor="backdated-reason">Reason (required)</FieldLabel>
          <Input
            id="backdated-reason"
            autoComplete="off"
            placeholder="Why wasn't this logged at the time?"
            aria-invalid={errors.reason ? true : undefined}
            {...form.register("reason")}
          />
          {errors.reason ? (
            <FieldError errors={[errors.reason]} />
          ) : (
            <FieldDescription>
              The admin reviewing this sees only what you write here.
            </FieldDescription>
          )}
        </Field>

        <Button type="submit" className="self-start" disabled={isSubmitting}>
          {isSubmitting ? "Sending…" : "Request this entry"}
        </Button>
      </FieldGroup>
    </form>
  );
}
