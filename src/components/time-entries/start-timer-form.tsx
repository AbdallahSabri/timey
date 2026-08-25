"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { nativeSelectClassName } from "@/components/structure/select-class";
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
import type { Task } from "@/lib/actions/tasks";
import { listTasks } from "@/lib/actions/tasks";
import { startTimer, switchTimer } from "@/lib/actions/time-entries";
import { startTimerSchema } from "@/lib/validations/time-entries";

import type { z } from "zod";

type StartTimerInput = z.input<typeof startTimerSchema>;
type StartTimerValues = z.output<typeof startTimerSchema>;

type TaskState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; tasks: Task[] }
  | { status: "error"; message: string };

/**
 * §3.5.2 gives every project a "General" task, so a project is never
 * un-loggable — but "first alphabetically" is not the same as "the obvious
 * one", and silently pre-selecting whichever task sorts first would attribute
 * time to something nobody chose. So: General when it exists, the only task
 * when there is only one, and otherwise an explicit pick.
 */
function preferredTaskId(tasks: Task[]): string {
  const general = tasks.find((task) => task.name.toLowerCase() === "general");
  if (general) {
    return general.id;
  }

  return tasks.length === 1 ? (tasks[0]?.id ?? "") : "";
}

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
 * Tasks are fetched per project rather than shipped for every project up front:
 * `listTasks` is scoped by the same policy as the project list, so asking for
 * one project's tasks is one round trip and asking for all of them is N.
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
  const [taskState, setTaskState] = useState<TaskState>({ status: "idle" });

  const form = useForm<StartTimerInput, unknown, StartTimerValues>({
    resolver: zodResolver(startTimerSchema),
    defaultValues: { projectId: "", taskId: "", note: "" },
  });

  const {
    formState: { errors, isSubmitting },
    setValue,
    watch,
  } = form;

  const projectId = watch("projectId");

  useEffect(() => {
    if (!projectId) {
      setTaskState({ status: "idle" });
      setValue("taskId", "");
      return;
    }

    // A user clicking through the project list faster than the network answers
    // would otherwise get whichever response landed last, which is not
    // necessarily the project now selected.
    let cancelled = false;
    setTaskState({ status: "loading" });
    setValue("taskId", "");

    void listTasks(projectId).then((result) => {
      if (cancelled) {
        return;
      }
      if (!result.ok) {
        setTaskState({ status: "error", message: result.error });
        return;
      }

      setTaskState({ status: "ready", tasks: result.data });
    });

    return () => {
      cancelled = true;
    };
  }, [projectId, setValue]);

  /**
   * Applied in a second effect rather than beside `setTaskState` above, and the
   * ordering is load-bearing: `setValue` on a registered `<select>` writes
   * straight to the DOM node, and at the moment the fetch resolves that node
   * still holds only the placeholder — React has not rendered the new
   * `<option>`s yet, so the assignment silently does nothing and the field
   * stays empty. Running after the commit means the option exists to select.
   */
  useEffect(() => {
    if (taskState.status !== "ready") {
      return;
    }

    setValue("taskId", preferredTaskId(taskState.tasks));
  }, [taskState, setValue]);

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

  const tasks = taskState.status === "ready" ? taskState.tasks : [];

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FieldGroup>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <Field
            className="sm:flex-1"
            data-invalid={errors.projectId ? true : undefined}
          >
            <FieldLabel htmlFor={`${mode}-project`}>Project</FieldLabel>
            <select
              id={`${mode}-project`}
              className={nativeSelectClassName}
              aria-invalid={errors.projectId ? true : undefined}
              {...form.register("projectId")}
            >
              <option value="">Pick a project…</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.client
                    ? `${project.client.name} — ${project.name}`
                    : project.name}
                </option>
              ))}
            </select>
            <FieldError
              errors={errors.projectId ? [errors.projectId] : undefined}
            />
          </Field>

          <Field
            className="sm:flex-1"
            data-invalid={errors.taskId ? true : undefined}
          >
            <FieldLabel htmlFor={`${mode}-task`}>Task</FieldLabel>
            <select
              id={`${mode}-task`}
              className={nativeSelectClassName}
              disabled={taskState.status !== "ready"}
              aria-invalid={errors.taskId ? true : undefined}
              {...form.register("taskId")}
            >
              <option value="">
                {taskState.status === "loading"
                  ? "Loading tasks…"
                  : "Pick a task…"}
              </option>
              {tasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.name}
                </option>
              ))}
            </select>
            {taskState.status === "error" ? (
              <FieldError errors={[{ message: taskState.message }]} />
            ) : (
              <FieldError
                errors={errors.taskId ? [errors.taskId] : undefined}
              />
            )}
          </Field>
        </div>

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
