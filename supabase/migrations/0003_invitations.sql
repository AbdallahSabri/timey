-- 0003_invitations.sql
--
-- Phase 3 — Invitations. Implements SPEC.md §2.3, §3.10, §4.2 (invitations
-- row), §4.3, §8.1 (Path B), §8.4.
--
-- Creates: table invitations; the admin-only RLS matrix for it;
-- hash_invitation_token(); invitation_preview() (token-gated read for the
-- signed-out invitee); accept_invitation() — the SECURITY DEFINER path that
-- binds profiles.company_id + role and consumes the invitation atomically.
--
-- Reversibility: this migration is purely additive. It drops no column, no
-- constraint and no policy, and it modifies nothing created by 0001 or 0002.
-- Nothing existing is lost by applying it.
--
-- Error codes raised by the functions below, extending 0002's table. All are
-- standard SQLSTATEs, so PostgREST maps them to 4xx rather than a blanket 500,
-- and the actions layer can branch on error.code without parsing messages:
--
--   28000  caller is not authenticated                              -> 403
--   23505  caller already belongs to a company (§2, §8.4)           -> 409
--   P0002  no invitation matches this token (never issued, revoked,
--          or tampered with)                                        -> 404
--   22023  invitation has expired (§8.4, 7 days)                    -> 400
--   23514  invitation was already accepted (§8.4, one-time use)     -> 400
--   42501  caller is signed in as somebody other than the invitee   -> 403
--
-- 23505 is deliberately the same code create_company() raises for the same
-- invariant — one company per user for the life of the account. It is the one
-- case §8.4 requires to be reported in plain language, and it is reached
-- before the token is even looked at, so it can never be confused with a
-- token problem.

-- ---------------------------------------------------------------------------
-- Token hashing (§8.4)
--
-- "The raw token appears only in the emailed URL; the database stores a hash.
-- A leaked database backup must not grant company access."
--
-- sha256() and encode() are pg_catalog builtins in PG 11+, so no extension is
-- needed here and none is added: pgcrypto lives in the `extensions` schema on
-- Supabase and would drag that schema into every search_path below.
--
-- This function is the single definition of the digest, used by the acceptance
-- and preview paths. The actions layer must produce the identical value in
-- Node before INSERT:
--     crypto.createHash('sha256').update(rawToken).digest('hex')
-- The raw token is never passed to an INSERT and never stored.
-- ---------------------------------------------------------------------------

create function public.hash_invitation_token(p_token text)
returns text
language sql
immutable
strict
set search_path = public
as $$
  select encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
$$;

comment on function public.hash_invitation_token(text) is
  'SPEC.md §8.4. Lowercase hex SHA-256 of a raw invitation token. Matches crypto.createHash(''sha256'').digest(''hex'') in Node. Not granted to any client role: it exists so the acceptance and preview paths hash exactly the way the actions layer does.';

-- ---------------------------------------------------------------------------
-- invitations (§3.10)
--
-- No created_at: §3.10 does not define one, and expires_at is a faithful proxy
-- for it precisely because it is not client-settable (see the GRANTs below) —
-- every row's expires_at is now() + 7 days at insert, so ordering by
-- expires_at is ordering by creation.
-- ---------------------------------------------------------------------------

create table public.invitations (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid   not null references public.companies (id) on delete cascade,
  email       citext not null,
  role        public.user_role not null default 'employee',
  token_hash  text   not null,
  -- profiles, not auth.users: the admin list renders "invited by <full_name>",
  -- and a FK into our own schema keeps that join inside RLS-visible rows.
  -- CASCADE mirrors profiles -> auth.users: if the inviter's account is
  -- deleted (an out-of-product operation, §2.3), their outstanding
  -- invitations go with it. The membership an accepted invitation produced
  -- survives on profiles, which is where it is actually recorded.
  invited_by  uuid   not null references public.profiles (id) on delete cascade,
  expires_at  timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,

  -- Deliberately loose on shape, strict on the abuses that matter: no
  -- whitespace, exactly one @, a dotted domain, RFC 5321's length ceiling.
  -- A stricter regex rejects addresses that really exist.
  constraint invitations_email_valid
    check (
      length(email) between 3 and 254
      and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    ),

  -- Structural enforcement of §8.4's "the database stores a hash": a raw
  -- token — random bytes in base64url or similar — cannot satisfy 64 lowercase
  -- hex characters, so an actions-layer bug that forgets to hash fails at
  -- write time instead of silently storing a working credential in plaintext.
  constraint invitations_token_hash_is_sha256_hex
    check (token_hash ~ '^[0-9a-f]{64}$')
);

comment on table public.invitations is
  'SPEC.md §3.10, §8.4. Admin-only at the RLS layer; the invitee reaches it only through invitation_preview() / accept_invitation(), which are token-gated.';
comment on column public.invitations.token_hash is
  'Lowercase hex SHA-256 of the raw token (§8.4). The raw value exists only in the emailed URL and is never stored.';
comment on column public.invitations.expires_at is
  'Always now() + 7 days: not insertable by clients, so §8.4''s expiry cannot be widened per-invitation. Doubles as the creation-order key.';
