"use server";

import { revalidatePath } from "next/cache";

// Type-only, so it is erased at build time and does not pull another
// "use server" module into this one's graph.
import type { ActionResult } from "@/lib/actions/auth";
import { createClient } from "@/lib/supabase/server";
import {
  createCompanySchema,
  type CreateCompanyInput,
} from "@/lib/validations/auth";

import type { PostgrestError } from "@supabase/supabase-js";

const NOT_CONFIGURED =
  "Authentication is not configured. Check the Supabase environment variables.";

function createCompanyErrorMessage(error: PostgrestError): string {
  switch (error.code) {
    case "23505":
      // create_company() raises this when profiles.company_id is already set.
      // §2: a user belongs to exactly one company for the life of the account,
      // so this is a permanent state, not a retryable failure.
      return "You already belong to a company.";
    case "28000":
    case "42501":
      // Verified against the local stack: an anon-key call never reaches the
      // function body — EXECUTE is granted to `authenticated` only, so it
      // fails as 42501 "permission denied for function create_company".
      // 28000 is the function's own guard for an authenticated role whose
      // auth.uid() is null. Both mean the same thing to the person reading it.
      return "You need to be signed in to create a company.";
    case "23514":
      // create_company() and the companies triggers share this code; the
      // timezone trigger is the only one a user can provoke with valid input.
      return error.message.includes("timezone")
        ? "That timezone is not recognised. Pick a valid IANA timezone."
        : "Your account is not ready yet. Reload the page and try again.";
    default:
      return "Could not create the company. Please try again.";
  }
}

/**
 * Company creation is one `SECURITY DEFINER` RPC, never two client-side
 * inserts (§8.2): it creates the row and binds `profiles.company_id` +
 * `role = 'admin'` in a single transaction. Two inserts can strand a user in
 * limbo owning a company they cannot even select.
 *
 * Defaults for `p_week_starts_on` / `p_max_timer_hours` live in the function
 * signature, so omitted fields are left out of the payload rather than sent
 * as null — passing null would override the default with NOT NULL and fail.
 */
export async function createCompany(
  input: CreateCompanyInput,
): Promise<ActionResult<{ companyId: string }>> {
  const parsed = createCompanySchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid company details.",
    };
  }

  const { name, timezone, weekStartsOn, maxTimerHours } = parsed.data;

  let companyId: string;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("create_company", {
      p_name: name,
      p_timezone: timezone,
      ...(weekStartsOn === undefined ? {} : { p_week_starts_on: weekStartsOn }),
      ...(maxTimerHours === undefined
        ? {}
        : { p_max_timer_hours: maxTimerHours }),
    });

    if (error) {
      return { ok: false, error: createCompanyErrorMessage(error) };
    }
    if (!data) {
      return {
        ok: false,
        error: "Could not create the company. Please try again.",
      };
    }

    companyId = data;
  } catch {
    return { ok: false, error: NOT_CONFIGURED };
  }

  // The user just left limbo (§8.3); every cached authenticated view was
  // rendered under the old state.
  revalidatePath("/", "layout");
  return { ok: true, data: { companyId } };
}
