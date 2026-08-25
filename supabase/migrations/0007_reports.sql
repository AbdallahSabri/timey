-- 0007_reports.sql
--
-- Phase 8 — Reporting. Implements SPEC.md §9.1, §9.2, §9.3, §9.4, §9.5, and the
-- §6.1 / §5.5 day-bucketing rules that every one of these queries depends on.
--
-- Creates seven aggregate functions, all `language sql stable security invoker`
-- and all sharing one parameter signature:
--
--   report_by_day, report_by_user, report_by_project, report_by_task,
--   report_by_client, report_by_user_project  — §9.3's five required groupings
--                                               plus the user x project
--                                               cross-tab §9.3 calls "the
--                                               useful one in practice"
--   report_summary                            — the header figures: closed
--                                               entry count, total seconds, and
--                                               the §5.4 / §9.4 "in progress"
--                                               count shown separately
--
-- Creates no table, no column, no policy and no index. Purely additive.
--
-- ---------------------------------------------------------------------------
-- Reversibility
-- ---------------------------------------------------------------------------
--
-- Nothing is lost. This migration drops nothing and replaces nothing — it adds
-- seven new functions and their grants. `drop function` on all seven restores
-- the database to its 0006 state exactly.
--
-- ---------------------------------------------------------------------------
-- Why these are database functions at all (§9.1)
-- ---------------------------------------------------------------------------
--
-- §9.1 rules that reports are "aggregate SQL run through lib/actions/**". They
-- cannot be PostgREST queries in this stack, for two independent reasons —
-- either alone is sufficient:
--
--   1. `db-aggregates-enabled` is off (the PostgREST default since v12, and
--      unset in supabase/config.toml), so `select=...sum()` is refused
--      outright.
--   2. Even with aggregates enabled, PostgREST can only group by *columns*.
--      §6.1's day key is the computed expression
--      `(started_at at time zone c.timezone)::date`, which is not a column and
--      never can be — the timezone lives on a joined row. A by-day report is
--      therefore not expressible through PostgREST at any setting.
--
-- The alternative — pulling raw entries to Node and summing there — is the
-- thing §9.1 forbids ("no client-side aggregation of raw entries"), and it
-- would break §9.2's scoping the moment a range exceeded one PostgREST page.
--
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER is the whole design, not an omission (§9.2)
-- ---------------------------------------------------------------------------
--
-- Stated explicitly on every function below even though it is the default,
-- because it is load-bearing and its absence would read as an oversight.
--
-- §9.2: "Admins may filter by any user; employees are hard-scoped to themselves
-- by RLS regardless of what the UI sends." That sentence names RLS as the
-- boundary. Running as the caller means these functions inherit
-- time_entries_select_own_or_admin (0005) verbatim — admin sees the company,
-- employee sees `user_id = auth.uid()`, another company's admin sees nothing —
-- with no scope predicate restated here that could drift from the policy. A
-- SECURITY DEFINER version would have to hand-roll `is_admin() or user_id =
-- auth.uid()`, which is exactly the divergence §0.2 exists to prevent, and it
-- would put a company-wide read behind a function signature that takes a
-- caller-supplied p_user_id.
--
-- `stable`, not `immutable`: these read auth.uid() and are subject to RLS, so
-- their result depends on the current session and the current snapshot. An
-- immutable label would license the planner to fold a call to a constant across
-- transactions.
--
-- Consequence worth naming: because every function carries a `SET search_path`
-- clause, none of them is inlinable, so the planner sees them as opaque
-- function calls rather than merging their body into the caller's query. That
-- is the accepted cost of the search_path posture this schema applies to every
-- function; see the index note below for what keeps the plan sane anyway.
--
-- ---------------------------------------------------------------------------
-- The shared FROM/WHERE, and the two things about it that look wrong
-- ---------------------------------------------------------------------------
--
-- All seven bodies share one FROM/WHERE. Two parts of it are counter-intuitive
-- enough that a later reader will be tempted to "simplify" them. Both were
-- proven against this stack, not reasoned about, and both must stay.
--
-- (a) EVERY LABEL JOIN IS `LEFT`, NEVER `INNER` — projects, tasks, profiles,
--     clients.
--
--     Not defensive style. §2.3 keeps a removed employee's time entries, and
--     §3.6.1 scopes an employee's `projects` SELECT to their memberships. So an
--     employee removed from a project still OWNS entries on it while no longer
--     being able to read the projects row. An INNER join to projects drops
--     those rows — the employee's own hours vanish from the employee's own
--     report, silently, with no error anywhere. Verified side by side: INNER
--     returned 0 rows where LEFT returned the correct 22450s with a null
--     project label. The row counts; only the label is missing.
--
--     `join public.companies` is the ONE safe INNER join: companies SELECT is
--     "own company", every time_entries row the caller can read belongs to the
--     caller's company, so the join matches exactly one row for every surviving
--     entry. It is INNER because the timezone is not optional — an entry with
--     no readable company row has no day to be bucketed into, and dropping it
--     is more honest than bucketing it in UTC.
--
-- (b) THE TWO `started_at` RANGE PREDICATES ARE A PLANNER HINT AND MUST STAY
--     WIDER THAN THE TRUE RANGE.
--
--     Correctness comes entirely from
--     `(e.started_at at time zone c.timezone)::date between p_from and p_to`.
--     That predicate is not sargable — it wraps the indexed column in two
--     function calls — so on its own it forces a full scan of every entry the
--     caller can see, for all time, on every report.
--
--     The `>=` / `<` pair exists only so the planner can use
--     time_entries_company_id_user_id_started_at_idx. They deliberately span
--     `p_from - 1` to `p_to + 2` rather than the tight range, because
--     `p_from::timestamp at time zone tz` is NOT always the first instant of
--     that local calendar day. In a zone whose DST transition lands AT local
--     midnight, local 00:00 does not exist (spring forward) or exists twice
--     (fall back), and Postgres resolves the ambiguity by a rule that can put
--     the result an hour off the true day boundary — proven with
--     America/Havana, whose transitions are at local midnight. A tight bound
--     would then exclude entries the `between` filter would have kept, and the
--     loss would be silent, once a year, at one edge of the range.
--
--     So: the `between` line is the guarantee, the range pair is the hint, and
--     the hint is allowed to be loose but never tight. The cushion cannot cause
--     double counting or over-counting — it only widens what the `between`
--     filter then rejects.
--
-- ---------------------------------------------------------------------------
-- Totals (§9.4, §9.5)
-- ---------------------------------------------------------------------------
--
-- Every total is `coalesce(sum(e.duration_seconds), 0)::bigint` over the
-- GENERATED STORED int column from §3.7. Integer seconds, summed as integers,
-- formatted at the edge — §9.5, whose rationale is that float-hour drift
-- produces totals that disagree with their own line items. Nothing here divides
-- by 3600 and nothing here casts to a float type. `coalesce` matters because a
-- group with rows but no closed rows would otherwise return NULL, which renders
-- as an empty cell rather than "0:00".
--
-- `where e.ended_at is not null` appears in every total-producing function:
-- §9.4, "running entries are excluded from all report totals". §5.4 makes the
-- same ruling from the other direction — "the entry contributes zero to reports
-- while ended_at IS NULL". duration_seconds is NULL while running, so `sum`
-- would skip it regardless; the predicate is still written explicitly so that
-- `count(*)` counts the same rows the sum does. Without it, a report line would
-- read "3 entries, 1h20m" where the third entry is still running.
--
-- report_summary is the ONE exception and the one place this template does not
-- apply literally: it needs running rows in view to count them, so
-- `ended_at is not null` moves off the WHERE clause and into a
-- `filter (where ...)` on each aggregate. Its row filter is otherwise identical.
--
-- ---------------------------------------------------------------------------
-- Error contract
-- ---------------------------------------------------------------------------
--
-- These functions raise nothing of their own. They are pure reads; every
-- refusal is RLS, and RLS on a SELECT filters rather than errors. The only
-- SQLSTATEs a caller can see come from the parameters themselves:
--
--   SQLSTATE  meaning                                                PGRST  API
--   --------  ----------------------------------------------------  -----  ---
--   22008     p_from / p_to is not a real date ('2026-02-30').        400   400
--             validations/reports.ts refuses these before the RPC,
--             so this is reachable only by a direct API call
--   22P02     a filter parameter is not a valid uuid                  400   400
--
-- No result is ever an error. In particular:
--   * filtering by a project, task or client the caller cannot see returns
--     ZERO ROWS, not a refusal — RLS does not distinguish "not yours" from "not
--     there", and making it do so would confirm the existence of another
--     tenant's rows;
--   * an employee passing another user's p_user_id gets an empty report for the
--     same reason. validations/reports.ts documents that the action drops the
--     parameter for employees so they see their OWN rows instead of an empty
--     report — a UX choice layered on top of this boundary, never the boundary
--     itself.
--
-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
--
-- Granted to `authenticated` only, `anon` gets nothing — the same posture as
-- stop_timer (0005) and approve_correction (0006). `revoke ... from public`
-- first, because EXECUTE is granted to PUBLIC by default on function creation
-- and a later `grant to authenticated` would not take it away.

