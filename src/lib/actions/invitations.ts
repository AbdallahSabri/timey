"use server";

import { createHash, randomBytes } from "node:crypto";

import { revalidatePath } from "next/cache";

// Type-only, so it is erased at build time and does not pull another
// "use server" module into this one's graph.
import type { ActionResult } from "@/lib/actions/auth";
import { escapeHtml, sendEmail } from "@/lib/email/resend";
import { createClient } from "@/lib/supabase/server";
import {
  invitationIdSchema,
  invitationTokenSchema,
  inviteMemberSchema,
  type InviteMemberInput,
} from "@/lib/validations/invitations";

import type { PostgrestError } from "@supabase/supabase-js";

const NOT_CONFIGURED =
  "Authentication is not configured. Check the Supabase environment variables.";

const CREATE_FAILED = "Could not send the invitation. Please try again.";

/** 256 bits, hex-encoded: 64 characters, ~10^77 possibilities. */
const TOKEN_BYTES = 32;

/**
 * Must be byte-for-byte identical to `public.hash_invitation_token()`
 * (`encode(sha256(convert_to(p_token,'UTF8')),'hex')`) — that function is
 * granted to no client role, so the two definitions never meet at runtime and
 * a divergence would only show up as a token that can never be redeemed.
 *
 * The `invitations_token_hash_is_sha256_hex` CHECK is the backstop: a raw
 * token cannot satisfy 64 lowercase hex characters, so forgetting to hash
 * fails at INSERT rather than storing a working credential in plaintext
 * (§8.4).
 */
function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

function firstIssue(
  error: { issues: readonly { message: string }[] },
  fallback: string,
): string {
  return error.issues[0]?.message ?? fallback;
}

function createInvitationErrorMessage(error: PostgrestError): string {
  switch (error.code) {
    case "23505":
      // `invitations_company_email_outstanding_key`. The delete below should
      // have cleared any outstanding row for this address, so reaching here
      // means another admin inserted one in between (§8.4.1 — the accepted,
      // safe-failing race). A token_hash collision is the other 23505 this
      // table can raise; it is not a user error and must not read like one.
      return error.message.includes("token_hash")
        ? CREATE_FAILED
        : "An invitation to this address is already pending.";
    case "42501":
      // RLS: `invitations_insert_admin` requires an active admin of this
      // company. A non-admin never gets a row in, whatever the UI offered.
      return "Only an admin can invite people to this company.";
    case "23514":
      return error.message.includes("email")
        ? "Enter a valid email address."
        : CREATE_FAILED;
    case "23503":
      // invited_by -> profiles: the caller has no profile row yet.
      return "Your account is not ready yet. Reload the page and try again.";
    default:
      return CREATE_FAILED;
  }
}

function acceptInvitationErrorMessage(error: PostgrestError): string {
  switch (error.code) {
    case "28000":
      return "You need to be signed in to accept an invitation.";
    case "23505":
      // §2, §8.4: one company for the life of the account. The one case §8.4
      // requires to be stated plainly rather than failing generically.
      return "You already belong to a company.";
    case "P0002":
      // Never issued, revoked, or tampered with — indistinguishable by design
      // (`accept_invitation()`), and all three mean the link grants nothing.
      return "This invitation link is invalid or has already been used.";
    case "22023":
      return "This invitation has expired. Ask your admin to send a new one.";
    case "23514":
      return error.message.includes("already been used")
        ? "This invitation has already been used."
        : // The function's other 23514 is "no profile for the calling user",
          // which the signup trigger makes unreachable in practice.
          "Your account is not ready yet. Reload the page and try again.";
    case "42501":
      // `accept_invitation()` raises this with the whole explanation already
      // in it — "this invitation was sent to X, but you are signed in as Y"
      // (§8.4.1) — so it is passed through verbatim rather than rewrapped
      // into something that hides which address to sign in as. The only other
      // 42501 on this path is Postgres refusing EXECUTE to `anon`, which is
      // an auth problem and reads nothing like an invitation problem.
      return error.message.toLowerCase().startsWith("permission denied")
        ? "You need to be signed in to accept an invitation."
        : error.message;
    default:
      return "Could not accept this invitation. Please try again.";
  }
}

