"use server";

import { revalidatePath } from "next/cache";

// Type-only, so it is erased at build time and does not pull another
// "use server" module into this one's graph.
import type { ActionResult } from "@/lib/actions/auth";
import { getCurrentMember } from "@/lib/actions/companies";
import type { TimeEntry } from "@/lib/actions/time-entries";
import { createClient } from "@/lib/supabase/server";
import {
  formatConflictRange,
  FUTURE_GRACE_MS,
  wallClockToInstant,
} from "@/lib/time/company-time";
import {
  adminEditEntrySchema,
  correctionRequestIdSchema,
  reviewNoteSchema,
  submitCorrectionSchema,
  type AdminEditEntryInput,
  type CorrectionKind,
  type CorrectionStatus,
  type SubmitCorrectionInput,
} from "@/lib/validations/corrections";
import { timeEntryIdSchema } from "@/lib/validations/time-entries";

import type { PostgrestError } from "@supabase/supabase-js";

/**
 * Phase 7 — corrections (§3.8, §3.9, §7.1–§7.4).
 *
 * `SPEC.md` §7 opens with "this is the heart of the product and the section most
 * likely to be misimplemented", and states the intent in one sentence: **an
 * employee cannot quietly rewrite their own history.** Almost none of that
 * enforcement lives in this file — it lives in `0006_corrections.sql`, in RLS
 * policies, column grants, CHECK constraints and three `SECURITY DEFINER`
 * functions. What lives here is the boundary: validate input, resolve wall
 * clocks against the company timezone, call the one path the database offers,
 * and turn its refusals into sentences.
 *
 * **Two mechanisms, not one, and they fail differently — this is the single
 * thing most likely to be got wrong here.**
 *
 *   * *Submitting* and *withdrawing* are plain table operations governed by RLS.
 *     A refusal is **silent**: PostgREST answers `200` with `[]` and nothing
 *     changed. `if (!error)` reports a withdrawal that never happened, which is
 *     the same hazard Phase 5 documented for `stop_timer()` and the migration
 *     re-states in the withdraw policy's own comment. Both check the row count.
 *   * *Approving*, *rejecting* and *direct admin edits* are RPCs that **raise**.
 *     They are branched on `error.code` **plus `error.details`** — never on the
 *     HTTP status (§7.4.1: a custom `P0002` arrives as a bare `500`,
 *     indistinguishable from a genuine fault, while `23P01` arrives as `400`) —
 *     because three different refusals share one honest `42501` and the DETAIL
 *     token is the only thing that tells them apart.
 */

const NOT_CONFIGURED =
  "Authentication is not configured. Check the Supabase environment variables.";

const NOT_SIGNED_IN = "You need to be signed in to do that.";

const NO_COMPANY =
  "You need to finish setting up your company before requesting a correction.";

const UNKNOWN_TIMEZONE =
  "Your company's timezone isn't one this server recognises. Ask an admin to set it again.";

/**
 * §7.4.1's not-found rule, and the reason it is one sentence for two database
 * answers: `approve_correction()` and `reject_correction()` filter by
 * `company_id` inside a `SECURITY DEFINER` body, so a Company 2 admin passing a
 * Company 1 id gets `P0002/request_not_found` — the same answer an id that never
 * existed produces. Telling them apart here would undo that, and would confirm
 * the existence of another tenant's rows. This is the same treatment
 * `accept_invitation()` gets in Phase 3.
 */
const REQUEST_NOT_FOUND =
  "That correction request doesn't exist, or you don't have access to it.";

/**
 * `42501/not_an_admin`. Covers the deactivated-admin case too: `is_admin()`
 * requires `role = 'admin' AND status = 'active'` (§4.1), so a member demoted or
 * deactivated while the queue page was open lands here rather than on a stale
 * success.
 */
const NOT_AN_ADMIN = "Only an admin can review correction requests.";

/** §7.4 [R]: "An admin cannot approve their own correction request." */
const SELF_APPROVAL =
  "You can't approve your own correction request. Ask another admin.";

const ALREADY_REVIEWED = "That request has already been reviewed.";

/**
 * The withdraw path's zero-row answer. RLS produces the same nothing for "not
 * yours", "another company's", "no such request" and "already decided", and the
 * database declines to distinguish them; so does this.
 */
const NOT_PENDING_OR_NOT_YOURS = "That request isn't pending, or isn't yours.";

const REASON_REQUIRED =
  "Tell us why — a reason is required for a correction request.";

const REVIEW_NOTE_REQUIRED = "A note explaining the rejection is required.";

/** §6.4, re-evaluated at approval time per §7.4 — "the world moved". */
const PROPOSED_IN_FUTURE = "The proposed time is in the future.";

/**
 * `23514/running_entry_reattribution`, raised by `apply_entry_change()` — the
 * one case where a running entry **is** correctable, and only in part. §5.4's
 * stale-timer remedy ("submit a correction with the real end time") depends on
 * reaching a running row; §5.1's "never mutate `project_id` on a running timer"
 * bounds what it may do there. The message says both halves, because a user told
 * only "no" would resubmit the same request.
 */
const RUNNING_ENTRY_REATTRIBUTION =
  "This entry's timer is still running — its project and start time can't be changed until it's stopped. You can still correct its end time.";

