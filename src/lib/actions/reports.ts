"use server";

// Type-only, so it is erased at build time and does not pull another
// "use server" module into this one's graph.
import type { ActionResult } from "@/lib/actions/auth";
// A value import. Every report needs the caller's role before it can build its
// arguments (§9.2's employee filter drop, below), and `getCurrentMember()`
// already answers "who am I, what may I do" in one read — a second copy of that
// `profiles -> companies` query here would be a second place for §4.2.1's limbo
// case to be handled differently.
import { getCurrentMember } from "@/lib/actions/companies";
import { csvForReport, reportCsvFilename } from "@/lib/reports/columns";
import { createClient } from "@/lib/supabase/server";
import {
  reportFiltersSchema,
  reportRequestSchema,
  type ReportFiltersInput,
  type ReportRequestInput,
} from "@/lib/validations/reports";
import type { Database } from "@/types/supabase";

import type { PostgrestError } from "@supabase/supabase-js";

const NOT_CONFIGURED =
  "Authentication is not configured. Check the Supabase environment variables.";

const NOT_SIGNED_IN = "You need to be signed in to run a report.";

const NO_COMPANY =
  "You need to finish setting up your company before running reports.";

// ---------------------------------------------------------------------------
// Row shapes
//
// Every label column below is `string | null`, and **the generated types in
// `src/types/supabase.ts` disagree** — they type `project_name`, `client_name`,
// `task_name`, `user_name` and `client_id` as plain `string`. The generator is
// wrong here, and provably so rather than theoretically: `supabase gen types`
// reads a function's `RETURNS TABLE` declaration, which has no nullability
// information at all, so it emits every column as non-null. The SQL those
// columns come from is a LEFT join (0007's note (a)), which returns NULL
// whenever the caller cannot read the joined row.
//
// That is a state a normal employee reaches, not a corner case: §2.3 keeps a
// removed employee's time entries while §3.6.1 takes away their `projects`
// SELECT, so their own hours come back with no project label — verified against
// the local stack, 22450 seconds on a row whose `project_name` was null.
// Trusting the generated `string` would put `undefined.slice(...)`-shaped
// crashes in the UI and, worse, would let a `?? ""` slip in somewhere that
// silently turns "I cannot see this label" into "this thing is called nothing".
//
// So the widening happens once, here, where every raw row is assigned to a
// corrected type before it is mapped (see `LabelNullable`). No cast is
// involved: `string` is assignable to `string | null`, so the compiler accepts
// the assignment and then *forces* every mapper below to face the null.
// ---------------------------------------------------------------------------

/** §9.3 "by day". `day` is `YYYY-MM-DD` in the company timezone (§6.1). */
export type ReportDayRow = {
  day: string;
  entryCount: number;
  totalSeconds: number;
};

/** §9.3 "by user". `userName` is null when the profile row is unreadable. */
export type ReportUserRow = {
  userId: string;
  userName: string | null;
  entryCount: number;
  totalSeconds: number;
};

/**
 * §9.3 "by project", carrying the client for display.
 *
 * A null `clientId`/`clientName` means one of two things this query cannot tell
 * apart: a genuinely internal project (§3.4 — `projects.client_id` is nullable)
 * or a project whose row the caller cannot read. Render it as an absent label
 * ("No client", "—"), never as a claim that the work was internal.
 */
export type ReportProjectRow = {
  projectId: string;
  projectName: string | null;
  clientId: string | null;
  clientName: string | null;
  entryCount: number;
  totalSeconds: number;
};

/** §9.3 "by task", carrying the parent project — §3.5.2 makes bare task names ambiguous. */
export type ReportTaskRow = {
  taskId: string;
  taskName: string | null;
  projectId: string;
  projectName: string | null;
  entryCount: number;
  totalSeconds: number;
};

/**
 * §9.3 "by client". Here the null group is a **line item**, not a blank cell,
 * and it mixes internal work with work whose client label the caller cannot
 * read. 0007's own comment: render it as "no client label", never "Internal".
 */