/** One row of the admin's outstanding-invitations list. */
export type PendingInvitation = {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
  expired: boolean;
  invitedByName: string | null;
};

/**
 * Outstanding invitations only (`accepted_at IS NULL`): an accepted one is a
 * member now, and belongs in the member list rather than here.
 *
 * Admin-only and company-scoped by `invitations_select_admin`, so an employee
 * gets an empty list rather than an error — the same shape the page renders
 * before anyone has been invited. `token_hash` is never selected: it is not
 * the raw token, but it is still the credential's only stored form and has no
 * business in a page payload.
 *
 * `expires_at` doubles as the creation-order key (it is always `now() + 7
 * days` and not client-settable), so ordering by it descending puts the
 * newest invitation first.
 */
export async function listInvitations(): Promise<
  ActionResult<PendingInvitation[]>
> {
  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("invitations")
      .select(
        "id, email, role, expires_at, profiles!invitations_invited_by_fkey (full_name)",
      )
      .is("accepted_at", null)
      .order("expires_at", { ascending: false });

    if (error) {
      return { ok: false, error: "Could not load pending invitations." };
    }

    const now = Date.now();
    return {
      ok: true,
      data: data.map((row) => ({
        id: row.id,
        email: row.email,
        role: row.role,
        expiresAt: row.expires_at,
        expired: new Date(row.expires_at).getTime() < now,
        invitedByName: row.profiles?.full_name ?? null,
      })),
    };
  } catch {
    return { ok: false, error: NOT_CONFIGURED };
  }
}

/**
 * Mints an invitation and returns the **raw** token exactly once (§8.4): only
 * the SHA-256 is stored, so after this call returns, the raw value exists
 * nowhere but the caller's variable. Never log it — a log line with the raw
 * token in it is the leaked-backup scenario §8.4 exists to prevent.
 *
 * Building the shareable `/invite/{token}` URL for on-screen copy is the
 * caller's job; a server action has no reliable view of the request origin
 * (`InviteLink` reads `window.location.origin`). The email this action sends
 * itself (`BLOCKERS.md` N-6) needs that same URL from a context with no
 * window, which is what the server-only `APP_URL` env var is for — a trusted
 * value an admin cannot influence, unlike a client-supplied origin would be.
 * `emailSent` on the result tells the caller which fallback copy to show; the
 * invitation itself is created either way; a copyable link stays the ground
 * truth (`accept_invitation()` only ever sees the token, never how it got to
 * the invitee).
 *
 * §8.4's "re-inviting replaces the outstanding invitation" is delete-then-
 * insert, not atomic (§8.4.1). The partial unique index makes stacking
 * impossible, so the worst case is a friendly 23505 for the admin who loses a
 * same-second race.
 */
export async function createInvitation(
  input: InviteMemberInput,
): Promise<
  ActionResult<{ token: string; expiresAt: string; emailSent: boolean }>
