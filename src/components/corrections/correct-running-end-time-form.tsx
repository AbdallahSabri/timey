"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

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
import { correctionReasonSchema } from "@/lib/validations/corrections";
import { localDateTimeSchema } from "@/lib/validations/time-entries";

/**
 * §5.4's second offer, finally reachable (`BLOCKERS.md` N-9): "submit a
 * correction with the real end time" against the running entry the stale
 * prompt is about.
 *
 * **Deliberately narrower than `AmendCorrectionForm`.** This proposes only
 * `proposedEndedAt` — no start, project, task or note. Not a UI restriction
 * standing in for a database one: `approve_correction`'s
 * `running_entry_reattribution` guard (`0006_corrections.sql`) refuses
 * exactly those fields on a still-running row, so a wider form would collect
 * input the server is guaranteed to reject. The schema here is a stricter
 * subset built from the same field-level schemas `submitCorrection`
 * ultimately re-validates against — not a rule this form invents.
 */
const runningEndTimeCorrectionSchema = z.object({
  proposedEndedAt: localDateTimeSchema,
  reason: correctionReasonSchema,
});

type RunningEndTimeCorrectionValues = z.infer<
  typeof runningEndTimeCorrectionSchema
>;

export function CorrectRunningEndTimeForm({
  timeEntryId,
  onCompleted,
  onCancel,
}: {
  timeEntryId: string;
  onCompleted: () => void;
  onCancel: () => void;
}) {
  const router = useRouter();

  const form = useForm<RunningEndTimeCorrectionValues>({
    resolver: zodResolver(runningEndTimeCorrectionSchema),
    defaultValues: { proposedEndedAt: "", reason: "" },
  });

  const {
    formState: { errors, isSubmitting },
  } = form;

  async function onSubmit(values: RunningEndTimeCorrectionValues) {
    const result = await submitCorrection({
      kind: "amend",
      timeEntryId,
      proposedEndedAt: values.proposedEndedAt,
      reason: values.reason,
    });

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    toast.success(
      "Correction requested. An admin reviews it before anything changes — the timer keeps running until then.",
    );
    onCompleted();
    router.refresh();
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FieldGroup>
        <Field data-invalid={errors.proposedEndedAt ? true : undefined}>
          <FieldLabel htmlFor="running-correction-ended-at">
            Real end time
          </FieldLabel>
          <Input
            id="running-correction-ended-at"
            type="datetime-local"
            aria-invalid={errors.proposedEndedAt ? true : undefined}
            {...form.register("proposedEndedAt")}
          />
          {errors.proposedEndedAt ? (
            <FieldError errors={[errors.proposedEndedAt]} />
          ) : (
            <FieldDescription>
              The project, task and start time stay as they are — only the end
              time is proposed here.
            </FieldDescription>
          )}
        </Field>

        <Field data-invalid={errors.reason ? true : undefined}>
          <FieldLabel htmlFor="running-correction-reason">
            Reason (required)
          </FieldLabel>
          <Input
            id="running-correction-reason"
            autoComplete="off"
            placeholder="Why does this need changing?"
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

        <div className="flex items-center gap-2">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Sending…" : "Request correction"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={isSubmitting}
            onClick={onCancel}
          >
            Back
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}
