"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import {
  deleteCorrectionSchema,
  type DeleteCorrectionInput,
  type DeleteCorrectionValues,
} from "@/components/corrections/correction-schemas";
import { formatClock } from "@/components/time-entries/elapsed";
import { formatStartedAt } from "@/components/time-entries/format-entry";
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
import { submitCorrection } from "@/lib/actions/corrections";
import type { TimeEntryWithLabels } from "@/lib/actions/time-entries";

/**
 * §7.1's "Delete a **closed** entry — No → correction request".
 *
 * One field, and it is the reason. `kind='delete'` proposes nothing else — the
 * schema does not merely ignore proposed values, it has no place to put them,
 * because "anything proposed alongside a deletion would be silently discarded at
 * approval, which is worse than a refusal at submission".
 *
 * The entry it names is stated above the field rather than assumed from
 * context: this dialog can be reached from any row, and asking to delete the
 * wrong day's work is a mistake nobody would catch afterwards.
 */
export function DeleteCorrectionDialog({
  entry,
  timezone,
  open,
  onOpenChange,
}: {
  entry: TimeEntryWithLabels;
  timezone: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();

  const form = useForm<DeleteCorrectionInput, unknown, DeleteCorrectionValues>({
    resolver: zodResolver(deleteCorrectionSchema),
    defaultValues: {
      kind: "delete",
      timeEntryId: entry.id,
      reason: "",
    },
  });

  const {
    formState: { errors, isSubmitting },
  } = form;

  async function onSubmit(values: DeleteCorrectionValues) {
    const result = await submitCorrection(values);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    toast.success(
      "Deletion requested. The entry stays until an admin approves it.",
    );
    onOpenChange(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Request deletion</DialogTitle>
          <DialogDescription>
            A closed entry is yours to question, not to remove — an admin
            approves the deletion. Until then it stays exactly as it is and
            keeps counting towards your totals.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
          <FieldGroup>
            <div className="border-border rounded-md border px-3 py-2 text-sm">
              <p className="font-medium">
                {entry.project?.name ?? "—"}
                {entry.task ? ` · ${entry.task.name}` : ""}
              </p>
              <p className="text-muted-foreground">
                {formatStartedAt(entry.startedAt, timezone)}
                {entry.durationSeconds === null
                  ? ""
                  : ` · ${formatClock(entry.durationSeconds)}`}
                {entry.note ? ` · ${entry.note}` : ""}
              </p>
            </div>

            <Field data-invalid={errors.reason ? true : undefined}>
              <FieldLabel htmlFor="delete-reason">Reason (required)</FieldLabel>
              <Input
                id="delete-reason"
                autoComplete="off"
                placeholder="Why should this entry go?"
                aria-invalid={errors.reason ? true : undefined}
                {...form.register("reason")}
              />
              {errors.reason ? (
                <FieldError errors={[errors.reason]} />
              ) : (
                <FieldDescription>
                  Duplicates, time logged to the wrong account, work that never
                  happened — say which.
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
                {isSubmitting ? "Sending…" : "Request deletion"}
              </Button>
            </div>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}