> {
  const parsed = inviteMemberSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: firstIssue(parsed.error, "Invalid invitation details."),
    };
  }

  const { email, role } = parsed.data;

  const rawToken = randomBytes(TOKEN_BYTES).toString("hex");

  let expiresAt: string;
  let companyName: string;
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return {
        ok: false,
        error: "You need to be signed in to invite someone.",
      };
    }

    // `invitations.company_id` is NOT NULL with no default and the INSERT
    // policy demands it equal `current_company_id()`, so the caller's company
    // has to be read first. The profiles SELECT policy covers the caller's own
    // row even in limbo (§4.2.1).
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("company_id, companies (name)")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      return { ok: false, error: CREATE_FAILED };
    }
    if (!profile?.company_id) {
      return {
        ok: false,
        error: "Create your company before inviting anyone to it.",
      };
    }

    // §8.4. Refuse an address that is already in this company, BEFORE writing
    // a row for it. Without this the invitation is created happily and only
    // fails when the holder clicks the link — `accept_invitation()` raises
    // 23505 ("this account already belongs to a company"), which is the right
    // refusal in the wrong place: the admin learns nothing at send time, the
    // row sits in the pending list until it expires, and a configured Resend
    // has already mailed a link that can never work.
    //
    // `profiles` carries no email column and `auth.users` is unreadable from
    // here (§4.4 — no service-role key), so this is the one question this
    // module cannot answer itself. `email_is_company_member` is the narrow
    // definer function for it (0011), admin-only and scoped to the caller's
    // own company.
    //
    // Advisory, not the enforcement: `accept_invitation()` still refuses, and
    // still has to — this check can lose a race with a signup completing
    // between here and redemption. It exists to move a guaranteed failure
    // forward to the person who can act on it.
    const { data: alreadyMember, error: memberCheckError } = await supabase.rpc(
      "email_is_company_member",
      { p_email: email },
    );

    if (memberCheckError) {
      return {
        ok: false,
        error: createInvitationErrorMessage(memberCheckError),
      };
    }
    if (alreadyMember) {
      return {
        ok: false,
        error:
          "That address already belongs to someone in your company. Change their role from the member list instead.",
      };
    }

    // §8.4 replace-don't-stack. Scoped to this company by the DELETE policy;
    // the explicit company_id keeps the intent readable and the statement
    // correct on its own terms rather than only under RLS.
    const { error: deleteError } = await supabase
      .from("invitations")
      .delete()
      .eq("company_id", profile.company_id)
      .eq("email", email)
      .is("accepted_at", null);

    if (deleteError) {
      return { ok: false, error: createInvitationErrorMessage(deleteError) };
    }

    // expires_at is not in the INSERT grant: §8.4 fixes expiry at 7 days, so
    // it is the column default or nothing. It comes back in the returning row.
    const { data: invitation, error } = await supabase
      .from("invitations")
      .insert({
        company_id: profile.company_id,
        email,
        role,
        token_hash: hashToken(rawToken),
        invited_by: user.id,
      })
      .select("expires_at")
      .single();

    if (error) {
      return { ok: false, error: createInvitationErrorMessage(error) };
    }

    expiresAt = invitation.expires_at;
    companyName = profile.companies?.name ?? "your company";
  } catch {
    return { ok: false, error: NOT_CONFIGURED };
  }

  // Best-effort, and deliberately outside the try/catch above: the
  // invitation row already exists and its link already works, so a provider
  // outage or a missing `APP_URL`/`RESEND_API_KEY` must not turn a created
  // invitation into a reported failure — only into a caller that knows to
  // fall back to the copyable link (`emailSent: false`).
  const emailSent = await sendInvitationEmail({
    to: email,
    companyName,
    role,
    inviteUrl: buildInviteUrl(rawToken),
    expiresAt,
  });

  revalidatePath("/", "layout");
  return { ok: true, data: { token: rawToken, expiresAt, emailSent } };
}

/**
 * `APP_URL` is the one env var this module needs beyond Supabase's: a
 * trusted, server-configured origin for a link going into an email, where
 * `InviteLink`'s `window.location.origin` isn't reachable. Unset (a freshly
 * forked template, same as a missing Resend key) means "don't send" rather
 * than a guess — a wrong origin baked into a real email is worse than no
 * email.
 */
function buildInviteUrl(rawToken: string): string | null {
  const appUrl = process.env.APP_URL;
  if (!appUrl) {
    return null;
  }
  return `${appUrl.replace(/\/+$/, "")}/invite/${rawToken}`;
}

async function sendInvitationEmail(input: {
  to: string;
  companyName: string;
  role: string;
  inviteUrl: string | null;
  expiresAt: string;
}): Promise<boolean> {
  if (!input.inviteUrl) {
    return false;
  }

  const expiry = new Date(input.expiresAt).toUTCString();
  const company = escapeHtml(input.companyName);
  const url = escapeHtml(input.inviteUrl);

  const result = await sendEmail({
    to: input.to,
    subject: `You've been invited to join ${input.companyName} on Timey`,
    html: `<p>You've been invited to join <strong>${company}</strong> on Timey as ${escapeHtml(input.role)}.</p><p><a href="${url}">Accept the invitation</a></p><p>This link expires ${expiry}. If the button doesn't work, copy this URL: ${url}</p>`,
  });

  return result.ok;
}

