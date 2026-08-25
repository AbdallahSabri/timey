"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { createTask } from "@/lib/actions/tasks";
import { taskSchema, type TaskInput } from "@/lib/validations/structure";

import type { z } from "zod";

type TaskValues = z.output<typeof taskSchema>;

/**
 * §3.5, §3.5.1 — tasks are flat, and a task belongs to the project in the URL,
 * so `projectId` is a prop rather than a field. `tasks.project_id` has no
 * UPDATE grant at all: a task cannot move between projects, and no form here
 * pretends otherwise.
 */
export function CreateTaskForm({ projectId }: { projectId: string }) {
  const router = useRouter();

  const form = useForm<TaskInput, unknown, TaskValues>({
    resolver: zodResolver(taskSchema),
    defaultValues: { name: "" },
  });

  const {
    formState: { errors, isSubmitting },
  } = form;

  async function onSubmit(values: TaskValues) {
    const result = await createTask(projectId, values);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    toast.success(`${result.data.name} has been added.`);
    form.reset({ name: "" });
    router.refresh();
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FieldGroup>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <Field
            className="flex-1"
            data-invalid={errors.name ? true : undefined}
          >
            <FieldLabel htmlFor="task-name">Task name</FieldLabel>
            <Input
              id="task-name"
              autoComplete="off"
              placeholder="Design review"
              aria-invalid={errors.name ? true : undefined}
              {...form.register("name")}
            />
            <FieldError errors={errors.name ? [errors.name] : undefined} />
          </Field>

          <Button type="submit" className="sm:mt-6" disabled={isSubmitting}>
            {isSubmitting ? "Adding task…" : "Add task"}
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}