comment on column public.invitations.accepted_at is
  'Set exactly once, by accept_invitation(). NULL means outstanding (§8.4, one-time use).';

-- §8.4: "Re-inviting the same email replaces the outstanding invitation rather
-- than stacking a second one." The index makes stacking impossible; replacing
-- is the actions layer's DELETE-then-INSERT, which this constraint backstops
-- with a clean 23505 when two admins race the same address.
create unique index invitations_company_email_outstanding_key
  on public.invitations (company_id, email)
  where accepted_at is null;

-- One token, one invitation. Also the lookup index for both token-gated
-- functions below, which is the only way an invitee ever finds their row.
create unique index invitations_token_hash_key
  on public.invitations (token_hash);

-- Drives the admin invitation list (§4.2: company-scoped, admin-only).
create index invitations_company_id_expires_at_idx
  on public.invitations (company_id, expires_at desc);

-- ---------------------------------------------------------------------------
-- invitation_preview() (§8.1 Path B)
--
-- The RLS matrix on invitations is admin-only, and an invitee is by definition
-- not yet an admin of that company — usually not signed in at all. Without a
-- token-gated read, the accept page could not name the company it is inviting
-- somebody to, and the pressure would land on the SELECT policy instead. This
-- function is that read, deliberately narrow:
--
--   * the token is the entire authorization: no token, no row, ever;
--   * it discloses only what the invitation email already told the holder —
--     company name, the invited address, the role, and the link's state;
--   * it returns zero rows rather than raising, so a bad link is a UI state
--     ("invalid or revoked"), not an error path;
--   * it never returns token_hash, id, or company_id.
--
-- It is an oracle for token validity, which is inherent to any accept
-- endpoint; tokens are 256-bit random, so guessing is not a threat model.
-- ---------------------------------------------------------------------------

create function public.invitation_preview(p_token text)
returns table (
  company_name text,
  email        citext,
  role         public.user_role,
  expires_at   timestamptz,
  expired      boolean,
  accepted     boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select c.name,
         i.email,
         i.role,
         i.expires_at,
         i.expires_at < now(),
         i.accepted_at is not null
    from public.invitations i
    join public.companies c on c.id = i.company_id
   where p_token is not null
     and i.token_hash = public.hash_invitation_token(p_token)
$$;

comment on function public.invitation_preview(text) is
  'SPEC.md §8.1 Path B. Token-gated read of a single invitation for the invitee, who cannot pass the admin-only RLS on invitations. Returns no rows for an unknown or revoked token.';

-- ---------------------------------------------------------------------------
-- accept_invitation() (§8.1 Path B, §8.4)
--
-- SECURITY DEFINER for the same reason create_company() is (§8.2): binding
-- profiles.company_id + role and consuming the invitation must be one
-- transaction. It also has to run for a caller who is not yet in the company —
-- RLS on invitations is admin-only, so a client cannot even read the row it is
-- accepting, let alone update it.
--
-- Order of checks is deliberate:
--   1. authentication, then
--   2. the caller's own eligibility (§8.4's "already belongs to a company"),
--      which is about the caller and needs no token, and
--   3. only then anything about the token.
-- A caller who already has a company therefore learns nothing about whether
-- the token they presented was real.
--
-- Atomicity: there is no EXCEPTION block anywhere below, on purpose. A block
-- would open a subtransaction and make partial state expressible. As written,
-- the function body runs inside the caller's transaction and any raise —
-- including one from the profiles triggers installed in 0002 — rolls the whole
-- call back. There is no interleaving in which company_id is bound but
-- accepted_at is not, or the reverse.
--
-- Concurrency: the caller's profile is locked before the invitation row, the
-- same order create_company() uses, so the two cannot deadlock. Two sessions
-- redeeming one token serialize on the invitation row; the loser re-reads
-- under READ COMMITTED, sees accepted_at set, and is rejected with 23514.
-- ---------------------------------------------------------------------------

