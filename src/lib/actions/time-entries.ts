"use server";

import { revalidatePath } from "next/cache";

// Type-only, so it is erased at build time and does not pull another
// "use server" module into this one's graph.
import type { ActionResult } from "@/lib/actions/auth";
import { createClient } from "@/lib/supabase/server";
import {
  entryNoteSchema,
  listMyEntriesOptionsSchema,
  startTimerSchema,
  timeEntryIdSchema,
  type EntrySource,
  type ListMyEntriesOptions,
} from "@/lib/validations/time-entries";

import type { PostgrestError } from "@supabase/supabase-js";

const NOT_CONFIGURED =
  "Authentication is not configured. Check the Supabase environment variables.";

const NOT_SIGNED_IN = "You need to be signed in to track time.";

/**
 * The one sentence every "the database quietly did nothing" path returns.
 *
 * Zero rows is what RLS produces for *all* of "no such entry", "someone else's
 * entry", "another company's entry" and — for `discardTimer` — "already
 * closed". The database deliberately does not distinguish them (telling them
 * apart would confirm the existence of other people's entries), so neither does
 * this message. It is honest rather than vague: it names both possibilities it
 * could be and claims to know which one it is in neither case.
 */
const NOT_RUNNING_OR_NOT_YOURS = "That timer isn't running, or isn't yours.";

/**
 * One time entry as the rest of the app sees it.
 *
 * `endedAt === null` **is** "the timer is running" (§5.1) — there is no
 * separate timer entity and no status column to consult. `durationSeconds` is
 * `GENERATED STORED` and therefore null for exactly the same rows; it is
 * integer seconds and must stay that way through every sum, formatted only at
 * the edge (§9.5).
 */
export type TimeEntry = {
  id: string;
  projectId: string;
  taskId: string;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  source: EntrySource;
  note: string | null;
};

/**
 * An entry with the labels a list needs. Both are nullable because the embed
 * is a join through RLS, not a guaranteed row: an employee removed from a
 * project keeps their entries (§2.3) but loses `projects` SELECT on it, so
 * their own history can come back label-less. Rendering "—" there is correct;
 * treating it as a broken row is not.
 */
export type TimeEntryWithLabels = TimeEntry & {
  project: { id: string; name: string } | null;
  task: { id: string; name: string } | null;
};

/**
 * What `getRunningTimer()` returns. The two nulls are narrowed literals so a
 * caller that has a `RunningTimer` in hand cannot be asked to render an end
 * time or a duration that, by construction, does not exist yet — the elapsed
 * counter is computed in the UI from `startedAt` and is display-only (§5.3).
 */
export type RunningTimer = Omit<
  TimeEntryWithLabels,
  "endedAt" | "durationSeconds"
> & {
  endedAt: null;
  durationSeconds: null;
};

const ENTRY_COLUMNS =
  "id, project_id, task_id, started_at, ended_at, duration_seconds, source, note";

const ENTRY_COLUMNS_WITH_LABELS = `${ENTRY_COLUMNS}, projects (id, name), tasks (id, name)`;

type EntryRow = {
  id: string;
  project_id: string;
  task_id: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  source: EntrySource;
  note: string | null;
};

type EntryRowWithLabels = EntryRow & {
  projects: { id: string; name: string } | null;
  tasks: { id: string; name: string } | null;
};

function toEntry(row: EntryRow): TimeEntry {
  return {
    id: row.id,
    projectId: row.project_id,
    taskId: row.task_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationSeconds: row.duration_seconds,
    source: row.source,
    note: row.note,
  };
}

function toEntryWithLabels(row: EntryRowWithLabels): TimeEntryWithLabels {
  return { ...toEntry(row), project: row.projects, task: row.tasks };
}

/**
 * §5.2 asks for "This overlaps an entry from 14:00–15:30", naming the
 * conflicting range. That is deliberately **not** attempted here, and the
 * omission is scoped rather than permanent:
 *
 *   * Through a pure timer start/stop this is effectively unreachable —
 *     `started_at` is `now()` and the exclusion constraint ignores running
 *     rows, so there is no closed range for a new entry to land inside. It
 *     becomes reachable in Phase 6, when a manual entry can be written over a
 *     period that already has one.
 *   * The conflicting range is only available by parsing Postgres's `DETAIL`
 *     text, which is a locale- and version-dependent string, not an API. Phase
 *     6 should name the range with a real query against `tstzrange` overlap
 *     before it inserts, where the answer is data rather than prose.
 *
 * So the honest message for now says what happened without inventing a
 * precision this layer does not have.
 */
