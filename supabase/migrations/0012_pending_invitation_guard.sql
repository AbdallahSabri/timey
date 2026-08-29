-- 0012_pending_invitation_guard.sql
--
-- SPEC.md §8.1, §8.2, §8.3. Stops an INVITED user becoming an admin by
-- wandering into onboarding.
--
-- THE BUG. Every new account starts in limbo (§8.3: company_id NULL, role
-- 'employee' by column default), and middleware parks every limbo user on
-- /onboarding. create_company() then binds the caller as role = 'admin'
-- (§8.2). Nothing asked whether that person had been invited. So an invitee
-- who does not complete the accept step becomes the admin of a second,
-- unwanted company, and the role their invitation named is silently lost.
--
-- Three routes reach it with no email confirmation involved: closing the tab
-- before clicking Accept and signing in later; signing up under an address
-- that differs from the invited one (accept_invitation() then refuses with
-- 42501 and leaves them stranded); or never opening the link at all. With
-- Confirm email ON it is not a possibility but the DEFAULT path, because the
-- confirmation link carries no invitation token.
--
-- accept_invitation() is NOT the problem and is untouched here: it binds
-- role = v_inv.role faithfully and checks the caller's address. The problem is
-- the OTHER door, which assigns a different role and was unguarded.
--
-- WHY THE GUARD IS IN THE FUNCTION AND NOT ONLY THE PAGE. The page can explain;
-- only the function can refuse. A client that never renders /onboarding still
-- cannot create the company, which is this project's usual division (§4.4).
--
-- WHY EXPIRY MATTERS. Only an UNEXPIRED invitation blocks. A lapsed invitation
-- must not lock somebody out of the product permanently — after 7 days (§8.4)
-- the door reopens and they can create their own company like anyone else.

-- ---------------------------------------------------------------------------
-- pending_invitation_for_me() — what /onboarding shows instead of the form
--
-- Contrast with email_is_company_member() (0011), which is admin-only BECAUSE
-- it takes an address and would otherwise be an oracle. This one takes NO
-- argument: it can only ever describe an invitation sent to the caller's own
-- address, so there is nothing to probe and no admin check to make. The two
-- look inconsistent side by side and are not.
--
-- IT DELIBERATELY DOES NOT RETURN THE TOKEN, and could not: only token_hash is
-- stored. That is the right outcome rather than a limitation to route around.
-- §8.4.1 makes the token AND the address together the evidence of who was
-- invited. Accepting on an email match alone would drop the token half — and
-- where enable_confirmations is off the address half is unverified too, so
-- registering as somebody else's address would be enough to join their
-- company. Onboarding therefore blocks and explains; it never offers to
-- accept. The emailed link stays the only way in.
-- ---------------------------------------------------------------------------

create function public.pending_invitation_for_me()
returns table (
  company_name text,
  role         public.user_role,
  expires_at   timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
stable
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  return query
    select c.name, i.role, i.expires_at
      from public.invitations i
      join public.companies c on c.id = i.company_id
      join auth.users u on u.email::citext = i.email
     where u.id = v_user_id
       and i.accepted_at is null
       and i.expires_at > now()
     order by i.expires_at desc
     limit 1;
end;
$$;

comment on function public.pending_invitation_for_me() is
  'SPEC.md §8.1 Path B. The caller''s own unexpired, unaccepted invitation, or no row. Takes no argument and so cannot describe anyone else''s — unlike email_is_company_member() (0011), which is admin-only for exactly that reason. Returns no token: only token_hash is stored, and §8.4.1 keeps the emailed link the only way to accept.';

revoke execute on function public.pending_invitation_for_me() from public;
grant execute on function public.pending_invitation_for_me() to authenticated;

-- ---------------------------------------------------------------------------
-- create_company() — unchanged except for the new refusal
--
-- Replaced rather than patched from the outside so there is one definition to
-- read. Everything else is 0002's function verbatim, including the `for
-- update` that serializes two concurrent calls from the same user.
--
-- The new check is placed AFTER the already-belongs-to-a-company check: that
-- one is about a user who finished onboarding, this one about a user who
-- should never start it, and reporting them in that order keeps the more
-- specific message for the more specific state.
-- ---------------------------------------------------------------------------

create or replace function public.create_company(
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
  v_user_id      uuid := auth.uid();
  v_company_id   uuid;
  v_invited_to   text;
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

  -- §8.1: an invited account joins the company that invited it, with the role
  -- that invitation names. Creating a company here would overwrite that role
  -- with 'admin' and strand the invitation unaccepted.
  select c.name
    into v_invited_to
    from public.invitations i
    join public.companies c on c.id = i.company_id
    join auth.users u on u.email::citext = i.email
   where u.id = v_user_id
     and i.accepted_at is null
     and i.expires_at > now()
   limit 1;

  if v_invited_to is not null then
    raise exception
      'you have been invited to join %; open that invitation link instead of creating a company',
      v_invited_to
      using errcode = '23514', detail = 'pending_invitation';
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
  'SPEC.md §8.2. Creates a company and binds the caller as its admin atomically. Refuses (23514, DETAIL pending_invitation) when the caller has an unexpired invitation outstanding — §8.1 gives that account the invitation''s company and role, and onboarding would overwrite both.';
