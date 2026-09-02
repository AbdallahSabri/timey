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
import {
  csvForReport,
  csvForReportEntries,
  reportCsvFilename,
  reportEntriesCsvFilename,
} from "@/lib/reports/columns";
import { createClient } from "@/lib/supabase/server";
import {
  ENTRIES_PER_PAGE,
  reportEntriesRequestSchema,
  reportFiltersSchema,
  reportRequestSchema,
  type ReportEntriesRequest,
  type ReportEntriesRequestInput,
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

/**
 * §9.7's detail row: one time entry, with every label resolved and both clock
 * readings already converted to the company timezone by the SQL (0013's
 * DEPARTURE 2 — `startedAt` is `"2026-09-01T09:02:11"`, a wall clock with no
 * offset, and attaching one or feeding it to `new Date()` re-interprets it in
 * whatever zone the reader happens to be in).
 *
 * **This is not a seventh `ReportResult` variant and must not be folded into
 * one.** `ReportResult`'s tag exists so `csvForReport` and `describeReport` can
 * switch exhaustively over the six §9.3 *aggregations*, each of which has an
 * `entryCount`, a `totalSeconds`, and a footer total that sums its own visible
 * rows. This shape has none of the three: it aggregates nothing, it is
 * paginated, and §9.7 rules out a footer total precisely because a page of 50
 * rows out of 312 cannot honestly carry one. Adding it as a variant would make
 * those switches claim to handle a row they cannot render (`SPEC.md` §9.7's own
 * "deliberately not a seventh grouping"). The range figures stay where they
 * already are, in `getReportSummary`.
 *
 * `endedAt` and `durationSeconds` are null on exactly the running rows, and
 * together they *are* the "in progress" flag — 0013 returns no status column
 * because `duration_seconds` is GENERATED from `ended_at` (§3.7), so there is no
 * third state to represent. §9.4's exclusion of running entries from totals is
 * the caller's obligation the moment it sums these: `report_summary` remains the
 * sanctioned source of range totals, and nothing derived here may disagree
 * with it.
 */
export type ReportEntryRow = {
  id: string;
  /** `YYYY-MM-DD`, the company-local day the entry started in (§6.1, §5.5). */
  day: string;
  /** Company wall clock, `YYYY-MM-DDTHH:MM:SS`, no offset — never a UTC instant. */
  startedAt: string;
  /** Null while the timer runs. */
  endedAt: string | null;
  /** Null while the timer runs; integer seconds otherwise (§9.5). */
  durationSeconds: number | null;
  userId: string;
  userName: string | null;
  projectId: string;
  projectName: string | null;
  taskId: string;
  taskName: string | null;
  clientId: string | null;
  clientName: string | null;
  source: Database["public"]["Enums"]["entry_source"];
  note: string | null;
};

/**
 * One page of §9.7's list, with the size of the whole filtered set alongside it.
 *
 * `totalCount` is what the pagination control needs and what `rows.length`
 * cannot tell it: on the last page they differ, and on an over-shot page number
 * `rows` is empty while the set is not.
 */
export type ReportEntriesPage = {
  rows: ReportEntryRow[];
  /** The whole filtered set, not this page. */
  totalCount: number;
  page: number;
  perPage: number;
};

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

/**
 * 0013's row, widened for **two different reasons** that happen to need the same
 * correction — worth separating, because only the first is the one the long note
 * at the top of this file describes.
 *
 * `user_name`, `project_name`, `task_name`, `client_name` and `client_id` are
 * the familiar case: LEFT joins over rows the caller may not be able to read
 * (0013's note (a)), typed non-null only because `RETURNS TABLE` carries no
 * nullability for the generator to read.
 *
 * `local_ended_at` and `duration_seconds` are **genuinely nullable columns**,
 * not unreadable labels. They are null on exactly the running entries, which
 * 0013's DEPARTURE 1 deliberately includes in this result — the generator is
 * equally wrong about them, but a `?? 0` here would not merely invent a label,
 * it would turn a running timer into a completed zero-second entry inside a
 * timesheet. `note` is nullable in the table itself (§3.7) for a third, entirely
 * ordinary reason: entries need not carry one.
 */
type RawEntryRow = LabelNullable<
  Fn["report_entries"]["Returns"][number],
  | "user_name"
  | "project_name"
  | "task_name"
  | "client_name"
  | "client_id"
  | "local_ended_at"
  | "duration_seconds"
  | "note"
>;

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
 * `report_entries`' parameters: the same six every 0007 function takes, plus
 * 0013's page window.
 *
 * Both page parameters are required here rather than optional, unlike the
 * filters above. The filters have a meaningful "off" that the function's own
 * `default null` expresses; a window does not — omitting `p_limit` would take
 * 0013's default of 50, which is right for one screen and wrong for an export,
 * so every caller states which it wants.
 */
type ReportEntriesArgs = ReportArgs & {
  p_limit: number;
  p_offset: number;
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
// §9.7 — the detail view
// ---------------------------------------------------------------------------

/**
 * Parse an entries request and turn it into RPC arguments.
 *
 * **The double parse is not redundant, and neither half can be dropped.**
 * `reportEntriesRequestSchema` owns `page` — the one field `prepare` has never
 * heard of — and it is what refuses a 400-day range or an absurd page number
 * with its own sentence before any round trip happens. `prepare` owns the
 * filters *and* §9.2's employee scoping, and that scoping must stay in exactly
 * one place: a second `isAdmin ? userId : ownId` written here would be a second
 * definition of who an admin is, free to drift from the policy's (§0.2). So the
 * page half is peeled off, the filter half is handed to `prepare` unchanged, and
 * the window is spread onto what comes back.
 *
 * The re-parse `prepare` performs on the already-parsed filters is idempotent —
 * the day and uuid schemas are trims and regexes over values that have been
 * through them once — so it costs a few microseconds and buys the property that
 * `prepare` is safe to call from anywhere.
 *
 * Not exported: a `'use server'` module publishes every export as an endpoint,
 * and this has no caller outside the file.
 */
async function prepareEntries(
  input: ReportEntriesRequestInput,
): Promise<
  ActionResult<{ request: ReportEntriesRequest; filterArgs: ReportArgs }>
> {
  const parsed = reportEntriesRequestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Could not list those entries.",
    };
  }

  // `page` is split off so that `filters` is exactly the §9.2 filter set
  // `prepare` accepts, and put back on the request the caller receives — which
  // is where the page number is actually read.
  const { page, ...filters } = parsed.data;

  const args = await prepare(filters);
  if (!args.ok) {
    return args;
  }

  // The window is left to the caller: one page for the screen, 200 at a time for
  // the export. `p_limit` and `p_offset` are the only difference between them.
  return {
    ok: true,
    data: { request: { ...filters, page }, filterArgs: args.data },
  };
}

