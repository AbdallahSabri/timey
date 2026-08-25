-- 0005_time_entries.sql
--
-- Phase 5 — Time entries and the timer. Implements SPEC.md §3.7, §5.1, §5.2,
-- §5.3, §5.5, §6.3, plus the §4.2 / §4.3 row for time_entries and the §7.1 /
-- §7.2 editing rules that belong in the database.
--
-- Creates: enum entry_source; table time_entries with its three constraints
-- (§3.7); set_updated_at(), the first reusable updated_at trigger function in
-- this schema; time_entries_guard_update(), the column-level half of §7.2 that
-- a row policy cannot express, and the §5.3 half that a column grant cannot;
-- stop_timer(), the one path that writes ended_at; one unique index on tasks
-- (id, project_id) so a composite FK can pin a time entry's task to its
-- project; RLS with the §4.2 matrix, every policy also filtered by company_id
-- (§4.3).
--
-- Reversibility: this migration is purely additive in schema terms. It drops
-- no column, no constraint and no policy. It adds one index to public.tasks
-- (tasks_id_project_id_key); that index is additive and imposes no new
-- restriction, since tasks.id is already the primary key.
--
-- It does, however, change the behaviour of ONE pre-existing path, and that is
-- deliberate rather than incidental — stated here because it is the only thing
-- in this file that is not purely additive:
--
--   Deleting an auth.users row for a user who has time entries now FAILS.
--   auth.users delete cascades to profiles (0002); time_entries carries
--   (user_id, company_id) -> profiles (id, company_id) ON DELETE RESTRICT, so
--   the cascade is blocked. This is §2.3 stated as a constraint —
--   "hard-deleting a user would orphan historical records that reports depend
--   on" — and §3.11's "hard delete for nothing". 0002 recorded the cascade as
--   a known open path and declined to close it there because closing it for
--   PROFILES would have changed auth.users deletion behaviour for every user;
--   this closes it only for users who actually have history to lose. A user
--   with no entries still deletes cleanly. See the FK comment below.
--
-- Error codes raised here, extending the tables in 0002, 0003 and 0004. All
-- are standard SQLSTATEs so PostgREST maps them to 4xx rather than a blanket
-- 500, and the actions layer can branch on error.code without parsing text:
--
--   23503  project_id names a project that does not exist; or task_id does not
--          belong to project_id; or user_id is not a profile of the entry's
--          company (§2.2)                                              -> 409
--   23505  a second RUNNING entry for the same user — two tabs racing on
--          Start (§3.7, §5.1)                                          -> 409
--   23514  an immutable column changed (id, user_id, company_id,
--          created_at); or ended_at <= started_at (§3.7)               -> 400
--   23P01  the entry overlaps another CLOSED entry of the same user
--          (§5.2). The actions layer must translate this into "This
--          overlaps an entry from 14:00-15:30", never a constraint
--          name                                                        -> 409
--   42501  RLS or column-grant refusal — reading another user's entry,
--          logging time to a project the caller is not a member of
--          (§3.6.1), touching a column this schema derives, editing the
--          times on a CLOSED entry (§7.1/§7.2), deleting a closed one, or
--          writing any ended_at other than the server's own now() (§5.3)
--                                                                      -> 403
--
-- Policy-performance note (§9.0): §9.0 asks for the `(select helper())` form
-- "from time_entries onward" so the planner hoists row-independent calls into
-- an InitPlan and evaluates them once per statement instead of once per row.
-- This is that table. auth.uid() is wrapped the same way and for the same
-- reason. is_project_member(project_id) takes a column and therefore CANNOT be
-- hoisted; it is called bare, as in 0004.
--
-- NOT built here, deliberately, and named so their absence is not mistaken for
-- an oversight:
--   * §6.4's future-entry guard and §7.1's today-only rule for manual entries.
--     Both concern CLIENT-SUPPLIED timestamps, which Phase 5 never produces
--     (§5.3: timer start and stop are now() in Postgres). They are Phase 6.
--   * §5.4 stale-timer detection. A stale timer is a running row older than
--     companies.max_timer_hours — a query, not a constraint. §5.4 rules that
--     stale timers are NEVER auto-closed, so there is deliberately no trigger,
--     no job and no default here that could invent an ended_at.
--   * §7.3/§7.4 corrections and time_entry_revisions. Phase 7.

-- ---------------------------------------------------------------------------
-- entry_source (§3.7)
--
-- No DEFAULT, on purpose. 'timer' would be the obvious one, but then a manual
-- entry whose payload forgot the column would be silently recorded as a
-- measurement rather than the assertion it is (§5.3). Every caller says which.
-- ---------------------------------------------------------------------------

create type public.entry_source as enum ('timer', 'manual');