export type ReportClientRow = {
  clientId: string | null;
  clientName: string | null;
  entryCount: number;
  totalSeconds: number;
};

/** §9.3's user × project cross-tab, "the useful one in practice". */
export type ReportUserProjectRow = {
  userId: string;
  userName: string | null;
  projectId: string;
  projectName: string | null;
  clientId: string | null;
  clientName: string | null;
  entryCount: number;
  totalSeconds: number;
};

/**
 * §9.4's header figures. `runningCount` is the "shown separately as in
 * progress" half — those entries contribute **zero** to `totalSeconds` (§5.4),
 * so a header reading "3 entries, 1:20:00, 1 running" is describing four rows.
 */
export type ReportSummary = {
  entryCount: number;
  totalSeconds: number;
  runningCount: number;
};

/**
 * A completed report, tagged by which §9.3 grouping produced it. The tag is
 * what lets the CSV formatter (and a renderer) pick columns without a cast —
 * six row shapes with no discriminant would need one.
 */
export type ReportResult =
  | { grouping: "day"; rows: ReportDayRow[] }
  | { grouping: "user"; rows: ReportUserRow[] }
  | { grouping: "project"; rows: ReportProjectRow[] }
  | { grouping: "task"; rows: ReportTaskRow[] }
  | { grouping: "client"; rows: ReportClientRow[] }
  | { grouping: "user-project"; rows: ReportUserProjectRow[] };

// ---------------------------------------------------------------------------
// Raw rows, with the label columns corrected
// ---------------------------------------------------------------------------

type Fn = Database["public"]["Functions"];

/**
 * `Row` with the named keys widened to include `null`.
 *
 * Used as the *declared type of a local variable*, never as a cast: assigning a
 * `{ name: string }[]` to a `{ name: string | null }[]` is ordinary widening
 * that TypeScript already permits, and it flips the null handling below from
 * dead code the compiler thinks is unnecessary into code the compiler requires.
 */
type LabelNullable<Row, K extends keyof Row> = Omit<Row, K> & {
  [P in K]: Row[P] | null;
};

type RawDayRow = Fn["report_by_day"]["Returns"][number];

type RawUserRow = LabelNullable<
  Fn["report_by_user"]["Returns"][number],
  "user_name"
>;

type RawProjectRow = LabelNullable<
  Fn["report_by_project"]["Returns"][number],
  "project_name" | "client_id" | "client_name"
>;

type RawTaskRow = LabelNullable<
  Fn["report_by_task"]["Returns"][number],
  "task_name" | "project_name"
>;

type RawClientRow = LabelNullable<
  Fn["report_by_client"]["Returns"][number],
  "client_id" | "client_name"
>;

type RawUserProjectRow = LabelNullable<
  Fn["report_by_user_project"]["Returns"][number],
  "user_name" | "project_name" | "client_id" | "client_name"
>;

type RawSummaryRow = Fn["report_summary"]["Returns"][number];

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

/**
 * The six parameters every one of 0007's functions takes, in the shape
 * `supabase.rpc` wants.
 *
 * A filter that is off is `undefined` rather than `null`: `JSON.stringify`
 * drops undefined keys, so the parameter is absent from the request body and
 * Postgres applies the function's own `default null`. Sending an explicit null
 * would work identically today — the bodies all read
 * `p_x is null or col = p_x` — but omitting it keeps the "no filter" case
 * expressed in exactly one place, the function signature.
 */
type ReportArgs = {
  p_from: string;
  p_to: string;
  p_user_id?: string;
  p_client_id?: string;
  p_project_id?: string;
  p_task_id?: string;
};