const OVERLAP = "This overlaps another time entry.";

function startTimerErrorMessage(error: PostgrestError): string {
  switch (error.code) {
    case "23505":
      // `time_entries_one_running_per_user` — the partial unique index on
      // (user_id) WHERE ended_at IS NULL. This is the two-tabs race in §3.7
      // arriving as a constraint violation rather than as a second timer, which
      // is exactly the design: no read-then-insert in this layer could have
      // won that race.
      return error.message.includes("one_running_per_user")
        ? "You already have a timer running. Stop it before starting another."
        : "Could not start the timer. Please try again.";
    case "42501":
      // `time_entries_insert_self_and_member`. Its third term is
      // `is_project_member(project_id)`, with no `or is_admin()` — §3.6.1 rules
      // that assignment governs time entry and role governs only visibility, so
      // an admin who can *see* every project still cannot log time to one they
      // are not on. That is a normal, recoverable state (an admin adds them,
      // possibly themselves), so it gets a sentence that says what to do rather
      // than a generic refusal.
      //
      // The same code would also answer a payload naming an ungranted column
      // (company_id, user_id, ...) — this module never sends one — and a limbo
      // caller whose `current_company_id()` is NULL, whom middleware (§8.3)
      // does not let reach a timer at all.
      return "You're not assigned to this project. Ask an admin to add you to it before logging time.";
    case "23P01":
      return OVERLAP;
    case "23503":
      // Either FK: the project does not exist, or the task is real but belongs
      // to a different project (`time_entries_task_id_project_id_fkey`, the
      // pair check 0004 could not make). Both mean the picker is out of date.
      return error.message.includes("task")
        ? "That task doesn't belong to that project. Reload and pick again."
        : "That project no longer exists.";
    case "23502":
      // `set_company_id_from_project()` raises this when project_id names
      // nothing at all.
      return "That project no longer exists.";
    case "23514":
      // `ended_at <= started_at`. Unreachable from here — this insert never
      // sends either timestamp — so there is nothing specific to say.
      return "Something went wrong recording that entry.";
    default:
      return "Could not start the timer. Please try again.";
  }
}

function stopTimerErrorMessage(error: PostgrestError): string {
  switch (error.code) {
    case "42501":
      // `time_entries_guard_update` raising on a closed row, and its message is
      // already the sentence a user needs ("the times on a closed entry change
      // only through a correction request..."). Passed through verbatim rather
      // than rewrapped: restating it here would be a second copy of §7.1's rule
      // that can drift from the trigger actually enforcing it.
      //
      // The other 42501 this trigger can raise — an `ended_at` the server did
      // not choose (§5.3) — is unreachable through `stop_timer()`, which is the
      // only path this module uses and never sends a value at all.
      return error.message;
    case "23P01":
      // Reachable: a manual entry (Phase 6) written across the period a timer
      // was already running turns the stop into an overlap.
      return OVERLAP;
    case "23514":
      return "Something went wrong recording that entry.";
    default:
      return "Could not stop the timer. Please try again.";
  }
}

/**
 * §5.1's start transition.
 *
 * **The payload is four keys and can never be more.** `started_at` is absent on
 * purpose — it defaults to `now()` in Postgres, and sending one from Node would
 * reintroduce exactly the clock-trust §5.3 forbids, letting a wrong device
 * clock decide how long someone worked. `company_id`, `user_id`, `created_at`,
 * `updated_at` and `duration_seconds` are absent because `authenticated` holds
 * no INSERT grant on any of them: they are derived or generated, and naming one
 * fails 42501 at runtime *even with the correct value*, which
 * `supabase gen types` cannot warn about because it reads defaults and
 * nullability, never column grants.
 *
 * `note` is omitted entirely when blank rather than sent as `undefined` — a
 * key whose value is `undefined` is dropped by the JSON encoder anyway, but
 * saying so in the payload's type is what keeps that an intention instead of a
 * coincidence.
 */
