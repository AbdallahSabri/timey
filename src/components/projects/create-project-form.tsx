"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
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
import type { Client } from "@/lib/actions/clients";
import { createProject } from "@/lib/actions/projects";
import { projectSchema, type ProjectInput } from "@/lib/validations/structure";

import type { z } from "zod";

type ProjectValues = z.output<typeof projectSchema>;

/**
 * §3.4. The client picker holds active clients only (§3.11 — archived rows are
 * excluded from pickers) and "No client" is a real choice, not an empty state:
 * an internal project has no client, and the schema normalises the empty string
 * the `<select>` submits to null.
 *
 * Project names are **not** unique per company (`BLOCKERS.md` B-4 — §3.4 asks
 * for no index and none exists), so nothing here warns about a duplicate. A
 * client-side rule the database does not enforce would be a rule only the
 * honest path obeys.
 */
export function CreateProjectForm({ clients }: { clients: Client[] }) {
  const router = useRouter();

  const form = useForm<ProjectInput, unknown, ProjectValues>({
    resolver: zodResolver(projectSchema),
    defaultValues: { name: "", description: "", clientId: "" },
  });

  const {
    formState: { errors, isSubmitting },
  } = form;

  async function onSubmit(values: ProjectValues) {
    const result = await createProject(values);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    // §3.5.2 — the project already has a "General" task, created by a trigger
    // on insert, so there is no task step between here and logging time.
    toast.success(`${result.data.name} is ready, with a "General" task.`);
    form.reset({ name: "", description: "", clientId: values.clientId ?? "" });
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
            <FieldLabel htmlFor="project-name">Project name</FieldLabel>
            <Input
              id="project-name"
              autoComplete="off"
              placeholder="Website rebuild"
              aria-invalid={errors.name ? true : undefined}
              {...form.register("name")}
            />
            <FieldError errors={errors.name ? [errors.name] : undefined} />
          </Field>

          <Field
            className="sm:w-56"
            data-invalid={errors.clientId ? true : undefined}
          >
            <FieldLabel htmlFor="project-client">Client</FieldLabel>
            <select
              id="project-client"
              className={nativeSelectClassName}
              aria-invalid={errors.clientId ? true : undefined}
              {...form.register("clientId")}
            >
              <option value="">No client — internal</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
            <FieldError
              errors={errors.clientId ? [errors.clientId] : undefined}
            />
          </Field>
        </div>

        <Field data-invalid={errors.description ? true : undefined}>
          <FieldLabel htmlFor="project-description">Description</FieldLabel>
          <Input
            id="project-description"
            autoComplete="off"
            placeholder="What this project covers"
            aria-invalid={errors.description ? true : undefined}
            {...form.register("description")}
          />
          {errors.description ? (
            <FieldError errors={[errors.description]} />
          ) : (
            <FieldDescription>
              Optional. Everyone assigned to the project can read it.
            </FieldDescription>
          )}
        </Field>

        <Button type="submit" className="self-start" disabled={isSubmitting}>
          {isSubmitting ? "Creating project…" : "Create project"}
        </Button>
      </FieldGroup>
    </form>
  );
}