/**
 * Validate, resolve the caller, and apply §9.2's employee scoping.
 *
 * **The filter drop.** §9.2: "Admins may filter by any user; employees are hard
 * -scoped to themselves by RLS regardless of what the UI sends." RLS is the
 * boundary and it already holds — `time_entries_select_own_or_admin` returns an
 * employee nothing but their own rows whatever `p_user_id` says, and these
 * functions are `SECURITY INVOKER` precisely so that policy is the only scope
 * in play. This is the *UX* half: an employee's `p_user_id` is replaced with
 * their own id rather than forwarded.
 *
 * The difference is only visible when something sends a colleague's id — a
 * stale form, a bookmarked URL, a hand-edited request. Forwarding it would
 * produce an empty report, which reads as "that person logged nothing this
 * week"; replacing it produces their own report, which is what the boundary was
 * always going to give them. Nothing is granted or denied by this line; it
 * chooses between two renderings of the same permission.
 *
 * Setting it for an employee who sent *no* filter is the same statement made
 * positively: the parameter then says out loud what RLS would have done
 * silently, and the report cannot be misread as company-wide.
 */
async function prepare(
  input: ReportFiltersInput,
): Promise<ActionResult<ReportArgs>> {
  const parsed = reportFiltersSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Could not run that report.",
    };
  }

  const member = await getCurrentMember();
  if (!member.ok) {
    return member;
  }
  if (!member.data) {
    return { ok: false, error: NOT_SIGNED_IN };
  }
  if (!member.data.company) {
    return { ok: false, error: NO_COMPANY };
  }

  // `role === 'admin' AND status === 'active'` is `is_admin()`'s own definition
  // (§4.1), restated here so this layer's idea of an admin cannot be wider than
  // the policy's. A deactivated admin still holds `role = 'admin'` — §2.3 keeps
  // the row — but `is_admin()` is false for them, so RLS scopes them to their
  // own entries. Reading role alone would let them keep a colleague's filter and
  // receive an empty report, which is precisely the "that person logged nothing"
  // misreading this whole branch exists to avoid.
  const isAdmin =
    member.data.role === "admin" && member.data.status === "active";
  const userId = isAdmin ? parsed.data.userId : member.data.id;

  return {
    ok: true,
    data: {
      p_from: parsed.data.from,
      p_to: parsed.data.to,
      p_user_id: userId ?? undefined,
      p_client_id: parsed.data.clientId ?? undefined,
      p_project_id: parsed.data.projectId ?? undefined,
      p_task_id: parsed.data.taskId ?? undefined,
    },
  };
}

/**
 * 0007's error contract, which is short because these functions raise nothing
 * of their own: they are pure reads, and RLS on a SELECT filters rather than
 * errors. Filtering by a project the caller cannot see is zero rows, not a
 * refusal — the database deliberately does not distinguish "not yours" from
 * "not there", and neither does anything here.
 *
 * The one asymmetry worth knowing about (and it is a UX question, not a bug):
 * `clients` SELECT is company-wide, so an employee can *pick* a client whose
 * projects they are not a member of, and get an empty report. That is correct
 * per RLS. It is not smoothed over here, and it must not be — the fix would be
 * a `SECURITY DEFINER` read, which is exactly what §4.4 forbids.
 */
function reportErrorMessage(error: PostgrestError): string {
  switch (error.code) {
    case "22008":
      // A date Postgres cannot parse. `reportDaySchema` refuses these first, so
      // this is reachable only by a direct API call.
      return "That date range isn't valid.";
    case "22P02":
      // A filter that is not a uuid — likewise refused by validation first.
      return "One of those report filters isn't valid. Reload and try again.";
    case "42501":
      // EXECUTE is granted to `authenticated` only; an anon-key call never
      // reaches the body.
      return NOT_SIGNED_IN;
    default:
      return "Could not run that report. Please try again.";
  }
}

// ---------------------------------------------------------------------------
// The seven groupings
//
// Each one is the same four steps — prepare, call, map, return — written out
// rather than routed through one generic helper. `supabase.rpc` is overloaded
// per function name, and a generic wrapper collapses seven distinct
// `Returns` types into one union that every caller then has to narrow by hand;
// the repetition buys full inference at each call site and one place per
// grouping to see which columns are being read.
// ---------------------------------------------------------------------------

