import { z } from "zod";

/**
 * §5.3 splits this file in two.
 *
 * **The timer half validates no timestamp at all**, because it never
 * constructs one: `started_at` defaults to `now()` in Postgres and `ended_at`
 * is written only by `public.stop_timer()`. A `startedAt` field on
 * `startTimerSchema` would be a value the client could choose, which is
 * precisely what §5.3 forbids.
 *
 * **The manual half (Phase 6) does**, because §5.3 rules that manual entries
 * "*do* accept client-supplied times — they're a deliberate assertion, not a
 * measurement." What lives here is shape only. The two rules that decide
 * whether an assertion is *permitted* — §7.1's today-only and §6.4's
 * future guard — are in `createManualEntry`, not here, because both need the
 * company timezone and the server's clock and a standalone zod schema has
 * neither.
 */

/**
 * `entry_source` in `0005_time_entries.sql` (§3.7). The enum has no DEFAULT in
 * the database on purpose: a manual entry whose payload forgot the column would
 * otherwise be recorded as a measurement rather than the assertion it is
 * (§5.3). Phase 5 only ever writes `'timer'`; `'manual'` is Phase 6's.
 */
export const entrySourceSchema = z.enum(
  ["timer", "manual"],
  "An entry is either a timer or a manual entry.",
);

/**
 * The note on a time entry. `time_entries.note` is unbounded `text` with no
 * CHECK, so the 2000-character ceiling is ours alone and matches
 * `projects.description` in `structure.ts` — long enough for a real handover
 * note, short enough that a pasted document cannot become a list row.
 *
 * Blank normalises to `null` for the same reason it does there: a column that
 * is either prose or absent should never hold `""`, or every reader needs two
 * emptiness checks. This also makes "clear the note" expressible through
 * `updateEntryNote(id, "")` without a separate verb.
 */
export const entryNoteSchema = z
  .string()
  .trim()
  .max(2000, "That note is too long (2000 characters max).")
  .nullish()
  .transform((value) => (value ? value : null));

/**
 * Ids arrive from form fields and URL segments. A non-uuid could never match a
 * row, so it is rejected here rather than sent as a guaranteed-empty statement
 * whose zero rows would then be reported as "that timer isn't yours" — which
 * would misdescribe a typo as a permissions problem.
 */
export const timeEntryIdSchema = z.uuid("That time entry no longer exists.");

/**
 * `projectId` and `taskId` are validated as a pair but never checked against
 * each other here: "does this task belong to this project" is a fact about the
 * database, and `time_entries_task_id_project_id_fkey` answers it atomically
 * where a read-then-write in this layer could not.
 */
export const startTimerSchema = z.object({
  projectId: z.uuid("Pick a project to log time to."),
  taskId: z.uuid("Pick a task to log time to."),
  note: entryNoteSchema,
});

/**
 * A **wall clock in the company's timezone**, not an instant. `2026-08-25T09:30`
 * or `2026-08-25T09:30:00` — exactly what `<input type="datetime-local">`
 * produces, and deliberately *without* a `Z` or a `+03:00`.
 *
 * **This is the load-bearing decision in Phase 6's input contract, so it is
 * stated rather than implied.** A manual entry is read back through
 * `formatStartedAt`, which renders in `companies.timezone` (§6.1, §6.2 — per-user
 * zones are out of scope for v1). If this field carried an offset, the only
 * offset a browser could honestly supply is its own, so a user in London
 * entering "09:30" for a Cairo company would store 09:30 London, see 11:30
 * rendered back, and — near midnight — have the entry land on a different
 * company-local day than the one they picked, which is §7.1's today-only rule
 * silently disagreeing with the calendar the user was looking at. Sending the
 * wall clock and resolving it against `companies.timezone` server-side is what
 * makes "what I typed" and "what I see" the same time. `createManualEntry` owns
 * that resolution; nothing in the UI layer has to do timezone arithmetic.
 *
 * Rejecting the offset form rather than accepting both is deliberate: one field
 * with two meanings ("this instant" / "this wall clock") is a bug that only
 * shows up for users whose zone differs from their company's.
 *
 * The regex cannot tell `2026-02-30` from a real date, so the refinement does —
 * without it, `Date.UTC` would silently roll it forward to 2 March and record an
 * entry on a day nobody chose.
 */
