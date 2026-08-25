-- 0004_structure.sql
--
-- Phase 4 — Structure. Implements SPEC.md §2.1, §3.3, §3.4, §3.5, §3.5.1,
-- §3.5.2, §3.6, §3.6.1, §3.11, plus the §4.2 / §4.3 rows for clients,
-- projects, tasks and project_members.
--
-- Creates: tables clients, projects, tasks, project_members; the trigger that
-- derives the denormalized company_id from the parent project (§2.1's stated
-- cost); the trigger that auto-creates a "General" task on project insert
-- (§3.5.2); is_project_member() (§3.6.1); RLS with the §4.2 matrix, every
-- policy also filtered by company_id (§4.3).
--
-- Reversibility: this migration is purely additive. It drops no column, no
-- constraint and no policy. It adds one index to public.profiles
-- (profiles_id_company_id_key) so that project_members can carry a composite
-- foreign key into it; that index is additive and changes no existing
-- behaviour. Nothing existing is lost by applying it.
--
-- Error codes raised here, extending the tables in 0002 and 0003. All are
-- standard SQLSTATEs so PostgREST maps them to 4xx rather than a blanket 500,
-- and the actions layer can branch on error.code without parsing messages:
--
--   23502  a task or membership was inserted without a project_id       -> 400
--   23503  the named project does not exist (derive trigger), or a
--          membership names a user outside the project's company        -> 409
--   23505  a second ACTIVE client with the same name in a company, or a
--          second ACTIVE task with the same name in a project (§3.3,
--          §3.5 partial unique indexes)                                 -> 409
--   42501  RLS or column-grant refusal — non-admin write, cross-company
--          write, or an attempt to set a company_id that this schema
--          derives rather than accepts (§2.1)                           -> 403
--
-- Policy-performance note (§9.0): the row-independent helpers are called as
-- `(select public.is_admin())` / `(select public.current_company_id())` so the
-- planner hoists them to an InitPlan and evaluates them once per statement
-- rather than once per row. §9.0 asks for this "from time_entries onward";
-- projects and tasks are the first tables here with row counts that make it
-- worth anything, and it is behaviourally identical to 0002's bare-call form.

-- ---------------------------------------------------------------------------
-- clients (§3.3)
-- ---------------------------------------------------------------------------

create table public.clients (
  id          uuid primary key default gen_random_uuid(),
  -- Defaulted, not merely policy-checked. Two reasons, in order of weight:
  -- (1) the only value the RLS WITH CHECK below will accept is the caller's
  --     own company, so defaulting it makes the correct value the automatic
  --     one instead of something every call site has to get right;
  -- (2) `supabase gen types` reads column defaults, not grants — without a
  --     default it emits `company_id: string` as REQUIRED on Insert, which
  --     type-checks a payload the database then refuses. That trap is worse
  --     on tasks and project_members, where the column has no grant at all.
  company_id  uuid not null default public.current_company_id()
                references public.companies (id) on delete restrict,
  name        text not null,
  -- §3.11 soft delete. Archived rows stay selectable so historical entries
  -- keep a readable label; excluding them from pickers is a UI filter, not a
  -- policy, and deliberately not enforced here.
  archived_at timestamptz,

  constraint clients_name_not_blank
    check (length(btrim(name)) > 0)
);

comment on table public.clients is
  'SPEC.md §3.3. Soft-deleted via archived_at (§3.11); never hard-deleted — no DELETE grant exists.';
comment on column public.clients.archived_at is
  'NULL = active. Archived clients stay selectable so existing projects keep a readable label (§3.11).';

-- §3.3. Case-insensitive uniqueness among ACTIVE clients only: archiving a
-- client must free its name for reuse, which a total unique index would block.
create unique index clients_company_id_name_active_key
  on public.clients (company_id, lower(name))
  where archived_at is null;

-- Referenced by the composite FK from projects below, which is what keeps a
-- project and its client inside one tenant (§2.2: there is no cross-company
-- anything). A plain FK on client_id alone could not express that.
create unique index clients_id_company_id_key
  on public.clients (id, company_id);