export async function getReportByDay(
  filters: ReportFiltersInput,
): Promise<ActionResult<ReportDayRow[]>> {
  const args = await prepare(filters);
  if (!args.ok) {
    return args;
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("report_by_day", args.data);

    if (error) {
      return { ok: false, error: reportErrorMessage(error) };
    }

    const rows: RawDayRow[] = data;
    return {
      ok: true,
      data: rows.map((row) => ({
        day: row.day,
        entryCount: row.entry_count,
        totalSeconds: row.total_seconds,
      })),
    };
  } catch {
    return { ok: false, error: NOT_CONFIGURED };
  }
}

export async function getReportByUser(
  filters: ReportFiltersInput,
): Promise<ActionResult<ReportUserRow[]>> {
  const args = await prepare(filters);
  if (!args.ok) {
    return args;
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("report_by_user", args.data);

    if (error) {
      return { ok: false, error: reportErrorMessage(error) };
    }

    const rows: RawUserRow[] = data;
    return {
      ok: true,
      data: rows.map((row) => ({
        userId: row.user_id,
        userName: row.user_name,
        entryCount: row.entry_count,
        totalSeconds: row.total_seconds,
      })),
    };
  } catch {
    return { ok: false, error: NOT_CONFIGURED };
  }
}

export async function getReportByProject(
  filters: ReportFiltersInput,
): Promise<ActionResult<ReportProjectRow[]>> {
  const args = await prepare(filters);
  if (!args.ok) {
    return args;
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("report_by_project", args.data);

    if (error) {
      return { ok: false, error: reportErrorMessage(error) };
    }

    const rows: RawProjectRow[] = data;
    return {
      ok: true,
      data: rows.map((row) => ({
        projectId: row.project_id,
        projectName: row.project_name,
        clientId: row.client_id,
        clientName: row.client_name,
        entryCount: row.entry_count,
        totalSeconds: row.total_seconds,
      })),
    };
  } catch {
    return { ok: false, error: NOT_CONFIGURED };
  }
}

export async function getReportByTask(
  filters: ReportFiltersInput,
): Promise<ActionResult<ReportTaskRow[]>> {
  const args = await prepare(filters);
  if (!args.ok) {
    return args;
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("report_by_task", args.data);

    if (error) {
      return { ok: false, error: reportErrorMessage(error) };
    }

    const rows: RawTaskRow[] = data;
    return {
      ok: true,
      data: rows.map((row) => ({
        taskId: row.task_id,
        taskName: row.task_name,
        projectId: row.project_id,
        projectName: row.project_name,
        entryCount: row.entry_count,
        totalSeconds: row.total_seconds,
      })),
    };
  } catch {
    return { ok: false, error: NOT_CONFIGURED };
  }
}

export async function getReportByClient(
  filters: ReportFiltersInput,
): Promise<ActionResult<ReportClientRow[]>> {
  const args = await prepare(filters);
  if (!args.ok) {
    return args;
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("report_by_client", args.data);

    if (error) {
      return { ok: false, error: reportErrorMessage(error) };
    }

    const rows: RawClientRow[] = data;
    return {
      ok: true,
      data: rows.map((row) => ({
        clientId: row.client_id,
        clientName: row.client_name,
        entryCount: row.entry_count,
        totalSeconds: row.total_seconds,
      })),
    };
  } catch {
    return { ok: false, error: NOT_CONFIGURED };
  }
}

export async function getReportByUserProject(
  filters: ReportFiltersInput,
): Promise<ActionResult<ReportUserProjectRow[]>> {
  const args = await prepare(filters);
  if (!args.ok) {
    return args;
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc(
      "report_by_user_project",
      args.data,
    );

    if (error) {
      return { ok: false, error: reportErrorMessage(error) };
    }

    const rows: RawUserProjectRow[] = data;
    return {
      ok: true,
      data: rows.map((row) => ({
        userId: row.user_id,
        userName: row.user_name,
        projectId: row.project_id,
        projectName: row.project_name,
        clientId: row.client_id,
        clientName: row.client_name,
        entryCount: row.entry_count,
        totalSeconds: row.total_seconds,
      })),
    };
  } catch {
    return { ok: false, error: NOT_CONFIGURED };
  }
}