/**
 * `23514/entry_still_running`, raised by `admin_edit_entry()` — and deliberately
 * **not** the same rule as above. The direct-edit path refuses a running entry
 * outright rather than narrowing to a note-and-end-time edit, so the sentence is
 * an instruction rather than an explanation of what is still possible.
 */
const ENTRY_STILL_RUNNING =
  "Stop this entry's timer before editing it directly.";

/**
 * `42501/not_project_member` (§3.6.1). Phrased in the third person, unlike the
 * Phase 5/6 member refusal it belongs to the same family as: on this path the
 * caller is an admin and the person who is not assigned is somebody else, so
 * "You're not assigned to this project" would name the wrong user and send the
 * admin looking at their own memberships.
 */
const OWNER_NOT_PROJECT_MEMBER =
  "That entry's owner isn't assigned to the project it would move to. Add them to it first.";

const OVERLAP = "This overlaps another time entry.";

const ENTRY_GONE = "That time entry no longer exists.";

const TASK_NOT_IN_PROJECT =
  "That task doesn't belong to that project. Reload and pick again.";

const PROJECT_GONE = "That project no longer exists.";

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/**
 * One correction request as the rest of the app sees it (§3.9).
 *
 * `timeEntryId` carries no foreign key in the database, on purpose: §7.4
 * requires a request that outlives the entry it names, so that approval can
 * auto-withdraw rather than error. A non-null `timeEntryId` therefore does
 * **not** promise the entry still exists — `entry` on the hydrated shape below
 * is what answers that.
 */
export type CorrectionRequest = {
  id: string;
  kind: CorrectionKind;
  status: CorrectionStatus;
  timeEntryId: string | null;
  requestedBy: string;
  proposedStartedAt: string | null;
  proposedEndedAt: string | null;
  proposedProjectId: string | null;
  proposedTaskId: string | null;
  proposedNote: string | null;
  reason: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  createdAt: string;
};

/**
 * The referenced entry as it stands **now** — the "before" an admin needs beside
 * the proposal to decide anything at all.
 *
 * `null` for three different reasons, none of them an error: the request is a
 * `create` (there is no entry yet), the entry was deleted since (§7.4's
 * auto-withdraw case, which approval resolves), or the caller cannot see it. The
 * third only affects an employee looking at their own list, where it cannot
 * happen — `correction_requests_insert_own` proved the entry was theirs at
 * submission, and `time_entries` SELECT keeps it visible to them.
 */
export type CorrectionEntrySnapshot = {
  id: string;
  startedAt: string;
  endedAt: string | null;
  note: string | null;
  project: { id: string; name: string } | null;
  task: { id: string; name: string } | null;
};

/**
 * A request with everything a list row needs and nothing a component would
 * otherwise have to query for itself.
 *
 * The names are looked up rather than joined because none of `time_entry_id`,
 * `proposed_project_id` or `proposed_task_id` is a foreign key — the first by
 * design (see above), the other two because they are a *proposal*, not a
 * reference. PostgREST can only embed across a declared FK, so this is three
 * bounded `in (...)` reads per page, not one per row.
 *
 * Every name is nullable, and rendering "—" there is correct rather than a
 * broken row: an employee removed from a project keeps their entries (§2.3) but
 * loses `projects` SELECT on it, so their own history can come back label-less.
 */
export type CorrectionRequestWithContext = CorrectionRequest & {
  requesterName: string | null;
  reviewerName: string | null;
  entry: CorrectionEntrySnapshot | null;
  proposedProject: { id: string; name: string } | null;
  proposedTask: { id: string; name: string } | null;
};

const REQUEST_COLUMNS =
  "id, kind, status, time_entry_id, requested_by, proposed_started_at, proposed_ended_at, proposed_project_id, proposed_task_id, proposed_note, reason, reviewed_by, reviewed_at, review_note, created_at";

const REQUEST_COLUMNS_WITH_PEOPLE = `${REQUEST_COLUMNS}, requester:profiles!correction_requests_requested_by_company_id_fkey (id, full_name), reviewer:profiles!correction_requests_reviewed_by_company_id_fkey (id, full_name)`;

type RequestRow = {
  id: string;
  kind: CorrectionKind;
  status: CorrectionStatus;
  time_entry_id: string | null;
  requested_by: string;
  proposed_started_at: string | null;
  proposed_ended_at: string | null;
  proposed_project_id: string | null;
  proposed_task_id: string | null;
  proposed_note: string | null;
  reason: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
};

function toRequest(row: RequestRow): CorrectionRequest {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    timeEntryId: row.time_entry_id,
    requestedBy: row.requested_by,
    proposedStartedAt: row.proposed_started_at,
    proposedEndedAt: row.proposed_ended_at,
    proposedProjectId: row.proposed_project_id,
    proposedTaskId: row.proposed_task_id,
    proposedNote: row.proposed_note,
    reason: row.reason,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    reviewNote: row.review_note,
    createdAt: row.created_at,
  };
}

type ServerClient = Awaited<ReturnType<typeof createClient>>;

