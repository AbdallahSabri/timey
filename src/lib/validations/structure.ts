import { z } from "zod";

/**
 * Structure names (`clients.name`, `projects.name`, `tasks.name`) all carry the
 * same `length(btrim(name)) > 0` CHECK in `0004_structure.sql`, so trimming
 * here is what makes " " a client-side message rather than a 23514 nobody can
 * read. The 120-character ceiling is ours alone — the columns are unbounded
 * `text` — and exists so a pasted paragraph cannot become a picker label.
 */
function structureNameSchema(subject: string) {
  return z
    .string()
    .trim()
    .min(1, `Enter a name for this ${subject}.`)
    .max(120, `That ${subject} name is too long (120 characters max).`);
}

export const clientSchema = z.object({
  name: structureNameSchema("client"),
});

/**
 * `clientId` is optional **and** nullable because §3.4 makes it so: an internal
 * project has no client. Three shapes mean the same thing — omitted, `null`,
 * and the empty string a `<select>` with a "No client" option submits — and all
 * three normalise to `null`, which is the only value `projects.client_id`
 * accepts for "none".
 *
 * `description` normalises a blank string to `null` for the same reason: a
 * column that is either prose or absent should never hold `""`, or every reader
 * needs two emptiness checks instead of one.
 */
export const projectSchema = z.object({
  name: structureNameSchema("project"),
  description: z
    .string()
    .trim()
    .max(2000, "That description is too long (2000 characters max).")
    .nullish()
    .transform((value) => (value ? value : null)),
  clientId: z
    .union([
      z.uuid("Pick a client from the list, or leave it unassigned."),
      z.literal(""),
      z.null(),
    ])
    .optional()
    .transform((value) => (value ? value : null)),
});

/**
 * No `projectId` field: a task's project is a route parameter, never something
 * the user types, and `createTask(projectId, input)` keeps it that way — the
 * same split as `revokeInvitation(id)` (opaque identifier as an argument)
 * versus `createInvitation(input)` (authored fields as an object). It also
 * matches the database, where `tasks.project_id` has no UPDATE grant at all:
 * a task cannot move between projects (§5.1's reasoning, applied to structure).
 */
export const taskSchema = z.object({
  name: structureNameSchema("task"),
});

/**
 * Ids arrive from URL segments and form fields. Anything that is not a uuid
 * could never match a row, so it is rejected at the boundary rather than sent
 * as a guaranteed-empty statement that would then report "not found, or you
 * don't have permission" — a message that would misdescribe a typo as a
 * permissions problem.
 */
export const clientIdSchema = z.uuid("That client no longer exists.");
export const projectIdSchema = z.uuid("That project no longer exists.");
export const taskIdSchema = z.uuid("That task no longer exists.");

/**
 * §3.11: archived rows stay selectable so historical entries keep a readable
 * label, but they are excluded from pickers. The default is therefore the
 * picker's answer — active only — and including archived rows is something a
 * caller has to ask for explicitly, on an admin-facing management list.
 */
export const listStructureOptionsSchema = z.object({
  includeArchived: z.boolean().default(false),
});

export type ClientInput = z.input<typeof clientSchema>;
export type ProjectInput = z.input<typeof projectSchema>;
export type TaskInput = z.input<typeof taskSchema>;
export type ListStructureOptions = z.input<typeof listStructureOptionsSchema>;
