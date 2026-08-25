import { z } from "zod";

/**
 * §5.3 is the reason this file is so short. **Nothing here validates a
 * timestamp**, because Phase 5 never constructs one: `started_at` defaults to
 * `now()` in Postgres and `ended_at` is written only by `public.stop_timer()`.
 * A `startedAt` field on any schema below would be a value the client could
 * choose, which is precisely what §5.3 forbids. Phase 6's manual entries are
 * where client-supplied times — and §6.4's future-entry rule — arrive.
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