// ---------------------------------------------------------------------------
// Error translation
// ---------------------------------------------------------------------------

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * §5.2 / §7.4: "it fails with a specific message naming the conflicting entry."
 *
 * Phase 6 built this by re-running the exclusion constraint's own predicate as a
 * filter after the fact. It is not rebuilt here, and it is not reused either,
 * because `assert_entry_window_valid()` already did the search and put the
 * conflicting entry's **id in the exception's HINT** precisely so this layer
 * would not have to guess at the window: the correction path's effective times
 * are a coalesce of proposal over current state, which this layer does not
 * compute. So the hint is read, the entry is fetched, and
 * `formatConflictRange()` — the same function Phase 6's message goes through —
 * renders it in the company timezone (§6.1). Same sentence, same formatting,
 * one fewer thing to keep in step.
 *
 * Returns `null`, and the caller falls back to the generic sentence, when there
 * is no hint (a raw `23P01` from the constraint itself, which happens when the
 * pre-check loses a race), when the entry has since been deleted, or when the
 * company's zone is one this runtime cannot format. A wrong time in this message
 * is worse than no time.
 */
async function describeHintedOverlap(
  supabase: ServerClient,
  error: PostgrestError,
): Promise<string | null> {
  const hint = error.hint;
  if (!hint || !UUID_PATTERN.test(hint)) {
    return null;
  }

  const member = await getCurrentMember();
  if (!member.ok || !member.data?.company) {
    return null;
  }

  const { data, error: lookupError } = await supabase
    .from("time_entries")
    .select("started_at, ended_at")
    .eq("id", hint)
    .maybeSingle();

  if (lookupError || !data || !data.ended_at) {
    return null;
  }

  const startMs = Date.parse(data.started_at);
  const endMs = Date.parse(data.ended_at);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    return null;
  }

  try {
    return formatConflictRange(startMs, endMs, member.data.company.timezone);
  } catch {
    return null;
  }
}

/**
 * The refusals `insert into correction_requests` can produce. All of them are
 * constraint or policy violations rather than raised exceptions, so they carry
 * no DETAIL token (the migration's header says so explicitly) and the constraint
 * name in `error.message` is what distinguishes the four 23514s.
 */
function submitErrorMessage(error: PostgrestError): string {
  switch (error.code) {
    case "23502":
      // NOT NULL on `reason`. Unreachable through this action — zod refuses a
      // missing reason first — but §3.9 calls the reason non-negotiable, so the
      // database's own refusal of it gets the same sentence rather than a
      // generic one.
      return error.message.includes("reason")
        ? REASON_REQUIRED
        : "Could not file that correction request. Please try again.";
    case "23514":
      if (error.message.includes("reason_not_blank")) {
        return REASON_REQUIRED;
      }
      if (error.message.includes("shape_by_kind")) {
        // The kind's own shape rule. zod refuses each of these first, so
        // reaching here means the two disagree — worth a specific sentence
        // anyway, because the alternative is a constraint name.
        return "That correction request doesn't propose anything an admin could apply.";
      }
      if (error.message.includes("project_move_names_task")) {
        return "Pick a task in the new project too.";
      }
      if (error.message.includes("proposed_ends_after_starts")) {
        return "An entry has to end after it starts.";
      }
      return "Could not file that correction request. Please try again.";
    case "42501":
      // `correction_requests_insert_own`. Its third term is the one that bites:
      // `time_entry_id` carries no FK, so nothing structural stops a payload
      // from naming a colleague's entry, and the policy is what refuses it
      // (§7.1 — "Touch another user's entry: never"). The same code answers a
      // payload naming an ungranted column (company_id, requested_by, status),
      // which this module never sends.
      return "You can only request corrections for your own time entries.";
    case "23503":
      // requested_by -> profiles: the caller has no profile row yet.
      return "Your account isn't ready yet. Reload the page and try again.";
    default:
      return "Could not file that correction request. Please try again.";
  }
}

/**
 * `approve_correction()`'s refusals, branched on `error.code` and
 * `error.details` together.
 *
 * The DETAIL token is not optional garnish: three distinct refusals here are
 * `42501` and two are `P0002`, so `error.code` alone cannot tell "you may not
 * approve your own request" from "you are not an admin" from "the requester is
 * not on that project".
 */