export async function startTimer(
  projectId: string,
  taskId: string,
  note?: string | null,
): Promise<ActionResult<TimeEntry>> {
  const parsed = startTimerSchema.safeParse({ projectId, taskId, note });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Could not start the timer.",
    };
  }

  let entry: TimeEntry;
  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("time_entries")
      .insert(buildStartPayload(parsed.data))
      .select(ENTRY_COLUMNS)
      .single();

    if (error) {
      return { ok: false, error: startTimerErrorMessage(error) };
    }

    entry = toEntry(data);
  } catch {
    return { ok: false, error: NOT_CONFIGURED };
  }

  revalidatePath("/", "layout");
  return { ok: true, data: entry };
}

/** The only shape an insert from this module may take. See `startTimer`. */
type StartTimerPayload = {
  project_id: string;
  task_id: string;
  source: "timer";
  note?: string;
};

function buildStartPayload(input: {
  projectId: string;
  taskId: string;
  note: string | null;
}): StartTimerPayload {
  const payload: StartTimerPayload = {
    project_id: input.projectId,
    task_id: input.taskId,
    source: "timer",
  };

  if (input.note !== null) {
    payload.note = input.note;
  }

  return payload;
}

/**
 * §5.1's stop transition, and the one place `ended_at` is ever written.
 *
 * This is an RPC and there is no fallback path, because a direct
 * `.update({ ended_at })` is not merely discouraged — `time_entries_guard_update`
 * rejects any `ended_at` on the open→closed transition that is not the
 * database's own `now()` (§5.3), so a client-chosen timestamp fails 42501. A
 * "try the update if the RPC fails" branch could therefore only ever succeed by
 * accident of clock alignment, and would be a second, weaker copy of the stop
 * rule.
 *
 * `stop_timer` returns `setof time_entries`, so the answer to "not yours / not
 * there" is `[]`. That return type was chosen deliberately over a scalar
 * composite: a composite that matches no row comes back as an object whose
 * every field is null, which is **truthy** in JavaScript, and `if (data)` would
 * then report a stop that never happened. Hence the explicit length check —
 * `data[0]` alone would be `undefined` and crash on the next property access.
 */
export async function stopTimer(
  entryId: string,
): Promise<ActionResult<TimeEntry>> {
  const parsed = timeEntryIdSchema.safeParse(entryId);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? NOT_RUNNING_OR_NOT_YOURS,
    };
  }

  let entry: TimeEntry;
  try {
    const supabase = await createClient();

    const { data, error } = await supabase.rpc("stop_timer", {
      p_id: parsed.data,
    });

    if (error) {
      return { ok: false, error: stopTimerErrorMessage(error) };
    }

    const row = data.at(0);
    if (!row) {
      return { ok: false, error: NOT_RUNNING_OR_NOT_YOURS };
    }

    entry = toEntry(row);
  } catch {
    return { ok: false, error: NOT_CONFIGURED };
  }

  revalidatePath("/", "layout");
  return { ok: true, data: entry };
}

/**
 * §5.1's discard transition — "delete a *running* entry outright. Permitted
 * because nothing was ever recorded as complete. The only DELETE any user can
 * perform on `time_entries`."
 *
 * `time_entries_delete_own_running` carries `ended_at is null` in its USING
 * clause, so a closed entry, or anyone else's, is filtered rather than refused:
 * zero rows, HTTP 200, no error. Reporting that as success would tell someone
 * their mis-started entry had been thrown away while it sat in the timesheet,
 * which is why the row count is checked instead of the error.
 */
export async function discardTimer(
  entryId: string,
): Promise<ActionResult<null>> {
  const parsed = timeEntryIdSchema.safeParse(entryId);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? NOT_RUNNING_OR_NOT_YOURS,
    };
  }

  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("time_entries")
      .delete()
      .eq("id", parsed.data)
      .select("id");

    if (error) {
      return {
        ok: false,
        error: "Could not discard the timer. Please try again.",
      };
    }
    if (data.length === 0) {
      return { ok: false, error: NOT_RUNNING_OR_NOT_YOURS };
    }
  } catch {
    return { ok: false, error: NOT_CONFIGURED };
  }

  revalidatePath("/", "layout");
  return { ok: true, data: null };
}

