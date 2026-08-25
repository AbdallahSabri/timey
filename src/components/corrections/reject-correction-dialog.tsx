"use client";

import { useState } from "react";

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
import { reviewNoteSchema } from "@/lib/validations/corrections";

/**
 * §7.4: "A rejected request is terminal... `review_note` required."
 *
 * The note is validated here against the *same* `reviewNoteSchema` the action
 * and `reject_correction()` use — not a second rule invented for the form — so
 * the button is disabled for exactly the input the database would refuse, and
 * the sentence shown is the one the server would have sent back.
 *
 * Disabling is a courtesy and not the enforcement: the note is required by the
 * schema, by the function, and by two table CHECKs, and a rejection that reached
 * any of them empty would still be refused. What the disabled button buys is
 * that an admin never files a permanent audit record whose explanation is blank,
 * which is the outcome §7.4 actually cares about — the record outlives the
 * decision and is all the employee ever sees of it.
 */
export function RejectCorrectionDialog({
  requesterName,
  pending,
  open,
  onOpenChange,
  onReject,
}: {
  requesterName: string | null;
  pending: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReject: (reviewNote: string) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [touched, setTouched] = useState(false);

  const parsed = reviewNoteSchema.safeParse(note);
  const message = parsed.success ? null : parsed.error.issues[0]?.message;

  function change(open: boolean) {
    if (!open) {
      setNote("");
      setTouched(false);
    }
    onOpenChange(open);
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Reject this request</DialogTitle>
          <DialogDescription>
            Rejecting is final — {requesterName ?? "the requester"} can&rsquo;t
            revive this request, only file a new one. The entry is left exactly
            as it is, and this note is the only explanation they get.
          </DialogDescription>
        </DialogHeader>

        <FieldGroup>
          <Field data-invalid={touched && message ? true : undefined}>
            <FieldLabel htmlFor="reject-note">Note (required)</FieldLabel>
            <Input
              id="reject-note"
              autoComplete="off"
              placeholder="Why isn't this being applied?"
              value={note}
              disabled={pending}
              aria-invalid={touched && message ? true : undefined}
              onBlur={() => setTouched(true)}
              onChange={(event) => setNote(event.target.value)}
            />
            {touched && message ? (
              <FieldError errors={[{ message }]} />
            ) : (
              <FieldDescription>
                Kept with the request for good, so write what would make sense
                months from now.
              </FieldDescription>
            )}
          </Field>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => change(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={pending || !parsed.success}
              onClick={() => {
                if (parsed.success) {
                  void onReject(parsed.data);
                }
              }}
            >
              {pending ? "Rejecting…" : "Reject request"}
            </Button>
          </div>
        </FieldGroup>
      </DialogContent>
    </Dialog>
  );
}