async function approveErrorMessage(
  supabase: ServerClient,
  error: PostgrestError,
): Promise<string> {
  const detail = error.details ?? "";

  switch (error.code) {
    case "28000":
      return NOT_SIGNED_IN;
    case "42501":
      if (detail === "self_approval") {
        return SELF_APPROVAL;
      }
      if (detail === "not_project_member") {
        return OWNER_NOT_PROJECT_MEMBER;
      }
      if (detail === "entry_not_requesters") {
        return "That entry doesn't belong to the person who asked for this change.";
      }
      // `not_an_admin`, and also Postgres refusing EXECUTE outright — both mean
      // the caller has no standing to review anything.
      return NOT_AN_ADMIN;
    case "P0002":
      // `entry_not_found` from `apply_entry_change()`: the entry was deleted
      // between the request lock and the entry lock. Distinguished from
      // `request_not_found` because it leaks nothing — the request itself was
      // already visible to this admin — and because "reload the queue" is
      // actionable where the generic sentence is not.
      return detail === "entry_not_found" ? ENTRY_GONE : REQUEST_NOT_FOUND;
    case "23514":
      if (detail === "request_not_pending") {
        return ALREADY_REVIEWED;
      }
      if (detail === "running_entry_reattribution") {
        return RUNNING_ENTRY_REATTRIBUTION;
      }
      if (detail === "ended_before_started") {
        return "An entry has to end after it starts.";
      }
      // `time_entries_ended_after_started` itself, reached without a token when
      // the friendly pre-check is bypassed by a coalesce that produces a
      // reversed pair.
      return "An entry has to end after it starts.";
    case "22023":
      // `started_in_future` / `ended_in_future` — §6.4 re-evaluated at approval
      // time, which is the whole point of §7.4's re-validation: a proposal that
      // was fine when filed can be refused now, and vice versa.
      return PROPOSED_IN_FUTURE;
    case "23P01": {
      const range = await describeHintedOverlap(supabase, error);
      return range ? `This overlaps an entry from ${range}.` : OVERLAP;
    }
    case "23503":
      return error.message.includes("task")
        ? TASK_NOT_IN_PROJECT
        : PROJECT_GONE;
    case "23505":
      // `time_entries_one_running_per_user`. Not reachable today: an approved
      // `create` always carries both times (the shape CHECK), and an `amend`
      // cannot set `ended_at` back to NULL (NULL means "leave alone"). Mapped so
      // a future path does not surface as "please try again".
      return "That change would leave two timers running at once.";
    default:
      return "Could not approve that correction. Please try again.";
  }
}

function rejectErrorMessage(error: PostgrestError): string {
  const detail = error.details ?? "";

  switch (error.code) {
    case "28000":
      return NOT_SIGNED_IN;
    case "42501":
      return NOT_AN_ADMIN;
    case "P0002":
      return REQUEST_NOT_FOUND;
    case "23514":
      if (detail === "review_note_required") {
        return REVIEW_NOTE_REQUIRED;
      }
      if (detail === "request_not_pending") {
        return ALREADY_REVIEWED;
      }
      // `correction_requests_review_note_when_rejected` /
      // `..._review_note_not_blank` — the table CHECKs behind the function's own
      // check, reached only if the two ever disagree.
      return REVIEW_NOTE_REQUIRED;
    default:
      return "Could not reject that correction. Please try again.";
  }
}

async function adminEditErrorMessage(
  supabase: ServerClient,
  error: PostgrestError,
): Promise<string> {
  const detail = error.details ?? "";

  switch (error.code) {
    case "28000":
      return NOT_SIGNED_IN;
    case "42501":
      if (detail === "not_project_member") {
        return OWNER_NOT_PROJECT_MEMBER;
      }
      return "Only an admin can edit a recorded entry.";
    case "P0002":
      // Tenancy: `admin_edit_entry()` filters by `current_company_id()` inside a
      // definer body, so a Company 2 admin probing Company 1 ids gets exactly
      // this — and gets it *before* the running-entry check, so they cannot even
      // learn which of another tenant's entries are running.
      return "That time entry doesn't exist, or you don't have access to it.";
    case "23514":
      if (detail === "entry_still_running") {
        return ENTRY_STILL_RUNNING;
      }
      if (detail === "ended_before_started") {
        return "An entry has to end after it starts.";
      }
      return "An entry has to end after it starts.";
    case "22023":
      return PROPOSED_IN_FUTURE;
    case "23P01": {
      const range = await describeHintedOverlap(supabase, error);
      return range ? `This overlaps an entry from ${range}.` : OVERLAP;
    }
    case "23503":
      return error.message.includes("task")
        ? TASK_NOT_IN_PROJECT
        : PROJECT_GONE;
    default:
      return "Could not save that change. Please try again.";
  }
}

// ---------------------------------------------------------------------------
// Wall-clock resolution
// ---------------------------------------------------------------------------

type ResolvedTimes = {
  startedAt: Date | null;
  endedAt: Date | null;
};

/**
 * Proposed wall clocks → instants, plus the two rules that govern a
 * *proposal* — and the one that pointedly does not.
 *
 *   * **§6.4's future guard applies.** Five minutes of grace, the same constant
 *     `assert_entry_window_valid()` uses, applied to both ends. Checked here so
 *     a proposal dated next week is refused at submission instead of after an
 *     admin's round trip; checked again at approval because §7.4 says the world
 *     moved while it sat in the queue. Neither check is redundant: this one can
 *     pass and that one still fail, which is the intended behaviour, not a race.
 *   * **`ended_at > started_at` applies**, and only when both ends are proposed.
 *     A partial amend proposing one end is compared against the entry's current
 *     other end at approval, which is where the coalesce happens and the only
 *     place both values exist.
 *   * **§7.1's today-only rule does NOT apply.** See the header of
 *     `lib/validations/corrections.ts`: it governs what may be asserted without
 *     approval, and a correction is by definition the approved path. Applying it
 *     here would refuse "I forgot to log Tuesday", which is the request this
 *     whole feature exists to carry.
 */
