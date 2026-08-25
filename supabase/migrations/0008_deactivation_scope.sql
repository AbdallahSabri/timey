-- 0008_deactivation_scope.sql
--
-- Closes BLOCKERS.md N-7. Implements SPEC.md §2.3 ("Deactivation, not
-- deletion. A removed employee gets status = 'inactive': LOSES ACCESS, keeps
-- their time entries") at the one place that decides access for every table.
--
-- THE DEFECT. 0002 defined current_company_id() as the caller's company_id
-- with no reference to profiles.status:
--
--   select company_id from public.profiles where id = auth.uid()
--
-- is_admin() got this right in the same migration — it requires
-- `status = 'active'` — so deactivation correctly removed every ADMIN verb.
-- But every tenancy check in this schema is `company_id =
-- current_company_id()` (0002-0007, directly or in 0004's InitPlan
-- `(select ...)` form), and that expression kept returning the real company
-- for an inactive profile. A deactivated member holding a still-valid session
-- therefore kept full EMPLOYEE-level read AND write access: their company's
-- clients, their assigned projects and tasks, their own time entries — and,
-- confirmed during Phase 5 verification, the ability to START NEW TIMERS and
-- record new billable-looking hours after being removed. Deactivation stopped
-- future logins and nothing else.
--
-- THE FIX, and why it is one line rather than one line per policy. A
-- deactivated caller is, for access purposes, exactly the case this function
-- already handles twice: an unauthenticated caller (auth.uid() IS NULL -> no
-- row -> NULL) and a limbo user (§8.3, company_id IS NULL -> NULL). Returning
-- NULL for a non-active profile puts deactivation in the same shape. Because
-- `x = NULL` is never true in SQL, every SELECT / INSERT / UPDATE / DELETE
-- policy in the schema fails closed for that caller with no policy edited and
-- no per-table rule to keep in sync — which is the property that makes this
-- safe to do centrally. A per-policy fix would be N places to forget.
--
-- WHAT REMAINS VISIBLE, deliberately: the caller's OWN profiles row.
-- profiles_select_own_company (0002) is
-- `company_id = current_company_id() OR id = auth.uid()`, and the second
-- branch is plain primary-key equality that never consults this function. A
-- deactivated user therefore reads exactly one row — their own, including
-- status = 'inactive' — and nothing else in the schema. That is the §8.3 limbo
-- affordance doing double duty, and it is what lets a client eventually say
-- "your account has been deactivated" instead of rendering an inexplicably
-- empty product. Verified as exactly one row, not assumed from the policy's
-- shape.
--
-- SIDE EFFECTS THAT FOLLOW, all intended and all §2.3:
--   * A deactivated user can no longer edit their own full_name.
--     profiles_update_self_or_admin's self branch is
--     `id = auth.uid() and company_id is not distinct from
--     current_company_id()`; with the function NULL and the row's company_id
--     not NULL, `is not distinct from` is false. "Loses access" includes this.
--   * A deactivated ADMIN loses employee-level reads too, on top of the admin
--     verbs is_admin() already withheld. Nothing in the spec asks for a
--     demoted-to-reader state, and the last-admin guard (§2) makes the case
--     unreachable for a company's only admin anyway.
--   * REACTIVATION IS IMMEDIATE. This function reads profiles live on every
--     call; nothing is cached in a JWT claim. Flipping status back to 'active'
--     restores access on the next statement, with no re-login and no token
--     refresh.
--   * A limbo user is unaffected: their profile is status = 'active' with
--     company_id NULL, so create_company() (§8.2) and accept_invitation()
--     (§8.4) still work exactly as before.
--
-- SPEC NOTE (§11: conflicts amend the spec rather than being coded around).
-- §4.1's illustrative snippet shows current_company_id() WITHOUT the status
-- term. That snippet is written to explain the recursion trap, not to rule on
-- deactivation; §2.3's "loses access" is the normative ruling and is what this
-- migration implements. §4.1's code block should be amended to match. Flagged
-- for a human — SPEC.md is not edited from here.
--
-- Reversibility: this replaces one function BODY. The signature, volatility
-- (stable), security class (security definer), search_path and grants are
-- unchanged, so no dependent policy, default or function is invalidated and
-- nothing is dropped. Reverting means one more `create or replace` restoring
-- the 0002 body — which would reopen N-7.

create or replace function public.current_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select company_id
    from public.profiles
   where id = auth.uid()
     and status = 'active'
$$;

comment on function public.current_company_id() is
  'SPEC.md §4.1, §2.3. Tenant of the calling user, or NULL when the caller is unauthenticated, in limbo (§8.3), or DEACTIVATED (status <> ''active''). The status term is what makes §2.3''s "loses access" true for every table at once, since every policy in this schema filters on company_id = current_company_id() and x = NULL is never true. Says nothing about role — see is_admin().';