/**
 * The caller's own running entry, or `null` when nothing is running — which is
 * the normal state, not an error, and must not be rendered as one. This is what
 * tells the UI whether to show a live counter or a start button.
 *
 * `user_id` is filtered explicitly even though RLS already scopes an *employee*
 * to their own rows, because it does not scope an **admin**:
 * `time_entries_select_own_or_admin` returns every entry in the company to one,
 * so without this an admin would be shown a colleague's running timer as their
 * own — and could then stop it from their own toolbar. The partial unique index
 * guarantees at most one such row exists, which is why `maybeSingle()` is safe.
 */
export async function getRunningTimer(): Promise<
  ActionResult<RunningTimer | null>
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
      .from("time_entries")
      .select(ENTRY_COLUMNS_WITH_LABELS)
      .eq("user_id", user.id)
      .is("ended_at", null)
      .maybeSingle();

    if (error) {
      return { ok: false, error: "Could not check for a running timer." };
    }
    if (!data) {
      return { ok: true, data: null };
    }

    return {
      ok: true,
      data: {
        ...toEntryWithLabels(data),
        endedAt: null,
        durationSeconds: null,
      },
    };
  } catch {
    return { ok: false, error: NOT_CONFIGURED };
  }
}

/**
 * "My recent entries" — the list beside the timer, newest first. **Not a
 * report:** §9's groupings, company-local day bucketing (§6.1) and integer-second
 * totals belong to Phase 8, and nothing here should grow into them. There is no
 * date range and no aggregation on purpose.
 *
 * Running entries are included, because this is a work log rather than a total
 * and the row the user just started is the one they most expect to see; §9.4's
 * "running entries contribute zero" governs sums, and this function computes
 * none. `durationSeconds` is null on those rows, which is how a caller tells
 * them apart.
 *
 * `user_id` is filtered for the same reason as `getRunningTimer` — for an admin
 * the RLS policy is company-wide, and this list claims to be *mine*.
 */
export async function listMyEntries(
  options?: ListMyEntriesOptions,
): Promise<ActionResult<TimeEntryWithLabels[]>> {
  const parsed = listMyEntriesOptionsSchema.safeParse(options ?? {});
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Could not load your entries.",
    };
  }

  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { ok: false, error: NOT_SIGNED_IN };
    }

    let query = supabase
      .from("time_entries")
      .select(ENTRY_COLUMNS_WITH_LABELS)
      .eq("user_id", user.id);

    if (parsed.data.projectId) {
      query = query.eq("project_id", parsed.data.projectId);
    }

    const { data, error } = await query
      .order("started_at", { ascending: false })
      .limit(parsed.data.limit);

    if (error) {
      return { ok: false, error: "Could not load your entries." };
    }

    return { ok: true, data: data.map(toEntryWithLabels) };
  } catch {
    return { ok: false, error: NOT_CONFIGURED };
  }
}

/**
 * §7.1: "Edit the `note` on their own entry — Yes." That right applies to
 * **closed** entries too, which is why this is a plain UPDATE and not a
 * correction request: `note` is one of the two columns in
 * `GRANT UPDATE (ended_at, note)`, and `time_entries_guard_update` has nothing
 * to say about it. Times on a closed entry are the opposite case and stay
 * unreachable from here — no grant exists on `started_at`, and `ended_at` is
 * refused by the trigger — so this action cannot be widened into an edit path
 * by accident.
 *
 * Blank clears the note (`entryNoteSchema` normalises `""` to `null`) rather
 * than storing an empty string, so "remove my note" needs no second verb.
 */