function resolveProposedTimes(
  startedLocal: string | null,
  endedLocal: string | null,
  timeZone: string,
  now: number,
): ActionResult<ResolvedTimes> {
  let startedAt: Date | null = null;
  let endedAt: Date | null = null;

  try {
    startedAt = startedLocal
      ? wallClockToInstant(startedLocal, timeZone)
      : null;
    endedAt = endedLocal ? wallClockToInstant(endedLocal, timeZone) : null;
  } catch {
    return { ok: false, error: UNKNOWN_TIMEZONE };
  }

  if (startedAt && endedAt && endedAt.getTime() <= startedAt.getTime()) {
    return { ok: false, error: "An entry has to end after it starts." };
  }

  const limit = now + FUTURE_GRACE_MS;
  if (
    (startedAt && startedAt.getTime() > limit) ||
    (endedAt && endedAt.getTime() > limit)
  ) {
    return { ok: false, error: "You can't log time that hasn't happened yet." };
  }

  return { ok: true, data: { startedAt, endedAt } };
}

/**
 * The company timezone, plus the caller's own id. One read, because every path
 * that resolves a wall clock also needs to know it has a company at all — a
 * limbo user (§8.3) has neither.
 */
async function currentTimeZone(): Promise<ActionResult<string>> {
  const member = await getCurrentMember();
  if (!member.ok) {
    return member;
  }
  if (!member.data) {
    return { ok: false, error: NOT_SIGNED_IN };
  }
  if (!member.data.company) {
    return { ok: false, error: NO_COMPANY };
  }
  return { ok: true, data: member.data.company.timezone };
}

// ---------------------------------------------------------------------------
// Submit / withdraw — plain table operations under RLS
// ---------------------------------------------------------------------------

/**
 * The only shape an insert from this module may take.
 *
 * `company_id`, `requested_by` and `status` are absent and can never be present:
 * all three are defaulted in the database and carry no INSERT grant, so naming
 * one fails `42501` *even with the correct value*. `reviewed_by`, `reviewed_at`
 * and `review_note` are ungranted for every verb — a review is written by a
 * function or not at all.
 */
type SubmitPayload = {
  kind: CorrectionKind;
  reason: string;
  time_entry_id?: string;
  proposed_started_at?: string;
  proposed_ended_at?: string;
  proposed_project_id?: string;
  proposed_task_id?: string;
  proposed_note?: string;
};

/**
 * §7.1's escape hatch: everything the employee may not do alone becomes a
 * request an admin decides on.
 *
 * Three kinds, discriminated in the schema so the shape rules are type errors
 * rather than round trips (`create` proposes a whole entry and names none;
 * `amend` names one and proposes at least one change; `delete` names one and
 * proposes nothing).
 *
 * Times are wall clocks in `companies.timezone`, resolved here — never in SQL —
 * so a proposal round-trips through the same reading Phase 6's manual entries
 * get, including the ambiguous-DST-hour choice `wallClockToInstant` documents.
 *
 * The reason is required three times over: by `correctionReasonSchema` here, by
 * `NOT NULL` in the table, and by `correction_requests_reason_not_blank` for the
 * whitespace that would satisfy `NOT NULL`. §3.9 calls it "the entire point of
 * the approval step", and a request that arrives without one should never reach
 * the queue in any of the three ways it could try.
 */
export async function submitCorrection(
  input: SubmitCorrectionInput,
): Promise<ActionResult<CorrectionRequest>> {
  const parsed = submitCorrectionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error:
        parsed.error.issues[0]?.message ??
        "Could not file that correction request.",
    };
  }

  const payload: SubmitPayload = {
    kind: parsed.data.kind,
    reason: parsed.data.reason,
  };

  if (parsed.data.kind !== "create") {
    payload.time_entry_id = parsed.data.timeEntryId;
  }

  if (parsed.data.kind !== "delete") {
    const timeZone = await currentTimeZone();
    if (!timeZone.ok) {
      return timeZone;
    }

    const resolved = resolveProposedTimes(
      parsed.data.proposedStartedAt ?? null,
      parsed.data.proposedEndedAt ?? null,
      timeZone.data,
      Date.now(),
    );
    if (!resolved.ok) {
      return resolved;
    }

    if (resolved.data.startedAt) {
      payload.proposed_started_at = resolved.data.startedAt.toISOString();
    }
    if (resolved.data.endedAt) {
      payload.proposed_ended_at = resolved.data.endedAt.toISOString();
    }
    if (parsed.data.proposedProjectId) {
      payload.proposed_project_id = parsed.data.proposedProjectId;
    }
    if (parsed.data.proposedTaskId) {
      payload.proposed_task_id = parsed.data.proposedTaskId;
    }
    if (parsed.data.proposedNote) {
      payload.proposed_note = parsed.data.proposedNote;
    }
  }

  let request: CorrectionRequest;
  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("correction_requests")
      .insert(payload)
      .select(REQUEST_COLUMNS)
      .single();

    if (error) {
      return { ok: false, error: submitErrorMessage(error) };
    }

    request = toRequest(data);
  } catch {
    return { ok: false, error: NOT_CONFIGURED };
  }

  revalidatePath("/", "layout");
  return { ok: true, data: request };
}