-- ---------------------------------------------------------------------------
-- Reusable updated_at trigger (§3.7)
--
-- Postgres does not maintain an updated_at column on its own. §3.7 is the
-- first table in this schema to ask for one, so this function is written to be
-- reused rather than table-specific: correction_requests (§3.9) will want the
-- same behaviour in Phase 7, and re-deriving it there would be a second copy
-- of a one-line rule.
--
-- Not SECURITY DEFINER: it reads nothing and writes only NEW, so it needs no
-- privilege the invoker lacks. `set search_path = pg_catalog, public` matches
-- 0002's companies_validate_timezone() — the same posture for the same reason,
-- even though a plain trigger function is not itself an escalation vector.
--
-- Attach it as a `..._set_updated_at` trigger with a numeric prefix that puts
-- it AFTER any guard trigger, so a guard comparing NEW to OLD never sees a
-- timestamp this function wrote.
-- ---------------------------------------------------------------------------

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Generic BEFORE UPDATE trigger: stamps updated_at with now(). Reusable — attach to any table carrying an updated_at column, after that table''s guard triggers.';

-- ---------------------------------------------------------------------------
-- tasks (id, project_id) uniqueness
--
-- 0004 deliberately did not add this index, declining to speculate about what
-- Phase 5 would need. This is that need: time_entries carries BOTH project_id
-- and task_id (§3.7), and nothing about the pair is self-consistent — a client
-- holding a valid task id from one project and a valid project id from another
-- could submit them together, and every report grouping by project would then
-- disagree with the same report grouped by task.
--
-- Chosen mechanism: a composite FOREIGN KEY, (task_id, project_id) ->
-- tasks (id, project_id), which needs this index as its target. The
-- alternative — a BEFORE trigger looking up tasks.project_id and comparing —
-- was rejected for the reason 0004 gives for preferring composite FKs to
-- triggers on the same question: a trigger is a check that runs when it is
-- attached and fires, an FK is a fact the table cannot store a counterexample
-- to. A trigger would also have to read tasks past its own RLS (SECURITY
-- DEFINER) to avoid reporting "task does not exist" for a task the caller
-- simply cannot see, which is a second privileged function to audit for
-- exactly no gain in expressiveness.
--
-- Additive to 0004's tasks: id is already the primary key, so uniqueness of
-- (id, project_id) follows and this index restricts nothing new.
-- ---------------------------------------------------------------------------

create unique index tasks_id_project_id_key
  on public.tasks (id, project_id);

-- ---------------------------------------------------------------------------
-- time_entries (§3.7)
--
-- §5.1: a timer is NOT a separate entity. A running timer is a row here with
-- ended_at IS NULL. There is no timer table, no in-memory state, no Redis.
-- Every state transition in §5.1's machine is a statement against this table:
--   start   -> INSERT with ended_at NULL
--   stop    -> UPDATE ended_at
--   discard -> DELETE, permitted only while ended_at IS NULL
-- ---------------------------------------------------------------------------

