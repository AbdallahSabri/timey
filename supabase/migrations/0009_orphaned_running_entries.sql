-- 0009_orphaned_running_entries.sql
--
-- Closes BLOCKERS.md N-10. Implements SPEC.md §2.3 + §5.1 + §5.4 + §7.4 at the
-- one point where they collide: a RUNNING time entry whose owner has since
-- been DEACTIVATED.
--
-- ---------------------------------------------------------------------------
-- THE DEFECT, reproduced before it was fixed rather than reasoned about
-- ---------------------------------------------------------------------------
--
-- Deactivate a member while their timer is running, with no correction request
-- already filed, and the row becomes permanently unstoppable. Every path was
-- exercised against this database, in this order, on one real orphaned entry:
--
--   owner  stop_timer()          -> NULL row (no-op). 0008 made
--                                  current_company_id() NULL for an inactive
--                                  profile, so the UPDATE policy matches no
--                                  rows. CORRECT, and not to be undone.
--   admin  stop_timer()          -> NULL row (no-op). The UPDATE policy is
--                                  owner-scoped; is_admin() appears in neither
--                                  the UPDATE nor the DELETE policy on
--                                  time_entries (§5.1.1, deliberate).
--   admin  raw UPDATE            -> 0 rows.
--   admin  raw DELETE            -> 0 rows.
--   admin  admin_edit_entry()    -> 23514 / entry_still_running.
--   admin  INSERT correction     -> RLS refusal: the INSERT policy requires
--                                  requested_by = auth.uid() on the
--                                  REQUESTER'S OWN entry, which an admin's
--                                  account never satisfies for someone else's
--                                  row.
--   admin  report_summary()      -> running_count = 1.
--
-- The last line is what makes this worse than a silent gap: the stuck entry
-- sits in the admin's exception queue looking actionable, and nothing in the
-- product can act on it. The only escape today is reactivate -> owner stops
-- their own timer -> deactivate again, which is a workaround, not a path.
--
-- ---------------------------------------------------------------------------
-- THE FIX, and the far larger thing it deliberately does NOT do
-- ---------------------------------------------------------------------------
--
-- admin_edit_entry() still refuses a running entry. It gains exactly one
-- exception: when the ENTRY'S OWNER (time_entries.user_id) is currently
-- INACTIVE (profiles.status <> 'active').
--
-- Why that predicate and not a looser one. Phase 7 added the running-entry
-- refusal to this function after review, to stop an admin reattributing or
-- backdating an ACTIVE employee's still-running timer — §5.1 forbids that in
-- terms carrying no role exception, and it stays forbidden here, unchanged and
-- verified unchanged. What the refusal was never meant to cover is a row whose
-- owner can no longer reach it AT ALL. For an active employee the refusal
-- redirects work to the owner, who has stop_timer(); for a deactivated one it
-- redirects work to nobody. The exception is keyed on precisely the condition
-- that makes the redirect impossible, so it can never widen to the case Phase
-- 7 closed: reactivate the user and the refusal comes straight back.
--
-- SCOPE OF WHAT THE EXCEPTION PERMITS — ended_at and note ONLY.
--
-- This is the deliberate part, and the conservative reading was chosen. The
-- exception decides only WHETHER admin_edit_entry proceeds; WHAT it may then
-- change on a running row is left entirely to apply_entry_change()'s existing
-- running_entry_reattribution check (0006 header note (h)), which is not
-- touched by this migration. So an admin closing a deactivated user's orphaned
-- timer may set p_ended_at and p_note; passing a different p_started_at,
-- p_project_id or p_task_id in the same call is refused with
-- 23514 / running_entry_reattribution, exactly as the correction path already
-- refuses it.
--
-- The argument for that, stated so it is arguable:
--   * §5.1's reason for refusing reattribution is about the DATA, not the
--     actor — moving project_id "would silently misattribute already-elapsed
--     minutes", and a backdated started_at manufactures minutes nobody worked.
--     Deactivating the owner changes who can act; it does not make those
--     minutes any less already-elapsed.
--   * The goal N-10 names is "make it closeable", not "make it fully editable
--     while still running". Closing it is what ended_at does. Once closed, the
--     entry is an ordinary closed entry and the ordinary admin-edit path can
--     reattribute it in a second call, with its own revision row — so nothing
--     is actually unreachable, only sequenced.
--   * The narrow version is the one that can be widened later on evidence. A
--     migration that allowed full reattribution here could not be narrowed
--     again without breaking a capability somebody had started using.
--
-- ---------------------------------------------------------------------------
-- What is NOT changed, and must not be as a side effect of reading this
-- ---------------------------------------------------------------------------
--
--   * time_entries' RLS policies. Untouched. Admins still have NO write path
--     on time_entries (§5.1.1) — this function is SECURITY DEFINER and has
--     always bypassed RLS; the change is about when it agrees to run.
--   * time_entries_guard_update(). Untouched. The open-to-closed §5.3 check is
--     already carved out under timey.bypass_entry_guard for the owner role,
--     which is how §5.4's stale-timer correction closes a running entry at a
--     backdated time today. This path reuses that mechanism verbatim; it does
--     not add to it.
--   * apply_entry_change(). Untouched, and load-bearing precisely because it is
--     untouched — see the scope note above.
--   * current_company_id(). Untouched. The deactivated owner stays locked out.
--     This gives the ADMIN a path; it gives the deactivated user nothing.
--   * correction_requests, approve_correction, reject_correction, the
--     self-approval block, every policy in the schema. Untouched.
--
-- ---------------------------------------------------------------------------
-- Error contract delta (against 0006's table)
-- ---------------------------------------------------------------------------
--
-- No new SQLSTATE and no new DETAIL token. Two existing tokens shift meaning
-- slightly and the actions layer should know it:
--
--   23514 / entry_still_running          now means "running AND its owner is
--                                        still active". Same code, same
--                                        message, strictly narrower trigger.
--   23514 / running_entry_reattribution  now also reachable from
--                                        admin_edit_entry (previously only
--                                        from approve_correction), when an
--                                        admin's edit of a DEACTIVATED owner's
--                                        running entry tries to move
--                                        started_at / project_id / task_id.
--
-- A missing profiles row for the entry's owner FAILS CLOSED (treated as
-- active, i.e. refused). Unreachable — time_entries carries
-- (user_id, company_id) -> profiles (id, company_id) ON DELETE RESTRICT — but
-- the branch is written so that "we could not establish the owner is inactive"
-- and "the owner is active" produce the same refusal rather than the same
-- permission.
--
-- ---------------------------------------------------------------------------
-- Reversibility
-- ---------------------------------------------------------------------------
--
-- This replaces one function BODY (create or replace). Nothing is dropped: no
-- table, column, constraint, index, policy, grant or trigger. The signature,
-- volatility, security class (security definer), search_path and EXECUTE
-- grants are identical to 0006's, so no dependent object is invalidated.
-- Reverting is one more `create or replace` restoring 0006's body — which
-- would reopen N-10.
--
-- SPEC NOTE (§11: a conflict amends the spec rather than being coded around).
-- §7.4.1's Phase 7 amendment says admin_edit_entry covers "CLOSED ENTRIES
-- ONLY". That sentence is now true with one stated exception and should be
-- amended to carry it. §5.1 itself needs no change: nothing here mutates a
-- running timer's attribution, only its end. Flagged for a human — SPEC.md is
-- not edited from here.
--
-- Manual re-verification this change requires (SPEC.md §12.2): the
-- time_entries admin-write checks, the correction-approval checks, and the
-- deactivation checks from §2.3. `pnpm test` cannot see any of it (§12.1).

