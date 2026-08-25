-- 0002_tenancy_core.sql
--
-- Phase 1 — Tenancy core. Implements SPEC.md §2, §2.1, §2.3, §3.1, §3.2,
-- §4.1, §4.2, §4.3, §8.2.
--
-- Creates: enums user_role / member_status; tables companies and profiles;
-- the two recursion-safe RLS helpers (§4.1); the signup profile trigger;
-- create_company() (§8.2); the last-admin guard (§2); RLS with the §4.2
-- matrix, every policy also filtered by company_id (§4.3).
--
-- Reversibility: this migration is purely additive. It drops no column, no
-- constraint and no policy. Nothing existing is lost by applying it.
--
-- Error codes raised by the functions below, for the actions layer to map.
-- All are standard SQLSTATEs so PostgREST maps them to sane HTTP statuses
-- rather than a blanket 500:
--   28000  caller is not authenticated
--   23505  user already belongs to a company (§2: exactly one, for life)
--   23514  last active admin / immutable column violated
--   42501  caller lacks admin rights for a role or status change

-- ---------------------------------------------------------------------------
-- Enums (§3.2)
-- ---------------------------------------------------------------------------

create type public.user_role as enum ('admin', 'employee');
create type public.member_status as enum ('active', 'inactive');

-- ---------------------------------------------------------------------------
-- companies (§3.1)
--
-- timezone, week_starts_on and max_timer_hours are load-bearing, not
-- decorative: timezone defines report day boundaries (§6.1) and
-- max_timer_hours defines the stale-timer threshold (§5.4).
-- ---------------------------------------------------------------------------

create table public.companies (
  id                uuid primary key default gen_random_uuid(),
  name              text     not null,
  timezone          text     not null,
  week_starts_on    smallint not null default 1,
  max_timer_hours   smallint not null default 12,
  created_at        timestamptz not null default now(),

  constraint companies_name_not_blank
    check (length(btrim(name)) > 0),
  -- 0 = Sunday, 1 = Monday (§3.1). No other value has a defined meaning.
  constraint companies_week_starts_on_valid
    check (week_starts_on in (0, 1)),
  -- A stale threshold of 0 would mark every timer stale the instant it
  -- starts; beyond a week the concept stops meaning anything (§5.4).
  constraint companies_max_timer_hours_range
    check (max_timer_hours between 1 and 168)
);

comment on table public.companies is
  'Tenant root (SPEC.md §2). Every tenant-owned row carries company_id directly.';
comment on column public.companies.timezone is
  'IANA name. Defines company-local day boundaries for every report (§6.1).';
comment on column public.companies.max_timer_hours is
  'Stale-timer threshold in hours (§5.4). Stale timers are never auto-closed.';

-- companies.timezone must be a name Postgres can actually resolve, because
-- every report evaluates (started_at AT TIME ZONE timezone) (§6.1). A CHECK
-- constraint cannot query pg_timezone_names, so this is a trigger.
create function public.companies_validate_timezone()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1 from pg_timezone_names where name = new.timezone
  ) then
    raise exception 'unknown IANA timezone: %', new.timezone
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger companies_10_validate_timezone
  before insert or update of timezone on public.companies
  for each row execute function public.companies_validate_timezone();

-- ---------------------------------------------------------------------------
-- profiles (§3.2)
--
-- company_id is NULLABLE and is the only valid null in the schema (§8.3):
-- a user exists between signup and company creation / invite acceptance.
-- ---------------------------------------------------------------------------

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  company_id  uuid references public.companies (id) on delete restrict,
  role        public.user_role     not null default 'employee',
  full_name   text                 not null,
  status      public.member_status not null default 'active',
  created_at  timestamptz          not null default now(),

  constraint profiles_full_name_not_blank
    check (length(btrim(full_name)) > 0)
);

-- Drives every company-scoped member listing and the last-admin guard.
create index profiles_company_id_status_idx
  on public.profiles (company_id, status);