create table public.time_entries (
  id uuid not null default gen_random_uuid(),

  -- Denormalized (§2.1), derived, never accepted from a client — the same
  -- treatment tasks and project_members get in 0004 (§3.6.2). The DEFAULT is a
  -- fallback for two purposes only: it keeps the column omissible in
  -- `supabase gen types` output (which reads defaults and knows nothing about
  -- column grants), and it degrades to the caller's own company rather than to
  -- NULL if the derive trigger were ever dropped. The real mechanism is
  -- time_entries_10_set_company_id below, plus the absence of any INSERT or
  -- UPDATE grant on this column.
  company_id uuid not null default public.current_company_id(),

  -- Whose time this is (§3.7). Also derived rather than accepted: §4.2's
  -- INSERT cell is "self, own row", so the only value any client could
  -- legitimately send is the one this default produces. Not granted for INSERT
  -- or UPDATE, so a caller naming another user's id is refused on privilege
  -- before RLS is consulted, and the RLS WITH CHECK below is the second lock
  -- on the same door rather than the only one.
  user_id uuid not null default auth.uid(),

  project_id uuid not null,
  task_id    uuid not null,

  -- §5.3: the client never sends a timestamp for timer start or stop; both are
  -- now() in Postgres. The DEFAULT is what makes that the easy path — the
  -- timer's INSERT omits started_at entirely. Manual entries (Phase 6) DO
  -- supply it, which is why the column is insertable at all; it is a deliberate
  -- assertion there, not a measurement, and Phase 6 owns validating it (§6.4).
  started_at timestamptz not null default now(),

  -- NULL = the timer is currently running (§3.7, §5.1). This is the single
  -- most load-bearing null in the schema: the one-running-timer index, the
  -- overlap exclusion, the UPDATE guard, the DELETE policy and §9.4's "running
  -- entries contribute zero to every total" all key off it.
  ended_at timestamptz,

  -- §3.7. Verified to be accepted as immutable by Postgres 17.6 before this
  -- migration was written, not assumed: timestamptz - timestamptz yields an
  -- exact interval (days are never justified into months), and extract(epoch
  -- from interval) counts a day as exactly 86400 seconds, so the value is true
  -- elapsed time even across a DST boundary (§6.3) and across midnight (§5.5).
  -- NULL while running, which is what keeps a running timer out of every SUM.
  duration_seconds int generated always as (
    extract(epoch from (ended_at - started_at))::int
  ) stored,

  source public.entry_source not null,
  note   text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint time_entries_pkey primary key (id),

  -- §3.7: zero-length and reversed entries rejected. A running entry has no
  -- end yet, hence the NULL branch.
  constraint time_entries_ended_after_started
    check (ended_at is null or ended_at > started_at),

  -- §2.1's consistency requirement, declarative half: (project_id, company_id)
  -- must be a real pair on projects, so an entry can never sit in a company its
  -- project does not. ON DELETE RESTRICT because §3.11 rules out hard-deleting
  -- structure; no DELETE grant on projects exists either (0004).
  constraint time_entries_project_id_company_id_fkey
    foreign key (project_id, company_id)
    references public.projects (id, company_id)
    on delete restrict
    on update cascade,

  -- The pair check §3.6.2 could not make in Phase 4: the task must belong to
  -- the project named on the same row. Without it a client could pair a task
  -- from project A with project B and every task-level report would disagree
  -- with the project-level one over the same rows.
  --
  -- ON DELETE RESTRICT is §3.11 written as a constraint: "a task with entries
  -- can never be hard-deleted."
  constraint time_entries_task_id_project_id_fkey
    foreign key (task_id, project_id)
    references public.tasks (id, project_id)
    on delete restrict
    on update cascade,

  -- The member must be a profile of the entry's own company (§2.2: no
  -- cross-company anything). Composite, because user_id -> profiles (id) alone
  -- would admit another tenant's user.
  --
  -- ON DELETE RESTRICT, and this is the one behavioural change in this
  -- migration (see the header). 0004 chose CASCADE for project_members with
  -- the explicit reasoning that "membership is not historical data — time
  -- entries are". This is that table. §2.3 rules that a removed employee
  -- "loses access, keeps their time entries", so deleting a user who has any
  -- must fail rather than silently take the history with it.
  constraint time_entries_user_id_company_id_fkey
    foreign key (user_id, company_id)
    references public.profiles (id, company_id)
    on delete restrict
    on update cascade,

  -- §3.7 / §5.2: no overlapping CLOSED entries per user. One person cannot be
  -- in two places. Requires btree_gist (0001) for the `user_id WITH =` half.
  --
  -- WHERE (ended_at IS NOT NULL) because tstzrange(x, NULL) is the unbounded
  -- range [x, infinity), which would overlap every later entry the user has —
  -- a running timer would make its owner unable to record anything else at
  -- all. Running entries are instead constrained to at most one by the unique
  -- index below, which is the stronger statement anyway.
  --
  -- tstzrange defaults to '[)' — half-open. An entry ending at exactly 11:00
  -- and one starting at exactly 11:00 do NOT overlap and both are accepted;
  -- back-to-back entries are normal and must stay possible.
  constraint time_entries_no_overlap_per_user
    exclude using gist (
      user_id                            with =,
      tstzrange(started_at, ended_at)    with &&
    ) where (ended_at is not null)
);

comment on table public.time_entries is
  'SPEC.md §3.7. A running timer IS a row here with ended_at IS NULL (§5.1) — there is no separate timer entity. Entries are never split across days (§5.5); a 22:00->03:00 shift is one row attributed to its started_at day in the company timezone (§6.1).';
comment on column public.time_entries.company_id is
  'Denormalized from projects (§2.1). NOT client-writable — no INSERT or UPDATE grant exists. Derived by time_entries_10_set_company_id from project_id; omit it from every payload.';
comment on column public.time_entries.user_id is
  'Whose time this is. NOT client-writable — defaults to auth.uid() and has no INSERT or UPDATE grant (§4.2: "self, own row").';
comment on column public.time_entries.started_at is
  'Defaults to now() so the timer path never sends a timestamp (§5.3). Manual entries (Phase 6) supply it deliberately and it is validated there (§6.4, §7.1).';
comment on column public.time_entries.ended_at is
  'NULL = the timer is currently running (§3.7, §5.1). Running entries contribute zero to every report total (§9.4). On UPDATE the only value this column accepts is the server''s own now() (§5.3) — stop a timer with public.stop_timer(id), never by sending a timestamp.';