create function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id      uuid := auth.uid();
  v_caller_email text;
  v_has_company  boolean;
  v_inv          public.invitations;
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if p_token is null or btrim(p_token) = '' then
    raise exception 'no invitation matches this link' using errcode = 'P0002';
  end if;

  -- Serializes two concurrent acceptances by the same user, and any race
  -- between accept_invitation() and create_company().
  select company_id is not null
    into v_has_company
    from public.profiles
   where id = v_user_id
     for update;

  if not found then
    raise exception 'no profile for the calling user' using errcode = '23514';
  end if;

  -- §2, §8.4. Checked against the CALLER, not the invited address: the
  -- session holding the link may belong to a different account entirely.
  if v_has_company then
    raise exception
      'this account already belongs to a company, and a user belongs to one company for the life of the account'
      using errcode = '23505';
  end if;

  select *
    into v_inv
    from public.invitations
   where token_hash = public.hash_invitation_token(p_token)
     for update;

  -- Revoked (§8.4: revoking deletes the row), never issued, or tampered with.
  -- Indistinguishable by design, and correctly so: all three mean "this link
  -- grants nothing".
  if not found then
    raise exception 'no invitation matches this link' using errcode = 'P0002';
  end if;

  if v_inv.accepted_at is not null then
    raise exception 'this invitation has already been used'
      using errcode = '23514';
  end if;

  if v_inv.expires_at < now() then
    raise exception 'this invitation expired on %', v_inv.expires_at
      using errcode = '22023';
  end if;

  -- The invitation was mailed to one address; that address is the only
  -- evidence of who was actually invited. Without this check the token is a
  -- bearer credential for company membership and a forwarded link admits
  -- anyone. See the migration report for the §8.1 amendment this records.
  select email into v_caller_email from auth.users where id = v_user_id;

  if v_caller_email is null
     or v_caller_email::citext is distinct from v_inv.email then
    raise exception
      'this invitation was sent to %, but you are signed in as %',
      v_inv.email, coalesce(v_caller_email, 'an account with no email address')
      using errcode = '42501';
  end if;

  -- Permitted by profiles_10_guard_columns()'s limbo branch (old.company_id
  -- IS NULL), which is the only path that may set company_id and role
  -- together. There is no client-issued update that can reach this.
  update public.profiles
     set company_id = v_inv.company_id,
         role       = v_inv.role,
         status     = 'active'
   where id = v_user_id;

  -- §8.4 one-time use. Same transaction as the bind above.
  update public.invitations
     set accepted_at = now()
   where id = v_inv.id;

  return v_inv.company_id;
end;
$$;

comment on function public.accept_invitation(text) is
  'SPEC.md §8.1 Path B, §8.4. Binds the caller to the invitation''s company and role and consumes the invitation atomically. Rejects: 28000 unauthenticated, 23505 caller already in a company, P0002 unknown/revoked token, 22023 expired, 23514 already used, 42501 signed in as somebody other than the invitee.';

-- ---------------------------------------------------------------------------
-- Privileges
--
-- RLS decides which rows; these grants decide which verbs and which columns.
--
-- expires_at is not insertable: §8.4 fixes expiry at 7 days, and a client-set
-- expires_at would let an admin mint a link that never dies. It is the table
-- default or nothing.
--
-- accepted_at is not writable by anyone: one-time use (§8.4) is meaningless if
-- a client can clear it. accept_invitation() is the only writer.
--
-- token_hash is insertable but never updatable — reissuing is a new row.
-- ---------------------------------------------------------------------------

revoke all on public.invitations from anon, authenticated;

grant select on public.invitations to authenticated;
grant insert (company_id, email, role, token_hash, invited_by)
  on public.invitations to authenticated;
grant delete on public.invitations to authenticated;
-- No UPDATE grant at all: see invitations_update_never below.

revoke execute on function public.hash_invitation_token(text) from public;
revoke execute on function public.invitation_preview(text)     from public;
revoke execute on function public.accept_invitation(text)      from public;

-- hash_invitation_token() is granted to no client role. Nothing outside the
-- two functions above needs it, and the actions layer hashes in Node.

-- anon as well as authenticated: §8.1 Path B has the invitee landing on the
-- accept page before they sign up, and the page must be able to name the
-- company doing the inviting.
grant execute on function public.invitation_preview(text) to anon, authenticated;

-- Not granted to anon: acceptance binds a profile, which requires a session.
grant execute on function public.accept_invitation(text) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS (§4.2 matrix, §4.3 tenancy filter)
--
-- Admin-only across the board, and every policy also filters
-- company_id = public.current_company_id(): role and tenancy are independent
-- checks (§4.3). is_admin() is true for an active admin of *some* company, so
-- without the company_id term an admin of Company 2 would reach Company 1's
-- invitations.
--
-- As in 0002, a verb that is denied is written out as an explicit `false`
-- policy rather than left absent, so the intent is visible in pg_policies
-- instead of inferred from a gap.
-- ---------------------------------------------------------------------------

alter table public.invitations enable row level security;

create policy invitations_select_admin
  on public.invitations for select to authenticated
  using (company_id = public.current_company_id() and public.is_admin());

-- invited_by = auth.uid() is a tenancy control, not bookkeeping: it makes the
-- denormalized invited_by provably a member of company_id (the caller is an
-- active admin of it), so no consistency trigger is needed the way §2.1
-- requires one for tasks and project_members.
create policy invitations_insert_admin
  on public.invitations for insert to authenticated
  with check (
    company_id = public.current_company_id()
    and public.is_admin()
    and invited_by = auth.uid()
  );

-- §4.2's matrix says "admin (revoke)" for UPDATE, but §8.4 defines revoke as
-- "deletes the row; the link stops working immediately", and describes no
-- other in-place mutation. The only legitimate UPDATE on this table is
-- accept_invitation() setting accepted_at, which is SECURITY DEFINER and does
-- not consult this policy. So the verb is denied outright rather than left as
-- a granted-but-unused surface on a table whose rows are credentials.
-- Recorded as a §4.2 amendment; restoring an update path is additive.
create policy invitations_update_never
  on public.invitations for update to authenticated
  using (false)
  with check (false);

-- §8.4: revoke deletes the row.
create policy invitations_delete_admin
  on public.invitations for delete to authenticated
  using (company_id = public.current_company_id() and public.is_admin());
