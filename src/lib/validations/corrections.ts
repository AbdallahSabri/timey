import { z } from "zod";

import { entryNoteSchema, localDateTimeSchema } from "./time-entries";

/**
 * §3.9 / §7.4 — the shape of a correction request at the boundary.
 *
 * **What this file does NOT do, and the omission is the load-bearing part.**
 * §7.1's *today-only* rule is not applied to a proposed time, at any kind, ever.
 * That rule governs what an employee may assert **without approval**; a
 * correction is the escape hatch §7.1 itself points at for every row in its
 * table that reads "No → correction request", three of which are explicitly
 * about days that are not today ("Edit times on a closed entry", "Delete a
 * closed entry", "Create an entry dated before today"). A today-only check here
 * would refuse the only requests worth filing. `0006_corrections.sql` reaches
 * the same conclusion independently at approval time (header note (f): "the
 * today-only rule is NOT re-checked at approval ... a backdated entry is the
 * whole point of a correction"), so neither end of the round trip applies it.
 *
 * §6.4's **future guard does still apply**, and both ends apply it: §7.4 has
 * approval re-validate "against overlap and future-date rules", which
 * `assert_entry_window_valid()` does with the same five-minute grace. It is
 * checked at submission as well — not as a duplicate of the database's check but
 * as an earlier one, so an employee proposing next Tuesday is told immediately
 * rather than after an admin's round trip. Both checks live in
 * `lib/actions/corrections.ts` rather than here, because both need the company
 * timezone and the server's clock and a standalone zod schema has neither.
 *
 * The times below are therefore **wall clocks in the company timezone**, exactly
 * as Phase 6's manual entry is (`localDateTimeSchema`), resolved server-side by
 * the action. A proposal read back in a different zone from the one it was typed
 * in is §6.1's failure mode, and it does not become acceptable because an admin
 * approved it.
 */

/**
 * `correction_kind` and `correction_status` (§3.9), mirrored as zod enums the
 * way `entrySourceSchema` mirrors `entry_source`. The status one validates
 * nothing on any input path today — no action accepts a status, because the only
 * transitions that exist are one policy and two functions — but it is the type
 * the UI's status pills (§12.3) are built from, and a hand-written union in a
 * component would be a second copy of the lifecycle §7.4 defines.
 */
export const correctionKindSchema = z.enum(
  ["create", "amend", "delete"],
  "A correction either adds, changes or removes an entry.",
);

export const correctionStatusSchema = z.enum(
  ["pending", "approved", "rejected", "withdrawn"],
  "That isn't a correction status.",
);

/**
 * §3.9: "`reason` — Required from the employee. Non-negotiable — it's the
 * entire point of the approval step."
 *
 * The database says this twice (`NOT NULL` plus
 * `correction_requests_reason_not_blank`, because a form sending `""` satisfies
 * the first and defeats the rule). This is the third statement of it, and the
 * only one that produces a sentence rather than a constraint name. The 2000
 * character ceiling matches `entryNoteSchema`; `reason` is `text` with no
 * length CHECK, so it is ours alone.
 */
export const correctionReasonSchema = z
  .string("Tell us why — a reason is required for a correction request.")
  .trim()
  .min(1, "Tell us why — a reason is required for a correction request.")
  .max(2000, "That reason is too long (2000 characters max).");

/**
 * §3.9 / §7.4: "`review_note` — Required when rejecting." Enforced by a table
 * CHECK *and* by `reject_correction()`, which refuses the whitespace the CHECK
 * would accept. Same sentence, earlier.
 */
export const reviewNoteSchema = z
  .string("A note explaining the rejection is required.")
  .trim()
  .min(1, "A note explaining the rejection is required.")
  .max(2000, "That note is too long (2000 characters max).");

/**
 * §7.4.1's not-found rule, applied to a malformed id: a non-uuid could never
 * match a row, and reporting it as "you don't have access" would misdescribe a
 * typo as a permissions problem — while still not distinguishing "never existed"
 * from "another company's", which is the distinction that must stay invisible.
 */
export const correctionRequestIdSchema = z.uuid(
  "That correction request doesn't exist, or you don't have access to it.",
);

/**
 * An optional wall clock. Blank and absent both mean **leave this alone** —
 * the `proposed_*` NULL convention `0006_corrections.sql` header note (a)
 * defines: "a NULL proposed column means 'leave this alone', never 'set it to
 * NULL'". A form field the user did not fill in sends `""`, and treating that as
 * a malformed timestamp would refuse every partial proposal, which is what a
 * correction usually is (§5.4's stale-timer remedy proposes an end time and
 * nothing else).
 */
const optionalLocalDateTimeSchema = z
  .string()
  .trim()
  .nullish()
  .transform((value) => (value ? value : null))
  .pipe(localDateTimeSchema.nullable());

function optionalUuidSchema(message: string) {
  return z
    .string()
    .trim()
    .nullish()
    .transform((value) => (value ? value : null))
    .pipe(z.uuid(message).nullable());
}

const PICK_PROJECT = "Pick a project to log time to.";
const PICK_TASK = "Pick a task to log time to.";

/**
 * `kind = 'create'` — §7.1's "Create an entry dated **before today** — No →
 * correction request."
 *
 * All four proposed values are required, mirroring
 * `correction_requests_shape_by_kind`'s `create` branch: a proposal to
 * materialise a whole entry that names no project, or no times, is not a
 * proposal. `timeEntryId` is absent from the object entirely rather than
 * optional-and-ignored, so it is not merely unused but unexpressible — the
 * discriminated union is what makes "a create request cannot name an entry" a
 * type error instead of a runtime surprise.
 */