/**
 * §7.4's third outcome: "withdrawn (by requester, only while pending)".
 *
 * A plain UPDATE, not an RPC, because it is one status flip on the caller's own
 * pending row and needs no elevated privilege (§4.4) —
 * `correction_requests_update_withdraw_own_pending` states the whole rule, with
 * `USING` pinning the old status to `pending` and `WITH CHECK` pinning the new
 * one to `withdrawn`.
 *
 * **The row count is the result, not the error.** Two of the three refusals are
 * silent: someone else's request and an already-decided one are both filtered by
 * `USING`, which PostgREST answers `200 []`. Only "set status to something other
 * than withdrawn" raises, and this action never sends anything else. So `!error`
 * proves nothing at all here — the same hazard Phase 5's `stop_timer()` has, in
 * a second place, and the migration's own policy comment says so.
 */
export async function withdrawCorrection(
  requestId: string,
): Promise<ActionResult<CorrectionRequest>> {
  const parsed = correctionRequestIdSchema.safeParse(requestId);
  if (!parsed.success) {
    return { ok: false, error: REQUEST_NOT_FOUND };
  }

  let request: CorrectionRequest;
  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("correction_requests")
      .update({ status: "withdrawn" })
      .eq("id", parsed.data)
      .select(REQUEST_COLUMNS);

    if (error) {
      return {
        ok: false,
        error:
          error.code === "23514"
            ? ALREADY_REVIEWED
            : "Could not withdraw that request. Please try again.",
      };
    }

    const row = data.at(0);
    if (!row) {
      return { ok: false, error: NOT_PENDING_OR_NOT_YOURS };
    }

    request = toRequest(row);
  } catch {
    return { ok: false, error: NOT_CONFIGURED };
  }

  revalidatePath("/", "layout");
  return { ok: true, data: request };
}

// ---------------------------------------------------------------------------
// Review — SECURITY DEFINER RPCs
// ---------------------------------------------------------------------------

/**
 * §7.3 / §7.4, the core of the phase: validate → snapshot into
 * `time_entry_revisions` → mutate/insert/delete the entry → mark the request
 * approved, **in one transaction**. All of that is `approve_correction()`; this
 * action is the call and the translation of its refusals.
 *
 * It is an RPC and there is no fallback path, because there is no second path:
 * no client-issued UPDATE can set `status = 'approved'` (the only UPDATE policy
 * pins the new status to `withdrawn`), no client can execute
 * `apply_entry_change()`, and `time_entries` has no admin UPDATE policy at all.
 * Approval without the revision row is not merely discouraged — it is
 * unexpressible.
 *
 * **The returned status is worth reading, not assuming.** §7.4: "Requests
 * referencing an entry that was since deleted are auto-marked `withdrawn` at
 * approval time rather than erroring." That path commits and returns a row whose
 * `status` is `withdrawn`, not `approved`, with a `reviewNote` explaining why.
 * A caller that renders "approved" on `ok: true` will occasionally lie.
 */
export async function approveCorrection(
  requestId: string,
): Promise<ActionResult<CorrectionRequest>> {
  const parsed = correctionRequestIdSchema.safeParse(requestId);
  if (!parsed.success) {
    return { ok: false, error: REQUEST_NOT_FOUND };
  }

  let request: CorrectionRequest;
  try {
    const supabase = await createClient();

    const { data, error } = await supabase.rpc("approve_correction", {
      p_request_id: parsed.data,
    });

    if (error) {
      return { ok: false, error: await approveErrorMessage(supabase, error) };
    }

    // Every path in the function either returns a real row or raises, so this
    // cannot happen — but a composite that matched no row would arrive as an
    // object whose every field is null, which is truthy, so the check is on `id`
    // rather than on `data` (Phase 5's `stop_timer()` note).
    if (!data?.id) {
      return { ok: false, error: REQUEST_NOT_FOUND };
    }

    request = toRequest(data);
  } catch {
    return { ok: false, error: NOT_CONFIGURED };
  }

  revalidatePath("/", "layout");
  return { ok: true, data: request };
}

/**
 * §7.4's other terminal decision. Rejection is an RPC rather than a plain UPDATE
 * for one reason worth restating: `reviewed_at` must be the server's clock, and
 * granting UPDATE on it would let an admin backdate a review — the same hazard
 * §5.3 refuses for `ended_at`.
 *
 * The note is required by the schema here, by `reject_correction()` (which
 * refuses whitespace), and by two table CHECKs. "A rejected request is terminal.
 * The employee submits a new one; the rejected record stays for the audit
 * trail" — so a rejection with no stated reason would leave a permanent record
 * that explains nothing.
 */
export async function rejectCorrection(
  requestId: string,
  reviewNote: string,
): Promise<ActionResult<CorrectionRequest>> {
  const parsedId = correctionRequestIdSchema.safeParse(requestId);
  if (!parsedId.success) {
    return { ok: false, error: REQUEST_NOT_FOUND };
  }

  const parsedNote = reviewNoteSchema.safeParse(reviewNote);
  if (!parsedNote.success) {
    return {
      ok: false,
      error: parsedNote.error.issues[0]?.message ?? REVIEW_NOTE_REQUIRED,
    };
  }

  let request: CorrectionRequest;
  try {
    const supabase = await createClient();

    const { data, error } = await supabase.rpc("reject_correction", {
      p_request_id: parsedId.data,
      p_review_note: parsedNote.data,
    });

    if (error) {
      return { ok: false, error: rejectErrorMessage(error) };
    }

    if (!data?.id) {
      return { ok: false, error: REQUEST_NOT_FOUND };
    }

    request = toRequest(data);
  } catch {
    return { ok: false, error: NOT_CONFIGURED };
  }

  revalidatePath("/", "layout");
  return { ok: true, data: request };
}