export const localDateTimeSchema = z
  .string()
  .trim()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/,
    "Enter a date and time like 2026-08-25T09:30, with no timezone.",
  )
  // Normalised to a fixed 19-character layout so every reader downstream can
  // slice it by position instead of re-parsing it.
  .transform((value) => (value.length === 16 ? `${value}:00` : value))
  .refine(isRealCalendarDateTime, "That isn't a real date and time.");

function isRealCalendarDateTime(normalised: string): boolean {
  const year = Number(normalised.slice(0, 4));
  const month = Number(normalised.slice(5, 7));
  const day = Number(normalised.slice(8, 10));
  const hour = Number(normalised.slice(11, 13));
  const minute = Number(normalised.slice(14, 16));
  const second = Number(normalised.slice(17, 19));

  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59) {
    return false;
  }
  // 60 would be a leap second; Postgres accepts one and JavaScript does not, so
  // it is refused here rather than silently rolled into the next minute.
  if (second > 59) {
    return false;
  }

  // Round-tripping through Date.UTC is what catches 31 April and 29 February in
  // a non-leap year: both roll forward, and the parts then disagree. Two-digit
  // years cannot reach this (the regex demands four), and if one did,
  // Date.UTC's 1900-offset would make the year disagree and fail here too.
  const utc = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return (
    utc.getUTCFullYear() === year &&
    utc.getUTCMonth() === month - 1 &&
    utc.getUTCDate() === day
  );
}

/**
 * §7.1: "Create a manual entry dated **today** — Yes."
 *
 * Shape only, and the omissions are the interesting part:
 *
 *   * **No today check and no future check.** Both are §6.4/§7.1 rules about
 *     the company's timezone and the server's clock; `createManualEntry` runs
 *     them.
 *   * **No `endedAt > startedAt` refinement**, even though it looks like it
 *     belongs here. These are wall clocks, and wall-clock order is not instant
 *     order: across a DST fall-back, 02:30 → 01:30 is a real, positive
 *     50-minute entry, and 01:30 → 01:30 can be a real 60-minute one. Comparing
 *     the strings would refuse both. The action compares the resolved instants,
 *     which is the comparison the database's own CHECK makes.
 *   * **No `source`.** It is `'manual'` and the action writes it; a client that
 *     could choose would be able to file an assertion as a measurement (§5.3).
 *
 * `projectId`/`taskId` are not checked against each other for the same reason
 * `startTimerSchema` does not: `time_entries_task_id_project_id_fkey` answers
 * that atomically where a read-then-write here could not.
 */
export const manualEntrySchema = z.object({
  projectId: z.uuid("Pick a project to log time to."),
  taskId: z.uuid("Pick a task to log time to."),
  startedAt: localDateTimeSchema,
  endedAt: localDateTimeSchema,
  note: entryNoteSchema,
});

/**
 * A short "what have I been working on" list, not a report (§9 owns those, in
 * Phase 8). The limit is capped so a caller cannot turn this into an
 * unbounded table scan; the default is one screen's worth.
 */
export const listMyEntriesOptionsSchema = z.object({
  limit: z.coerce
    .number()
    .int("That isn't a whole number of entries.")
    .min(1, "Ask for at least one entry.")
    .max(200, "That's more entries than this list shows (200 max).")
    .default(50),
  projectId: z.uuid("That project no longer exists.").optional(),
});

export type EntrySource = z.infer<typeof entrySourceSchema>;
export type StartTimerInput = z.input<typeof startTimerSchema>;
export type ListMyEntriesOptions = z.input<typeof listMyEntriesOptionsSchema>;

/**
 * What a form hands `createManualEntry`. `z.input`, not `z.infer`, so `note`
 * stays optional and the timestamps stay plain strings — the `:00` padding is
 * something the schema does, not something a caller has to.
 */
export type ManualEntryInput = z.input<typeof manualEntrySchema>;