const createCorrectionSchema = z.object({
  kind: z.literal("create"),
  proposedStartedAt: localDateTimeSchema,
  proposedEndedAt: localDateTimeSchema,
  proposedProjectId: z.uuid(PICK_PROJECT),
  proposedTaskId: z.uuid(PICK_TASK),
  proposedNote: entryNoteSchema,
  reason: correctionReasonSchema,
});

/**
 * `kind = 'amend'` — §7.1's "Edit times on a **closed** entry — No → correction
 * request", and §5.4's stale-timer remedy.
 *
 * Every proposed field is optional and at least one must be present, which is
 * `correction_requests_shape_by_kind`'s `amend` branch stated as a sentence: "a
 * request that proposes nothing is not a correction, it is a queue item nobody
 * can action."
 *
 * The project/task pairing rule is the table's
 * `correction_requests_project_move_names_task`: `time_entries` has a composite
 * FK requiring the task to belong to the entry's project (§3.5.2), so a proposal
 * that moves an entry to another project without naming a task **there** would
 * fail at approval with a 23503 about a task the employee never mentioned. The
 * reverse — a task alone, staying inside the same project — is allowed by both,
 * and is the common case of correcting which task a day was booked to.
 */
const amendCorrectionSchema = z
  .object({
    kind: z.literal("amend"),
    timeEntryId: z.uuid("That time entry no longer exists."),
    proposedStartedAt: optionalLocalDateTimeSchema,
    proposedEndedAt: optionalLocalDateTimeSchema,
    proposedProjectId: optionalUuidSchema(PICK_PROJECT),
    proposedTaskId: optionalUuidSchema(PICK_TASK),
    proposedNote: entryNoteSchema,
    reason: correctionReasonSchema,
  })
  .refine(
    (value) =>
      value.proposedStartedAt !== null ||
      value.proposedEndedAt !== null ||
      value.proposedProjectId !== null ||
      value.proposedTaskId !== null ||
      value.proposedNote !== null,
    {
      error: "Propose at least one change for an admin to review.",
      path: ["proposedStartedAt"],
    },
  )
  .refine(
    (value) =>
      value.proposedProjectId === null || value.proposedTaskId !== null,
    {
      error: "Pick a task in the new project too.",
      path: ["proposedTaskId"],
    },
  );

/**
 * `kind = 'delete'` — §7.1's "Delete a **closed** entry — No → correction
 * request."
 *
 * Nothing but the entry and the reason, matching
 * `correction_requests_shape_by_kind`'s `delete` branch and its argument:
 * "anything proposed alongside a deletion would be silently discarded at
 * approval, which is worse than a refusal at submission." Here it is stronger
 * than a refusal — the fields do not exist on the type, and zod strips unknown
 * keys, so a form that sends them cannot smuggle them into the insert either.
 */
const deleteCorrectionSchema = z.object({
  kind: z.literal("delete"),
  timeEntryId: z.uuid("That time entry no longer exists."),
  reason: correctionReasonSchema,
});

/**
 * The three kinds as one discriminated union on `kind` (§3.9's
 * `correction_kind`). A union rather than one wide optional object because the
 * shape rules differ per kind in both directions — `create` requires four fields
 * that `delete` forbids — and an object permissive enough for all three would
 * push every one of those rules into a runtime refinement, where the type system
 * could no longer help the caller get it right.
 */
export const submitCorrectionSchema = z.discriminatedUnion("kind", [
  createCorrectionSchema,
  amendCorrectionSchema,
  deleteCorrectionSchema,
]);

/**
 * §7.4's single-admin direct-edit path (`admin_edit_entry`).
 *
 * Every field optional, **and an omitted field means "leave unchanged"** — the
 * same NULL convention as `proposed_*`, because the RPC coalesces each argument
 * over the entry's current value. Two consequences inherited from the migration
 * rather than invented here: this path cannot clear a note (that needs a new
 * argument, not a reinterpretation of NULL), and it cannot re-open a closed
 * entry by proposing a NULL `ended_at`.
 *
 * At least one field is required for the same reason `amend` requires one: a
 * call that changes nothing would still write a revision row, and an audit trail
 * of no-ops is a worse trail.
 */
export const adminEditEntrySchema = z
  .object({
    startedAt: optionalLocalDateTimeSchema,
    endedAt: optionalLocalDateTimeSchema,
    projectId: optionalUuidSchema(PICK_PROJECT),
    taskId: optionalUuidSchema(PICK_TASK),
    note: entryNoteSchema,
  })
  .refine(
    (value) =>
      value.startedAt !== null ||
      value.endedAt !== null ||
      value.projectId !== null ||
      value.taskId !== null ||
      value.note !== null,
    { error: "Change at least one thing.", path: ["startedAt"] },
  )
  .refine((value) => value.projectId === null || value.taskId !== null, {
    error: "Pick a task in the new project too.",
    path: ["taskId"],
  });

export type CorrectionKind = z.infer<typeof correctionKindSchema>;
export type CorrectionStatus = z.infer<typeof correctionStatusSchema>;

/** What a form hands `submitCorrection`. */
export type SubmitCorrectionInput = z.input<typeof submitCorrectionSchema>;

/** What a form hands `adminEditEntry`. */
export type AdminEditEntryInput = z.input<typeof adminEditEntrySchema>;