/**
 * §9.4's header, as one row.
 *
 * `report_summary` has no GROUP BY, so it returns exactly one row over any
 * input, including a row of zeroes for an empty range — the empty-array branch
 * below is therefore unreachable through PostgREST and exists so that an empty
 * response renders "0:00:00" rather than crashing on `undefined.entry_count`.
 */
export async function getReportSummary(
  filters: ReportFiltersInput,
): Promise<ActionResult<ReportSummary>> {
  const args = await prepare(filters);
  if (!args.ok) {
    return args;
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("report_summary", args.data);

    if (error) {
      return { ok: false, error: reportErrorMessage(error) };
    }

    const rows: RawSummaryRow[] = data;
    const row = rows.at(0);

    return {
      ok: true,
      data: {
        entryCount: row?.entry_count ?? 0,
        totalSeconds: row?.total_seconds ?? 0,
        runningCount: row?.running_count ?? 0,
      },
    };
  } catch {
    return { ok: false, error: NOT_CONFIGURED };
  }
}

// ---------------------------------------------------------------------------
// §9.6 — CSV export
// ---------------------------------------------------------------------------

/**
 * One report, fetched and encoded as an RFC 4180 document (§9.6).
 *
 * **This is not how the browser downloads the file.** A server action can only
 * hand a string back to JavaScript, which then has to build a Blob and an
 * object URL to save it — that is UI work, it loses the filename and the
 * `Content-Disposition` header, and it cannot be a plain link. The download is
 * `GET /api/reports/export`, which calls this and writes the headers; this
 * action exists alongside it for any caller that wants the text itself (a
 * preview, a copy-to-clipboard, a Server Component rendering the same data).
 *
 * The filters go through `prepare` inside the grouping action, so the §9.2
 * employee filter drop applies to an export exactly as it does to a report on
 * screen — there is no second path to the data here.
 */
export async function exportReportCsv(
  request: ReportRequestInput,
): Promise<ActionResult<{ filename: string; csv: string }>> {
  const parsed = reportRequestSchema.safeParse(request);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Could not export that report.",
    };
  }

  const { grouping, ...filters } = parsed.data;

  const result = await fetchReport(grouping, filters);
  if (!result.ok) {
    return result;
  }

  return {
    ok: true,
    data: {
      filename: reportCsvFilename(grouping, filters.from, filters.to),
      csv: csvForReport(result.data),
    },
  };
}

/**
 * Grouping → action. Exhaustive by construction: `ReportGrouping` is a closed
 * enum and every arm returns, so adding a seventh grouping to the schema
 * without adding it here is a compile error rather than a runtime fallthrough.
 *
 * Not exported — a `'use server'` module publishes every export as an endpoint,
 * and this one has no caller outside the file.
 */
async function fetchReport(
  grouping: ReportResult["grouping"],
  filters: ReportFiltersInput,
): Promise<ActionResult<ReportResult>> {
  switch (grouping) {
    case "day": {
      const result = await getReportByDay(filters);
      return result.ok
        ? { ok: true, data: { grouping, rows: result.data } }
        : result;
    }
    case "user": {
      const result = await getReportByUser(filters);
      return result.ok
        ? { ok: true, data: { grouping, rows: result.data } }
        : result;
    }
    case "project": {
      const result = await getReportByProject(filters);
      return result.ok
        ? { ok: true, data: { grouping, rows: result.data } }
        : result;
    }
    case "task": {
      const result = await getReportByTask(filters);
      return result.ok
        ? { ok: true, data: { grouping, rows: result.data } }
        : result;
    }
    case "client": {
      const result = await getReportByClient(filters);
      return result.ok
        ? { ok: true, data: { grouping, rows: result.data } }
        : result;
    }
    case "user-project": {
      const result = await getReportByUserProject(filters);
      return result.ok
        ? { ok: true, data: { grouping, rows: result.data } }
        : result;
    }
  }
}
