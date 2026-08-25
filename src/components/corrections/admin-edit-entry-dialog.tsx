"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { toCompanyDateTimeLocalValue } from "@/components/time-entries/datetime-local";
import { ProjectTaskFields } from "@/components/time-entries/project-task-fields";
import { useProjectTasks } from "@/components/time-entries/use-project-tasks";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { adminEditEntry } from "@/lib/actions/corrections";
import type { Project } from "@/lib/actions/projects";
import type { TimeEntryWithLabels } from "@/lib/actions/time-entries";
import {
  adminEditEntrySchema,
  type AdminEditEntryInput,
} from "@/lib/validations/corrections";

import type { z } from "zod";

type AdminEditEntryValues = z.output<typeof adminEditEntrySchema>;

/**
 * §7.4's single-admin path: "If a company has one admin, that admin edits
 * entries directly (admin edits also write revision rows) rather than routing
 * through a request."
 *
 * **This is not the employee's dialog with the approval step removed.** It skips
 * the queue because there is nobody to review it, not because an admin's edits
 * are unaudited — `admin_edit_entry()` writes a `time_entry_revisions` row
 * exactly as approval does, and there is no path in this product that changes a
 * closed entry without one.
 *
 * Rendered only for an admin, and only on a **closed** row (see
 * `entry-correction-actions.tsx`). The RPC refuses a running entry outright with
 * "Stop this entry's timer before editing it directly." — a sentence this file
 * renders verbatim if it ever arrives, but does not rely on: offering a control
 * whose only outcome is that refusal would be the bug §7.2 warns about, pointed
 * at admins instead of employees.
 *
 * Blank still means "leave unchanged", the same NULL convention the correction
 * path uses, with one consequence worth stating in the UI rather than
 * discovering: **this path cannot clear a note.** The owner can (§7.1 allows a
 * note edit at any time); an admin edit that sent an empty string would be read
 * as "leave it alone".
 */
export function AdminEditEntryDialog({
  entry,
  projects,
  timezone,
  open,
  onOpenChange,
}: {
  entry: TimeEntryWithLabels;
  projects: Project[];
  timezone: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();

  const form = useForm<AdminEditEntryInput, unknown, AdminEditEntryValues>({
    resolver: zodResolver(adminEditEntrySchema),
    defaultValues: {
      startedAt: toCompanyDateTimeLocalValue(entry.startedAt, timezone),
      endedAt: entry.endedAt
        ? toCompanyDateTimeLocalValue(entry.endedAt, timezone)
        : "",
      projectId: "",
      taskId: "",
      note: "",
    },
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

  const taskState = useProjectTasks(watch("projectId") ?? "", setTaskId);

  async function onSubmit(values: AdminEditEntryValues) {
    const result = await adminEditEntry(entry.id, values);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    toast.success(
      "Entry updated. The previous values are kept in its history.",
    );
    onOpenChange(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit this entry directly</DialogTitle>
          <DialogDescription>
            An admin edit applies immediately — there is no request and no
            second approval. The values it replaces are written to the
            entry&rsquo;s revision history either way.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
          <FieldGroup>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              <Field
                className="sm:flex-1"
                data-invalid={errors.startedAt ? true : undefined}
              >
                <FieldLabel htmlFor="admin-edit-started-at">Start</FieldLabel>
                <Input
                  id="admin-edit-started-at"
                  type="datetime-local"
                  aria-invalid={errors.startedAt ? true : undefined}
                  {...form.register("startedAt")}
                />
                <FieldError
                  errors={errors.startedAt ? [errors.startedAt] : undefined}
                />
              </Field>

              <Field
                className="sm:flex-1"
                data-invalid={errors.endedAt ? true : undefined}
              >
                <FieldLabel htmlFor="admin-edit-ended-at">End</FieldLabel>
                <Input
                  id="admin-edit-ended-at"
                  type="datetime-local"
                  aria-invalid={errors.endedAt ? true : undefined}
                  {...form.register("endedAt")}
                />
                <FieldError
                  errors={errors.endedAt ? [errors.endedAt] : undefined}
                />
              </Field>
            </div>

            <FieldDescription>
              Read in{" "}
              <span className="text-foreground font-medium">
                {timezone ?? "your company's timezone"}
              </span>
              . Overlaps and future times are refused here exactly as they are
              anywhere else.
            </FieldDescription>

            <ProjectTaskFields
              idPrefix="admin-edit"
              projects={projects}
              taskState={taskState}
              projectField={form.register("projectId")}
              taskField={form.register("taskId")}
              projectError={
                errors.projectId
                  ? { message: errors.projectId.message }
                  : undefined
              }
              taskError={
                errors.taskId ? { message: errors.taskId.message } : undefined
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
              . Moving an entry needs a task in the new project too, and the
              entry&rsquo;s owner has to be a member of it.
            </FieldDescription>

            <Field data-invalid={errors.note ? true : undefined}>
              <FieldLabel htmlFor="admin-edit-note">Note</FieldLabel>
              <Input
                id="admin-edit-note"
                autoComplete="off"
                placeholder={
                  entry.note ? `Currently: ${entry.note}` : "Leave unchanged"
                }
                aria-invalid={errors.note ? true : undefined}
                {...form.register("note")}
              />
              {errors.note ? (
                <FieldError errors={[errors.note]} />
              ) : (
                <FieldDescription>
                  Blank leaves the note as it is — a direct edit can replace a
                  note but never remove one.
                </FieldDescription>
              )}
            </Field>

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={isSubmitting}
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}
