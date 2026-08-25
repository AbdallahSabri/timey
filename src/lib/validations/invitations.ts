import { z } from "zod";

import { emailSchema } from "@/lib/validations/auth";
import { memberRoleSchema } from "@/lib/validations/members";

/**
 * The invited address is normalised exactly like a sign-in address
 * (`emailSchema`): `invitations.email` is `citext`, and the outstanding-invite
 * unique index is `(company_id, email)`, so a stray space or capital would
 * otherwise decide whether a re-invite replaces or collides (§3.10, §8.4).
 */
export const inviteMemberSchema = z.object({
  email: emailSchema,
  role: memberRoleSchema,
});

/**
 * Revoke and accept take an opaque identifier rather than user-authored
 * structured input, so there is no object schema for them — but the values
 * still arrive from a URL segment or a form and are validated before use.
 *
 * The raw token is 64 hex characters (`randomBytes(32).toString("hex")`), yet
 * only non-emptiness is checked: shape is the database's business — the token
 * is looked up by its SHA-256, and a token of any other shape simply matches
 * no row. Encoding this length here would turn a future token format into a
 * client-side rejection of links the server would still honour.
 */
export const invitationTokenSchema = z
  .string()
  .trim()
  .min(1, "This invitation link is missing its token.");

export const invitationIdSchema = z.uuid("That invitation no longer exists.");

/** What `createInvitation()` accepts. */
export type InviteMemberInput = z.input<typeof inviteMemberSchema>;

/** What the schema yields after parsing: the row that gets inserted. */
export type InviteMemberValues = z.infer<typeof inviteMemberSchema>;