comment on table public.profiles is
  'Extends auth.users (SPEC.md §3.2). Created by trigger on signup.';
comment on column public.profiles.company_id is
  'NULL = limbo, between signup and company creation/invite acceptance (§8.3). The only valid null in the schema.';

-- ---------------------------------------------------------------------------
-- Recursion-safe RLS helpers (§4.1)
--
-- A policy on profiles that reads profiles to determine the caller's company
-- recurses infinitely. These two SECURITY DEFINER functions bypass RLS on
-- their own read and break the cycle.
--
-- `set search_path = public` is mandatory on both: a SECURITY DEFINER
-- function without it is a privilege-escalation vector.
-- ---------------------------------------------------------------------------

create function public.current_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select company_id from public.profiles where id = auth.uid()
$$;

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role = 'admin'
      and status = 'active'
  )
$$;

comment on function public.current_company_id() is
  'SPEC.md §4.1. Tenant of the calling user, or NULL in limbo (§8.3).';
comment on function public.is_admin() is
  'SPEC.md §4.1. True when the caller is an ACTIVE admin. Says nothing about which company — callers must still filter company_id (§4.3).';

-- ---------------------------------------------------------------------------
-- Signup trigger (§3.2)
--
-- profiles.full_name is NOT NULL, so the trigger must always produce one.
-- It reads the signup metadata the client supplies; the fallbacks exist so a
-- signup path that forgets to send full_name (OAuth, magic link) cannot fail
-- at the NOT NULL and lock the user out of the product entirely.
-- ---------------------------------------------------------------------------

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'New member'
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Column guard on profiles (§2, §4.2)
--
-- RLS policies gate rows, not columns. §4.2 splits UPDATE on profiles into
-- "self (name)" and "admin (role, status)", which no row policy can express.
-- Column-level GRANTs below keep id / company_id / created_at out of reach
-- entirely; this trigger enforces the self-vs-admin split on the rest.
--
-- Rules enforced here:
--   * id and created_at never change.
--   * company_id may go NULL -> value once (§2: one company for life).
--     It may never be reassigned or cleared.
--   * role / status may only be changed by an ACTIVE admin of the SAME
--     company (§4.3: role and tenancy are independent checks).
--   * an admin may not change their own role (§2: "except themselves").
--
-- The NULL-company_id branch is what lets create_company() and, later,
-- invitation acceptance bind a fresh profile.
-- ---------------------------------------------------------------------------

create function public.profiles_guard_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.id is distinct from old.id then
    raise exception 'profiles.id is immutable'
      using errcode = '23514';
  end if;

  if new.created_at is distinct from old.created_at then
    raise exception 'profiles.created_at is immutable'
      using errcode = '23514';
  end if;

  if old.company_id is not null
     and new.company_id is distinct from old.company_id then
    raise exception 'a user belongs to one company for the life of the account'
      using errcode = '23514';
  end if;

  -- §4.2 reads "self (name) / admin (role, status)": a name belongs to the
  -- person it names. An admin governs role and status, not identity.
  if new.full_name is distinct from old.full_name
     and old.id is distinct from auth.uid() then
    raise exception 'full_name may only be changed by its owner'
      using errcode = '42501';
  end if;

  -- Binding a limbo profile (company_id NULL) is the onboarding path and sets
  -- role alongside company_id. It reaches here only through a SECURITY
  -- DEFINER function, since no RLS policy grants it otherwise.
  if old.company_id is null then
    return new;
  end if;

  if new.role is distinct from old.role
     or new.status is distinct from old.status then

    if auth.uid() is null then
      raise exception 'role and status changes require an authenticated admin'
        using errcode = '42501';
    end if;

    if not public.is_admin()
       or old.company_id is distinct from public.current_company_id() then
      raise exception 'only an active admin of this company may change role or status'
        using errcode = '42501';
    end if;

    if new.role is distinct from old.role and old.id = auth.uid() then
      raise exception 'an admin may not change their own role'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