comment on column public.time_entries.duration_seconds is
  'GENERATED STORED, NULL while running. True elapsed seconds across DST boundaries and midnight (§6.3, §5.5). Sum as integer seconds and format at the edge (§9.5) — never as floating-point hours.';
comment on column public.time_entries.note is
  'The only column the owner may change on a CLOSED entry (§7.1). Enforced by GRANT UPDATE (ended_at, note) plus time_entries_guard_update, not by the row policy — RLS gates rows, not columns.';

-- §3.7: at most one running timer per user, enforced by the DATABASE, not by
-- application logic. Two browser tabs racing on Start must fail here (23505)
-- and produce one timer, not two. A partial unique index is what makes that a
-- property of the table rather than of whichever code path happened to check
-- first; a read-then-insert in an action loses that race by construction.
create unique index time_entries_one_running_per_user
  on public.time_entries (user_id)
  where ended_at is null;

-- §3.7's three required indexes.
--
-- The first also serves the (user_id, company_id) foreign key's ON DELETE
-- RESTRICT check, which filters on exactly those two columns — so no separate
-- index is needed to keep that check off a sequential scan.
create index time_entries_company_id_user_id_started_at_idx
  on public.time_entries (company_id, user_id, started_at desc);

create index time_entries_project_id_started_at_idx
  on public.time_entries (project_id, started_at desc);

create index time_entries_task_id_idx
  on public.time_entries (task_id);

-- ---------------------------------------------------------------------------
-- Triggers
--
-- Numeric prefixes fix the firing order: same-timing triggers fire in name
-- order, and each of these depends on the previous one having run.
--   10  derive company_id from the project (§2.1)
--   20  guard the columns RLS cannot (§7.1, §7.2)
--   30  stamp updated_at
-- The guard at 20 must see the DERIVED company_id (so a project move that
-- crossed tenants would be caught) and must NOT see the updated_at that 30
-- writes (or every update would look like a change to an immutable column).
-- ---------------------------------------------------------------------------

-- Reused verbatim from 0004: the same derive-don't-accept rule, the same
-- SECURITY DEFINER read of projects, the same legible failure mode. Reading
-- the project past RLS matters here: a Company 2 caller naming a Company 1
-- project gets company_id = Company 1 and is then refused by the RLS WITH
-- CHECK below with a 42501, rather than being told the project does not exist.
create trigger time_entries_10_set_company_id
  before insert or update on public.time_entries
  for each row execute function public.set_company_id_from_project();