-- ---------------------------------------------------------------------------
-- projects (§3.4)
-- ---------------------------------------------------------------------------

create table public.projects (
  id          uuid not null default gen_random_uuid(),
  -- Defaults to the caller's company, as on clients above.
  company_id  uuid not null default public.current_company_id()
                references public.companies (id) on delete restrict,
  -- NULLABLE by §3.4: internal projects have no client.
  client_id   uuid,
  name        text not null,
  description text,
  archived_at timestamptz,

  constraint projects_pkey primary key (id),

  constraint projects_name_not_blank
    check (length(btrim(name)) > 0),

  -- (client_id, company_id) rather than client_id alone: a project may only
  -- point at a client of its OWN company. MATCH SIMPLE skips the check when
  -- any referencing column is NULL, which is exactly the internal-project case
  -- (§3.4) — company_id is NOT NULL, so the check is skipped only when
  -- client_id is NULL.
  --
  -- ON DELETE RESTRICT is §3.11 stated as a constraint: "a client with
  -- projects can never be hard-deleted". No DELETE grant exists on clients
  -- either (see the privileges section), so this is the second lock on the
  -- same door, and the one that also holds for a future SECURITY DEFINER path.
  constraint projects_client_id_company_id_fkey
    foreign key (client_id, company_id)
    references public.clients (id, company_id)
    on delete restrict
    on update cascade
);

comment on table public.projects is
  'SPEC.md §3.4. Visibility is asymmetric (§3.6.1): admins see every project in the company, employees only those they are a member of.';
comment on column public.projects.client_id is
  'NULLABLE (§3.4): an internal project has no client. When set, the client must belong to the same company — enforced by projects_client_id_company_id_fkey.';

-- §3.4's required index. Every picker and list is "active projects of my
-- company", which this serves directly.
create index projects_company_id_archived_at_idx
  on public.projects (company_id, archived_at);

-- Supports "projects of this client" and, more importantly, keeps the
-- ON DELETE RESTRICT check on clients from degenerating into a seq scan.
create index projects_client_id_idx
  on public.projects (client_id)
  where client_id is not null;

-- Referenced by the composite FKs from tasks and project_members. This index
-- is what makes §2.1's denormalization structurally sound rather than merely
-- trigger-maintained: a task's company_id cannot name a company its project
-- does not belong to, even if every trigger in this file were dropped.
create unique index projects_id_company_id_key
  on public.projects (id, company_id);

-- ---------------------------------------------------------------------------
-- tasks (§3.5)
--
-- company_id is denormalized here per §2.1 even though it is derivable through
-- project_id, so that RLS is a single-column equality test with no join.
-- §2.1 names the price: an enforced consistency check. This schema pays it
-- twice over — see set_company_id_from_project() and the composite FK below.
--
-- §3.5.1: tasks do not nest. There is deliberately no parent_task_id.
-- ---------------------------------------------------------------------------

create table public.tasks (
  id          uuid not null default gen_random_uuid(),
  -- The DEFAULT is a fallback, not the mechanism: tasks_10_set_company_id
  -- overwrites this unconditionally with the project's company_id before the
  -- row is stored, and there is no INSERT or UPDATE grant on this column, so
  -- no caller can supply one either way. It exists so that the column is
  -- omissible — including in `supabase gen types` output, which reports
  -- defaults but knows nothing about column grants — and so that dropping the
  -- trigger would degrade to the caller's own company rather than to NULL.
  company_id  uuid not null default public.current_company_id(),
  project_id  uuid not null,
  name        text not null,
  archived_at timestamptz,

  constraint tasks_pkey primary key (id),

  constraint tasks_name_not_blank
    check (length(btrim(name)) > 0),

  -- The declarative half of §2.1's consistency requirement: (project_id,
  -- company_id) must be a real pair on projects, so a task can never sit in a
  -- company its project does not. ON DELETE RESTRICT because §3.11 rules out
  -- hard-deleting structure at all; nothing in this schema deletes a project.
  constraint tasks_project_id_company_id_fkey
    foreign key (project_id, company_id)
    references public.projects (id, company_id)
    on delete restrict
    on update cascade
);

