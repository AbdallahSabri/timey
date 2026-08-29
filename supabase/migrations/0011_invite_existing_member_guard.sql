-- 0011_invite_existing_member_guard.sql
--
-- SPEC.md §8.4. Closes the gap where an admin can invite an address that
-- already belongs to their company.
--
-- The invitation is created happily today, and only fails when the holder
-- clicks the link: accept_invitation() raises 23505 ("this account already
-- belongs to a company"). That is the right refusal in the wrong place. The
-- admin gets no warning at send time, the row occupies the pending list until
-- it expires, and if Resend is configured the person receives a link that can
-- never work. Observed for real: the sole admin of a company invited their own
-- address as an employee and got a pending invitation that was structurally
-- un-acceptable.
--
-- WHY THIS NEEDS A FUNCTION AT ALL. `profiles` carries no email column — an
-- address lives in `auth.users`, which the application cannot read: there is
-- no service-role key in this project (§4.4) and `authenticated` holds no
-- grant on the auth schema. So "is this address already a member of my
-- company?" is a question the actions layer is structurally unable to ask,
-- and a narrow SECURITY DEFINER function is the sanctioned way to answer it
-- (§4.4: elevated work is a definer function with a narrow signature, never a
-- key handed to application code).
--
-- WHY IT IS ADMIN-ONLY. This is an email oracle: it answers "does this address
-- belong to your company" for any address the caller can name. Today a member
-- can list who is in the company but NOT their email addresses, so granting
-- this to every member would widen §4.2 by a column nobody asked for. Only an
-- admin invites (§8.4), so only an admin needs the answer. A non-admin caller
-- gets 42501 rather than false — false would be a second, quieter answer to a
-- question they may not ask at all.
--
-- WHY IT RETURNS A BOOLEAN AND NOT THE PROFILE. The caller needs one bit to
-- refuse on. Returning the row would hand back a member's id and name keyed by
-- an email the caller merely guessed, which is more than the question needs.
--
-- Reversibility: dropping this function restores the previous behaviour
-- exactly — accept_invitation() is unchanged and remains the enforcement.
-- This is a better error, earlier; it is not a new rule.

create function public.email_is_company_member(p_email citext)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
stable
as $$
declare
  v_company_id uuid;
begin
  if auth.uid() is null then
    raise exception 'you must be signed in'
      using errcode = '28000';
  end if;

  v_company_id := public.current_company_id();

  -- Mirrors the INSERT policy on `invitations`: an admin of one company, and
  -- the answer is scoped to that company and no other (§4.3).
  if not public.is_admin() or v_company_id is null then
    raise exception 'only an active admin may check company membership'
      using errcode = '42501';
  end if;

  return exists (
    select 1
      from public.profiles p
      join auth.users u on u.id = p.id
     where p.company_id = v_company_id
       and u.email = p_email
  );
end;
$$;

comment on function public.email_is_company_member(citext) is
  'SPEC.md §8.4. True when the address already belongs to the CALLER''S company. Admin-only (42501 otherwise) because it is an email oracle and §4.2 does not otherwise expose member emails. Lets createInvitation() refuse at send time what accept_invitation() would refuse at redemption (23505). Advisory: accept_invitation() remains the enforcement.';

revoke execute on function public.email_is_company_member(citext) from public;
grant execute on function public.email_is_company_member(citext) to authenticated;
