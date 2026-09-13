/**
 * What §9.9.7's setup card needs to know that no single read answers.
 *
 * Pure: no React, no Supabase, no `next/*`.
 */

/**
 * How many members of the company are on **no project at all**.
 *
 * This is the number that makes the invite → assign gap visible rather than
 * silent. An employee who has accepted their invitation is a full member of the
 * company and still cannot log a single minute until somebody assigns them to a
 * project (§3.6.1) — the schema forces that order, because
 * `project_members.(user_id, company_id)` references `profiles`, so nobody can
 * be put on a project before they accept. The setup card says so out loud; this
 * counts who it applies to.
 *
 * **The memberships side is the authority and the members side is the
 * universe.** A membership naming somebody who is no longer in `members` — a
 * stale row, or a read that raced a deactivation — contributes nothing rather
 * than counting against the total, so the result can never exceed
 * `members.length` or fall below zero. Somebody on three projects is assigned
 * once, not three times, which is why this is a `Set` rather than a length
 * comparison.
 *
 * Deactivated members are counted if they are in `members`: `listMembers()`
 * returns them (§2.3 keeps them for their history), and "not on a project" is
 * as true of them as of anyone. The caller filters if it wants only active
 * people — this function does not guess.
 */
export function unassignedMemberCount(
  members: readonly { id: string }[],
  memberships: readonly { userId: string }[],
): number {
  const assigned = new Set(memberships.map((row) => row.userId));

  return members.filter((member) => !assigned.has(member.id)).length;
}