comment on table public.tasks is
  'SPEC.md §3.5. Flat — tasks do not nest (§3.5.1). Every project gets a "General" task at creation (§3.5.2) so time_entries.task_id NOT NULL is never blocked.';
comment on column public.tasks.company_id is
  'Denormalized from projects (§2.1). NOT client-writable — no INSERT or UPDATE grant exists. Derived by tasks_10_set_company_id from project_id on every insert and update; omit it from every payload.';

-- §3.5. Active-only, for the same reason as clients: archiving frees the name.
create unique index tasks_project_id_name_active_key
  on public.tasks (project_id, lower(name))
  where archived_at is null;

-- §3.5's required index. Drives the task picker for a project.
create index tasks_project_id_archived_at_idx
  on public.tasks (project_id, archived_at);

-- ---------------------------------------------------------------------------
-- project_members (§3.6)
--
-- "Controls who may log time where." Membership, not role, is what will gate
-- time entry in Phase 5 — including for admins (§3.6.1).
-- ---------------------------------------------------------------------------

-- Composite FK target for project_members.(user_id, company_id), so it must
-- exist before the table below. Additive to 0002's profiles: id is already the
-- primary key, so this index adds no new restriction on profiles — it only
-- makes the pair referenceable.
create unique index profiles_id_company_id_key
  on public.profiles (id, company_id);

create table public.project_members (
  project_id uuid not null,
  user_id    uuid not null,
  -- Same fallback-not-mechanism default as tasks.company_id above:
  -- project_members_10_set_company_id derives the real value, and no grant on
  -- this column exists.
  company_id uuid not null default public.current_company_id(),
  added_at   timestamptz not null default now(),

  constraint project_members_pkey primary key (project_id, user_id),

  -- Same declarative consistency check as tasks: the membership's company_id
  -- must be the project's own.
  constraint project_members_project_id_company_id_fkey
    foreign key (project_id, company_id)
    references public.projects (id, company_id)
    on delete restrict
    on update cascade,

  -- And the member must be a profile of that same company (§2.2: no
  -- contractor belonging to two companies). Composite again, because
  -- user_id -> profiles(id) alone would happily admit another tenant's user.
  --
  -- ON DELETE CASCADE deliberately: 0002 records that deleting an auth.users
  -- row cascades to profiles, and that path is out-of-product but real. A
  -- RESTRICT here would newly block it. Membership is not historical data —
  -- time entries are, and they keep their own user_id.
  constraint project_members_user_id_company_id_fkey
    foreign key (user_id, company_id)
    references public.profiles (id, company_id)
    on delete cascade
    on update cascade
);

comment on table public.project_members is
  'SPEC.md §3.6. Assignment governs time entry; role governs visibility (§3.6.1). An admin still needs a row here to log time to a project.';
comment on column public.project_members.company_id is
  'Denormalized from projects (§2.1). NOT client-writable: derived by project_members_10_set_company_id.';

-- The PK serves (project_id, ...) lookups; this serves the other direction —
-- "which projects is this user on", which the projects SELECT policy and every
-- employee-facing picker ask.
create index project_members_user_id_idx
  on public.project_members (user_id);

-- ---------------------------------------------------------------------------
-- company_id derivation (§2.1)
--
-- The denormalized company_id on tasks and project_members is DERIVED from the
-- parent project, never accepted from the caller. The alternative — accept it
-- and validate it — was rejected for the same reason 0003 refuses a
-- client-supplied invitations.expires_at: a value the client cannot set is a
-- value no caller, present or future, can get wrong. Validation only rejects
-- the mismatches somebody actually attempts; derivation makes the mismatch
-- unrepresentable, and it removes the column from the actions layer's
-- vocabulary entirely (there is no INSERT or UPDATE grant on it).
--
-- Read together with the composite FKs above, this is defence in depth with
-- two independent mechanisms:
--   * the trigger guarantees company_id is always the project's;
--   * the FK guarantees that even if the trigger were bypassed (superuser,
--     `alter table ... disable trigger`), a mismatched pair still cannot be
--     stored.
--
-- SECURITY DEFINER, `set search_path = public`: the lookup must return the
-- project's true company_id rather than whatever the caller can SEE, so that
-- a cross-tenant attempt is rejected by the RLS WITH CHECK on the target table
-- (a legible 42501) instead of quietly becoming "project does not exist".
-- It reads exactly one column of one row and writes nothing.
--
-- It fires on every UPDATE, not only `update of project_id`, so that no future
-- path can leave company_id pointing somewhere project_id does not.
-- ---------------------------------------------------------------------------

