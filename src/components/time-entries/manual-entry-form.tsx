"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { toDateTimeLocalValue } from "@/components/time-entries/datetime-local";
import { formatClock } from "@/components/time-entries/elapsed";
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
import { createManualEntry } from "@/lib/actions/time-entries";
import {
  manualEntrySchema,
  type ManualEntryInput,
} from "@/lib/validations/time-entries";

import type { z } from "zod";

type ManualEntryValues = z.output<typeof manualEntrySchema>;

/**
 * A blank form seeded with the browser's current wall clock. Both ends start at
 * "now" rather than guessing a duration — a pre-filled hour would be a number
 * nobody worked, and the entry is an assertion about real time (§5.3).
 */
function emptyManualEntry(): ManualEntryInput {
  const now = toDateTimeLocalValue(new Date());

  return {
    projectId: "",
    taskId: "",
    startedAt: now,
    endedAt: now,
    note: "",
  };
}

/**
 * §7.1's one manual write an employee may make without approval: "Create a
 * manual entry dated **today** — Yes." Every other row of that table is a No
 * that routes to a correction request, which is why this form offers no entry
 * id, no way to reach an existing row, and no date range beyond today. It is
 * the secondary path by design — the timer above it is the one that measures.
 *
 * **The two `datetime-local` fields are submitted exactly as the browser
 * produced them.** `localDateTimeSchema` accepts precisely that format — a wall
 * clock with no `Z` and no offset — and `createManualEntry` resolves it against
 * `companies.timezone`. Passing it through `new Date(...).toISOString()` would
 * stamp the *browser's* zone onto a value the server is about to read as
 * company-local, so a user in a different zone from their company would silently
 * log the wrong company-local time and, near midnight, the wrong day. There is
 * no timezone arithmetic in this file at all; the only `Date` it constructs is
 * the seed in `emptyManualEntry`, which is never submitted unedited without the
 * user having looked at it.
 *
 * Native inputs, not a picker primitive: §12.3 flags a date/time picker as
 * eventually needed, and `datetime-local` already gives a browser-native
 * calendar and clock, keyboard entry, and — the part that matters — the exact
 * string the action's contract asks for, with no dependency.
 *
 * Refusals are rendered verbatim. The actions layer words them with the
 * specifics only it has ("This overlaps an entry from 09:00–10:30.", the
 * today-only sentence that names corrections), and nothing here should
 * paraphrase them into something vaguer.
 *
 * The helper text now names the control that handles an earlier day, because
 * Phase 7 built one: `CreateCorrectionDialog`, sitting beside this dialog's own
 * trigger. Saying "not built yet" once it is would send someone looking for a
 * workaround past the button that does it.
 */
export function ManualEntryForm({
  projects,
  timezone,
  onCompleted,
}: {
  projects: Project[];
  timezone: string | null;
  onCompleted?: () => void;
}) {
  const router = useRouter();
  const [defaults] = useState(emptyManualEntry);

  const form = useForm<ManualEntryInput, unknown, ManualEntryValues>({
    resolver: zodResolver(manualEntrySchema),
    defaultValues: defaults,
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

  async function onSubmit(values: ManualEntryValues) {
    const result = await createManualEntry(values);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    // The duration announced is the database's own `duration_seconds` — the
    // generated column, computed from the instants it stored — not a subtraction
    // done here on the two strings that were typed.
    toast.success(
      `Saved ${formatClock(result.data.durationSeconds ?? 0)} to your entries.`,
    );
    form.reset(emptyManualEntry());
    onCompleted?.();
    router.refresh();
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FieldGroup>
        <ProjectTaskFields
          idPrefix="manual"
          projects={projects}
          taskState={taskState}
          projectField={form.register("projectId")}
          taskField={form.register("taskId")}
          projectError={errors.projectId}
          taskError={errors.taskId}
        />

        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <Field
            className="sm:flex-1"
            data-invalid={errors.startedAt ? true : undefined}
          >
            <FieldLabel htmlFor="manual-started-at">Start</FieldLabel>
            <Input
              id="manual-started-at"
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
            <FieldLabel htmlFor="manual-ended-at">End</FieldLabel>
            <Input
              id="manual-ended-at"
              type="datetime-local"
              aria-invalid={errors.endedAt ? true : undefined}
              {...form.register("endedAt")}
            />
            <FieldError
              errors={errors.endedAt ? [errors.endedAt] : undefined}
            />
          </Field>
        </div>

        {/* §7.1 and §6.4 stated before the round trip, not discovered through
            a rejection. Deliberately prose and not a client-side check: "today"
            means today in the company's timezone, the server owns that clock,
            and a second copy of the rule computed in the browser would be a
            second thing that can be wrong. */}
        <FieldDescription>
          Both times are read in{" "}
          <span className="text-foreground font-medium">
            {timezone ?? "your company's timezone"}
          </span>
          , so type the time as it reads on your company&rsquo;s clock. You can
          only log time for today — for an earlier day, close this and use{" "}
          <span className="text-foreground font-medium">
            Request an earlier day
          </span>
          , which an admin approves. Time that hasn&rsquo;t happened yet is
          refused, give or take five minutes for a clock that drifts.
        </FieldDescription>

        <Field data-invalid={errors.note ? true : undefined}>
          <FieldLabel htmlFor="manual-note">Note</FieldLabel>
          <Input
            id="manual-note"
            autoComplete="off"
            placeholder="What did you work on?"
            aria-invalid={errors.note ? true : undefined}
            {...form.register("note")}
          />
          {errors.note ? (
            <FieldError errors={[errors.note]} />
          ) : (
            <FieldDescription>
              Optional. The note is the one thing you can still change once an
              entry is saved.
            </FieldDescription>
          )}
        </Field>

        <Button type="submit" className="self-start" disabled={isSubmitting}>
          {isSubmitting ? "Saving…" : "Save entry"}
        </Button>
      </FieldGroup>
    </form>
  );
}