-- ---------------------------------------------------------------------------
-- report_by_day (§9.3 "by day")
--
-- The grouping §6.1 exists for. The key is
-- `(started_at at time zone c.timezone)::date` and never
-- `date_trunc('day', started_at)`, which buckets in UTC and shifts every report
-- by the company's offset.
--
-- §5.5 falls out of this for free rather than needing its own handling: an
-- entry is attributed entirely to the calendar day of its started_at, so a
-- 22:00->03:00 shift is five hours on the start day and zero on the next. There
-- is no splitting logic here because there is no splitting.
--
-- Days with no entries are ABSENT from the result, not present with a zero.
-- Generating the gaps would need a generate_series over the local range, which
-- is the same DST-at-midnight hazard as note (b) above, solved once at the edge
-- (which knows the range it asked for) instead of seven times in SQL.
-- ---------------------------------------------------------------------------

create function public.report_by_day(
  p_from date,
  p_to date,
  p_user_id uuid default null,
  p_client_id uuid default null,
  p_project_id uuid default null,
  p_task_id uuid default null
)
returns table (
  day date,
  entry_count bigint,
  total_seconds bigint
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select (e.started_at at time zone c.timezone)::date          as day,
         count(*)::bigint                                      as entry_count,
         coalesce(sum(e.duration_seconds), 0)::bigint          as total_seconds
    from public.time_entries e
    join public.companies c on c.id = e.company_id
    left join public.projects pr on pr.id = e.project_id
   where e.ended_at is not null
     and e.started_at >= ((p_from - 1)::timestamp at time zone c.timezone)
     and e.started_at <  ((p_to   + 2)::timestamp at time zone c.timezone)
     and (e.started_at at time zone c.timezone)::date between p_from and p_to
     and (p_user_id    is null or e.user_id    = p_user_id)
     and (p_project_id is null or e.project_id = p_project_id)
     and (p_task_id    is null or e.task_id    = p_task_id)
     and (p_client_id  is null or pr.client_id = p_client_id)
   group by 1
   order by 1;
$$;

comment on function public.report_by_day(date, date, uuid, uuid, uuid, uuid) is
  'SPEC.md §9.3 "by day". Buckets by (started_at AT TIME ZONE companies.timezone)::date per §6.1, so §5.5''s 22:00->03:00 shift lands entirely on the start day. Closed entries only (§9.4); totals are integer seconds (§9.5). SECURITY INVOKER — scope is the caller''s own RLS (§9.2), never a check inside this function. Days with no entries are absent rather than zero-filled.';

-- ---------------------------------------------------------------------------
-- report_by_user (§9.3 "by user")
--
-- LEFT join to profiles per note (a). profiles SELECT is company-wide (§4.2)
-- so in practice the name resolves for every row an admin can read — but the
-- join stays LEFT because the invariant that keeps a total correct must not
-- depend on a policy in another migration staying as permissive as it is today.
--
-- Ordering is biggest-first, which is what a "who worked most" list is read
-- for. `nulls last` on the name keeps an unresolvable label at the bottom of a
-- tie rather than the top, and the trailing e.user_id makes the order total —
-- without it two users with identical totals and identical names could swap
-- position between two runs of the same report, which reads as data changing.
-- ---------------------------------------------------------------------------

create function public.report_by_user(
  p_from date,
  p_to date,
  p_user_id uuid default null,
  p_client_id uuid default null,
  p_project_id uuid default null,
  p_task_id uuid default null
)
returns table (
  user_id uuid,
  user_name text,
  entry_count bigint,
  total_seconds bigint
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select e.user_id                                             as user_id,
         p.full_name                                           as user_name,
         count(*)::bigint                                      as entry_count,
         coalesce(sum(e.duration_seconds), 0)::bigint          as total_seconds
    from public.time_entries e
    join public.companies c on c.id = e.company_id
    left join public.projects pr on pr.id = e.project_id
    left join public.profiles p on p.id = e.user_id
   where e.ended_at is not null
     and e.started_at >= ((p_from - 1)::timestamp at time zone c.timezone)
     and e.started_at <  ((p_to   + 2)::timestamp at time zone c.timezone)
     and (e.started_at at time zone c.timezone)::date between p_from and p_to
     and (p_user_id    is null or e.user_id    = p_user_id)
     and (p_project_id is null or e.project_id = p_project_id)
     and (p_task_id    is null or e.task_id    = p_task_id)
     and (p_client_id  is null or pr.client_id = p_client_id)
   group by e.user_id, p.full_name
   order by total_seconds desc, user_name asc nulls last, e.user_id;
$$;

comment on function public.report_by_user(date, date, uuid, uuid, uuid, uuid) is
  'SPEC.md §9.3 "by user". One row per user with recorded time in the range. Closed entries only (§9.4); integer-second totals (§9.5); day bucketing per §6.1. SECURITY INVOKER — an employee''s RLS collapses this to a single row, their own (§9.2). The profiles join is LEFT so a total is never dropped for want of a name.';

-- ---------------------------------------------------------------------------
-- report_by_project (§9.3 "by project")
--
-- Carries the client alongside the project so the caller can render
-- "Acme / Website" without a second query and without joining in JavaScript.
--
-- A NULL client_id / client_name here means ONE OF TWO THINGS, and this
-- function cannot tell them apart — nor should it:
--
--   * the project is genuinely internal (§3.4: projects.client_id is nullable
--     precisely so internal work needs no client), or
--   * the project HAS a client the caller cannot read the label for — an
--     employee whose §3.6.1 project membership was removed keeps the entries
--     (§2.3) and loses the projects row, so pr.client_id itself reads NULL.
--
-- In both cases the hours are correct and complete; only the label is absent.
-- The edge should render the blank as an absence of a label, never as a claim
-- that the work was internal. Same rule applies to project_name.
-- ---------------------------------------------------------------------------

create function public.report_by_project(
  p_from date,
  p_to date,
  p_user_id uuid default null,
  p_client_id uuid default null,
  p_project_id uuid default null,
  p_task_id uuid default null
)
returns table (
  project_id uuid,
  project_name text,
  client_id uuid,
  client_name text,
  entry_count bigint,
  total_seconds bigint
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select e.project_id                                          as project_id,
         pr.name                                               as project_name,
         pr.client_id                                          as client_id,
         cl.name                                               as client_name,
         count(*)::bigint                                      as entry_count,
         coalesce(sum(e.duration_seconds), 0)::bigint          as total_seconds
    from public.time_entries e
    join public.companies c on c.id = e.company_id
    left join public.projects pr on pr.id = e.project_id
    left join public.clients cl on cl.id = pr.client_id
   where e.ended_at is not null
     and e.started_at >= ((p_from - 1)::timestamp at time zone c.timezone)
     and e.started_at <  ((p_to   + 2)::timestamp at time zone c.timezone)
     and (e.started_at at time zone c.timezone)::date between p_from and p_to
     and (p_user_id    is null or e.user_id    = p_user_id)
     and (p_project_id is null or e.project_id = p_project_id)
     and (p_task_id    is null or e.task_id    = p_task_id)
     and (p_client_id  is null or pr.client_id = p_client_id)
   group by e.project_id, pr.name, pr.client_id, cl.name
   order by total_seconds desc, project_name asc nulls last, e.project_id;
$$;

comment on function public.report_by_project(date, date, uuid, uuid, uuid, uuid) is
  'SPEC.md §9.3 "by project", with the client carried alongside for display. Closed entries only (§9.4); integer-second totals (§9.5); §6.1 bucketing. SECURITY INVOKER (§9.2). A NULL client_id or client_name means EITHER a genuinely internal project (§3.4 — client_id is nullable) OR a project whose row the caller cannot read (§2.1/§3.6.1 — a removed member keeps the entries per §2.3 but loses the label). The hours are correct in both cases; only the label is missing, and the UI must not read a blank as "internal".';

-- ---------------------------------------------------------------------------
-- report_by_task (§9.3 "by task")
--
-- Carries the parent project, because a task name alone is ambiguous —
-- §3.5.2 auto-creates a task named "General" on every project, so a company
-- with six projects has six rows that would otherwise all read "General".
--
-- Uniqueness is only per project (§3.5's `(project_id, lower(name))`), so the
-- project name is part of the sort key too, ahead of the task name: tasks group
-- under their project rather than interleaving across projects.
-- ---------------------------------------------------------------------------

create function public.report_by_task(
  p_from date,
  p_to date,
  p_user_id uuid default null,
  p_client_id uuid default null,
  p_project_id uuid default null,
  p_task_id uuid default null
)
returns table (
  task_id uuid,
  task_name text,
  project_id uuid,
  project_name text,
  entry_count bigint,
  total_seconds bigint
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select e.task_id                                             as task_id,
         t.name                                                as task_name,
         e.project_id                                          as project_id,
         pr.name                                               as project_name,
         count(*)::bigint                                      as entry_count,
         coalesce(sum(e.duration_seconds), 0)::bigint          as total_seconds
    from public.time_entries e
    join public.companies c on c.id = e.company_id
    left join public.projects pr on pr.id = e.project_id
    left join public.tasks t on t.id = e.task_id
   where e.ended_at is not null
     and e.started_at >= ((p_from - 1)::timestamp at time zone c.timezone)
     and e.started_at <  ((p_to   + 2)::timestamp at time zone c.timezone)
     and (e.started_at at time zone c.timezone)::date between p_from and p_to
     and (p_user_id    is null or e.user_id    = p_user_id)
     and (p_project_id is null or e.project_id = p_project_id)
     and (p_task_id    is null or e.task_id    = p_task_id)
     and (p_client_id  is null or pr.client_id = p_client_id)
   group by e.task_id, t.name, e.project_id, pr.name
   order by total_seconds desc,
            project_name asc nulls last,
            task_name    asc nulls last,
            e.task_id;
$$;

comment on function public.report_by_task(date, date, uuid, uuid, uuid, uuid) is
  'SPEC.md §9.3 "by task", carrying the parent project because §3.5.2 gives every project a task named "General" and the name alone would be ambiguous. Closed entries only (§9.4); integer-second totals (§9.5); §6.1 bucketing. SECURITY INVOKER (§9.2). Task and project joins are LEFT: an entry whose labels the caller cannot read still contributes its hours (§2.3).';

-- ---------------------------------------------------------------------------
-- report_by_client (§9.3 "by client")
--
-- Grouped by pr.client_id — the project's client, reached through the LEFT join
-- to projects, since time_entries has no client_id of its own (§3.7).
--
-- The NULL group is therefore load-bearing and means exactly what it means in
-- report_by_project: internal work (§3.4) and unreadable-label work (§2.1) both
-- land in it, indistinguishably. This is the function where that matters most,
-- because the null group is a LINE ITEM here rather than a blank cell, and
-- labelling it "Internal" in the UI would be a claim this query cannot support.
-- ---------------------------------------------------------------------------

create function public.report_by_client(
  p_from date,
  p_to date,
  p_user_id uuid default null,
  p_client_id uuid default null,
  p_project_id uuid default null,
  p_task_id uuid default null
)
returns table (
  client_id uuid,
  client_name text,
  entry_count bigint,
  total_seconds bigint
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select pr.client_id                                          as client_id,
         cl.name                                               as client_name,
         count(*)::bigint                                      as entry_count,
         coalesce(sum(e.duration_seconds), 0)::bigint          as total_seconds
    from public.time_entries e
    join public.companies c on c.id = e.company_id
    left join public.projects pr on pr.id = e.project_id
    left join public.clients cl on cl.id = pr.client_id
   where e.ended_at is not null
     and e.started_at >= ((p_from - 1)::timestamp at time zone c.timezone)
     and e.started_at <  ((p_to   + 2)::timestamp at time zone c.timezone)
     and (e.started_at at time zone c.timezone)::date between p_from and p_to
     and (p_user_id    is null or e.user_id    = p_user_id)
     and (p_project_id is null or e.project_id = p_project_id)
     and (p_task_id    is null or e.task_id    = p_task_id)
     and (p_client_id  is null or pr.client_id = p_client_id)
   group by pr.client_id, cl.name
   order by total_seconds desc, client_name asc nulls last, pr.client_id;
$$;

comment on function public.report_by_client(date, date, uuid, uuid, uuid, uuid) is
  'SPEC.md §9.3 "by client", reached through projects.client_id — time_entries carries no client of its own (§3.7). Closed entries only (§9.4); integer-second totals (§9.5); §6.1 bucketing. SECURITY INVOKER (§9.2). The NULL client_id group mixes two cases this query cannot separate: genuinely internal projects (§3.4) and projects whose row the caller cannot read (§2.1/§3.6.1, where §2.3 keeps the entries but not the label). Render it as "no client label", never as "Internal".';

-- ---------------------------------------------------------------------------
-- report_by_user_project (§9.3's cross-tab)
--
-- §9.3: "Cross-tabs (user x project) are the useful ones in practice." One row
-- per (user, project) pair, carrying both labels plus the client so the grid
-- can render without a second query.
--
-- Ordered by user FIRST and total second, unlike every other function here. The
-- others answer "what was biggest"; this one is read as a per-person breakdown,
-- so the user is the outer grouping in the output and their projects are
-- ranked within it. Reversing the two would interleave people and destroy the
-- shape the cross-tab exists to show.
--
-- `e.user_id` sits immediately after user_name, and it is not a tiebreaker of
-- convenience — it is what makes "the user is the outer grouping" true. Nothing
-- constrains profiles.full_name to be unique within a company, and two people
-- named "John Smith" are not a hypothetical. Ordering on the NAME alone groups
-- the two Smiths together and then interleaves their rows by total, producing
-- exactly the interleaving this comment claims to prevent. Verified: with two
-- same-named users each on two projects, the name-only ordering returned rows
-- in user order 5555 / 6666 / 5555 / 6666. Sorting by user_id within the name
-- restores the per-person blocks.
--
-- The trailing `e.project_id` makes the order TOTAL, for the reason spelled out
-- on report_by_user: without it, two rows agreeing on user, total and project
-- name may swap between two runs of the same report, which a reader interprets
-- as the data having changed. Every other function here already ends its ORDER
-- BY on a group key; this one is the last to do so.
-- ---------------------------------------------------------------------------

create function public.report_by_user_project(
  p_from date,
  p_to date,
  p_user_id uuid default null,
  p_client_id uuid default null,
  p_project_id uuid default null,
  p_task_id uuid default null
)
returns table (
  user_id uuid,
  user_name text,
  project_id uuid,
  project_name text,
  client_id uuid,
  client_name text,
  entry_count bigint,
  total_seconds bigint
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select e.user_id                                             as user_id,
         p.full_name                                           as user_name,
         e.project_id                                          as project_id,
         pr.name                                               as project_name,
         pr.client_id                                          as client_id,
         cl.name                                               as client_name,
         count(*)::bigint                                      as entry_count,
         coalesce(sum(e.duration_seconds), 0)::bigint          as total_seconds
    from public.time_entries e
    join public.companies c on c.id = e.company_id
    left join public.projects pr on pr.id = e.project_id
    left join public.profiles p on p.id = e.user_id
    left join public.clients cl on cl.id = pr.client_id
   where e.ended_at is not null
     and e.started_at >= ((p_from - 1)::timestamp at time zone c.timezone)
     and e.started_at <  ((p_to   + 2)::timestamp at time zone c.timezone)
     and (e.started_at at time zone c.timezone)::date between p_from and p_to
     and (p_user_id    is null or e.user_id    = p_user_id)
     and (p_project_id is null or e.project_id = p_project_id)
     and (p_task_id    is null or e.task_id    = p_task_id)
     and (p_client_id  is null or pr.client_id = p_client_id)
   group by e.user_id, p.full_name, e.project_id, pr.name, pr.client_id, cl.name
   order by user_name    asc nulls last,
            e.user_id,
            total_seconds desc,
            project_name asc nulls last,
            e.project_id;
$$;

comment on function public.report_by_user_project(date, date, uuid, uuid, uuid, uuid) is
  'SPEC.md §9.3''s user x project cross-tab, "the useful one in practice". One row per (user, project) pair with both labels and the client. Closed entries only (§9.4); integer-second totals (§9.5); §6.1 bucketing. SECURITY INVOKER (§9.2). Ordered by user first, then total descending — a per-person breakdown, not a leaderboard. Null labels carry the same meaning as in report_by_project.';

-- ---------------------------------------------------------------------------
-- report_summary — the header figures
--
-- The one function that deviates from the shared WHERE clause, and it has to.
--
-- §9.4 has two halves: "running entries are excluded from all report totals"
-- AND "shown separately as in progress where useful". Every other function
-- implements the first half by filtering running rows out at the WHERE clause.
-- This one implements BOTH, which means it needs running rows in scope to count
-- them — so `ended_at is not null` moves off the row filter and onto each
-- aggregate as `filter (where ...)`.
--
-- Getting this wrong in either direction is silent:
--   * leaving `ended_at is not null` in the WHERE clause makes running_count
--     permanently 0, and the §5.4 stale-timer queue on the admin dashboard
--     shows nothing while timers pile up;
--   * dropping the FILTER from entry_count makes the header entry count
--     disagree with the sum of the by-day rows underneath it, which is §12.2's
--     "report totals equal the sum of their own visible line items" failing.
--
-- total_seconds needs the filter for the count's sake rather than its own —
-- duration_seconds is NULL while running (§3.7), so sum() would skip those rows
-- anyway. It is written explicitly so the three aggregates state their own
-- scope and none of them depends on a column's nullability holding.
--
-- Returns exactly one row, always, including a row of zeroes when nothing
-- matches — no GROUP BY, so the aggregates produce a row over the empty set.
-- That is deliberate: an empty range should render "0:00", not an empty header.
-- ---------------------------------------------------------------------------

create function public.report_summary(
  p_from date,
  p_to date,
  p_user_id uuid default null,
  p_client_id uuid default null,
  p_project_id uuid default null,
  p_task_id uuid default null
)
returns table (
  entry_count bigint,
  total_seconds bigint,
  running_count bigint
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select count(*) filter (where e.ended_at is not null)::bigint   as entry_count,
         coalesce(
           sum(e.duration_seconds) filter (where e.ended_at is not null),
           0
         )::bigint                                                as total_seconds,
         count(*) filter (where e.ended_at is null)::bigint       as running_count
    from public.time_entries e
    join public.companies c on c.id = e.company_id
    left join public.projects pr on pr.id = e.project_id
   where e.started_at >= ((p_from - 1)::timestamp at time zone c.timezone)
     and e.started_at <  ((p_to   + 2)::timestamp at time zone c.timezone)
     and (e.started_at at time zone c.timezone)::date between p_from and p_to
     and (p_user_id    is null or e.user_id    = p_user_id)
     and (p_project_id is null or e.project_id = p_project_id)
     and (p_task_id    is null or e.task_id    = p_task_id)
     and (p_client_id  is null or pr.client_id = p_client_id)
$$;

comment on function public.report_summary(date, date, uuid, uuid, uuid, uuid) is
  'SPEC.md §9.4 in one row: closed entry_count and total_seconds, plus running_count "shown separately as in progress". The ONE function here whose WHERE clause omits `ended_at is not null` — it needs running rows in scope to count them, so the exclusion moves onto each aggregate as FILTER. Integer seconds (§9.5), §6.1 bucketing, SECURITY INVOKER (§9.2). Always returns exactly one row, zeroes included, so an empty range renders 0:00 rather than a blank header.';

-- ---------------------------------------------------------------------------
-- Privileges
--
-- EXECUTE is granted to PUBLIC by default at creation, so each revoke is
-- required before the grant means anything. authenticated only; anon has no
-- company and therefore no rows any of these could return, and a reachable
-- report RPC on the anon key is a probing surface for no benefit.
--
-- No table grants are needed or added: these are SECURITY INVOKER and read
-- through the SELECT privileges authenticated already holds from 0002 and 0004,
-- filtered by the policies those migrations installed.
-- ---------------------------------------------------------------------------

revoke execute on function public.report_by_day(date, date, uuid, uuid, uuid, uuid)          from public;
revoke execute on function public.report_by_user(date, date, uuid, uuid, uuid, uuid)         from public;
revoke execute on function public.report_by_project(date, date, uuid, uuid, uuid, uuid)      from public;
revoke execute on function public.report_by_task(date, date, uuid, uuid, uuid, uuid)         from public;
revoke execute on function public.report_by_client(date, date, uuid, uuid, uuid, uuid)       from public;
revoke execute on function public.report_by_user_project(date, date, uuid, uuid, uuid, uuid) from public;
revoke execute on function public.report_summary(date, date, uuid, uuid, uuid, uuid)         from public;

grant execute on function public.report_by_day(date, date, uuid, uuid, uuid, uuid)          to authenticated;
grant execute on function public.report_by_user(date, date, uuid, uuid, uuid, uuid)         to authenticated;
grant execute on function public.report_by_project(date, date, uuid, uuid, uuid, uuid)      to authenticated;
grant execute on function public.report_by_task(date, date, uuid, uuid, uuid, uuid)         to authenticated;
grant execute on function public.report_by_client(date, date, uuid, uuid, uuid, uuid)       to authenticated;
grant execute on function public.report_by_user_project(date, date, uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.report_summary(date, date, uuid, uuid, uuid, uuid)         to authenticated;