create function public.set_company_id_from_project()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
begin
  if new.project_id is null then
    raise exception '%.project_id is required', tg_table_name
      using errcode = '23502';
  end if;

  select p.company_id
    into v_company_id
    from public.projects p
   where p.id = new.project_id;

  if v_company_id is null then
    raise exception 'project % does not exist', new.project_id
      using errcode = '23503';
  end if;

  new.company_id := v_company_id;
  return new;
end;
$$;

comment on function public.set_company_id_from_project() is
  'SPEC.md §2.1. Derives the denormalized company_id from the row''s project. Attached to tasks and project_members; company_id is never client-supplied on either.';

create trigger tasks_10_set_company_id
  before insert or update on public.tasks
  for each row execute function public.set_company_id_from_project();

create trigger project_members_10_set_company_id
  before insert or update on public.project_members
  for each row execute function public.set_company_id_from_project();

-- ---------------------------------------------------------------------------
-- Auto-created "General" task (§3.5.2)
--
-- "On project creation, auto-create one task named 'General' so the flow is
-- never blocked." Phase 5's time_entries.task_id is NOT NULL (BLOCKERS.md D-1);
-- without this, a freshly created project is a project nobody can log time to.
--
-- In the trigger rather than the actions layer because a project created by
-- any path — an action, a seed script, a future import — must have it. Two
-- statements in an action are two statements that can half-succeed.
--
-- SECURITY DEFINER so the insert does not depend on the creating caller
-- holding INSERT on tasks. Today they always do (only an admin can create a
-- project, and admins may insert tasks), but that coincidence is not something
-- the invariant should rest on. company_id is omitted here on purpose: the
-- tasks trigger above derives it.
-- ---------------------------------------------------------------------------

create function public.projects_create_general_task()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.tasks (project_id, name)
  values (new.id, 'General');
  return null;
end;
$$;

comment on function public.projects_create_general_task() is
  'SPEC.md §3.5.2. Gives every new project one "General" task so a mandatory task_id never blocks the entry flow.';

create trigger projects_10_create_general_task
  after insert on public.projects
  for each row execute function public.projects_create_general_task();

-- ---------------------------------------------------------------------------
-- is_project_member() (§3.6.1)
--
-- The third recursion-safe helper, alongside 0002's current_company_id() and
-- is_admin(). SECURITY DEFINER for the same reason they are: the projects
-- SELECT policy needs to read project_members, and project_members' own SELECT
-- policy would otherwise be consulted from inside a policy evaluation.
--
-- `set search_path = public` is mandatory, as on every SECURITY DEFINER
-- function in this schema.
--
-- It answers ONE question: is the caller assigned to this project. It says
-- nothing about tenancy — callers must still filter company_id (§4.3) — and
-- nothing about role.
--
-- PHASE 5, READ THIS: §3.6.1 rules that an admin still needs a
-- project_members row to LOG TIME to a project. Role governs visibility;
-- assignment governs time entry. The projects SELECT policy below is the
-- visibility question and deliberately ORs role with membership. The
-- time_entries INSERT policy is the other question and must call this function
-- WITHOUT an is_admin() escape hatch. Reusing the shape of the policy below
-- would silently let an unassigned admin log time.
-- ---------------------------------------------------------------------------

create function public.is_project_member(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.project_members
    where project_id = p_project_id
      and user_id = auth.uid()
  )
$$;

comment on function public.is_project_member(uuid) is
  'SPEC.md §3.6.1. True when the caller has a project_members row for this project. Visibility ORs this with is_admin(); time entry (Phase 5) must NOT — an admin needs a membership row to log time.';

