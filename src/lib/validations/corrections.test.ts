import { describe, expect, test } from "vitest";

import {
  adminEditEntrySchema,
  reviewNoteSchema,
  submitCorrectionSchema,
} from "./corrections";

/**
 * The shape rules in `submitCorrectionSchema` mirror
 * `correction_requests_shape_by_kind` in `0006_corrections.sql`. The database is
 * the enforcement; these tests are about the boundary agreeing with it, because
 * a disagreement surfaces to the user as a constraint name instead of a
 * sentence.
 *
 * Everything here is pure — no Supabase, no clock, no timezone. §6.4's future
 * guard and §7.1's (deliberately absent) today-only rule are decided in
 * `lib/actions/corrections.ts`, where the company timezone and the server clock
 * exist, and are verified against the live stack rather than here.
 */

const ENTRY = "3f1a2b6c-9d4e-4f7a-8b21-0c5d6e7f8a90";
const PROJECT = "5c2b1a4d-7e8f-4a3b-9c1d-2e3f4a5b6c7d";
const TASK = "7d3c2b1a-6e5f-4d3c-8b2a-1f0e9d8c7b6a";

describe("submitCorrectionSchema", () => {
  test("an amend that proposes nothing is refused", () => {
    const result = submitCorrectionSchema.safeParse({
      kind: "amend",
      timeEntryId: ENTRY,
      reason: "please fix",
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      "Propose at least one change for an admin to review.",
    );
  });

  test("an amend proposing one end time is enough, and blanks mean 'leave alone'", () => {
    const result = submitCorrectionSchema.safeParse({
      kind: "amend",
      timeEntryId: ENTRY,
      proposedStartedAt: "",
      proposedEndedAt: "2026-08-20T15:30",
      reason: "I forgot to stop the timer",
    });

    expect(result.success).toBe(true);
    if (result.success && result.data.kind === "amend") {
      expect(result.data.proposedStartedAt).toBeNull();
      // Normalised to the 19-character form the action slices by position.
      expect(result.data.proposedEndedAt).toBe("2026-08-20T15:30:00");
      expect(result.data.proposedProjectId).toBeNull();
    }
  });

  test("moving to another project must name a task in it", () => {
    const result = submitCorrectionSchema.safeParse({
      kind: "amend",
      timeEntryId: ENTRY,
      proposedProjectId: PROJECT,
      reason: "wrong project",
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      "Pick a task in the new project too.",
    );
  });

  test("a create proposes a whole entry and names no existing one", () => {
    const missingTimes = submitCorrectionSchema.safeParse({
      kind: "create",
      proposedProjectId: PROJECT,
      proposedTaskId: TASK,
      reason: "laptop was dead",
    });
    expect(missingTimes.success).toBe(false);

    const complete = submitCorrectionSchema.safeParse({
      kind: "create",
      proposedStartedAt: "2026-08-14T09:00",
      proposedEndedAt: "2026-08-14T11:00",
      proposedProjectId: PROJECT,
      proposedTaskId: TASK,
      reason: "laptop was dead",
    });
    expect(complete.success).toBe(true);
    if (complete.success) {
      expect("timeEntryId" in complete.data).toBe(false);
    }
  });

  test("a delete carries the entry and the reason, and nothing else", () => {
    const result = submitCorrectionSchema.safeParse({
      kind: "delete",
      timeEntryId: ENTRY,
      reason: "double-logged this one",
      // A form that sends this anyway must not smuggle it into the insert:
      // anything proposed alongside a deletion is refused by the table's own
      // shape CHECK.
      proposedNote: "sneaky",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect("proposedNote" in result.data).toBe(false);
    }
  });

  test("a reason is required, and whitespace is not a reason", () => {
    for (const reason of ["", "   ", undefined]) {
      const result = submitCorrectionSchema.safeParse({
        kind: "delete",
        timeEntryId: ENTRY,
        reason,
      });

      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toBe(
        "Tell us why — a reason is required for a correction request.",
      );
    }
  });

  test("a malformed wall clock is refused before it can reach the database", () => {
    const withOffset = submitCorrectionSchema.safeParse({
      kind: "amend",
      timeEntryId: ENTRY,
      proposedEndedAt: "2026-08-20T15:30:00Z",
      reason: "utc, not company time",
    });
    expect(withOffset.success).toBe(false);

    const notARealDay = submitCorrectionSchema.safeParse({
      kind: "amend",
      timeEntryId: ENTRY,
      proposedEndedAt: "2026-02-30T09:00",
      reason: "no such day",
    });
    expect(notARealDay.success).toBe(false);
  });
});

describe("adminEditEntrySchema", () => {
  test("an edit that changes nothing is refused", () => {
    const result = adminEditEntrySchema.safeParse({});

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Change at least one thing.");
  });

  test("omitted fields stay null — NULL means 'leave unchanged'", () => {
    const result = adminEditEntrySchema.safeParse({
      endedAt: "2026-08-20T17:30",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.startedAt).toBeNull();
      expect(result.data.projectId).toBeNull();
      expect(result.data.note).toBeNull();
      expect(result.data.endedAt).toBe("2026-08-20T17:30:00");
    }
  });
});

describe("reviewNoteSchema", () => {
  test("a rejection note cannot be blank", () => {
    expect(reviewNoteSchema.safeParse("   ").success).toBe(false);
    expect(reviewNoteSchema.safeParse("That day was billed to P.")).toEqual({
      success: true,
      data: "That day was billed to P.",
    });
  });
});