/**
 * §8.4: "Revoking deletes the row; the link stops working immediately."
 *
 * RLS scopes the delete to an admin of the owning company, so a stale UI and
 * cross-tenant tampering both land in the same place — zero rows affected.
 * Reporting that as success would tell an admin a live link is dead.
 */
export async function revokeInvitation(
  invitationId: string,
): Promise<ActionResult<null>> {
  const parsed = invitationIdSchema.safeParse(invitationId);
  if (!parsed.success) {
    return { ok: false, error: "Invitation not found." };
  }

  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("invitations")
      .delete()
      .eq("id", parsed.data)
      .select("id");

    if (error) {
      return {
        ok: false,
        error:
          error.code === "42501"
            ? "Only an admin can revoke invitations."
            : "Could not revoke the invitation. Please try again.",
      };
    }
    if (!data || data.length === 0) {
      return { ok: false, error: "Invitation not found." };
    }
  } catch {
    return { ok: false, error: NOT_CONFIGURED };
  }

  revalidatePath("/", "layout");
  return { ok: true, data: null };
}

/**
 * §8.1 Path B. The raw token goes to Postgres untouched: `accept_invitation()`
 * hashes it itself for the lookup. Hashing here would send a digest the
 * function would hash a second time, matching nothing.
 *
 * The binding of `profiles.company_id` + `role` and the consumption of the
 * invitation are one transaction inside the function; nothing here retries or
 * compensates.
 */
export async function acceptInvitation(
  rawToken: string,
): Promise<ActionResult<{ companyId: string }>> {
  const parsed = invitationTokenSchema.safeParse(rawToken);
  if (!parsed.success) {
    return {
      ok: false,
      error: "This invitation link is invalid or has already been used.",
    };
  }

  let companyId: string;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("accept_invitation", {
      p_token: parsed.data,
    });

    if (error) {
      return { ok: false, error: acceptInvitationErrorMessage(error) };
    }
    if (!data) {
      return {
        ok: false,
        error: "Could not accept this invitation. Please try again.",
      };
    }

    companyId = data;
  } catch {
    return { ok: false, error: NOT_CONFIGURED };
  }

  // The caller just left limbo (§8.3) and gained a role; every cached
  // authenticated view was rendered under the old state.
  revalidatePath("/", "layout");
  return { ok: true, data: { companyId } };
}

/**
 * Token-gated read for the accept page, callable by `anon` — the invitee has
 * to see which company invited them *before* they have an account (§8.1 Path
 * B), and `invitations` SELECT is admin-only.
 *
 * `data: null` means "no invitation matches this token": never issued,
 * revoked, or mistyped. That is a normal UI state, not a failure, so it is not
 * an `ok: false` — the same reason `signUp` reports `confirmationRequired` as
 * data rather than as an error. `ok: false` is reserved for the link never
 * having been checked at all (network, configuration).
 *
 * `expired` and `accepted` are reported rather than collapsed into null: the
 * page can say "this link expired on the 3rd, ask for a new one", which is
 * actionable in a way that "invalid link" is not. Acceptance is still enforced
 * server-side at redemption (§8.4) — this is display, not a gate.
 */
export async function previewInvitation(rawToken: string): Promise<
  ActionResult<{
    companyName: string;
    email: string;
    role: string;
    expiresAt: string;
    expired: boolean;
    accepted: boolean;
  } | null>
> {
  const parsed = invitationTokenSchema.safeParse(rawToken);
  if (!parsed.success) {
    // A missing or blank token cannot match a row; report it the same way the
    // database would rather than inventing a second "bad link" shape.
    return { ok: true, data: null };
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("invitation_preview", {
      p_token: parsed.data,
    });

    if (error) {
      return {
        ok: false,
        error: "Could not check this invitation link. Please try again.",
      };
    }

    const invitation = data?.[0];
    if (!invitation) {
      return { ok: true, data: null };
    }

    return {
      ok: true,
      data: {
        companyName: invitation.company_name,
        email: invitation.email,
        role: invitation.role,
        expiresAt: invitation.expires_at,
        expired: invitation.expired,
        accepted: invitation.accepted,
      },
    };
  } catch {
    return { ok: false, error: NOT_CONFIGURED };
  }
}
