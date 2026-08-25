-- 0010_admin_direct_entry_paths.sql
--
-- Closes BLOCKERS.md N-8. Implements SPEC.md §7.4's direct-admin path for the
-- two correction kinds it never covered: DELETE and CREATE.
--
-- ---------------------------------------------------------------------------
-- THE GAP
-- ---------------------------------------------------------------------------
--
-- §7.4 [R] forbids self-approval: "an admin cannot approve their own
-- correction request ... If a company has one admin, that admin edits entries
-- directly (admin edits also write revision rows) rather than routing through
-- a request." Phase 7 built exactly one direct path — admin_edit_entry(), for
-- kind='amend' — and said so in its own header ("no DELETE ... a single-admin
-- company genuinely cannot delete a closed entry").
--
-- Put together, for a company with exactly one admin (which is EVERY company
-- at creation, §8.1 Path A):
--
--   delete a closed entry   -> queue: needs a second admin. direct: no
--                              function exists. NO PATH.
--   create a backdated one  -> queue: needs a second admin. direct: no
--                              function exists. NO PATH.
--
-- The workaround was promoting a second admin and demoting them again, which
-- is a way around the product rather than a way through it.
--
-- ---------------------------------------------------------------------------
-- THE SHAPE CHOSEN, and the one rejected
-- ---------------------------------------------------------------------------
--
-- Two new client-callable RPCs — admin_delete_entry(uuid) and
-- admin_create_entry(uuid, uuid, uuid, timestamptz, timestamptz, text) —
-- alongside admin_edit_entry(), whose name, signature and behaviour are
-- UNCHANGED by this migration (0009's deactivated-owner exception included).
--
-- The alternative considered and rejected was collapsing all three into a
-- single kind-aware admin_apply_entry_change(p_kind, ...), mirroring
-- approve_correction()'s one-function-three-branches shape. Rejected because
-- the resemblance is superficial: approve_correction takes ONE argument (a
-- request id) and reads the per-kind payload out of a table whose
-- correction_requests_shape_by_kind CHECK has already proved that payload
-- coherent for its kind. A function signature can express no such CHECK. The
-- merged version would take the union of three argument lists — an entry id
-- that must be NULL for create and NOT NULL for delete, a user id meaningless
-- for both others, five proposed values meaningless for delete — and would
-- have to hand-write, per branch, the shape validation the table gets for
-- free. Three narrow signatures each name exactly the arguments their
-- operation has, and PostgREST publishes that difference to the actions layer.
--
-- It would also rename a function the actions layer, the validations layer and
-- two components already call, for no behavioural gain, in a migration whose
-- job is to ADD two missing capabilities.
--
-- ---------------------------------------------------------------------------
-- WHERE THE SHARED LOGIC LIVES — the substance of this migration
-- ---------------------------------------------------------------------------
--
-- 0006 already factored the amend path into apply_entry_change(): validate,
-- snapshot to time_entry_revisions, mutate — so that approve_correction's
-- amend branch and admin_edit_entry() cannot drift apart. The create and
-- delete branches were never factored the same way, because they had exactly
-- one caller each.
--
-- Now they have two each, so this migration extracts them FIRST and builds the
-- new RPCs on top, rather than copying them:
--
--   apply_entry_create()  membership check (§3.6.1) + window re-validation
--                         (§5.2/§6.4) + INSERT + all-NULL-prior revision row
--   apply_entry_delete()  lock + snapshot revision row + DELETE
--
-- and approve_correction() is REPLACED (create or replace, body only) so its
-- create and delete branches call them. After this migration there is exactly
-- one implementation of each of the three operations, reached from two callers
-- each — the same property 0006 gave amend:
--
--   amend   apply_entry_change  <- approve_correction / admin_edit_entry
--   create  apply_entry_create  <- approve_correction / admin_create_entry
--   delete  apply_entry_delete  <- approve_correction / admin_delete_entry
--
-- No overlap, future-date, membership or snapshot logic is written twice
-- anywhere in this file. assert_entry_window_valid(),
-- assert_project_membership() and record_entry_revision() are 0006's, unchanged
-- and uncopied.
--
-- ---------------------------------------------------------------------------
-- SCOPE DECISIONS, stated so they are arguable
-- ---------------------------------------------------------------------------
--
-- (1) admin_delete_entry IS CLOSED-ENTRIES-ONLY, and does NOT inherit 0009's
--     deactivated-owner exception.
--
--     §7.1's row is "delete a CLOSED entry -> correction request"; that is the
--     row with no direct counterpart, and this is its counterpart. A RUNNING
--     entry is not in the gap N-8 describes: its owner may discard it
--     unilaterally (§5.1, §7.1, and the time_entries_delete_own_running
--     policy), and since 0009 an ORPHANED running entry (inactive owner) can be
--     closed by an admin through admin_edit_entry — after which it is an
--     ordinary closed entry and this function applies to it normally.
--
--     So extending 0009's exception to deletion would add no reachable
--     capability, only a way to destroy a row whose measurement is still in
--     progress without the two-step that makes what was destroyed visible in
--     the revision row first. 0009's exception is deliberately the narrowest
--     thing that closed N-10 and it is not widened here.
--
-- (2) admin_create_entry HAS NO TODAY-ONLY RESTRICTION. §7.1's today-only rule
--     governs what an EMPLOYEE may assert without oversight; 0006 note (f)
--     already ruled that it is not re-checked when a create correction is
--     approved, because "a backdated entry is the whole point of a correction".
--     This function is the same escape hatch with the same countersignature
--     (an admin, a revision row), reached without a queue that a lone admin
--     cannot use. §6.4's future guard DOES apply, unchanged and inherited from
--     assert_entry_window_valid() — as does overlap (§5.2) and project
--     membership for the ENTRY'S OWNER (§3.6.1).
--
-- (3) admin_create_entry TAKES p_user_id: the entry belongs to a NAMED MEMBER,
--     not to the calling admin. N-8's own words are "create a backdated one on
--     an employee's behalf", and approve_correction's create branch already
--     names the owner explicitly (v_req.requested_by) rather than letting
--     time_entries.user_id fall back to its auth.uid() default. An admin
--     creating an entry for themselves passes their own id.
--
-- (4) NEITHER FUNCTION COUNTS ADMINS. §7.4 motivates the direct path with the
--     single-admin case, but admin_edit_entry has never counted admins either,
--     and a count would make the same call succeed or fail depending on an
--     unrelated membership change. The control §7.4 offers for direct admin
--     action is the revision row, not scarcity of admins.
--
-- (5) A CLOSED WINDOW IS REQUIRED ON CREATE. p_ended_at may not be NULL: this
--     path creates a RECORD of work done, never a running timer on somebody
--     else's behalf (§5.1's start transition belongs to the owner, and
--     time_entries_one_running_per_user would make it a way to block their real
--     timer). Enforced in apply_entry_create so the correction path shares the
--     invariant; approve_correction cannot reach it, since
--     correction_requests_shape_by_kind already requires both instants for
--     kind='create'.
--
-- (6) THE TARGET MEMBER'S status IS NOT CHECKED. An admin may record a
--     deactivated member's past work, and may delete an entry belonging to one.
--     §2.3 rules that a removed employee "loses access, keeps their time
--     entries" — a statement about THEIR access, not about whether their
--     history remains administrable. approve_correction imposes no such check
--     either (a request filed before deactivation stays approvable). What the
--     deactivated user cannot do is reach any of this themselves:
--     current_company_id() is NULL for them (0008) and is_admin() is false.
--
-- (7) ARCHIVED PROJECTS ARE NOT REFUSED, matching 0005's INSERT policy note and
--     0004's ruling that §3.11 keeps archived rows fully usable and hiding them
--     is a query filter, not a constraint. Flagged rather than invented.
--
-- ---------------------------------------------------------------------------
-- Error contract delta (against 0006's table)
-- ---------------------------------------------------------------------------
--
-- Existing tokens, now also reachable from the two new RPCs, unchanged in
-- meaning: 28000/not_authenticated, 42501/not_an_admin, 42501/not_project_member,
-- P0002/entry_not_found, 23514/entry_still_running, 23514/ended_before_started,
-- 22023/started_in_future, 22023/ended_in_future, 23P01/overlap (HINT carries
-- the conflicting entry's id).
--
-- Three NEW DETAIL tokens, all from admin_create_entry:
--
--   SQLSTATE  DETAIL token          meaning                          PGRST  API
--   --------  --------------------  -------------------------------  -----  ---
--   P0002     member_not_found      no such member in the caller's
--                                   company (also the answer for a
--                                   cross-tenant user id)             500   404
--   P0002     project_not_found     no such project in the caller's
--                                   company (also the answer for a
--                                   cross-tenant project id)          500   404
--   23514     create_window_required  a created entry needs both a
--                                   start and an end instant          400   400
--
-- Both P0002s are deliberately indistinguishable from "that id never existed",
-- which is the answer that leaks nothing across a tenant boundary. Branch on
-- error.code + error.details, never on the HTTP status (0006's error-contract
-- note, and §7.4.1's finding: P0002 arrives as a bare 500).
--
-- Unchanged and still raised by the tables themselves through the new paths:
-- 23503 (task does not belong to the named project — the composite FK, which
-- is the enforcement and needs no restatement here), 23514 (time_entries'
-- CHECK), 23P01 (the exclusion constraint behind the friendly overlap check).
--
-- ---------------------------------------------------------------------------
-- Reversibility
-- ---------------------------------------------------------------------------
--
-- Purely additive plus one body replacement. NOTHING IS DROPPED: no table,
-- column, constraint, index, policy, grant, trigger or function. RLS is not
-- touched — admins still have no write policy on time_entries (§5.1.1); both
-- new functions are SECURITY DEFINER and carry their own tenancy filter, as
-- every function in this family does.
--
-- The one non-additive item, named rather than discovered:
-- public.approve_correction(uuid) is REPLACED (create or replace, identical
-- signature, volatility, security class, search_path and grants, so no
-- dependent object is invalidated). What is LOST from the old body: nothing.
-- Its create and delete branches are moved verbatim into the two new helpers,
-- and every check they made — shape, membership, window re-validation, the
-- all-NULL-prior revision row, the snapshot-before-delete ordering — is made in
-- the same order on the same rows with the same errcodes. Its self-approval
-- block, its auto-withdraw branch, its status/tenancy checks and its absence of
-- any EXCEPTION block (§7.4: partial application is not expressible) are
-- byte-identical to 0006's.
--
-- Reverting is one `create or replace` restoring 0006's approve_correction body
-- plus dropping the four new functions — which would reopen N-8.
--
-- ---------------------------------------------------------------------------
-- Manual re-verification this change requires (SPEC.md §12.2) — `pnpm test`
-- cannot see any of it (§12.1)
-- ---------------------------------------------------------------------------
--
--   Tenancy      "A user from Company 2 sees nothing belonging to Company 1"
--                (both new RPCs cross-tenant), "employee hitting an admin route
--                directly" (both new RPCs called by a non-admin).
--   Timer        "manual entry overlapping an existing entry -> rejected with
--                the conflicting range named", "ended_at before started_at ->
--                rejected", "entry starting an hour in the future -> rejected"
--                — all three now also via admin_create_entry.
--   Corrections  ALL FIVE, because approve_correction's body is replaced:
--                employee cannot edit a closed entry through the UI or via a
--                direct API call; approving writes a revision row with correct
--                prior values; approving into an overlap fails cleanly with the
--                entry unchanged and the request still pending; an admin cannot
--                approve their own request.
--   Reporting    a deleted entry leaves report totals equal to the sum of their
--                own visible line items.

-- ---------------------------------------------------------------------------
-- apply_entry_create() — 0006's kind='create' branch, extracted
--
-- Everything approve_correction did inline for kind='create', in the same
-- order, plus the closed-window guard scope decision (5) describes. Callers
-- pass final values; this function has no NULL-means-unchanged convention,
-- exactly like apply_entry_change().
--
-- SECURITY INVOKER on purpose, for the same reason record_entry_revision() and
-- apply_entry_change() are: reached from inside a definer RPC it inserts as the
-- owner and succeeds; called directly by a client (were EXECUTE ever granted,
-- which it is not) it would run as `authenticated`, where the INSERT is refused
-- by time_entries_insert_self_and_member — user_id is not client-writable and
-- has no INSERT grant, so naming another user is refused on privilege first.
-- It cannot be turned into a forgery tool by a grant alone.
--
-- Note what it does NOT check: the caller's role or tenancy. Both are the
-- CALLER's job, because the two callers establish them differently
-- (approve_correction from the request row, admin_create_entry from
-- current_company_id()), and a helper that guessed would be guarding a door
-- neither caller uses. It is granted to nobody, which is what makes that safe.
-- ---------------------------------------------------------------------------

create function public.apply_entry_create(
  p_user_id    uuid,
  p_project_id uuid,
  p_task_id    uuid,
  p_started_at timestamptz,
  p_ended_at   timestamptz,
  p_note       text,
  p_changed_by uuid,
  p_request_id uuid
)
returns public.time_entries
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_new public.time_entries;
begin
  -- Scope decision (5). Unreachable from approve_correction —
  -- correction_requests_shape_by_kind already proves both instants present for
  -- kind='create' — and the first thing admin_create_entry could get wrong.
  -- started_at would otherwise fail as a bare 23502 on a NOT NULL column, and
  -- ended_at would not fail at all: it would silently start a timer on
  -- somebody else's behalf.
  if p_started_at is null or p_ended_at is null then
    raise exception
      'a created entry needs both a start and an end time — this path does not start timers (SPEC.md §5.1)'
      using errcode = '23514', detail = 'create_window_required';
  end if;

  -- §3.6.1, for a user who is not the caller: "assignment governs time entry,
  -- role governs visibility." Checked unconditionally here, unlike the amend
  -- path's project-moved-only check — there is no prior project to have been a
  -- member of.
  perform public.assert_project_membership(p_user_id, p_project_id);

  -- §5.2 overlap, §6.4's future guard, §3.7's ordering. No entry to exclude:
  -- this one does not exist yet.
  perform public.assert_entry_window_valid(
    p_user_id, null, p_started_at, p_ended_at
  );

  -- user_id is named explicitly: the entry belongs to the NAMED MEMBER, not to
  -- the admin applying this, and the column's default (auth.uid()) would
  -- silently produce the second. company_id is left to
  -- time_entries_10_set_company_id, which derives it from the project — so the
  -- caller is responsible for having established that the project is theirs
  -- (both do, differently).
  --
  -- source is 'manual' per 0006 note (e): a human assertion about the past,
  -- merely one an admin countersigned.
  insert into public.time_entries (
    user_id, project_id, task_id, started_at, ended_at, source, note
  )
  values (
    p_user_id, p_project_id, p_task_id, p_started_at, p_ended_at, 'manual',
    p_note
  )
  returning * into v_new;

  -- 0006 note (d): a creation writes a revision row too, with every prior_*
  -- column NULL — the honest snapshot of "there was nothing here". Without it
  -- an entry materialises in somebody's timesheet with no record of who put it
  -- there. company_id comes from the INSERTED ROW rather than from the caller,
  -- so the audit row can never land in a different tenant than its subject.
  perform public.record_entry_revision(
    v_new.company_id, v_new.id, p_changed_by, p_request_id,
    null, null, null, null, null
  );

  return v_new;
end;
$$;

comment on function public.apply_entry_create(uuid, uuid, uuid, timestamptz, timestamptz, text, uuid, uuid) is
  'SPEC.md §7.3/§7.4, extracted from 0006''s approve_correction kind=''create'' branch so approve_correction and admin_create_entry share one implementation. Checks §3.6.1 membership for the NAMED OWNER and re-validates the window (§5.2 overlap, §6.4 future, §3.7 ordering), inserts source=''manual'', then writes the all-NULL-prior revision row (note (d)). Refuses a NULL start or end (23514/create_window_required): this path never starts a timer. Internal: no EXECUTE grant.';

-- ---------------------------------------------------------------------------
-- apply_entry_delete() — 0006's kind='delete' branch, extracted
--
-- §3.11 is "hard delete for nothing" for structure; a time entry is the one
-- thing §7.1 says may be deleted outright, and only through an audited path.
-- This is that path, and the ordering is the whole point: the revision row is
-- written FIRST and is the only remaining record of what the entry was, which
-- is why time_entry_revisions.time_entry_id carries no foreign key (§3.8).
--
-- Locking and the not-found raise mirror apply_entry_change() exactly, so both
-- callers get the same answer for an entry that vanished between their read and
-- this call. Re-selecting a row the caller already locked is a no-op that keeps
-- the snapshot and the DELETE reading the same tuple — the property that makes
-- "a mutation cannot happen without its audit row" a fact about this function
-- rather than a rule two callers must remember.
--
-- No guard-trigger flag is set: time_entries_20_guard_update is BEFORE UPDATE
-- only, and time_entries_delete_own_running (which limits clients to running
-- entries) is an RLS policy, which a definer caller is not subject to.
--
-- Returns the row AS IT WAS, so a caller can report what it destroyed without a
-- second read it could no longer perform.
--
-- SECURITY INVOKER: same argument as apply_entry_create() above. Granted to
-- nobody.
-- ---------------------------------------------------------------------------

create function public.apply_entry_delete(
  p_entry_id   uuid,
  p_changed_by uuid,
  p_request_id uuid
)
returns public.time_entries
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_old public.time_entries;
begin
  select *
    into v_old
    from public.time_entries
   where id = p_entry_id
     for update;

  -- Nothing has been written at this point, so a nonexistent or
  -- already-deleted id leaves no phantom revision row behind.
  if not found then
    raise exception 'that time entry no longer exists'
      using errcode = 'P0002', detail = 'entry_not_found';
  end if;

  perform public.record_entry_revision(
    v_old.company_id, v_old.id, p_changed_by, p_request_id,
    v_old.started_at, v_old.ended_at, v_old.project_id, v_old.task_id,
    v_old.note
  );

  delete from public.time_entries where id = v_old.id;

  return v_old;
end;
$$;

comment on function public.apply_entry_delete(uuid, uuid, uuid) is
  'SPEC.md §3.8/§7.1, extracted from 0006''s approve_correction kind=''delete'' branch so approve_correction and admin_delete_entry share one implementation. Locks the entry, writes the prior state to time_entry_revisions, then deletes — in that order, because the revision row is the only surviving record of what the entry was. Returns the row as it was. Raises P0002/entry_not_found for an id that is already gone, before writing anything. Internal: no EXECUTE grant.';

-- ---------------------------------------------------------------------------
-- approve_correction() — body replaced; two branches now delegate
--
-- Identical to 0006's in every observable respect. The ONLY changes:
--   * kind='create'  -> one call to apply_entry_create()
--   * kind='delete'  -> one call to apply_entry_delete()
-- Both helpers do exactly what the inline code did, in the same order. The
-- self-approval block, the auto-withdraw branch, the pending check, the tenancy
-- filter, the entry-belongs-to-requester check, the final status update and —
-- critically — the total absence of any EXCEPTION block (§7.4: partial
-- application must not be expressible) are unchanged.
--
-- v_new_id is gone: the created entry's id now comes back inside the helper's
-- returned row, which the function does not need. The declared locals that
-- remain are the ones the amend branch still uses.
-- ---------------------------------------------------------------------------

create or replace function public.approve_correction(p_request_id uuid)
returns public.correction_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin   uuid := auth.uid();
  v_req     public.correction_requests;
  v_entry   public.time_entries;
  v_started timestamptz;
  v_ended   timestamptz;
  v_project uuid;
  v_task    uuid;
  v_note    text;
begin
  if v_admin is null then
    raise exception 'not authenticated'
      using errcode = '28000', detail = 'not_authenticated';
  end if;

  -- Role and tenancy are independent checks (§4.3). is_admin() is true for an
  -- active admin of SOME company; the company_id filter on the SELECT below is
  -- what makes it this company's.
  if not public.is_admin() then
    raise exception 'only an admin may review correction requests'
      using errcode = '42501', detail = 'not_an_admin';
  end if;

  -- SECURITY DEFINER bypasses RLS, so this WHERE is the tenancy boundary
  -- rather than a convenience. A Company 2 admin passing a Company 1 request
  -- id gets "no such request" — the same answer they would get for an id that
  -- never existed, which is the answer that leaks nothing.
  select *
    into v_req
    from public.correction_requests
   where id = p_request_id
     and company_id = public.current_company_id()
     for update;

  if not found then
    raise exception 'no correction request matches this id'
      using errcode = 'P0002', detail = 'request_not_found';
  end if;

  if v_req.status <> 'pending' then
    raise exception 'this request is already %', v_req.status
      using errcode = '23514', detail = 'request_not_pending';
  end if;

  -- §7.4 [R]: "An admin cannot approve their own correction request —
  -- self-approval makes the whole workflow decorative."
  --
  -- Placed here, before the entry is resolved and before the auto-withdraw
  -- branch, because it is a statement about the CALLER'S STANDING to act on
  -- this request at all — not about what the request would do. Standing should
  -- not depend on whether the target entry still exists. An admin whose own
  -- request is stale withdraws it themselves through the ordinary RLS path,
  -- which is available to every requester regardless of role.
  --
  -- NOTE, since 0010 gives a lone admin direct create and delete paths: this
  -- block is NOT softened by their existence and must never be. The direct
  -- paths are not "self-approval by another name" — they file no request, make
  -- no claim about a second signature, and are attributed as what they are
  -- (a revision row with correction_request_id NULL, changed_by the admin).
  -- Approving one's OWN request would instead record a review that never
  -- happened. §7.4 forbids exactly that, and it still does.
  if v_req.requested_by = v_admin then
    raise exception
      'an admin cannot approve their own correction request — a second admin must review it (SPEC.md §7.4)'
      using errcode = '42501', detail = 'self_approval';
  end if;

  -- -----------------------------------------------------------------------
  -- kind = 'create' (§7.1: "Create an entry dated before today — No ->
  -- correction request"). Nothing to snapshot; the revision row records the
  -- creation with all-NULL priors (0006 note (d)). The shape CHECK guarantees
  -- all four proposed values are present, so there is nothing to coalesce over
  -- and the helper's NULL-window guard cannot fire from here.
  --
  -- The entry belongs to the REQUESTER, not to the approving admin.
  -- -----------------------------------------------------------------------
  if v_req.kind = 'create' then
    perform public.apply_entry_create(
      v_req.requested_by,
      v_req.proposed_project_id,
      v_req.proposed_task_id,
      v_req.proposed_started_at,
      v_req.proposed_ended_at,
      v_req.proposed_note,
      v_admin,
      v_req.id
    );

  -- -----------------------------------------------------------------------
  -- kind = 'amend' / 'delete' — both name an existing entry, and both have to
  -- survive it having gone away.
  -- -----------------------------------------------------------------------
  else
    select *
      into v_entry
      from public.time_entries
     where id = v_req.time_entry_id
       and company_id = v_req.company_id
       for update;

    -- §7.4: "Requests referencing an entry that was since deleted are
    -- auto-marked withdrawn at approval time rather than erroring." A clean
    -- return, not a raise — the transaction commits and the queue item goes
    -- away, which is the whole point of the rule.
    if not found then
      update public.correction_requests
         set status      = 'withdrawn',
             reviewed_by = v_admin,
             reviewed_at = now(),
             review_note = 'The time entry this request refers to no longer exists.'
       where id = v_req.id
      returning * into v_req;

      return v_req;
    end if;

    -- Defensive, and expected to be unreachable: the INSERT policy proves the
    -- entry is the requester's own at submission, and time_entries.user_id is
    -- immutable (0005's guard, outside 0006's carve-out), so an entry cannot
    -- change hands afterwards. Kept because the cost of being wrong about that
    -- is an admin unknowingly rewriting a third party's timesheet.
    if v_entry.user_id <> v_req.requested_by then
      raise exception 'that entry does not belong to the person who requested this change'
        using errcode = '42501', detail = 'entry_not_requesters';
    end if;

    if v_req.kind = 'delete' then
      -- Snapshot then delete, in that order, inside the helper. 0006 note (i)
      -- still holds: a delete correction against a RUNNING entry is left
      -- permitted, because the requester could already discard that row
      -- unilaterally and this way leaves a revision row behind.
      perform public.apply_entry_delete(v_entry.id, v_admin, v_req.id);

    else
      -- kind = 'amend'. NULL proposed value = leave that field alone
      -- (0006 note (a)). Note the consequence: a closed entry cannot be
      -- re-opened by proposing a NULL ended_at, because that is spelled the
      -- same as proposing nothing.
      v_started := coalesce(v_req.proposed_started_at, v_entry.started_at);
      v_ended   := coalesce(v_req.proposed_ended_at,   v_entry.ended_at);
      v_project := coalesce(v_req.proposed_project_id, v_entry.project_id);
      v_task    := coalesce(v_req.proposed_task_id,    v_entry.task_id);
      v_note    := coalesce(v_req.proposed_note,       v_entry.note);

      -- Validates, snapshots, then mutates behind the carve-out.
      perform public.apply_entry_change(
        v_entry.id, v_started, v_ended, v_project, v_task, v_note,
        v_admin, v_req.id
      );
    end if;
  end if;

  update public.correction_requests
     set status      = 'approved',
         reviewed_by = v_admin,
         reviewed_at = now()
   where id = v_req.id
  returning * into v_req;

  return v_req;
end;
$$;

comment on function public.approve_correction(uuid) is
  'SPEC.md §7.3, §7.4. Approves one pending correction in one transaction: validate (re-checking overlap, §6.4 and project membership at APPROVAL time), snapshot the prior state into time_entry_revisions, apply the create/amend/delete, mark the request approved. Refuses self-approval (42501/self_approval). Auto-withdraws and returns cleanly when the referenced entry is gone. No EXCEPTION block anywhere: partial application is not expressible. Since 0010 the three kinds delegate to apply_entry_create / apply_entry_change / apply_entry_delete, shared with the three admin-direct RPCs.';

-- ---------------------------------------------------------------------------
-- admin_delete_entry() — §7.4's direct path for kind='delete'
--
-- The delete counterpart of admin_edit_entry, structured identically: same
-- authentication check, same is_admin() check, same current_company_id()
-- tenancy filter as the ONLY thing standing between a Company 2 admin and a
-- Company 1 timesheet, same P0002 for anything outside it, then one call into
-- the shared helper with correction_request_id NULL.
--
-- CLOSED ENTRIES ONLY — scope decision (1). 0009's deactivated-owner exception
-- is admin_edit_entry's alone and is deliberately NOT mirrored here: closing an
-- orphaned running entry is already possible there, and an entry closed that
-- way is an ordinary closed entry this function then accepts. Two steps, both
-- audited, nothing unreachable.
--
-- No self-approval concept applies: there is no request and no approver. As
-- with admin_edit_entry, the control §7.4 offers for a direct admin action is
-- the revision row — append-only, attributed, timestamped, and unreachable for
-- update or delete by anyone including its author.
-- ---------------------------------------------------------------------------

create function public.admin_delete_entry(p_entry_id uuid)
returns public.time_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_entry public.time_entries;
begin
  if v_admin is null then
    raise exception 'not authenticated'
      using errcode = '28000', detail = 'not_authenticated';
  end if;

  if not public.is_admin() then
    raise exception 'only an admin may delete a recorded entry'
      using errcode = '42501', detail = 'not_an_admin';
  end if;

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

  -- §5.1 / scope decision (1). Checked after the tenancy filter, so a Company 2
  -- admin probing Company 1 ids still learns only "no such entry" and never
  -- which of them are running.
  if v_entry.ended_at is null then
    raise exception
      'that entry''s timer is still running — stop it before deleting it (SPEC.md §5.1)'
      using errcode = '23514', detail = 'entry_still_running';
  end if;

  return public.apply_entry_delete(v_entry.id, v_admin, null);
end;
$$;

comment on function public.admin_delete_entry(uuid) is
  'SPEC.md §7.4''s single-admin direct path for deletion (BLOCKERS.md N-8). An admin deletes a CLOSED entry in their own company outright; the deletion writes a time_entry_revisions row with correction_request_id NULL and the full prior state, which is then the only record that the entry existed (§3.8). Refuses a still-running entry with 23514/entry_still_running and does NOT inherit 0009''s deactivated-owner exception — close such an entry with admin_edit_entry first, then delete it. Returns the row as it was.';

-- ---------------------------------------------------------------------------
-- admin_create_entry() — §7.4's direct path for kind='create'
--
-- The create counterpart. Two tenancy filters instead of one, because a
-- creation names two objects that do not exist yet in any row this function can
-- lock: the OWNER and the PROJECT. Both are checked against
-- current_company_id() before anything is written, and the project check is
-- load-bearing rather than cosmetic — time_entries_10_set_company_id DERIVES
-- company_id from the project, and this function is SECURITY DEFINER, so an
-- unchecked project id from another tenant would be a cross-tenant INSERT that
-- RLS is not present to refuse.
--
-- What is deliberately NOT checked here, because a constraint already is the
-- check (§0.2: constraints belong in the database, not restated in front of
-- it): that the task belongs to the project — time_entries' composite FK
-- (task_id, project_id) -> tasks refuses the pair with 23503.
--
-- NO TODAY-ONLY RULE — scope decision (2). §6.4's future guard, §5.2's overlap
-- and §3.6.1's membership all still apply, inherited whole from the shared
-- helper rather than restated.
-- ---------------------------------------------------------------------------

create function public.admin_create_entry(
  p_user_id    uuid,
  p_project_id uuid,
  p_task_id    uuid,
  p_started_at timestamptz,
  p_ended_at   timestamptz,
  p_note       text default null
)
returns public.time_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin   uuid := auth.uid();
  v_company uuid;
begin
  if v_admin is null then
    raise exception 'not authenticated'
      using errcode = '28000', detail = 'not_authenticated';
  end if;

  if not public.is_admin() then
    raise exception 'only an admin may record time for somebody else'
      using errcode = '42501', detail = 'not_an_admin';
  end if;

  -- NOT NULL for an active admin (is_admin() already required active), read
  -- once so both filters below are demonstrably the same tenant.
  v_company := public.current_company_id();

  -- Tenancy, first half: the owner must be a member of the caller's company.
  -- A cross-tenant user id gets the same answer as one that never existed.
  -- Status is deliberately not filtered — scope decision (6).
  if not exists (
    select 1
      from public.profiles p
     where p.id = p_user_id
       and p.company_id = v_company
  ) then
    raise exception 'no member matches this id'
      using errcode = 'P0002', detail = 'member_not_found';
  end if;

  -- Tenancy, second half, and the one that matters most: see the header. An
  -- archived project is accepted — scope decision (7).
  if not exists (
    select 1
      from public.projects pr
     where pr.id = p_project_id
       and pr.company_id = v_company
  ) then
    raise exception 'no project matches this id'
      using errcode = 'P0002', detail = 'project_not_found';
  end if;

  return public.apply_entry_create(
    p_user_id, p_project_id, p_task_id, p_started_at, p_ended_at, p_note,
    v_admin, null
  );
end;
$$;

comment on function public.admin_create_entry(uuid, uuid, uuid, timestamptz, timestamptz, text) is
  'SPEC.md §7.4''s single-admin direct path for creation (BLOCKERS.md N-8). An admin records a closed, possibly BACKDATED entry for a named member of their own company; the creation writes a time_entry_revisions row with correction_request_id NULL and all prior_* columns NULL (§3.8, 0006 note (d)). No today-only rule (§7.1 governs unsupervised employee entry, not this); §6.4''s future guard, §5.2 overlap and §3.6.1 project membership for the OWNER all still apply. Owner and project are both verified to be in the caller''s company (P0002/member_not_found, P0002/project_not_found) before anything is written. Never starts a timer: p_ended_at is required.';

-- ---------------------------------------------------------------------------
-- Privileges
--
-- Same split 0006 makes: the internal helpers are granted to NOBODY (they are
-- reached only from inside the definer RPCs, where EXECUTE is not re-checked
-- against the original caller), and the two new RPCs go to `authenticated`
-- because PostgREST calls everything as that role. There is no Postgres role
-- corresponding to "admin" — admin-ness is a profiles column — so the role
-- check is INSIDE each function, where it can be combined with the tenancy
-- filter §4.3 requires. `anon` gets nothing.
--
-- No grant anywhere in this file is widened, and no service-role key is used or
-- implied by any path here (§4.4).
-- ---------------------------------------------------------------------------

revoke execute on function public.apply_entry_create(uuid, uuid, uuid, timestamptz, timestamptz, text, uuid, uuid) from public;
revoke execute on function public.apply_entry_delete(uuid, uuid, uuid) from public;

revoke execute on function public.admin_delete_entry(uuid) from public;
revoke execute on function public.admin_create_entry(uuid, uuid, uuid, timestamptz, timestamptz, text) from public;

grant execute on function public.admin_delete_entry(uuid) to authenticated;
grant execute on function public.admin_create_entry(uuid, uuid, uuid, timestamptz, timestamptz, text) to authenticated;