/**
 * §7.4's single-admin path: "If a company has one admin, that admin edits
 * entries directly (admin edits also write revision rows) rather than routing
 * through a request."
 *
 * **NULL means "leave unchanged", so this sends only the keys the caller asked
 * to change.** `admin_edit_entry()` declares every value argument
 * `default null` and coalesces each over the entry's current value, so an
 * omitted key and an explicit null are the same instruction — and sending a
 * whole struct of nulls "for consistency" would be a call that writes a revision
 * row and changes nothing. Two consequences inherited from that convention
 * rather than chosen here: this path cannot clear a note (the owner can, through
 * `updateEntryNote`), and it cannot re-open a closed entry.
 *
 * **It refuses a running entry outright** (`23514/entry_still_running`), which is
 * *not* symmetric with the correction path. An approved amend may touch a
 * running entry to set its `ended_at` — §5.4's stale-timer remedy depends on
 * that — but `admin_edit_entry()` has no business with a row still being
 * measured, so it rejects the whole call rather than silently degrading to a
 * note-and-end-time edit. The two paths' messages differ accordingly.
 *
 * There is no delete here, and none can be added from this layer: §7.4 describes
 * direct *edits* only, so deleting a closed entry stays behind an approved
 * `kind='delete'` request — which a lone admin cannot approve for themselves.
 * That gap is real, reachable, and tracked in `BLOCKERS.md` (N-8) rather than
 * papered over with an invented RPC.
 */
export async function adminEditEntry(
  entryId: string,
  input: AdminEditEntryInput,
): Promise<ActionResult<TimeEntry>> {
  const parsedId = timeEntryIdSchema.safeParse(entryId);
  if (!parsedId.success) {
    return { ok: false, error: ENTRY_GONE };
  }

  const parsed = adminEditEntrySchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Could not save that change.",
    };
  }

  const args: {
    p_entry_id: string;
    p_started_at?: string;
    p_ended_at?: string;
    p_project_id?: string;
    p_task_id?: string;
    p_note?: string;
  } = { p_entry_id: parsedId.data };

  if (parsed.data.startedAt || parsed.data.endedAt) {
    const timeZone = await currentTimeZone();
    if (!timeZone.ok) {
      return timeZone;
    }

    const resolved = resolveProposedTimes(
      parsed.data.startedAt,
      parsed.data.endedAt,
      timeZone.data,
      Date.now(),
    );
    if (!resolved.ok) {
      return resolved;
    }

    if (resolved.data.startedAt) {
      args.p_started_at = resolved.data.startedAt.toISOString();
    }
    if (resolved.data.endedAt) {
      args.p_ended_at = resolved.data.endedAt.toISOString();
    }
  }

  if (parsed.data.projectId) {
    args.p_project_id = parsed.data.projectId;
  }
  if (parsed.data.taskId) {
    args.p_task_id = parsed.data.taskId;
  }
  if (parsed.data.note) {
    args.p_note = parsed.data.note;
  }

  let entry: TimeEntry;
  try {
    const supabase = await createClient();

    const { data, error } = await supabase.rpc("admin_edit_entry", args);

    if (error) {
      return { ok: false, error: await adminEditErrorMessage(supabase, error) };
    }

    if (!data?.id) {
      return { ok: false, error: ENTRY_GONE };
    }

    entry = {
      id: data.id,
      projectId: data.project_id,
      taskId: data.task_id,
      startedAt: data.started_at,
      endedAt: data.ended_at,
      durationSeconds: data.duration_seconds,
      source: data.source,
      note: data.note,
    };
  } catch {
    return { ok: false, error: NOT_CONFIGURED };
  }

  revalidatePath("/", "layout");
  return { ok: true, data: entry };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

type PersonRef = { id: string; full_name: string } | null;

type RequestRowWithPeople = RequestRow & {
  requester: PersonRef;
  reviewer: PersonRef;
};

/**
 * The three lookups a page of requests needs and cannot get from a join.
 *
 * Each is skipped entirely when its id set is empty, and each is one `in (...)`
 * read regardless of page size — so this is at most three extra round trips per
 * list, never N. RLS scopes all three: an admin sees the whole company, an
 * employee sees their own entries and the projects they are a member of.
 */