/**
 * One call to `report_entries`, mapped.
 *
 * Split out from the two public entry points because the export reads the same
 * rows a page at a time: a second copy of this mapping would be a second place
 * for a running row's nulls to be handled differently, which is the failure
 * 0013's DEPARTURE 1 warns about at length.
 *
 * Not exported, for the `'use server'` reason above.
 */
async function queryEntries(
  args: ReportEntriesArgs,
): Promise<ActionResult<{ rows: ReportEntryRow[]; totalCount: number }>> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("report_entries", args);

    if (error) {
      return { ok: false, error: reportErrorMessage(error) };
    }

    const rows: RawEntryRow[] = data;

    return {
      ok: true,
      data: {
        rows: rows.map((row) => ({
          id: row.entry_id,
          day: row.day,
          startedAt: row.local_started_at,
          endedAt: row.local_ended_at,
          durationSeconds: row.duration_seconds,
          userId: row.user_id,
          userName: row.user_name,
          projectId: row.project_id,
          projectName: row.project_name,
          taskId: row.task_id,
          taskName: row.task_name,
          clientId: row.client_id,
          clientName: row.client_name,
          source: row.source,
          note: row.note,
        })),
        // 0013 carries `count(*) over ()` through the `returns table`, so the
        // pre-LIMIT size of the whole filtered set is repeated identically on
        // every row and there is nowhere else to read it from.
        //
        // **Zero rows therefore means zero count, and that is only true of the
        // page it was read from.** At offset 0 an empty page really is an empty
        // set; at any other offset it means "past the end", which says nothing
        // about how many entries exist. Nothing here can tell the two apart —
        // the argument is the caller's, and `getReportEntries` is where the
        // distinction is handled.
        totalCount: rows[0]?.total_count ?? 0,
      },
    };
  } catch {
    // **The one catch in this file that asks *why* before answering**, because
    // it is the one whose caller may be on its twenty-sixth round trip.
    //
    // Almost everything that goes wrong here never reaches this block:
    // `createClient()` throws when the Supabase environment variables are
    // missing, and a request that fails in flight does not throw at all —
    // postgrest-js converts a fetch failure into a `PostgrestError` that the
    // `if (error)` branch above has already worded. What is left is the narrow
    // remainder, an aborted request among them, which postgrest-js rethrows.
    //
    // Blaming that on configuration would tell an admin who has been running
    // reports all morning to go and check their environment variables. So the
    // sentence is chosen from a fact rather than an assumption: if the URL and
    // key really are absent, nothing was ever going to work and NOT_CONFIGURED
    // is the whole truth; if they are present, this was a failure in flight and
    // the honest answer is to try again.
    const configured = Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    );

    return {
      ok: false,
      error: configured
        ? "Could not load those entries. Please try again."
        : NOT_CONFIGURED,
    };
  }
}