export async function updateEntryNote(
  entryId: string,
  note: string,
): Promise<ActionResult<TimeEntry>> {
  const parsedId = timeEntryIdSchema.safeParse(entryId);
  if (!parsedId.success) {
    return {
      ok: false,
      error: "That time entry no longer exists, or isn't yours.",
    };
  }

  const parsedNote = entryNoteSchema.safeParse(note);
  if (!parsedNote.success) {
    return {
      ok: false,
      error: parsedNote.error.issues[0]?.message ?? "Could not save that note.",
    };
  }

  let entry: TimeEntry;
  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("time_entries")
      .update({ note: parsedNote.data })
      .eq("id", parsedId.data)
      .select(ENTRY_COLUMNS);

    if (error) {
      return {
        ok: false,
        error: "Could not save that note. Please try again.",
      };
    }

    const row = data.at(0);
    if (!row) {
      // The UPDATE policy's USING clause filtered the row: not yours, or not
      // this company. Silent at the database, so checked here.
      return {
        ok: false,
        error: "That time entry no longer exists, or isn't yours.",
      };
    }

    entry = toEntry(row);
  } catch {
    return { ok: false, error: NOT_CONFIGURED };
  }

  revalidatePath("/", "layout");
  return { ok: true, data: entry };
}

/**
 * §5.1: "Switch project mid-timer: stop, then start a new entry. Never mutate
 * `project_id` on a running timer — that would silently misattribute
 * already-elapsed minutes."
 *
 * **Two statements, deliberately not one transaction.** This is not a shortcut
 * around atomicity: `project_id` carries no UPDATE grant at all, so stop-then-start
 * is the only mechanism the database offers, and wrapping it would require a
 * `SECURITY DEFINER` function whose only purpose is to make an already-correct
 * pair of calls look like one — elevation bought for cosmetics (§4.4).
 *
 * **The failure mode, stated rather than hidden.** If the stop succeeds and the
 * start then fails — they were removed from the new project between the two
 * calls, the task moved, the network dropped — the user is left with *no*
 * running timer rather than the old one. That is the correct direction to fail:
 *
 *   * The elapsed minutes are already saved on the stopped entry. Nothing is
 *     lost, and the entry is attributed to the project it was actually worked
 *     on, which is the misattribution §5.1 exists to prevent.
 *   * Rolling forward instead (restarting the old project's timer) would create
 *     a *second* entry on the old project with a gap in the middle, which is a
 *     worse lie than a stopped timer.
 *
 * So it is surfaced, not smoothed: the error names both halves of what
 * happened, because a user who sees only "you're not assigned to this project"
 * would reasonably assume their old timer is still running.
 */
export async function switchTimer(
  projectId: string,
  taskId: string,
  note?: string | null,
): Promise<ActionResult<{ stopped: TimeEntry | null; started: TimeEntry }>> {
  const parsed = startTimerSchema.safeParse({ projectId, taskId, note });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Could not switch the timer.",
    };
  }

  let stopped: TimeEntry | null = null;
  let started: TimeEntry;

  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { ok: false, error: NOT_SIGNED_IN };
    }

    const { data: running, error: runningError } = await supabase
      .from("time_entries")
      .select("id")
      .eq("user_id", user.id)
      .is("ended_at", null)
      .maybeSingle();

    if (runningError) {
      return { ok: false, error: "Could not check for a running timer." };
    }

    // Statement one. Skipped entirely when nothing is running, so switching
    // from no timer is just a start — the caller does not have to know which
    // state it was in.
    if (running) {
      const { data: stopData, error: stopError } = await supabase.rpc(
        "stop_timer",
        { p_id: running.id },
      );

      if (stopError) {
        return { ok: false, error: stopTimerErrorMessage(stopError) };
      }

      const stoppedRow = stopData.at(0);
      if (!stoppedRow) {
        // The row was visible a moment ago and is not updatable now: it was
        // discarded or stopped from another tab in between. Nothing was
        // mutated, so this is safe to report and retry.
        return { ok: false, error: NOT_RUNNING_OR_NOT_YOURS };
      }

      stopped = toEntry(stoppedRow);
    }

    // Statement two.
    const { data: startData, error: startError } = await supabase
      .from("time_entries")
      .insert(buildStartPayload(parsed.data))
      .select(ENTRY_COLUMNS)
      .single();

    if (startError) {
      const message = startTimerErrorMessage(startError);
      return {
        ok: false,
        error: stopped
          ? `Your previous timer was stopped and saved, but the new one could not start. ${message}`
          : message,
      };
    }

    started = toEntry(startData);
  } catch {
    return { ok: false, error: NOT_CONFIGURED };
  }

  revalidatePath("/", "layout");
  return { ok: true, data: { stopped, started } };
}
