"use server";

import { revalidatePath } from "next/cache";

// Type-only, so it is erased at build time and does not pull another
// "use server" module into this one's graph.
import type { ActionResult } from "@/lib/actions/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import {
  clientIdSchema,
  clientSchema,
  listStructureOptionsSchema,
  type ClientInput,
  type ListStructureOptions,
} from "@/lib/validations/structure";

import type { PostgrestError } from "@supabase/supabase-js";

const NOT_CONFIGURED =
  "Authentication is not configured. Check the Supabase environment variables.";

const NOT_FOUND =
  "Client not found, or you don't have permission to change it.";

/** One row of the client list. `archivedAt` is non-null for a soft-deleted client (§3.11). */
export type Client = {
  id: string;
  name: string;
  archivedAt: string | null;
};

function clientWriteErrorMessage(error: PostgrestError): string {
  switch (error.code) {
    case "23505":
      // `clients_company_id_name_active_key` — the partial unique index over
      // ACTIVE clients only. Archiving frees the name, so this really does mean
      // "a client you can still see is using it", not "it was used once".
      return "A client with this name already exists.";
    case "42501":
      // `clients_insert_admin` / `clients_update_admin` WITH CHECK. USING
      // filters silently, so a blocked UPDATE arrives as zero rows instead
      // (handled by the callers); this code is the WITH CHECK half.
      return "Only an admin can manage clients.";
    case "23502":
    case "23503":
      // company_id defaults to current_company_id(), which is NULL for a user
      // in limbo (§8.3) — NOT NULL or the companies FK rejects it first.
      return "Create your company before adding clients to it.";
    default:
      return "Could not save the client. Please try again.";
  }
}

/**
 * §3.3. `company_id` is omitted deliberately: it defaults to
 * `current_company_id()` and the INSERT policy accepts no other value, so
 * naming it would only add a way to be wrong.
 */
export async function createClient(
  input: ClientInput,
): Promise<ActionResult<Client>> {
  const parsed = clientSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid client details.",
    };
  }

  let client: Client;
  try {
    const supabase = await createSupabaseClient();

    const { data, error } = await supabase
      .from("clients")
      .insert({ name: parsed.data.name })
      .select("id, name, archived_at")
      .single();

    if (error) {
      return { ok: false, error: clientWriteErrorMessage(error) };
    }

    client = { id: data.id, name: data.name, archivedAt: data.archived_at };
  } catch {
    return { ok: false, error: NOT_CONFIGURED };
  }

  revalidatePath("/", "layout");
  return { ok: true, data: client };
}

/**
 * §3.11 — archive, never delete. This is not a softened delete that could be
 * upgraded later: `authenticated` holds no DELETE grant on `clients` at all,
 * and `projects.client_id` is `ON DELETE RESTRICT`, so the hard delete this
 * action deliberately does not attempt would be refused twice over if it did.
 *
 * Zero rows affected is the case worth naming. A non-admin fails the UPDATE
 * policy's USING clause, which *filters* rather than raises — PostgREST reports
 * success with an empty set. Reporting that as done would tell an admin a
 * client is gone from their pickers when it is still in everyone's.
 *
 * Archiving is idempotent by design: re-archiving an already-archived client
 * simply rewrites `archived_at`. Nothing depends on the old timestamp, and
 * failing here would only punish a double-click.
 */
export async function archiveClient(
  clientId: string,
): Promise<ActionResult<null>> {
  const parsed = clientIdSchema.safeParse(clientId);
  if (!parsed.success) {
    return { ok: false, error: "Client not found." };
  }

  try {
    const supabase = await createSupabaseClient();

    const { data, error } = await supabase
      .from("clients")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", parsed.data)
      .select("id");

    if (error) {
      return { ok: false, error: clientWriteErrorMessage(error) };
    }
    if (data.length === 0) {
      return { ok: false, error: NOT_FOUND };
    }
  } catch {
    return { ok: false, error: NOT_CONFIGURED };
  }

  revalidatePath("/", "layout");
  return { ok: true, data: null };
}

/**
 * Active clients by default (§3.11: archived rows are "excluded from pickers"),
 * with `includeArchived` for the admin-facing management list.
 *
 * No `company_id` filter and no role check: `clients_select_own_company` scopes
 * this to the caller's company, and employees get the same list — clients are
 * not project-scoped, so there is no membership concept to narrow them with.
 * Adding a redundant TypeScript filter here would invite the reading that
 * tenancy is enforced in the application.
 *
 * Active rows sort ahead of archived ones so a mixed list needs no second pass
 * to group itself.
 */
export async function listClients(
  options?: ListStructureOptions,
): Promise<ActionResult<Client[]>> {
  const parsed = listStructureOptionsSchema.safeParse(options ?? {});
  if (!parsed.success) {
    return { ok: false, error: "Could not load the client list." };
  }

  try {
    const supabase = await createSupabaseClient();

    let query = supabase.from("clients").select("id, name, archived_at");

    if (!parsed.data.includeArchived) {
      query = query.is("archived_at", null);
    }

    const { data, error } = await query
      .order("archived_at", { ascending: true, nullsFirst: true })
      .order("name", { ascending: true });

    if (error) {
      return { ok: false, error: "Could not load the client list." };
    }

    return {
      ok: true,
      data: data.map((row) => ({
        id: row.id,
        name: row.name,
        archivedAt: row.archived_at,
      })),
    };
  } catch {
    return { ok: false, error: NOT_CONFIGURED };
  }
}