/**
 * §9.7's list: one page of the entries behind a report, newest first.
 *
 * Running entries are included and are the rows with a null `endedAt` — that is
 * 0013's deliberate departure from 0007's `where ended_at is not null`, and the
 * reason this view has no total of its own. Anything that needs the range's
 * figures calls `getReportSummary`, which excludes running entries from the sum
 * and counts them separately (§9.4).
 */
export async function getReportEntries(
  input: ReportEntriesRequestInput,
): Promise<ActionResult<ReportEntriesPage>> {
  const prepared = await prepareEntries(input);
  if (!prepared.ok) {
    return prepared;
  }

  const { page } = prepared.data.request;

  const result = await queryEntries({
    ...prepared.data.filterArgs,
    p_limit: ENTRIES_PER_PAGE,
    p_offset: (page - 1) * ENTRIES_PER_PAGE,
  });
  if (!result.ok) {
    return result;
  }

  // **An empty page that is not the first one is a page past the end, and it
  // cannot be reported as an empty range.**
  //
  // The count rides on the rows (0013 carries `count(*) over ()` through the
  // `returns table`), so a page with no rows carries no count either, and
  // `queryEntries` can only answer 0. That is right at offset 0 and wrong
  // everywhere else — and wrong in a way that compounds: 0 makes the pagination
  // control disappear, so there is no "previous" link back to the data; it makes
  // the empty state say "nothing was started in this range" about a range that
  // holds hundreds of entries; and it disables the CSV of an export that ignores
  // the page entirely and would have written every one of them. A stale
  // bookmark, or a range that shrank since the link was shared, is enough to
  // reach it.
  //
  // Falling back to the first page rather than to the *last* one is deliberate.
  // Both need this same extra round trip, but the last page needs the count
  // before it can be asked for, so it costs one more; and landing on page 1 of a
  // report is a place a reader recognises, where landing on page 4 of 4 with no
  // memory of having asked for a page is not. The page number in the returned
  // data — not the one in the URL — is what the pagination control renders, so
  // every link on screen agrees with what is under it.
  if (result.data.rows.length === 0 && page > 1) {
    const firstPage = await queryEntries({
      ...prepared.data.filterArgs,
      p_limit: ENTRIES_PER_PAGE,
      p_offset: 0,
    });
    if (!firstPage.ok) {
      return firstPage;
    }

    return {
      ok: true,
      data: {
        rows: firstPage.data.rows,
        totalCount: firstPage.data.totalCount,
        page: 1,
        perPage: ENTRIES_PER_PAGE,
      },
    };
  }

  return {
    ok: true,
    data: {
      rows: result.data.rows,
      totalCount: result.data.totalCount,
      page,
      perPage: ENTRIES_PER_PAGE,
    },
  };
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
 * How many entries an export reads per round trip.
 *
 * 200 is 0013's hard clamp, not a preference: `least(greatest(p_limit, 1), 200)`
 * silently caps anything larger, so asking for 1000 would fetch 200 and advance
 * the offset by 1000, skipping four rows in five. The loop below detects the end
 * of the data by a short page, which only works while this number is exactly the
 * limit the function will honour.
 */
const EXPORT_PAGE_SIZE = 200;

/**
 * §9.6's cap on a detail export, in entries.
 *
 * Checked **up front from `total_count`**, before any page but the first is
 * fetched, rather than discovered by counting rows on the way. The difference
 * matters: a limit discovered halfway through leaves a caller holding a
 * half-written file and a choice between truncating it and throwing the work
 * away, and the first of those is the one outcome worth refusing over. A
 * timesheet that silently stops at some row is not a smaller timesheet, it is a
 * wrong one — nothing in the file says it is incomplete, and the person
 * reconciling it against the summary header sees hours that have gone missing.
 * So the answer is a sentence asking for a narrower range, which is a request
 * the caller can act on.
 */
const MAX_EXPORT_ENTRIES = 5000;

/**
 * A ceiling on the loop itself, independent of the count check above.
 *
 * `total_count` comes from the database and the check above trusts it; this does
 * not. If a page ever came back full without the offset advancing past the end —
 * a clamp changing, a count disagreeing with the rows beside it — an
 * unconditional `while` would fetch forever. `+ 1` allows the extra empty page a
 * result of exactly `MAX_EXPORT_ENTRIES` rows needs to prove it has ended.
 */
const MAX_EXPORT_PAGES = Math.ceil(MAX_EXPORT_ENTRIES / EXPORT_PAGE_SIZE) + 1;

const TOO_MANY_ENTRIES =
  "That range has more entries than one file can hold. Narrow the date range.";

/**
 * §9.7's detail view as an RFC 4180 document — **the whole range, never the page
 * on screen** (§9.6).
 *
 * `page` is therefore ignored. A file that matched the pagination would be a
 * silent truncation dressed as a download: the CSV has no page indicator, no
 * "showing 50 of 312", and nothing else in it contradicts the range in its own
 * filename. `MAX_EXPORT_ENTRIES` is what stops that being unbounded, and it
 * refuses rather than trims.
 *
 * **The one real caveat, stated because it cannot be designed away here.** The
 * pages are separate statements, so an entry that starts or stops between two of
 * them shifts the window every later page is measured against: a timer stopping
 * does not move a row, but a *new* entry does — it sorts to the very front and
 * pushes everything down by one, so the row at a page seam is read twice. The
 * bound on the damage comes from the ordering being total (`started_at desc,
 * id desc`, with the id tiebreak 0013 insists on): the effect is confined to one
 * row duplicated or missed at a seam, never a reshuffled file. A serialisable
 * transaction would close it, and is not worth the cost for a CSV of a range
 * that is almost always already past — and for a range that includes right now,
 * the entries most likely to move are the running ones, which carry no duration
 * and so cannot double-count any hours.
 *
 * Scoping is `prepare`'s, exactly as for an aggregate export: an employee
 * exporting with a colleague's `userId` gets their own entries (§9.2).
 */
export async function exportReportEntriesCsv(
  input: ReportEntriesRequestInput,
): Promise<ActionResult<{ filename: string; csv: string }>> {
  const prepared = await prepareEntries(input);
  if (!prepared.ok) {
    return prepared;
  }

  const { from, to } = prepared.data.request;
  const rows: ReportEntryRow[] = [];
  let reachedTheEnd = false;

  for (let index = 0; index < MAX_EXPORT_PAGES; index += 1) {
    // Sequential on purpose: the offsets are only known to be worth fetching
    // because the previous page came back full, and firing them in parallel
    // would ask the database for up to 5000 rows in twenty-five simultaneous
    // statements to serve one download.
    const page = await queryEntries({
      ...prepared.data.filterArgs,
      p_limit: EXPORT_PAGE_SIZE,
      p_offset: index * EXPORT_PAGE_SIZE,
    });
    if (!page.ok) {
      return page;
    }

    if (index === 0) {
      if (page.data.totalCount > MAX_EXPORT_ENTRIES) {
        return { ok: false, error: TOO_MANY_ENTRIES };
      }

      // **The one invariant this loop cannot survive being wrong about**, and
      // the reason it is checked rather than trusted: `EXPORT_PAGE_SIZE` must
      // equal the ceiling in 0013's `least(greatest(coalesce(p_limit, 50), 1),
      // 200)`. If that ceiling is ever lowered without this constant following
      // it, every request asks for 200, receives fewer, and advances the offset
      // by 200 anyway — writing one row in two to the file, with no error and
      // nothing in the CSV to say so. Two paragraphs in two files are not enough
      // to hold that together, and `pnpm test` cannot reach Postgres to catch it
      // (§12.1), so it is caught here instead: a first page that came back short
      // while the count says there is more can only mean the clamp moved.
      if (
        page.data.rows.length < EXPORT_PAGE_SIZE &&
        page.data.totalCount > page.data.rows.length
      ) {
        return {
          ok: false,
          error: "Could not export those entries. Please try again.",
        };
      }
    }

    rows.push(...page.data.rows);

    // A short page is the end of the data. Testing the row count rather than
    // `rows.length >= totalCount` keeps this correct when the set has shrunk
    // mid-export, where the count read on page one is already stale.
    if (page.data.rows.length < EXPORT_PAGE_SIZE) {
      reachedTheEnd = true;
      break;
    }
  }

  // Falling out of the loop with a full last page means the data outran
  // `MAX_EXPORT_PAGES`. The up-front `total_count` check should have refused
  // this already, but that count was read before the first of up to
  // `MAX_EXPORT_PAGES` round trips and is stale by the last: a range ending
  // today can gain entries while the export is being assembled. Returning here
  // would produce exactly the file `MAX_EXPORT_ENTRIES` exists to refuse — one
  // that stops mid-data with nothing in it saying so — so the same refusal is
  // repeated on the way out, where the reason is no longer a prediction.
  if (!reachedTheEnd) {
    return { ok: false, error: TOO_MANY_ENTRIES };
  }

  return {
    ok: true,
    data: {
      filename: reportEntriesCsvFilename(from, to),
      csv: csvForReportEntries(rows),
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
