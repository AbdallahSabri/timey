-- 0013_report_entries.sql
--
-- The detail rows behind the report screens. Implements SPEC.md §9.2's filter
-- set and §9.3's row-level view of the same range the seven aggregates in 0007
-- summarise, on the §6.1 / §5.5 day-bucketing rules those aggregates depend on.
--
-- Creates ONE function:
--
--   report_entries — one row per time entry in the range, with the user,
--                    project, task and client labels resolved, the wall-clock
--                    times already in the company timezone, and a pre-LIMIT
--                    count of the whole filtered set on every row
--
-- Creates no table, no column, no policy and no index. Purely additive: a
-- `drop function public.report_entries(date, date, uuid, uuid, uuid, uuid, int,
-- int)` restores the database to its 0012 state exactly.
--
-- ---------------------------------------------------------------------------
-- Reversibility
-- ---------------------------------------------------------------------------
--
-- Nothing is lost. This migration drops nothing and replaces nothing — it adds
-- one new function and its grant.
--
-- ---------------------------------------------------------------------------
-- Why this is a database function even though it aggregates nothing
-- ---------------------------------------------------------------------------
--
-- 0007's two reasons do not both apply here. `db-aggregates-enabled` is
-- irrelevant to a query with no GROUP BY, and a flat list of entries with
-- embedded labels IS expressible as a PostgREST select. What is not expressible
-- is everything §6.1 asks for:
--
--   * the day key `(started_at at time zone c.timezone)::date` is a computed
--     expression over a JOINED row's timezone, so PostgREST can neither select
--     it nor filter on it;
--   * consequently the `between p_from and p_to` range filter — the actual
--     definition of "this report covers these days" — cannot be sent as a
--     PostgREST filter either. The nearest approximation is a UTC-instant range
--     on started_at, which is the bug §6.1 exists to forbid: it silently shifts
--     every report by the company offset and puts the wrong entries at both
--     edges of the range.
--
-- Doing the bucketing in Node after fetching a UTC range is the same class of
-- mistake §9.1 rules out for totals, with the added failure that the range you
-- would have to over-fetch to be safe is unbounded.
--
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER, for the reason 0007 gives at length
-- ---------------------------------------------------------------------------
--
-- Stated explicitly, as on all seven functions in 0007, because its absence
-- would read as an oversight rather than a decision. Running as the caller
-- means this inherits time_entries_select_own_or_admin (0005) verbatim: an
-- admin sees the company, an employee sees only `user_id = auth.uid()`, another
-- company's admin sees nothing — with no scope predicate restated here that
-- could drift from the policy (§9.2, §0.2).
--
-- That matters more here than in 0007, not less. These are RAW ROWS, not
-- totals: a definer version of this function would be a company-wide read of
-- every employee's timesheet behind a signature that takes a caller-supplied
-- p_user_id, which is the exact shape of accident §4.4 is written to avoid.
--
-- `stable`, not `immutable`: it reads auth.uid() and is subject to RLS.
--
-- ---------------------------------------------------------------------------
-- The shared FROM/WHERE is 0007's, unchanged, including both of its traps
-- ---------------------------------------------------------------------------
--
-- The join list and range predicates below are 0007's template verbatim. Its
-- notes (a) and (b) are the reasoning and are not repeated in full here; the
-- two consequences a reader of THIS file needs are:
--
-- (a) EVERY LABEL JOIN IS LEFT — projects, tasks, profiles, clients. Only
--     `join public.companies` is INNER, and only because the timezone is not
--     optional: an entry whose company row is unreadable has no day to be
--     bucketed into. §2.3 keeps a removed employee's entries while §3.6.1 takes
--     away their `projects` SELECT, so an INNER label join would delete that
--     employee's own hours from that employee's own list, silently. In a LIST
--     this is even easier to mistake for correct than in a total — a missing
--     row looks like a day they did not work, not like a wrong number.
--
-- (b) THE `started_at >= / <` PAIR IS A PLANNER HINT AND MUST STAY LOOSE. It
--     spans `p_from - 1` to `p_to + 2` because `p_from::timestamp at time zone
--     tz` is not reliably the first instant of that local day in a zone whose
--     DST transition lands at local midnight (America/Havana). Correctness
--     comes only from the `between` line; the hint exists so the planner can
--     use time_entries_company_id_user_id_started_at_idx instead of scanning
--     every entry the caller can see for all time. Widening it can only make
--     the `between` filter reject more; tightening it drops real entries once a
--     year at one edge of the range.
--
-- The four optional filters keep 0007's `(p_x is null or col = p_x)` form, with
-- p_client_id compared against pr.client_id because time_entries carries no
-- client of its own (§3.7).
--
-- Every join is on a primary key (companies.id, projects.id, tasks.id,
-- profiles.id, clients.id), so no join can duplicate an entry. That is what
-- makes the row count below a count of ENTRIES rather than of join products.
--
-- ---------------------------------------------------------------------------
-- DEPARTURE 1 — `where e.ended_at is not null` is DROPPED
-- ---------------------------------------------------------------------------
--
-- This is the one line of 0007's template that is deliberately absent, and it
-- is the most consequential difference in the file.
--
-- §9.4 governs report TOTALS: "running entries are excluded from all report
-- totals". This function computes no total. It has no GROUP BY, no sum() and no
-- count() over entries — it is a log of what happened, and a timer that is
-- running right now is part of what happened. §9.4's own second half asks for
-- exactly this: running entries "shown separately as in progress where useful",
-- and §5.4 puts the same requirement on the admin's stale-timer queue. A list
-- that omitted them could not show them.
--
-- How a caller tells them apart, without a status column: duration_seconds is
-- GENERATED STORED from ended_at (§3.7) and is therefore NULL on exactly the
-- running rows, as is local_ended_at. Those two nulls ARE the "in progress"
-- flag; there is no third state.
--
-- THE OBLIGATION THIS PUTS ON THE CALLER, stated plainly because it is the
-- thing that will otherwise be got wrong: any caller that sums
-- duration_seconds over these rows is computing a total, and §9.4 applies to
-- it. Postgres's sum() skips nulls, but JavaScript's `+` does not — a running
-- row contributes NaN to a naive reduce, and a `?? 0` "fix" turns it into a
-- silent zero-length entry in a count that includes it. report_summary (0007)
-- remains the sanctioned source of range totals, and it already separates the
-- closed sum from the running count for this reason. Nothing derived from this
-- function should disagree with it.
--
-- ---------------------------------------------------------------------------
-- DEPARTURE 2 — the local wall clock is returned, not re-derived at the edge
-- ---------------------------------------------------------------------------
--
-- local_started_at and local_ended_at are `timestamp` WITHOUT time zone,
-- computed as `e.started_at at time zone c.timezone` — the same expression,
-- character for character, that produces `day`. The absence of a zone is the
-- point: these are wall-clock readings in the company timezone, already
-- resolved, not instants awaiting interpretation.
--
-- The alternative is for each edge to receive UTC timestamptz values and
-- convert them itself using a timezone it fetched separately. That puts three
-- independent conversions in play — the one the screen renders, the one the CSV
-- writes, and the one that decided which day the row was filtered into — and
-- nothing keeps them agreeing. They diverge exactly where it is hardest to
-- notice: an entry at 23:30 local can be listed under a day whose header says
-- otherwise, or exported with a time an hour off the one on screen, on the
-- handful of days a year a DST transition sits between the range edge and the
-- entry. Returning one expression's result three times cannot do that.
--
-- `day` is returned for the same reason rather than being sliced off
-- local_started_at at the edge: `(started_at at time zone tz)::date` is what
-- §6.1 sanctions as the day an entry belongs to, and any re-derivation — even
-- one that looks equivalent — is a second implementation that can drift. §5.5
-- then falls out for free: a 22:00->03:00 shift is ONE row whose day is its
-- start day, with no splitting logic anywhere, here or upstream.
--
-- local_ended_at is NULL while the timer runs. `null at time zone tz` is null,
-- so this needs no special case.
--
-- The original timestamptz columns are deliberately NOT also returned. A caller
-- holding both would eventually format the wrong one.
--
-- ---------------------------------------------------------------------------
-- DEPARTURE 3 — pagination, which none of 0007's functions needs
-- ---------------------------------------------------------------------------
--
-- Every function in 0007 returns a bounded result: one row per day, per user,
-- per project, per task, per client, or exactly one summary row. This one
-- returns one row per ENTRY, over a range the app already permits to be
-- MAX_REPORT_DAYS (366) days wide, unfiltered, company-wide for an admin. That
-- is a product of headcount and days with no ceiling in it — the only unbounded
-- result in the reporting surface.
--
-- Shape: the filtered set is computed in a subquery carrying
-- `count(*) over ()`, and LIMIT/OFFSET are applied OUTSIDE it. Window functions
-- are evaluated before the outer LIMIT, so total_count is the size of the whole
-- filtered set, not of the page. Computing it any other way means a second
-- round trip with a second copy of this WHERE clause, which is a second thing
-- to keep in step with §6.1.
--
-- total_count is therefore REPEATED IDENTICALLY ON EVERY RETURNED ROW. That is
-- inherent to carrying a window function through a `returns table` — there is
-- nowhere else to put it — and the caller reads it off the first row. On an
-- empty page there is no row and hence no count, which is not a loss: the only
-- count consistent with zero returned rows at offset 0 is zero, and a non-zero
-- offset past the end has a count the caller already saw on page one.
--
-- THE CLAMP IS IN SQL, and its presence here is not redundancy with the
-- action's zod schema. Every RPC in this schema is reachable directly at
-- /rest/v1/rpc/report_entries with any valid session token; zod runs in the
-- Next.js action and a direct call never touches it. An unclamped p_limit is
-- then a request for every entry the caller can read, which for an admin is the
-- company's entire history in one response.
--
-- 200 is the ceiling because supabase/config.toml:18 sets PostgREST's
-- max_rows = 1000. Staying well under it means a full page is a page and not a
-- silently truncated one — PostgREST truncates at max_rows without erroring,
-- and a truncation the caller cannot detect while total_count still reports the
-- true size is a paginator that skips rows. The gap also leaves room for
-- max_rows to be lowered later without this function starting to lie.
-- greatest(..., 1) refuses a zero or negative limit, which Postgres would
-- otherwise accept as "no rows"; coalesce covers a caller who sends an explicit
-- null rather than omitting the parameter, since PostgREST sends what it is
-- given and DEFAULT only applies to an ABSENT argument.
--
-- ORDER BY IS `e.started_at desc, e.id desc` — newest first, matching
-- listMyEntries in the actions layer so the same data reads the same way on
-- every screen. The `e.id` tiebreak is what makes the order TOTAL, and under
-- LIMIT/OFFSET that is a correctness property rather than a tidiness one:
-- started_at is not unique (two entries by different users can share it to the
-- microsecond, and manual entries routinely share a round start time), and with
-- a partial order the sort of a tied group is free to differ between the query
-- for page 1 and the query for page 2. A row can then appear on both pages or
-- on neither. The tiebreak removes the freedom.
--
-- Note that the ORDER BY is stated OUTSIDE the subquery, on a sort key the
-- subquery carries but the function does not return. A subquery's ORDER BY is
-- not a guarantee about the enclosing query's output order — Postgres happens
-- to preserve it here because a subquery containing a window function is not
-- flattened, but that is an implementation detail of the planner, and LIMIT
-- over an unordered input is exactly the paging hazard described above. The
-- outer ORDER BY makes it a guarantee. It sorts on the raw UTC instant rather
-- than on local_started_at because the local value is ambiguous during a
-- fall-back hour, where two instants an hour apart share a wall clock.
--
-- ---------------------------------------------------------------------------
-- Error contract
-- ---------------------------------------------------------------------------
--
-- This function raises nothing of its own. It is a pure read; every refusal is
-- RLS, and RLS on a SELECT filters rather than errors. The only SQLSTATEs a
-- caller can see come from the parameters:
--
--   SQLSTATE  meaning                                                PGRST  API
--   --------  ----------------------------------------------------  -----  ---
--   22008     p_from / p_to is not a real date ('2026-02-30')         400   400
--   22P02     a filter parameter is not a valid uuid, or p_limit /    400   400
--             p_offset is not an integer
--
-- An out-of-range p_limit or p_offset is NOT an error — it is clamped. A
-- paginator that 400s on a stale page number is worse than one that returns the
-- nearest legal page.
--
-- No result is ever an error, on 0007's terms: filtering by a project, task,
-- client or user the caller cannot see returns ZERO ROWS rather than a refusal,
-- because RLS does not distinguish "not yours" from "not there" and making it
-- do so would confirm another tenant's rows exist.
--
-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
--
-- authenticated only; anon gets nothing — the same posture as every function in
-- 0005, 0006 and 0007. `revoke ... from public` first, because EXECUTE is
-- granted to PUBLIC by default at creation and a later grant would not take it
-- away. No table grants are needed: this is SECURITY INVOKER and reads through
-- the SELECT privileges authenticated already holds, filtered by the policies
-- 0002, 0004 and 0005 installed.