-- ---------------------------------------------------------------------------
-- time_entries_guard_update() (§7.1, §7.2)
--
-- THE COLUMN-LEVEL HALF OF §7.2, and the reason a row policy alone cannot
-- express that section.
--
-- §7.1 grants the owner two update rights that a single row policy cannot hold
-- at once:
--   (a) stop a RUNNING entry  — set ended_at on a row where it is NULL;
--   (b) edit the note on ANY of their own entries, closed included.
-- and denies a third:
--   (c) edit the TIMES on a closed entry — that is a correction request.
--
-- Why not two policies. Postgres OR's multiple permissive policies for the
-- same command. A policy for (a) restricted to `ended_at IS NULL` and a policy
-- for (b) unrestricted by ended_at would OR into "the owner may update any of
-- their own rows" — and since ended_at is a granted column, the owner could
-- then rewrite the end time of a closed entry, which is exactly (c). The
-- narrower policy would contribute nothing; permissive policies cannot narrow
-- each other. (RESTRICTIVE policies can, but a restrictive policy still cannot
-- see OLD, which is the whole problem — see below.)
--
-- Why not one cleverer policy. RLS USING is evaluated against the OLD row and
-- WITH CHECK against the NEW one, and neither clause can reference the other's
-- version. "ended_at may change only when it was NULL before" is a statement
-- about OLD and NEW together, so no combination of USING and WITH CHECK can
-- state it. This is structural, not a matter of finding the right expression.
--
-- What is built instead is the pairing §4.2.1 names as the working precedent
-- from 0002's profiles_guard_columns():
--   * the row policy decides WHICH ROWS         -> owner, own company;
--   * the column GRANT decides WHICH COLUMNS    -> ended_at and note, nothing
--     else, so started_at / project_id / task_id / source are unreachable from
--     any client on any row, running or closed (§5.1: "never mutate project_id
--     on a running timer" is therefore not a rule anyone can break);
--   * this trigger decides the one thing neither can see — whether ended_at is
--     being changed on a row that was already closed.
--
-- Keeping RLS as the authority on ownership is deliberate. The alternative
-- shape — a SECURITY DEFINER set_note() function — would have to re-implement
-- `user_id = auth.uid() and company_id = current_company_id()` inside a
-- definer context, i.e. hand-roll the check RLS already makes, which is the
-- class of divergence SPEC.md §0.2 exists to prevent. Editing your own note is
-- not an elevated operation and does not want an elevated function (§4.4).
--
-- PHASE 7, READ THIS: §7.3 applies approved corrections by mutating
-- time_entries in place, which means changing ended_at (and started_at,
-- project_id, task_id) on CLOSED rows. That path runs as a SECURITY DEFINER
-- function, which bypasses RLS and column grants — but NOT triggers. This
-- trigger will refuse it. That is correct today and must be resolved
-- DELIBERATELY, by a Phase 7 migration that replaces this function with one
-- carrying an explicit, named carve-out for the correction path (a
-- transaction-local flag set by the approval function, checked here). It must
-- not be resolved by dropping the trigger: without it, GRANT UPDATE (ended_at)
-- plus the owner-scoped policy is a licence to rewrite closed history, which
-- is the single failure §7 is written to prevent.
--
-- The immutability checks below are restricted to columns NO phase should ever
-- change — id, user_id, company_id, created_at. started_at, project_id,
-- task_id and source are deliberately absent: clients cannot reach them (no
-- grant), and listing them here would pre-emptively block the Phase 7 mutation
-- §7.3 rules for.
--
-- Not SECURITY DEFINER: it reads only OLD and NEW.
-- ---------------------------------------------------------------------------

create function public.time_entries_guard_update()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.id is distinct from old.id then
    raise exception 'time_entries.id is immutable'
      using errcode = '23514';
  end if;

  if new.user_id is distinct from old.user_id then
    raise exception 'time_entries.user_id is immutable — an entry does not change hands'
      using errcode = '23514';
  end if;

  -- company_id is derived by the trigger that runs before this one, so a
  -- difference here means project_id was moved across a tenant boundary.
  if new.company_id is distinct from old.company_id then
    raise exception 'time_entries.company_id is immutable — an entry does not change tenant'
      using errcode = '23514';
  end if;

  if new.created_at is distinct from old.created_at then
    raise exception 'time_entries.created_at is immutable'
      using errcode = '23514';
  end if;

  -- §7.1: "Edit times on a closed entry — No -> correction request."
  -- §7.2: once closed, the row is immutable to the employee AT THE DATABASE,
  -- not merely hidden in the UI. This covers re-opening (value -> NULL) too,
  -- since `is distinct from` catches it.
  if old.ended_at is not null
     and new.ended_at is distinct from old.ended_at then
    raise exception
      'the times on a closed entry change only through a correction request (SPEC.md §7.1)'
      using errcode = '42501';
  end if;

  -- §5.3: "The client never sends a timestamp for timer start or stop. Both
  -- are now() evaluated in Postgres. A device with a wrong clock or a user
  -- gaming their phone's time cannot affect recorded duration."
  --
  -- started_at gets that for free: it carries DEFAULT now() and is absent from
  -- the UPDATE grant, so no client can name one on the timer path. ended_at
  -- cannot be protected the same way, and this is the gap the clause below
  -- closes. ended_at MUST be writable to stop a timer at all, and a column
  -- GRANT is a statement about WHICH COLUMN, never about WHICH VALUE — it
  -- cannot tell `set ended_at = now()` from `set ended_at = '2030-01-01'`.
  -- Without this, any holder of a valid session could PATCH
  -- /rest/v1/time_entries?id=eq.<own running entry> with an ended_at of their
  -- choosing — no Next.js app involved, just a raw HTTP request with their own
  -- token — and inflate or shrink the recorded duration at will. That is
  -- precisely the gaming §5.3 exists to forbid.
  --
  -- So the restriction is placed on the VALUE, which is what §5.3 is actually
  -- about. The only value the stop transition may write is the server's own
  -- transaction timestamp. public.stop_timer() below writes exactly that and
  -- is the intended path; every other value is refused here.
  --
  -- WHY THIS IS NOT `revoke update (ended_at)` PLUS A FUNCTION, which is the
  -- shape this rule looks like it wants. stop_timer() is SECURITY INVOKER, on
  -- purpose (see the function). Its UPDATE therefore runs with the CALLER's
  -- privileges and needs exactly the grant a direct PATCH needs — revoking the
  -- grant refuses the function too. Verified in this database before this
  -- clause was written, not assumed: with the column grant removed, an invoker
  -- function's own UPDATE fails 42501 `permission denied for table`. Making it
  -- SECURITY DEFINER instead would buy the revocation at the price of
  -- bypassing RLS, forcing this file to restate
  -- `user_id = auth.uid() and company_id = current_company_id()` by hand
  -- inside a definer body — a second, divergeable copy of the authorization
  -- the UPDATE policy already states, which is the failure §0.2 exists to
  -- prevent. A value check needs no privilege and cannot diverge from a policy
  -- it does not duplicate.
  --
  -- now() is transaction_timestamp(), fixed for the whole transaction, so
  -- stop_timer's assignment and this comparison always agree. A client that
  -- sends the literal string 'now' also passes, because 'now'::timestamptz IS
  -- transaction_timestamp() — and what then gets STORED is the true server
  -- time, which is the property §5.3 asks for. There is no reachable ended_at
  -- that the server did not itself choose, which is the invariant; being the
  -- sole caller is only how stop_timer keeps that ergonomic.
  --
  -- Scoped to the stop transition (old NULL -> new non-NULL) alone. Changes to
  -- a CLOSED entry's ended_at are already refused above, and Phase 7's
  -- correction path — which writes a deliberate, human-supplied end time — is
  -- a closed-row mutation, so it must clear that check, not this one.
  if old.ended_at is null
     and new.ended_at is not null
     and new.ended_at <> now() then
    raise exception
      'ended_at is set by the server — stop a running entry with public.stop_timer(id) (SPEC.md §5.3)'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.time_entries_guard_update() is
  'SPEC.md §7.1/§7.2/§5.3. The column-level half of the UPDATE rule, which a row policy cannot express: the owner may stop a running entry and may edit the note on any of their own entries, but may never change the times on a closed one, and may never choose the ended_at a stop writes — it is always the server''s now(). Phase 7''s correction path needs an explicit carve-out here — see the migration comment.';

create trigger time_entries_20_guard_update
  before update on public.time_entries
  for each row execute function public.time_entries_guard_update();

create trigger time_entries_30_set_updated_at
  before update on public.time_entries
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- stop_timer() (§5.1's stop transition, §5.3)
--
-- The one path that writes ended_at. `update time_entries set ended_at = now()`
-- expressed once, in the database, so that no caller anywhere has to be trusted
-- to send the right timestamp — or to send one at all. The guard trigger above
-- refuses every other value; this is what makes the permitted one a single
-- short call rather than something each caller reconstructs.
--
-- SECURITY INVOKER (the default, stated by its absence), and that is the whole
-- design rather than an omission:
--
--   * RLS still applies. time_entries_update_own gates the row — owner, own
--     company — so this function needs no ownership check of its own and
--     therefore cannot drift from the policy. A SECURITY DEFINER version would
--     bypass RLS and have to hand-roll that predicate, which is the divergence
--     §0.2 is written to prevent (the same argument the guard comment above
--     makes against a definer set_note()).
--   * The column grants still apply — GRANT UPDATE (ended_at, note) is what
--     lets this function's own UPDATE run at all.
--   * The triggers still fire, because this performs an ordinary UPDATE
--     statement. Stopping an ALREADY-CLOSED entry therefore raises 42501 from
--     time_entries_guard_update, not from anything restated here.
--   * Stopping a timer is not an elevated operation (§4.4). It is the owner
--     doing the one thing the owner may do to their own running row.
--
-- Two distinct outcomes the actions layer must handle differently. Both are
-- deliberate; neither is smoothed over here, because a function that
-- normalized them would be inventing an error contract the database already
-- states precisely:
--
--   ZERO ROWS (HTTP 200, `[]`)  the id does not exist, or belongs to another
--                               user, or to another company. The UPDATE policy
--                               filters it out and zero rows are updated. This
--                               is silent by design — RLS does not distinguish
--                               "not yours" from "not there", and making it do
--                               so would confirm the existence of other
--                               people's entries. Nothing is mutated.
--
--   EXCEPTION 42501             the row is yours but already closed. The guard
--                               trigger raises; §7.1 rules that a closed
--                               entry's times change only through a correction
--                               request.
--
-- Also possible, from the table rather than from here: 23P01 if the stopped
-- entry would overlap an existing closed one (§5.2) — reachable when a manual
-- entry was inserted over a period the timer was already running.
--
-- RETURNS SETOF, not a bare `returns public.time_entries`, and the difference
-- is not cosmetic — it is the zero-row case above being legible to the caller.
-- Verified against this stack rather than reasoned about: a composite-returning
-- function that matches no row answers PostgREST with HTTP 200 and
-- {"id":null,"user_id":null,...} — an object whose every field is null, which
-- is TRUTHY in JavaScript. `if (data)` would read "that timer isn't yours" as
-- success and report a stop that never happened. SETOF answers `[]` for the
-- same case and `[{...}]` on success, so `.maybeSingle()` yields null-or-row
-- and the distinction cannot be missed by accident. The WHERE is on the
-- primary key, so "set of" is still at most one row.
-- ---------------------------------------------------------------------------

create function public.stop_timer(p_id uuid)
returns setof public.time_entries
language sql
set search_path = pg_catalog, public
as $$
  update public.time_entries
     set ended_at = now()
   where id = p_id
  returning *;
$$;

comment on function public.stop_timer(uuid) is
  'SPEC.md §5.1/§5.3. Stops a running entry with the SERVER''s now(); the client never supplies a stop timestamp. SECURITY INVOKER: RLS, column grants and triggers all still apply. Returns zero rows when the entry is not the caller''s own or does not exist (nothing is mutated); raises 42501 when it is the caller''s own but already closed.';

-- ---------------------------------------------------------------------------
-- Privileges
--
-- RLS decides which rows; these grants decide which verbs and which columns.
-- On this table the column list is doing as much work as the policies.
--
-- INSERT names project_id, task_id, started_at, ended_at, source, note — and
-- nothing else. id, company_id and user_id are all defaulted and ungranted, so
-- the correct payload never mentions them and a payload that does is refused
-- on privilege (42501) before RLS is consulted at all.
--
-- ended_at is insertable because a manual entry (Phase 6) is created closed,
-- in one statement. The timer path simply omits it, which is what "running"
-- means.
--
-- UPDATE names ONLY ended_at and note. This is the load-bearing grant on this
-- table:
--   * started_at is not updatable, so nobody can backdate a running timer to
--     manufacture elapsed minutes;
--   * project_id is not updatable, which is §5.1's "never mutate project_id on
--     a running timer — that would silently misattribute already-elapsed
--     minutes" enforced as a missing privilege rather than as a rule the
--     actions layer has to remember. Switching project mid-timer is stop then
--     start, and there is no other way to express it;
--   * task_id and source likewise;
--   * duration_seconds is GENERATED and cannot be written by anyone.
--
-- ended_at is granted, and a grant cannot say WHICH VALUE. The two hazards
-- that leaves are both time_entries_guard_update()'s, not this list's:
--   * changing ended_at on an already-closed row (§7.1/§7.2);
--   * choosing the ended_at a stop writes — the grant permits
--     `set ended_at = '2030-01-01'` from any raw PostgREST call, and §5.3
--     forbids it, so the trigger pins the stop transition to the server's
--     now(). Revoking the grant instead would ALSO refuse public.stop_timer(),
--     which is SECURITY INVOKER and runs the same UPDATE with the caller's
--     privileges; see that function and the trigger for why this is a value
--     check rather than a missing privilege.
--
-- DELETE is granted, narrowly: §5.1's discard transition. The policy is what
-- limits it to running entries. See the DELETE policy for the §4.2-vs-§5.1
-- discrepancy this resolves.
-- ---------------------------------------------------------------------------

revoke all on public.time_entries from anon, authenticated;

grant select on public.time_entries to authenticated;

grant insert (project_id, task_id, started_at, ended_at, source, note)
  on public.time_entries to authenticated;

grant update (ended_at, note)
  on public.time_entries to authenticated;

grant delete on public.time_entries to authenticated;

-- The guard and updated_at functions are reachable only as triggers and are
-- granted to no client role. Trigger execution does not check EXECUTE on the
-- invoker's part.
revoke execute on function public.time_entries_guard_update() from public;
revoke execute on function public.set_updated_at()            from public;

-- stop_timer is called BY clients, so it is granted — to authenticated only,
-- like every other RPC in this schema. anon has no entries to stop.
revoke execute on function public.stop_timer(uuid) from public;
grant  execute on function public.stop_timer(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS (§4.2 matrix, §4.3 tenancy filter)
--
-- Every policy is `to authenticated` and every policy filters on
-- company_id = current_company_id(), including the ones that already check
-- role or ownership: role and tenancy are independent checks (§4.3).
-- is_admin() is true for an active admin of SOME company, so without the
-- company_id term an admin of Company 2 would read Company 1's timesheets.
-- ---------------------------------------------------------------------------

alter table public.time_entries enable row level security;

-- SELECT --------------------------------------------------------------------
-- §4.2, and BLOCKERS.md D-2 (§10 item 7, answered): admins see every entry in
-- their company; employees see their own and nothing else. Both branches sit
-- inside the company_id filter, so this narrows tenancy and never widens it.
--
-- §9.2 depends on this being the boundary rather than a convenience: an
-- employee who asks a report for another user's data gets their own rows back,
-- because the filter the UI sends is not what scopes the query.

create policy time_entries_select_own_or_admin
  on public.time_entries for select to authenticated
  using (
    company_id = (select public.current_company_id())
    and (
      user_id = (select auth.uid())
      or (select public.is_admin())
    )
  );

-- INSERT --------------------------------------------------------------------
-- §4.2: "self, own row, member of project." All three terms are here, and the
-- third is the one this phase exists to get right.
--
-- §3.6.1: "An admin logging time to a project still needs a membership row —
-- assignment governs time entry, role governs visibility." There is therefore
-- NO `or is_admin()` in this policy, and its absence is the point. 0004's
-- projects/tasks SELECT policies do OR role with membership, because those
-- answer the visibility question; copying their shape here would silently let
-- an unassigned admin log time to every project in the company. An admin with
-- no project_members row is refused exactly as an employee with no
-- project_members row is refused — the check does not know what role is.
--
-- is_project_member() takes a column and cannot be hoisted into an InitPlan,
-- so it is called bare (§9.0's subselect form applies only to the
-- row-independent helpers).
--
-- Two things this policy deliberately does NOT check:
--   * that the project is not archived. §3.11 keeps archived rows fully
--     selectable and 0004 ruled that hiding them is a query filter, not a
--     policy. Nothing in the spec says logging time to an archived project is
--     forbidden, so nothing here forbids it. Flagged rather than invented.
--   * that started_at is not in the future (§6.4). Phase 6 owns that, because
--     Phase 5 never produces a client timestamp at all (§5.3).

create policy time_entries_insert_self_and_member
  on public.time_entries for insert to authenticated
  with check (
    company_id = (select public.current_company_id())
    and user_id = (select auth.uid())
    and public.is_project_member(project_id)
  );

-- UPDATE --------------------------------------------------------------------
-- §4.2's cell reads "self only while ended_at IS NULL (§7.2)", with no
-- separate admin cell — so there is NO admin branch in this policy, and that
-- is not an omission. An admin correcting an employee's entry goes through
-- §7.3's approval function in Phase 7, which writes a revision row; a policy
-- branch here would be an unaudited edit path around the entire §7 workflow.
--
-- The row scope is ownership plus tenancy. The `ended_at IS NULL` half of
-- §4.2's cell is NOT in this USING clause, and this is the deliberate part:
--
--   * Putting it here would implement §4.2's sentence literally and break
--     §7.1's "Edit the note on their own entry — Yes", which applies to closed
--     entries too. The closed row would be unreachable for any update at all.
--   * Leaving it out and adding a second permissive policy for the note does
--     nothing, because permissive policies OR: see time_entries_guard_update().
--
-- So the restriction lives one layer down, where it can see OLD and NEW
-- together, and the two spec sentences hold jointly:
--   stop a running entry            -> allowed  (ended_at NULL -> value)
--   edit the note, any own entry    -> allowed  (note is granted, times are not)
--   change the times once closed    -> refused  (42501 from the guard trigger)
--   change anything else, ever      -> refused  (no column grant)
--
-- Read the three together — policy, GRANT UPDATE (ended_at, note), and the
-- guard — as one rule. No one of them is sufficient alone, and this comment
-- exists so that a later reader does not "simplify" the policy back to
-- something that reads more like §4.2 and enforces less than it.

create policy time_entries_update_own
  on public.time_entries for update to authenticated
  using (
    company_id = (select public.current_company_id())
    and user_id = (select auth.uid())
  )
  with check (
    company_id = (select public.current_company_id())
    and user_id = (select auth.uid())
  );

-- DELETE --------------------------------------------------------------------
-- SPEC CONFLICT, resolved toward the narrative sections and recorded here.
--
-- §4.2's matrix lists DELETE on time_entries as "none". §5.1 says the exact
-- opposite for one case: "Discard: delete a running entry outright. Permitted
-- because nothing was ever recorded as complete. The only DELETE any user can
-- perform on time_entries." §7.1 agrees ("Start / stop / discard their own
-- timer — Yes") and so does PLAN.md's Phase 5.
--
-- Resolved toward §5.1/§7.1: they are the more specific and more detailed
-- statement, they name the transition explicitly, and a discard-less timer
-- would leave a mis-started entry only correctable by an admin. The matrix
-- cell is read as governing the COMPANY-WIDE case it shares with every other
-- "none" in that column — no admin may delete anyone's entry, including their
-- own closed ones — and the discard exception is the owner-scoped carve-out
-- §5.1 spells out.
--
-- Consequences, both intended:
--   * a closed entry is undeletable by ANYONE through this API. §7.1's "Delete
--     a closed entry — No -> correction request" is a missing row here, not a
--     UI decision.
--   * admins get no DELETE branch at all, for the same reason they get no
--     UPDATE branch: deleting an employee's entry outside the §7.4 workflow
--     leaves no trail of what was deleted or why.

create policy time_entries_delete_own_running
  on public.time_entries for delete to authenticated
  using (
    company_id = (select public.current_company_id())
    and user_id = (select auth.uid())
    and ended_at is null
  );