-- ---------------------------------------------------------------------------
-- Privileges
--
-- RLS decides which rows; these grants decide which verbs and which columns.
--
-- No DELETE is granted on clients, projects or tasks. §3.11 is "soft delete
-- for structure, hard delete for nothing", and the cheapest way to honour a
-- rule about a verb nobody may use is to not grant the verb. There is
-- therefore no guard trigger to forget, no ON DELETE CASCADE to audit, and
-- nothing for a future action to accidentally reach: an authenticated caller
-- issuing DELETE gets a privilege error before RLS is consulted at all. The
-- matching `using (false)` policies below exist so the intent is readable in
-- pg_policies rather than inferred from a gap.
--
-- company_id is NOT insertable or updatable on tasks or project_members —
-- it is derived (§2.1), and a caller that names it at all is refused before
-- RLS is even consulted. On clients and projects it is insertable, because
-- there is no parent to derive it from, and the RLS WITH CHECK pins it to
-- current_company_id(); it is never updatable anywhere, because a client or
-- project does not change tenant. All four columns default to
-- current_company_id(), so the correct payload omits company_id on every
-- table in this migration.
--
-- project_id is not updatable on tasks: moving a task between projects would
-- silently re-attribute every time entry already recorded against it, which is
-- the same failure §5.1 forbids for a running timer's project_id. Archive the
-- task and create it where it belongs.
--
-- added_at is not writable on project_members: it records when something
-- happened, and a client-settable "when" is not a record of anything.
-- ---------------------------------------------------------------------------

revoke all on public.clients         from anon, authenticated;
revoke all on public.projects        from anon, authenticated;
revoke all on public.tasks           from anon, authenticated;
revoke all on public.project_members from anon, authenticated;

grant select                            on public.clients to authenticated;
grant insert (company_id, name)         on public.clients to authenticated;
grant update (name, archived_at)        on public.clients to authenticated;

grant select on public.projects to authenticated;
grant insert (company_id, client_id, name, description)
  on public.projects to authenticated;
grant update (client_id, name, description, archived_at)
  on public.projects to authenticated;

grant select                     on public.tasks to authenticated;
grant insert (project_id, name)  on public.tasks to authenticated;
grant update (name, archived_at) on public.tasks to authenticated;

-- §4.2 lists all four verbs as admin for project_members. UPDATE is granted on
-- the two columns that make a membership what it is; company_id follows
-- project_id by trigger, and added_at stays a record.
grant select                        on public.project_members to authenticated;
grant insert (project_id, user_id)  on public.project_members to authenticated;
grant update (project_id, user_id)  on public.project_members to authenticated;
grant delete                        on public.project_members to authenticated;

revoke execute on function public.set_company_id_from_project()  from public;
revoke execute on function public.projects_create_general_task() from public;
revoke execute on function public.is_project_member(uuid)        from public;

