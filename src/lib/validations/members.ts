import { z } from "zod";

/**
 * `user_role` and `member_status` in `0002_tenancy_core.sql` (§2, §3.2).
 * Two roles only, and removal is deactivation rather than deletion (§2.3), so
 * both enums are closed sets the database also enforces.
 */
export const memberRoleSchema = z.enum(
  ["admin", "employee"],
  "Pick a role: admin or employee.",
);

export const memberStatusSchema = z.enum(
  ["active", "inactive"],
  "Pick a status: active or inactive.",
);

/**
 * `profiles.id` is the `auth.users` id, so anything that is not a uuid could
 * never match a row — reject it at the boundary rather than sending a
 * guaranteed-empty update and reporting "member not found".
 */
export const memberIdSchema = z.uuid("That member no longer exists.");

export const updateMemberRoleSchema = z.object({
  userId: memberIdSchema,
  role: memberRoleSchema,
});

export const setMemberStatusSchema = z.object({
  userId: memberIdSchema,
  status: memberStatusSchema,
});

export type MemberRole = z.infer<typeof memberRoleSchema>;
export type MemberStatus = z.infer<typeof memberStatusSchema>;