create or replace function public.admin_edit_entry(
  p_entry_id   uuid,
  p_started_at timestamptz default null,
  p_ended_at   timestamptz default null,
  p_project_id uuid        default null,
  p_task_id    uuid        default null,
  p_note       text        default null
)
returns public.time_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin        uuid := auth.uid();
  v_entry        public.time_entries;
  v_owner_active boolean;
begin
  if v_admin is null then
    raise exception 'not authenticated'
      using errcode = '28000', detail = 'not_authenticated';
  end if;

  if not public.is_admin() then
    raise exception 'only an admin may edit a recorded entry'
      using errcode = '42501', detail = 'not_an_admin';
  end if;

  -- The tenancy boundary, as in approve_correction: definer bypasses RLS, so
  -- this filter is the only thing standing between a Company 2 admin and a
  -- Company 1 timesheet. Unchanged from 0006, and it runs FIRST — the
  -- deactivated-owner exception below is reached only for a row that is
  -- already established to be this admin's own company's.
  select *
    into v_entry
    from public.time_entries
   where id = p_entry_id
     and company_id = public.current_company_id()
     for update;

  if not found then
    raise exception 'no time entry matches this id'
      using errcode = 'P0002', detail = 'entry_not_found';
  end if;

  -- §5.1 / §7.2, with §2.3's exception. See the header for the whole argument.
  --
  -- The refusal Phase 7 added stands for every running entry whose owner is
  -- still active: that owner holds stop_timer() and the refusal points at
  -- them. It lifts only when the owner is INACTIVE, because 0008 correctly
  -- made stop_timer() a no-op for them and there is then no other actor in the
  -- system who can close the row.
  --
  -- Read as "refuse unless we can positively establish the owner is inactive".
  -- v_owner_active is NULL when no profile row matches (unreachable: the FK is
  -- ON DELETE RESTRICT), and `is not false` refuses on NULL as well as on
  -- true. Failing closed on an unestablished owner is the point.
  --
  -- Note what is NOT decided here: what the edit may then change. A running
  -- entry that gets past this point still meets apply_entry_change()'s
  -- running_entry_reattribution check, which limits it to ended_at and note.
  if v_entry.ended_at is null then
    select p.status = 'active'
      into v_owner_active
      from public.profiles p
     where p.id = v_entry.user_id
       and p.company_id = v_entry.company_id;

    if v_owner_active is not false then
      raise exception
        'that entry''s timer is still running — stop it before editing it (SPEC.md §5.1)'
        using errcode = '23514', detail = 'entry_still_running';
    end if;
  end if;

  return public.apply_entry_change(
    v_entry.id,
    coalesce(p_started_at, v_entry.started_at),
    coalesce(p_ended_at,   v_entry.ended_at),
    coalesce(p_project_id, v_entry.project_id),
    coalesce(p_task_id,    v_entry.task_id),
    coalesce(p_note,       v_entry.note),
    v_admin,
    null
  );
end;
$$;

comment on function public.admin_edit_entry(uuid, timestamptz, timestamptz, uuid, uuid, text) is
  'SPEC.md §7.4''s single-admin path: an admin edits a CLOSED entry in their own company directly, and the edit writes a time_entry_revisions row with correction_request_id NULL. NULL argument means "leave unchanged". Same validation and same audit trail as an approved correction; no deletion path. Refuses a still-running entry with 23514/entry_still_running per §5.1 — UNLESS that entry''s owner is deactivated (profiles.status <> ''active''), the one case where nobody else can ever close it (§2.3, BLOCKERS.md N-10). In that case only ended_at and note may change: apply_entry_change() still refuses any move of started_at/project_id/task_id on a running row with 23514/running_entry_reattribution.';