create trigger profiles_10_guard_columns
  before update on public.profiles
  for each row execute function public.profiles_guard_columns();

-- ---------------------------------------------------------------------------
-- Last-admin guard (§2)
--
-- "A company must always have >= 1 active admin. Demoting or deactivating the
-- last one is rejected." Enforced in the database because an application-level
-- check loses to two concurrent demotions: both read one-other-admin-exists,
-- both commit, the company ends with zero admins.
--
-- The `for update` lock on the companies row serializes concurrent
-- demotions within a company. The second transaction blocks, then re-reads
-- under a fresh READ COMMITTED snapshot that includes the first commit.
-- ---------------------------------------------------------------------------

create function public.profiles_enforce_last_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only rows that WERE an active admin of a company can strand it.
  if old.company_id is null
     or old.role <> 'admin'
     or old.status <> 'active' then
    return new;
  end if;

  -- Still an active admin of the same company: nothing lost.
  if new.company_id is not distinct from old.company_id
     and new.role = 'admin'
     and new.status = 'active' then
    return new;
  end if;

  perform 1 from public.companies where id = old.company_id for update;

  if not exists (
    select 1 from public.profiles
    where company_id = old.company_id
      and id <> old.id
      and role = 'admin'
      and status = 'active'
  ) then
    raise exception
      'company % must retain at least one active admin', old.company_id
      using errcode = '23514';
  end if;

  return new;
end;
$$;

-- Runs after profiles_10_guard_columns: same-timing triggers fire in name
-- order, and the column guard should reject an illegitimate change before
-- the last-admin check spends a row lock on it.
create trigger profiles_20_last_admin
  before update on public.profiles
  for each row execute function public.profiles_enforce_last_admin();

-- ---------------------------------------------------------------------------
-- create_company() (§8.2)
--
-- SECURITY DEFINER, not two client-side inserts: it creates the company and
-- binds profiles.company_id + role = 'admin' atomically. Two separate inserts
-- can strand a user outside a company they just created.
--
-- The `for update` on the caller's own profile serializes two concurrent
-- calls from the same user: the second blocks, then sees company_id already
-- set and is rejected, so a user can never own two companies.
-- ---------------------------------------------------------------------------