-- The two trigger functions are granted to no client role: they are reachable
-- only as triggers, and a trigger function does not need EXECUTE on the
-- invoker's part.
grant execute on function public.is_project_member(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS (§4.2 matrix, §4.3 tenancy filter, §3.6.1 visibility)
--
-- Every policy is `to authenticated` and every policy filters on
-- company_id = current_company_id(), including the ones that already check
-- role: role and tenancy are independent checks (§4.3). is_admin() is true for
-- an active admin of SOME company, so without the company_id term an admin of
-- Company 2 would reach Company 1's structure.
--
-- As in 0002 and 0003, a denied verb is written out as an explicit `false`
-- policy rather than left absent.
--
-- Archiving is not a policy concern: archived rows remain fully selectable
-- (§3.11) so a historical entry keeps a readable label. Hiding them from
-- pickers is a query filter in the UI layer.
-- ---------------------------------------------------------------------------

alter table public.clients         enable row level security;
alter table public.projects        enable row level security;
alter table public.tasks           enable row level security;
alter table public.project_members enable row level security;

-- clients -------------------------------------------------------------------
-- §4.2: own company, not role-split. Clients are not project-scoped, so there
-- is no membership concept to narrow them with.

create policy clients_select_own_company
  on public.clients for select to authenticated
  using (company_id = (select public.current_company_id()));

create policy clients_insert_admin
  on public.clients for insert to authenticated
  with check (
    company_id = (select public.current_company_id())
    and (select public.is_admin())
  );

create policy clients_update_admin
  on public.clients for update to authenticated
  using (
    company_id = (select public.current_company_id())
    and (select public.is_admin())
  )
  with check (
    company_id = (select public.current_company_id())
    and (select public.is_admin())
  );

-- §3.11: archive, never hard-delete. Backed by the absence of a DELETE grant.
create policy clients_delete_never
  on public.clients for delete to authenticated
  using (false);

-- projects ------------------------------------------------------------------

-- §3.6.1, the asymmetric one: admins see every project in the company,
-- employees only those they are a member of. Both branches are inside the
-- company_id filter, so this is a narrowing of tenancy, never a widening.
--
-- What this policy does NOT decide: whether the caller may log time to the
-- project. §3.6.1 keeps those separate — an admin who can see a project here
-- still needs a project_members row before Phase 5's time_entries INSERT
-- policy will accept an entry against it. See is_project_member() above.
create policy projects_select_admin_or_member
  on public.projects for select to authenticated
  using (
    company_id = (select public.current_company_id())
    and (
      (select public.is_admin())
      or public.is_project_member(id)
    )
  );

create policy projects_insert_admin
  on public.projects for insert to authenticated
  with check (
    company_id = (select public.current_company_id())
    and (select public.is_admin())
  );

create policy projects_update_admin
  on public.projects for update to authenticated
  using (
    company_id = (select public.current_company_id())
    and (select public.is_admin())
  )
  with check (
    company_id = (select public.current_company_id())
    and (select public.is_admin())
  );

create policy projects_delete_never
  on public.projects for delete to authenticated
  using (false);

-- tasks ---------------------------------------------------------------------

-- §4.2: "same as parent project". Expressed against the task's own
-- company_id and project_id rather than by joining projects — which is exactly
-- what §2.1 denormalized company_id for. The join would also mean this
-- policy's answer depended on the projects policy's answer, two indirections
-- deep. The two stay equivalent because tasks.company_id is derived from the
-- project and pinned to it by tasks_project_id_company_id_fkey.
create policy tasks_select_admin_or_member
  on public.tasks for select to authenticated
  using (
    company_id = (select public.current_company_id())
    and (
      (select public.is_admin())
      or public.is_project_member(project_id)
    )
  );

create policy tasks_insert_admin
  on public.tasks for insert to authenticated
  with check (
    company_id = (select public.current_company_id())
    and (select public.is_admin())
  );

create policy tasks_update_admin
  on public.tasks for update to authenticated
  using (
    company_id = (select public.current_company_id())
    and (select public.is_admin())
  )
  with check (
    company_id = (select public.current_company_id())
    and (select public.is_admin())
  );

create policy tasks_delete_never
  on public.tasks for delete to authenticated
  using (false);

-- project_members -----------------------------------------------------------
-- §4.2: SELECT own company; INSERT / UPDATE / DELETE admin. The SELECT cell is
-- read literally — an employee sees the whole company's assignment rows, which
-- are (project_id, user_id) pairs and nothing more. Project names stay behind
-- the projects policy above.

create policy project_members_select_own_company
  on public.project_members for select to authenticated
  using (company_id = (select public.current_company_id()));

create policy project_members_insert_admin
  on public.project_members for insert to authenticated
  with check (
    company_id = (select public.current_company_id())
    and (select public.is_admin())
  );

create policy project_members_update_admin
  on public.project_members for update to authenticated
  using (
    company_id = (select public.current_company_id())
    and (select public.is_admin())
  )
  with check (
    company_id = (select public.current_company_id())
    and (select public.is_admin())
  );

-- The only DELETE granted in this migration. Unassigning is not a soft-delete
-- concept: §3.11 governs clients, projects and tasks, and a membership row is
-- none of those — it carries no history, and §4.2 lists DELETE as an admin
-- verb here and nowhere else in this phase.
create policy project_members_delete_admin
  on public.project_members for delete to authenticated
  using (
    company_id = (select public.current_company_id())
    and (select public.is_admin())
  );
