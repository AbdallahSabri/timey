"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

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
import type { Project } from "@/lib/actions/projects";
import { startTimer, switchTimer } from "@/lib/actions/time-entries";
import { startTimerSchema } from "@/lib/validations/time-entries";

import type { z } from "zod";

type StartTimerInput = z.input<typeof startTimerSchema>;
type StartTimerValues = z.output<typeof startTimerSchema>;

/**
 * The start form, in both the places a timer can begin.
 *
 * `mode="switch"` is **not an edit of the running timer** — §5.1 forbids
 * mutating `project_id` on a running row, because the minutes already elapsed
 * were worked on the old project. It calls `switchTimer`, which stops the
 * current entry (saving it against the project it was actually worked on) and
 * inserts a new one. The copy around this form says so in those words; nothing
 * here should ever read as "change what this timer is tracking".
 *
 * The project → task cascade lives in `useProjectTasks` / `ProjectTaskFields`
 * (Phase 6), shared with the manual-entry form so both ask the question the
 * same way. **No timestamp field appears here and none may be added:** §5.3
 * rules that the client never sends one for a timer, and `startTimer`'s payload
 * has no room for it. Client-supplied times belong to the manual path alone.
 */
export function StartTimerForm({
  projects,
  mode = "start",
  onCompleted,
}: {
  projects: Project[];
  mode?: "start" | "switch";
  onCompleted?: () => void;
}) {
  const router = useRouter();

  const form = useForm<StartTimerInput, unknown, StartTimerValues>({
    resolver: zodResolver(startTimerSchema),
    defaultValues: { projectId: "", taskId: "", note: "" },
  });

  const {
    formState: { errors, isSubmitting },
    setValue,
    watch,
  } = form;

  const setTaskId = useCallback(
    (taskId: string) => setValue("taskId", taskId),
    [setValue],
  );

  const taskState = useProjectTasks(watch("projectId"), setTaskId);

  async function onSubmit(values: StartTimerValues) {
    const result =
      mode === "switch"
        ? await switchTimer(values.projectId, values.taskId, values.note)
        : await startTimer(values.projectId, values.taskId, values.note);

    if (!result.ok) {
      // Pre-worded by the actions layer — "You already have a timer running",
      // "You're not assigned to this project", and the half-completed switch
      // ("stopped and saved, but the new one could not start") all read better
      // than anything this component could infer from a boolean.
      toast.error(result.error);
      return;
    }

    toast.success(
      mode === "switch"
        ? "Previous entry saved. New timer running."
        : "Timer running.",
    );
    form.reset({ projectId: "", taskId: "", note: "" });
    onCompleted?.();
    router.refresh();
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FieldGroup>
        <ProjectTaskFields
          idPrefix={mode}
          projects={projects}
          taskState={taskState}
          projectField={form.register("projectId")}
          taskField={form.register("taskId")}
          projectError={errors.projectId}
          taskError={errors.taskId}
        />

        <Field data-invalid={errors.note ? true : undefined}>
          <FieldLabel htmlFor={`${mode}-note`}>Note</FieldLabel>
          <Input
            id={`${mode}-note`}
            autoComplete="off"
            placeholder="What are you working on?"
            aria-invalid={errors.note ? true : undefined}
            {...form.register("note")}
          />
          {errors.note ? (
            <FieldError errors={[errors.note]} />
          ) : (
            <FieldDescription>
              Optional, and editable while the timer runs.
            </FieldDescription>
          )}
        </Field>

        <Button type="submit" className="self-start" disabled={isSubmitting}>
          {isSubmitting
            ? mode === "switch"
              ? "Switching…"
              : "Starting…"
            : mode === "switch"
              ? "Stop this and start the new one"
              : "Start timer"}
        </Button>
      </FieldGroup>
    </form>
  );
}