create function public.create_company(
  p_name            text,
  p_timezone        text     default 'UTC',
  p_week_starts_on  smallint default 1,
  p_max_timer_hours smallint default 12
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id    uuid := auth.uid();
  v_company_id uuid;
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  perform 1 from public.profiles where id = v_user_id for update;
  if not found then
    raise exception 'no profile for the calling user' using errcode = '23514';
  end if;

  if exists (
    select 1 from public.profiles
    where id = v_user_id and company_id is not null
  ) then
    raise exception 'user already belongs to a company'
      using errcode = '23505';
  end if;

  insert into public.companies (name, timezone, week_starts_on, max_timer_hours)
  values (btrim(p_name), p_timezone, p_week_starts_on, p_max_timer_hours)
  returning id into v_company_id;

  update public.profiles
     set company_id = v_company_id,
         role       = 'admin',
         status     = 'active'
   where id = v_user_id;

  return v_company_id;
end;
$$;

comment on function public.create_company(text, text, smallint, smallint) is
  'SPEC.md §8.2. Creates a company and binds the caller as its admin atomically.';

-- ---------------------------------------------------------------------------
-- Privileges
--
-- Objects created by `postgres` in this database grant nothing to anon or
-- authenticated by default, and nothing to PUBLIC on functions. Every grant
-- below is therefore deliberate and minimal. RLS decides which rows; these
-- grants decide which verbs and which columns.
-- ---------------------------------------------------------------------------

revoke all on public.companies from anon, authenticated;
revoke all on public.profiles  from anon, authenticated;

-- companies: no DELETE anywhere (§4.2). id and created_at are not writable.
grant select on public.companies to authenticated;
grant insert (name, timezone, week_starts_on, max_timer_hours)
  on public.companies to authenticated;
grant update (name, timezone, week_starts_on, max_timer_hours)
  on public.companies to authenticated;

-- profiles: INSERT is trigger-only and DELETE never happens (§2.3
-- deactivation, not deletion), so neither verb is granted at all.
-- id, company_id and created_at are unreachable by column grant; the
-- self-vs-admin split on the remaining columns is the trigger's job.
grant select on public.profiles to authenticated;
grant update (full_name, role, status) on public.profiles to authenticated;

revoke execute on function public.current_company_id() from public;
revoke execute on function public.is_admin() from public;
revoke execute on function public.create_company(text, text, smallint, smallint)
  from public;

grant execute on function public.current_company_id() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.create_company(text, text, smallint, smallint)
  to authenticated;

-- ---------------------------------------------------------------------------
-- RLS (§4.2 matrix, §4.3 tenancy filter)
--
-- Every policy is `to authenticated` and every policy filters on
-- company_id = public.current_company_id(), including the ones that already
-- check role: role and tenancy are independent checks (§4.3).
--
-- Where the §4.2 matrix says "none", the denial is written out as an explicit
-- `using (false)` policy rather than left as an absent policy, so that the
-- intent is visible in pg_policies instead of inferred from a gap.
-- ---------------------------------------------------------------------------

alter table public.companies enable row level security;
alter table public.profiles  enable row level security;

-- companies -----------------------------------------------------------------

create policy companies_select_own_company
  on public.companies for select to authenticated
  using (id = public.current_company_id());

-- The one deliberate exception in shape (§4.2, §8.2): an authenticated user
-- with no company yet. There is no company_id to filter on because the row
-- does not exist until this statement runs; the tenancy check is instead
-- that the caller currently belongs to no company at all.
create policy companies_insert_when_companyless
  on public.companies for insert to authenticated
  with check (auth.uid() is not null and public.current_company_id() is null);

create policy companies_update_admin
  on public.companies for update to authenticated
  using (id = public.current_company_id() and public.is_admin())
  with check (id = public.current_company_id() and public.is_admin());

create policy companies_delete_never
  on public.companies for delete to authenticated
  using (false);

-- profiles ------------------------------------------------------------------

-- `or id = auth.uid()` is required by §8.3: a limbo user has
-- current_company_id() = NULL and must still be able to read their own row
-- for the middleware to detect limbo at all. It exposes exactly one extra
-- row — the caller's own — and no other tenant's data.
create policy profiles_select_own_company
  on public.profiles for select to authenticated
  using (
    company_id = public.current_company_id()
    or id = auth.uid()
  );

-- §4.2: inserted by trigger only. handle_new_user() is SECURITY DEFINER and
-- bypasses this; no client path exists.
create policy profiles_insert_never
  on public.profiles for insert to authenticated
  with check (false);

-- §4.2: self (name) / admin (role, status). The row scope is here; the
-- column scope is the column GRANT plus profiles_10_guard_columns.
-- `is not distinct from` in the self branch is still a tenancy filter: it
-- matches only rows whose company equals the caller's, including the
-- limbo-to-limbo case where both are NULL (§8.3).
create policy profiles_update_self_or_admin
  on public.profiles for update to authenticated
  using (
    (id = auth.uid() and company_id is not distinct from public.current_company_id())
    or (public.is_admin() and company_id = public.current_company_id())
  )
  with check (
    (id = auth.uid() and company_id is not distinct from public.current_company_id())
    or (public.is_admin() and company_id = public.current_company_id())
  );

-- §2.3: deactivation, not deletion. Time entries must keep their author.
create policy profiles_delete_never
  on public.profiles for delete to authenticated
  using (false);