async function hydrate(
  supabase: ServerClient,
  rows: RequestRowWithPeople[],
): Promise<CorrectionRequestWithContext[]> {
  const entryIds = unique(rows.map((row) => row.time_entry_id));
  const projectIds = unique(rows.map((row) => row.proposed_project_id));
  const taskIds = unique(rows.map((row) => row.proposed_task_id));

  const entries = new Map<string, CorrectionEntrySnapshot>();
  if (entryIds.length > 0) {
    const { data } = await supabase
      .from("time_entries")
      .select(
        "id, started_at, ended_at, note, projects (id, name), tasks (id, name)",
      )
      .in("id", entryIds);

    for (const row of data ?? []) {
      entries.set(row.id, {
        id: row.id,
        startedAt: row.started_at,
        endedAt: row.ended_at,
        note: row.note,
        project: row.projects,
        task: row.tasks,
      });
    }
  }

  const projects = new Map<string, { id: string; name: string }>();
  if (projectIds.length > 0) {
    const { data } = await supabase
      .from("projects")
      .select("id, name")
      .in("id", projectIds);

    for (const row of data ?? []) {
      projects.set(row.id, row);
    }
  }

  const tasks = new Map<string, { id: string; name: string }>();
  if (taskIds.length > 0) {
    const { data } = await supabase
      .from("tasks")
      .select("id, name")
      .in("id", taskIds);

    for (const row of data ?? []) {
      tasks.set(row.id, row);
    }
  }

  return rows.map((row) => ({
    ...toRequest(row),
    requesterName: row.requester?.full_name ?? null,
    reviewerName: row.reviewer?.full_name ?? null,
    entry: row.time_entry_id ? (entries.get(row.time_entry_id) ?? null) : null,
    proposedProject: row.proposed_project_id
      ? (projects.get(row.proposed_project_id) ?? null)
      : null,
    proposedTask: row.proposed_task_id
      ? (tasks.get(row.proposed_task_id) ?? null)
      : null,
  }));
}

function unique(values: (string | null)[]): string[] {
  return Array.from(new Set(values.filter((value) => value !== null)));
}

/**
 * The employee's own requests, every status, newest first — the other half of
 * §7.4's lifecycle made visible: what I asked for, what happened to it, and why
 * (`reviewNote` carries the rejection's explanation, and the auto-withdraw's).
 *
 * `requested_by` is filtered explicitly even though RLS already scopes an
 * *employee* to their own rows, because it does not scope an **admin**:
 * `correction_requests_select_own_or_admin` returns the whole company to one, so
 * without this an admin's "my requests" list would be the entire queue.
 */
export async function listMyCorrectionRequests(): Promise<
  ActionResult<CorrectionRequestWithContext[]>
> {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { ok: false, error: NOT_SIGNED_IN };
    }

    const { data, error } = await supabase
      .from("correction_requests")
      .select(REQUEST_COLUMNS_WITH_PEOPLE)
      .eq("requested_by", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      return { ok: false, error: "Could not load your correction requests." };
    }

    return { ok: true, data: await hydrate(supabase, data) };
  } catch {
    return { ok: false, error: NOT_CONFIGURED };
  }
}

/**
 * The admin queue: pending only, newest first, company-scoped.
 *
 * **RLS is the boundary and the filters are not.** `status` is filtered here
 * rather than left to the caller because "pending" is what makes this a queue —
 * a list that silently included decided requests would grow without bound and
 * offer approve buttons that cannot work. `company_id` is *not* filtered,
 * because `correction_requests_select_own_or_admin` already scopes it and a
 * redundant filter in TypeScript invites the reading that tenancy is enforced
 * here.
 *
 * Not role-checked either: an employee calling this gets their own pending
 * requests, which is what the same policy gives them everywhere else. The queue
 * page is admin-only in the UI; the data is admin-only in the database. Adding a
 * third check here would only be able to disagree with one of them.
 */
export async function listPendingCorrectionRequests(): Promise<
  ActionResult<CorrectionRequestWithContext[]>
> {
  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("correction_requests")
      .select(REQUEST_COLUMNS_WITH_PEOPLE)
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    if (error) {
      return { ok: false, error: "Could not load the correction queue." };
    }

    return { ok: true, data: await hydrate(supabase, data) };
  } catch {
    return { ok: false, error: NOT_CONFIGURED };
  }
}

/**
 * Every request filed against one entry, newest first.
 *
 * This earns its own query rather than being filtered out of the two above:
 * it answers "is a correction already pending for this row", which is what keeps
 * the UI from offering *Request a correction* twice on the same entry and what
 * shows an employee why an entry they asked about has not changed. The migration
 * builds a partial index for exactly this read
 * (`correction_requests_time_entry_id_idx`), which is as close to a stated
 * intention as an index gets.
 *
 * Scoped entirely by RLS: an employee sees their own requests about their own
 * entry, an admin sees every request about it, and neither sees another
 * company's. No `create` request can appear here — those name no entry.
 */
export async function listCorrectionRequestsForEntry(
  entryId: string,
): Promise<ActionResult<CorrectionRequestWithContext[]>> {
  const parsed = timeEntryIdSchema.safeParse(entryId);
  if (!parsed.success) {
    return { ok: false, error: ENTRY_GONE };
  }

  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("correction_requests")
      .select(REQUEST_COLUMNS_WITH_PEOPLE)
      .eq("time_entry_id", parsed.data)
      .order("created_at", { ascending: false });

    if (error) {
      return { ok: false, error: "Could not load this entry's corrections." };
    }

    return { ok: true, data: await hydrate(supabase, data) };
  } catch {
    return { ok: false, error: NOT_CONFIGURED };
  }
}