create function public.report_entries(
  p_from date,
  p_to date,
  p_user_id uuid default null,
  p_client_id uuid default null,
  p_project_id uuid default null,
  p_task_id uuid default null,
  p_limit int default 50,
  p_offset int default 0
)
returns table (
  entry_id uuid,
  day date,
  local_started_at timestamp,
  local_ended_at timestamp,
  duration_seconds int,
  user_id uuid,
  user_name text,
  project_id uuid,
  project_name text,
  task_id uuid,
  task_name text,
  client_id uuid,
  client_name text,
  source public.entry_source,
  note text,
  total_count bigint
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select q.entry_id,
         q.day,
         q.local_started_at,
         q.local_ended_at,
         q.duration_seconds,
         q.user_id,
         q.user_name,
         q.project_id,
         q.project_name,
         q.task_id,
         q.task_name,
         q.client_id,
         q.client_name,
         q.source,
         q.note,
         q.total_count
    from (
      select e.id                                                as entry_id,
             (e.started_at at time zone c.timezone)::date        as day,
             (e.started_at at time zone c.timezone)              as local_started_at,
             (e.ended_at   at time zone c.timezone)              as local_ended_at,
             e.duration_seconds                                  as duration_seconds,
             e.user_id                                           as user_id,
             p.full_name                                         as user_name,
             e.project_id                                        as project_id,
             pr.name                                             as project_name,
             e.task_id                                           as task_id,
             t.name                                              as task_name,
             pr.client_id                                        as client_id,
             cl.name                                             as client_name,
             e.source                                            as source,
             e.note                                              as note,
             count(*) over ()                                    as total_count,
             -- Carried for the outer ORDER BY and not returned: the raw
             -- instant, which is unambiguous where local_started_at is not.
             e.started_at                                        as sort_started_at
        from public.time_entries e
        join public.companies c on c.id = e.company_id
        left join public.projects pr on pr.id = e.project_id
        left join public.tasks    t  on t.id  = e.task_id
        left join public.profiles p  on p.id  = e.user_id
        left join public.clients  cl on cl.id = pr.client_id
       -- No `e.ended_at is not null` here. See DEPARTURE 1 — this is a log,
       -- not a total, and a running entry is part of what happened.
       where e.started_at >= ((p_from - 1)::timestamp at time zone c.timezone)
         and e.started_at <  ((p_to   + 2)::timestamp at time zone c.timezone)
         and (e.started_at at time zone c.timezone)::date between p_from and p_to
         and (p_user_id    is null or e.user_id    = p_user_id)
         and (p_project_id is null or e.project_id = p_project_id)
         and (p_task_id    is null or e.task_id    = p_task_id)
         and (p_client_id  is null or pr.client_id = p_client_id)
    ) q
   order by q.sort_started_at desc, q.entry_id desc
   limit  least(greatest(coalesce(p_limit, 50), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

comment on function public.report_entries(date, date, uuid, uuid, uuid, uuid, int, int) is
  'SPEC.md §9.2/§9.3 at row level: the entries behind a report, paginated newest-first. Days are bucketed by (started_at AT TIME ZONE companies.timezone)::date per §6.1, and local_started_at / local_ended_at come from that same expression so the screen, the CSV and the day filter cannot disagree; §5.5 needs no splitting logic as a result. SECURITY INVOKER — scope is the caller''s own RLS (§9.2), never a check inside this function. DEPARTS from 0007 in including RUNNING entries: §9.4 excludes them from report TOTALS and this function computes none, while §9.4/§5.4 ask for them "shown separately as in progress". They are the rows where duration_seconds and local_ended_at are NULL; any caller summing these rows must exclude them itself, and report_summary remains the sanctioned source of range totals. total_count is the pre-LIMIT size of the whole filtered set, repeated on every row. p_limit is clamped to 1..200 in SQL because a direct PostgREST call never runs the action''s zod schema.';

revoke execute on function public.report_entries(date, date, uuid, uuid, uuid, uuid, int, int) from public;
grant  execute on function public.report_entries(date, date, uuid, uuid, uuid, uuid, int, int) to authenticated;
