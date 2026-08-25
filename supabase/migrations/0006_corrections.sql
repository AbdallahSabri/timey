-- 0006_corrections.sql
--
-- Phase 7 — Corrections. Implements SPEC.md §3.8, §3.9, §7.1, §7.2, §7.3,
-- §7.4, plus the §4.2 / §4.3 rows for correction_requests and
-- time_entry_revisions, and the §5.4 stale-timer correction path.
--
-- §7 opens with "this is the heart of the product and the section most likely
-- to be misimplemented", and states the design intent in one sentence: AN
-- EMPLOYEE CANNOT QUIETLY REWRITE THEIR OWN HISTORY. Everything below is that
-- sentence made structural.
--
-- Creates: enums correction_kind and correction_status; tables
-- correction_requests and time_entry_revisions; correction_requests_guard_
-- update() (immutability of a submitted request + the status state machine);
-- three internal helpers (assert_entry_window_valid, record_entry_revision,
-- apply_entry_change) that no client may execute; three client-callable RPCs
-- (approve_correction, reject_correction, admin_edit_entry); and a
-- `create or replace` of time_entries_guard_update() adding the carve-out that
-- 0005's own comment demands. RLS on both new tables per the §4.2 matrix, every
-- policy also filtered by company_id (§4.3).
--
-- BLOCKERS.md B-3 (§7.1.1, §10 item 1) is unanswered and this migration
-- proceeds on the stated default: STRICT ZERO TOLERANCE. There is no
-- correction_grace_minutes column, no grace branch, and no self-service edit of
-- a closed entry's times at any interval. §7.1 as written.
--
-- ---------------------------------------------------------------------------
-- Reversibility
-- ---------------------------------------------------------------------------
--
-- Schema-additive: this migration drops no table, column, constraint, index or
-- policy. Two things are nonetheless NOT purely additive and are named here
-- rather than discovered:
--
--   1. public.time_entries_guard_update() is REPLACED (create or replace, so
--      the trigger keeps pointing at the same oid — the trigger itself is
--      never dropped, which 0005 rules out explicitly). What is lost from the
--      old body: nothing. Every check it made is still made, on the same rows,
--      with the same errcodes. What is added: two of those checks —
--      §7.1's "the times on a closed entry are immutable" and §5.3's "a stop
--      may only write the server's own now()" — are skipped when the
--      transaction-local flag `timey.bypass_entry_guard` is 'on' AND the
--      statement is running as the role that owns the trigger function. The
--      four immutability checks (id, user_id, company_id, created_at) are NOT
--      skippable by anything. See the function for the scoping argument.
--
--   2. Deleting an auth.users row now fails (23503) for two more classes of
--      user, extending 0005's rule from "anyone with time entries" to also
--      cover anyone who has FILED a correction request and anyone who has
--      APPROVED, REJECTED or been recorded as the author of a revision.
--      correction_requests.requested_by / reviewed_by and
--      time_entry_revisions.changed_by are all ON DELETE RESTRICT. An audit
--      trail whose actor column silently empties is not an audit trail. §2.3
--      already rules deletion out of the product (deactivation, not deletion);
--      this makes the audit half of that non-negotiable at the database.
--
-- ---------------------------------------------------------------------------
-- Error contract
-- ---------------------------------------------------------------------------
--
-- Every raise below carries a stable machine-readable token in the exception's
-- DETAIL field, in addition to a standard SQLSTATE. supabase-js surfaces both
-- (`error.code`, `error.details`), so the actions layer can branch without
-- parsing prose, which is what 0005's error table asks for — and it needs the
-- token because several distinct refusals share one honest SQLSTATE (three
-- different things are legitimately 42501 here).
--
-- THE LAST TWO COLUMNS ARE NOT THE SAME THING, and conflating them is the one
-- way to misread this table. `PGRST` is the status PostgREST actually puts on
-- the wire for that SQLSTATE — measured against this stack, not assumed. `API`
-- is what the actions layer should return. Branch on `error.code` +
-- `error.details`, NEVER on the HTTP status: three of the rows below disagree,
-- and the two P0002 rows arrive as a bare 500 that is indistinguishable from a
-- genuine server fault unless the token is read.
--
--   SQLSTATE  DETAIL token             meaning                       PGRST  API
--   --------  -----------------------  ----------------------------  -----  ---
--   28000     not_authenticated        no auth.uid()                  401*  403
--   42501     not_an_admin             caller is not an ACTIVE admin   403  403
--   42501     self_approval            §7.4 — an admin may not
--                                      approve their own request       403  403
--   42501     not_project_member       §3.6.1 — the ENTRY OWNER is
--                                      not a member of the project     403  403
--   42501     entry_not_requesters     the request names an entry
--                                      that is not the requester's     403  403
--   P0002     request_not_found        no such request in the
--                                      caller's company                500  404
--   P0002     entry_not_found          no such entry in the
--                                      caller's company                500  404
--   23514     request_not_pending      §7.4 — approved/rejected/
--                                      withdrawn are terminal          400  400
--   23514     entry_still_running      §5.1 — admin_edit_entry does
--                                      not apply to an entry whose
--                                      timer has not stopped           400  400
--   23514     running_entry_           §5.1 — a correction against a
--             reattribution            RUNNING entry may set only
--                                      ended_at/note, never move or
--                                      backdate it                     400  400
--   23514     review_note_required     §3.9/§7.4 — rejection needs
--                                      a note                          400  400
--   23514     ended_before_started     §3.7                            400  400
--   23514     request_immutable        a submitted request's body
--                                      changed                         400  400
--   23514     status_not_a_transition  illegal status transition       400  400
--   22023     started_in_future        §6.4                            400  400
--   22023     ended_in_future          §6.4 applied to the other end
--                                      of a closed interval — see
--                                      assert_entry_window_valid()     400  400
--   23P01     overlap                  §5.2/§7.4 — HINT carries the
--                                      conflicting entry's id          400  409
--
-- * 28000 is defensive and unreachable through PostgREST: `anon` holds no
--   EXECUTE grant on any of the three RPCs, so an unauthenticated call is
--   refused at the grant (42501/401) before the function body runs. The branch
--   stays because a future non-PostgREST caller would reach it.
--
-- Codes raised by the tables themselves, unchanged from 0005 and reachable
-- through these functions: 23503 (proposed task does not belong to the
-- proposed project; proposed project does not exist — PostgREST 409), 23514
-- (the time_entries CHECK — 400), 23P01 (the exclusion constraint, the
-- backstop behind the friendly overlap check — 400), 23505 (one running timer
-- per user — 409). These carry no DETAIL token: they are constraint
-- violations, so the actions layer keys on `error.code` plus the constraint
-- name PostgREST puts in `error.message`.
--
-- ---------------------------------------------------------------------------
-- Decisions taken here, stated so they are arguable rather than inferred
-- ---------------------------------------------------------------------------
--
-- (a) A NULL `proposed_*` COLUMN MEANS "LEAVE THIS ALONE", never "set it to
--     NULL". A correction is a partial proposal — §3.9 makes every proposed_*
--     column nullable and §5.4's stale-timer flow submits nothing but an end
--     time. approve_correction coalesces each proposed value over the entry's
--     current one. Two consequences, both wanted:
--       * a correction CANNOT re-open a closed entry (ended_at -> NULL is
--         unexpressible), which keeps §7.2's immutability from having a hole
--         shaped like "propose nothing";
--       * a correction cannot CLEAR a note. It does not need to: §7.1 lets the
--         owner edit their own note directly, on closed entries included, with
--         no approval at all. admin_edit_entry inherits the same convention
--         and therefore cannot clear another user's note either — flagged, not
--         hidden. Adding an explicit "clear" needs a new argument, not a
--         reinterpretation of NULL.
--
-- (b) OVERLAP IS PRE-CHECKED WITH A NAMED CONFLICT, AND THE EXCLUSION
--     CONSTRAINT REMAINS THE GUARANTEE. §7.4: "If approval would create an
--     overlap, it fails with a specific message naming the conflicting entry."
--     The raw 23P01 from time_entries_no_overlap_per_user names a constraint
--     and a UTC range in locale-dependent prose — not an API, and not a range
--     anyone recognises. So assert_entry_window_valid() looks the conflict up
--     first and raises 23P01 with the conflicting entry's ID IN THE HINT
--     FIELD, which the actions layer can re-read and format in the company
--     timezone exactly as `describeOverlap` already does for manual entries.
--     The pre-check is a message, not a mechanism: it can lose a race with a
--     concurrent insert, and when it does the constraint refuses the write and
--     the whole transaction rolls back. Correctness never depends on it.
--
-- (c) APPROVAL IS A FUNCTION AND SO IS REJECTION; ONLY WITHDRAWAL IS A PLAIN
--     UPDATE. §4.2's UPDATE cell reads "employee: withdraw own pending. admin:
--     review any". Withdrawal is built literally as an RLS UPDATE — it is one
--     status flip on the caller's own pending row, it is not an elevated
--     operation (§4.4), and RLS states the ownership rule once instead of a
--     definer function restating it (§0.2). Rejection is NOT built as a plain
--     UPDATE, and that is this file's one deviation from the matrix cell,
--     recorded under §11's rule that conflicts amend the spec rather than
--     being coded around:
--       * a plain rejection UPDATE would need GRANT UPDATE on reviewed_by,
--         reviewed_at and review_note. reviewed_at is then client-chosen,
--         which lets an admin backdate a review — the same class of hazard
--         §5.3 refuses for ended_at, and the same fix applies: the server
--         picks the timestamp.
--       * every write to correction_requests other than "submit" and
--         "withdraw" then lands in one auditable place.
--     An admin can never reach status='approved' through a plain UPDATE
--     regardless: the withdraw policy's WITH CHECK pins the new status to
--     'withdrawn', and there is no other UPDATE policy on the table. Approval
--     without the revision snapshot is not merely discouraged, it is
--     unexpressible.
--
-- (d) A `create` CORRECTION ALSO WRITES A REVISION ROW, with every prior_*
--     column NULL. §3.8 describes the log as "written whenever a closed entry
--     changes", and an entry that did not exist has not changed — but the
--     alternative is an entry that materialises in the timesheet with no
--     record of who put it there or why, which is precisely what §7 exists to
--     prevent. All-NULL priors is the honest snapshot of "there was nothing
--     here", and it is also how the created entry is linked back to the
--     request that produced it (correction_requests.time_entry_id stays NULL
--     for kind='create' — it is immutable, and the request records what was
--     asked for, not what came of it).
--
-- (e) `source` ON A CREATED ENTRY IS 'manual'. §3.7 has exactly two values and
--     §5.3 defines them by trust model: 'timer' is a measurement the server
--     took, 'manual' is a human assertion about the past. An approved create
--     correction is the second of those — a deliberate assertion, merely one
--     that an admin countersigned. A third enum value ('correction') would
--     make every existing report filter on source subtly wrong and buys
--     nothing the revision row does not already record.
--
-- (f) THE TODAY-ONLY RULE (§7.1) IS NOT RE-CHECKED AT APPROVAL. It is a
--     creation-time rule about what an employee may assert without oversight;
--     a backdated entry is the whole point of a correction. Overlap (§5.2) and
--     the future guard (§6.4) ARE re-checked, per §7.4's "the world moved
--     while it sat in the queue", along with two more "world moved" cases the
--     spec does not name but that have the same shape: the entry may have been
--     deleted (§7.4 does name this one), and the requester may have been
--     removed from the project they are proposing to move time into (§3.6.1).
--
-- (g) 0005'S CARVE-OUT COVERS ONE MORE CLAUSE THAN ITS COMMENT ANTICIPATED.
--     That comment scopes the Phase 7 problem to closed-row mutation and says
--     the §5.3 stop-value check need not be cleared because "the correction
--     path is a closed-row mutation". §5.4 contradicts that: a stale timer's
--     remedy is explicitly "submit a correction with the real end time", which
--     is a correction against a RUNNING entry and therefore a stop transition
--     with a human-supplied ended_at. Both clauses are inside the carve-out.
--     Recorded as a finding rather than silently widened.
--
-- (h) WHAT A CORRECTION MAY DO TO A RUNNING ENTRY IS EXACTLY WHAT ITS OWNER
--     MAY DO, PLUS THE CHOICE OF ended_at. Note (g) establishes that a
--     correction must be able to reach a running entry at all — §5.4's flow
--     depends on it. It says nothing about WHICH fields it may reach, and the
--     first cut of this file left that unbounded, which made two things
--     reachable that §5.1 forbids in terms with no role qualifier on them:
--     "Never mutate project_id on a running timer — that would silently
--     misattribute already-elapsed minutes", and, by the same argument, a
--     backdated started_at that manufactures minutes nobody worked.
--
--     The line drawn instead is not a new invention, which is the point: on a
--     RUNNING entry the correction path gets the same column surface 0005
--     already grants the entry's own owner — GRANT UPDATE (ended_at, note) —
--     and nothing more. started_at, project_id and task_id are refused
--     (23514/running_entry_reattribution) until the entry closes, at which
--     point every one of them becomes amendable through the ordinary flow.
--     The single capability a correction adds over the owner's own path stays
--     exactly the one §5.4 asks for: the ended_at it writes need not be now().
--
--     Enforced in apply_entry_change(), i.e. AT APPROVAL TIME, not at
--     submission. §7.4 requires approval to re-validate "because the world
--     moved while it sat in the queue", and running-vs-closed is the most
--     literal instance of that there is: an entry running when the request was
--     filed is routinely closed by the time an admin reaches it, and the
--     request must then apply normally. A submission-time CHECK or policy
--     could not know that and would refuse corrections that are perfectly
--     valid by the time they are approved. The reverse transition does not
--     exist — note (a) makes ended_at -> NULL unexpressible — so approval-time
--     is not merely sufficient here, it is the only correct place.
--
-- (i) kind='delete' AGAINST A RUNNING ENTRY IS LEFT ALONE, deliberately. It
--     does not route through apply_entry_change() and is not covered by note
--     (h). It needs no restriction: §5.1 and §7.1 both give the owner an
--     unconditional right to DISCARD their own running entry with a plain
--     DELETE and no approval at all. A delete correction over the same row is
--     therefore strictly weaker than what the requester could already do
--     unilaterally, and it leaves a revision row behind where the discard
--     leaves nothing.

-- ---------------------------------------------------------------------------
-- Enums (§3.9)
-- ---------------------------------------------------------------------------

create type public.correction_kind as enum ('create', 'amend', 'delete');

create type public.correction_status as enum (
  'pending', 'approved', 'rejected', 'withdrawn'
);

comment on type public.correction_kind is
  'SPEC.md §3.9. What an approved request does to time_entries: insert a backdated row, mutate an existing one, or delete one.';
comment on type public.correction_status is
  'SPEC.md §7.4 lifecycle. pending is the only non-terminal state; approved, rejected and withdrawn are all final.';

-- ---------------------------------------------------------------------------
-- correction_requests (§3.9)
-- ---------------------------------------------------------------------------

create table public.correction_requests (
  id uuid not null default gen_random_uuid(),

  -- Derived, never accepted: defaulted from the caller's own tenancy and
  -- absent from the INSERT grant, the treatment 0004/0005 give every
  -- denormalized company_id. The composite FK below is the independent backup.
  company_id uuid not null default public.current_company_id(),

  -- §4.2 INSERT cell: "employee, own". Defaulted to auth.uid() and ungranted,
  -- so a payload naming somebody else is refused on privilege (42501) before
  -- RLS is consulted, and the policy's WITH CHECK is the second lock rather
  -- than the only one.
  requested_by uuid not null default auth.uid(),

  kind public.correction_kind not null,

  -- NO FOREIGN KEY, and this is deliberate rather than forgotten. §7.4 rules
  -- that "requests referencing an entry that was since deleted are auto-marked
  -- withdrawn at approval time" — a sentence that only has meaning if a
  -- dangling reference is REPRESENTABLE. Every FK action available makes it
  -- unrepresentable and each fails differently: RESTRICT would make approving
  -- a kind='delete' request impossible (the request would pin the row it
  -- exists to remove), CASCADE would delete the request and destroy the trail
  -- of why the entry went, SET NULL would keep the request and lose which
  -- entry it was about. Tenancy is checked at INSERT (the RLS policy proves
  -- the entry is the caller's own) and again at approval (the entry is
  -- re-read filtered by the request's company_id).
  time_entry_id uuid,

  proposed_started_at timestamptz,
  proposed_ended_at   timestamptz,
  proposed_project_id uuid,
  proposed_task_id    uuid,
  proposed_note       text,

  -- §3.9: "Required from the employee. Non-negotiable — it's the entire point
  -- of the approval step." NOT NULL plus a non-blank CHECK: a form that sends
  -- "" satisfies NOT NULL and defeats the rule, so the database refuses both.
  reason text not null,

  status public.correction_status not null default 'pending',

  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text,

  created_at timestamptz not null default now(),

  constraint correction_requests_pkey primary key (id),

  -- The FK target time_entry_revisions needs, so a revision can be pinned to
  -- its request AND its tenant in one constraint.
  constraint correction_requests_id_company_id_key unique (id, company_id),

  constraint correction_requests_company_id_fkey
    foreign key (company_id) references public.companies (id)
    on delete cascade,

  -- Composite (§2.2: no cross-company anything). ON DELETE RESTRICT: see the
  -- reversibility note in the header — a request whose author vanished is not
  -- an audit record.
  constraint correction_requests_requested_by_company_id_fkey
    foreign key (requested_by, company_id)
    references public.profiles (id, company_id)
    on delete restrict
    on update cascade,

  -- MATCH SIMPLE (the default): while reviewed_by is NULL the constraint is
  -- satisfied regardless of company_id, which is exactly right for a pending
  -- request.
  constraint correction_requests_reviewed_by_company_id_fkey
    foreign key (reviewed_by, company_id)
    references public.profiles (id, company_id)
    on delete restrict
    on update cascade,

  -- §3.9's non-negotiable, made un-defeatable by an empty string.
  constraint correction_requests_reason_not_blank
    check (btrim(reason) <> ''),

  -- §3.9 / §7.4: "review_note — Required when rejecting."
  constraint correction_requests_review_note_when_rejected
    check (status <> 'rejected' or review_note is not null),

  constraint correction_requests_review_note_not_blank
    check (review_note is null or btrim(review_note) <> ''),

  -- A pending request has not been reviewed. Without this, a client that could
  -- write those columns could pre-load a review onto a request nobody has read
  -- yet; with it, the reviewed_* triple is only ever written by the same
  -- statement that leaves 'pending'.
  constraint correction_requests_pending_is_unreviewed
    check (
      status <> 'pending'
      or (reviewed_by is null and reviewed_at is null and review_note is null)
    ),

  -- ...and a decided one HAS been reviewed, by somebody, at some time.
  -- 'withdrawn' is deliberately outside this: an employee withdrawing their
  -- own request reviews nothing, while approve_correction's §7.4 auto-withdraw
  -- does record who hit approve and when.
  constraint correction_requests_decided_is_reviewed
    check (
      status not in ('approved', 'rejected')
      or (reviewed_by is not null and reviewed_at is not null)
    ),

  -- §3.9's "NULL when kind = 'create'" / "NULL when kind = 'delete'" columns,
  -- read as the shape rules they are rather than as documentation:
  --   create — proposes a whole entry, names no existing one;
  --   amend  — names an entry and proposes at least one change to it. A
  --            request that proposes nothing is not a correction, it is a
  --            queue item nobody can action;
  --   delete — names an entry and proposes nothing. Anything proposed
  --            alongside a deletion would be silently discarded at approval,
  --            which is worse than a refusal at submission.
  constraint correction_requests_shape_by_kind
    check (
      case kind
        when 'create' then
          time_entry_id is null
          and proposed_started_at is not null
          and proposed_ended_at   is not null
          and proposed_project_id is not null
          and proposed_task_id    is not null
        when 'amend' then
          time_entry_id is not null
          and num_nonnulls(
                proposed_started_at, proposed_ended_at,
                proposed_project_id, proposed_task_id, proposed_note
              ) > 0
        when 'delete' then
          time_entry_id is not null
          and num_nonnulls(
                proposed_started_at, proposed_ended_at,
                proposed_project_id, proposed_task_id, proposed_note
              ) = 0
      end
    ),

  -- The submission-time half of time_entries' own CHECK (§3.7). The entry
  -- table would refuse it at approval anyway; refusing it here means the
  -- employee finds out immediately instead of after an admin's round trip.
  constraint correction_requests_proposed_ends_after_starts
    check (
      proposed_started_at is null
      or proposed_ended_at is null
      or proposed_ended_at > proposed_started_at
    ),

  -- §3.5.2: every entry needs a task, and time_entries' composite FK requires
  -- the task to belong to the entry's project. A proposal that moves an entry
  -- to another project without naming a task there is therefore incoherent by
  -- construction — it would fail at approval with a 23503 about a task the
  -- employee never mentioned.
  constraint correction_requests_project_move_names_task
    check (proposed_project_id is null or proposed_task_id is not null)
);

comment on table public.correction_requests is
  'SPEC.md §3.9, §7.4. The employee-visible half of corrections. Submitting is a plain INSERT; withdrawing is a plain UPDATE of status; approving and rejecting are SECURITY DEFINER functions, because approval must mutate time_entries and write a revision in the same transaction (§7.3).';
comment on column public.correction_requests.time_entry_id is
  'The entry this request is about; NULL for kind=''create''. Intentionally NOT a foreign key — §7.4 requires a request that outlives the entry it names, so that approval can auto-withdraw rather than error. See the column comment in the migration.';
comment on column public.correction_requests.reason is
  'SPEC.md §3.9: non-negotiable. NOT NULL and non-blank at the DATABASE, not merely required by a form — it is the justification the whole approval step exists to capture.';
comment on column public.correction_requests.status is
  'SPEC.md §7.4. pending is the only state from which anything may happen; approved, rejected and withdrawn are terminal, enforced by correction_requests_guard_update().';
comment on column public.correction_requests.review_note is
  'Required when rejecting (CHECK). Also carries approve_correction''s explanation when a request is auto-withdrawn because its entry no longer exists (§7.4).';

-- §3.9's stated index: drives the admin queue.
create index correction_requests_company_id_status_created_at_idx
  on public.correction_requests (company_id, status, created_at desc);

-- The employee's "my requests" list (PLAN.md Phase 7 UI). Not named in §3.9,
-- but it is the other of exactly two reads this table has, and an index is a
-- performance decision rather than a data-model one.
create index correction_requests_company_id_requested_by_created_at_idx
  on public.correction_requests (company_id, requested_by, created_at desc);

-- Finding a pending request against a given entry — the check the UI needs to
-- avoid offering "request a correction" twice for the same row.
create index correction_requests_time_entry_id_idx
  on public.correction_requests (time_entry_id)
  where time_entry_id is not null;

-- ---------------------------------------------------------------------------
-- time_entry_revisions (§3.8)
--
-- The append-only trail. §3.8: "No UPDATE or DELETE policy exists on this
-- table for anyone. Insert-only." Built more strictly than that even: there is
-- no INSERT policy or grant either. Not one client-issued statement of any
-- verb can reach this table except SELECT. Its only writer is
-- record_entry_revision(), reached exclusively from inside the two
-- SECURITY DEFINER paths that mutate an entry — so a revision row cannot be
-- forged, and (more importantly) a mutation cannot happen without one, because
-- the same function does both.
-- ---------------------------------------------------------------------------

create table public.time_entry_revisions (
  id uuid not null default gen_random_uuid(),

  company_id uuid not null,

  -- NO FOREIGN KEY, for a sharper reason than correction_requests': an
  -- approved kind='delete' correction DELETES the entry this column names, and
  -- the revision row is the only remaining evidence of what was deleted. A
  -- CASCADE would erase exactly the record §3.11 and §7.3 want kept; a
  -- RESTRICT would make the audited deletion path impossible. The audit log
  -- outliving its subject is the entire design.
  time_entry_id uuid not null,

  -- §3.8: "The admin who approved". profiles, not auth.users — 0003's
  -- invited_by convention, so the audit view renders a name through an
  -- RLS-visible join. RESTRICT rather than 0003's CASCADE: an invitation is
  -- ephemeral, a revision is the record of who changed somebody's timesheet.
  changed_by uuid not null,

  -- NULL for a direct admin edit (§7.4: "If a company has one admin, that
  -- admin edits entries directly ... admin edits also write revision rows").
  correction_request_id uuid,

  -- The snapshot, taken BEFORE the change (§3.8). All NULL when the change was
  -- a creation — see decision (d) in the header. The row's current state lives
  -- on time_entries; §7.3 chose in-place mutation precisely so that no report
  -- query ever has to filter this table.
  prior_started_at timestamptz,
  prior_ended_at   timestamptz,
  prior_project_id uuid,
  prior_task_id    uuid,
  prior_note       text,

  changed_at timestamptz not null default now(),

  constraint time_entry_revisions_pkey primary key (id),

  constraint time_entry_revisions_company_id_fkey
    foreign key (company_id) references public.companies (id)
    on delete cascade,

  constraint time_entry_revisions_changed_by_company_id_fkey
    foreign key (changed_by, company_id)
    references public.profiles (id, company_id)
    on delete restrict
    on update cascade,

  -- Composite, so a revision cannot cite another tenant's request. Requests
  -- are undeletable (no DELETE policy, no DELETE grant), so RESTRICT here
  -- guards a path that has no caller — which is the cheapest kind of guard.
  constraint time_entry_revisions_request_id_company_id_fkey
    foreign key (correction_request_id, company_id)
    references public.correction_requests (id, company_id)
    on delete restrict
    on update cascade
);

comment on table public.time_entry_revisions is
  'SPEC.md §3.8, §7.3. Append-only: no INSERT, UPDATE or DELETE policy or grant exists for any client role. Written only by record_entry_revision(), which is only reachable from approve_correction() and admin_edit_entry(). Rows survive the deletion of the entry they describe, on purpose.';
comment on column public.time_entry_revisions.time_entry_id is
  'The entry as it was identified at the time. Deliberately not a foreign key — an approved delete correction removes the entry and this row is what remains of it.';
comment on column public.time_entry_revisions.correction_request_id is
  'The request that authorised the change, or NULL for a direct admin edit (§7.4).';

-- The entry-history read: "what has been done to this entry, newest first".
create index time_entry_revisions_company_id_entry_id_changed_at_idx
  on public.time_entry_revisions (company_id, time_entry_id, changed_at desc);

-- The request-detail read: "what did approving this request actually do".
create index time_entry_revisions_correction_request_id_idx
  on public.time_entry_revisions (correction_request_id)
  where correction_request_id is not null;

-- ---------------------------------------------------------------------------
-- correction_requests_guard_update()
--
-- The half of §7.4's lifecycle that a policy cannot state, for the same
-- structural reason 0005's guard exists: USING sees OLD, WITH CHECK sees NEW,
-- and "pending is the only state you may leave" is a claim about both at once.
--
-- Two jobs:
--   1. A SUBMITTED REQUEST'S BODY IS IMMUTABLE. Everything an approver reads
--      when deciding — kind, the proposed values, the reason, who asked — is
--      frozen at submission. Without this, an employee could withdraw-and-edit
--      or, worse, alter the proposal between an admin reading the queue and
--      an admin pressing approve. The column grant already withholds these
--      columns from clients; this makes it true of every path, including the
--      SECURITY DEFINER ones in this file, which bypass grants.
--   2. TERMINAL MEANS TERMINAL (§7.4: "A rejected request is terminal. The
--      employee submits a new one"). Applies equally to approved and
--      withdrawn: an approved request cannot be re-approved into a second
--      mutation of the same entry, which is the one that would actually
--      corrupt data.
--
-- Not SECURITY DEFINER: it reads only OLD and NEW.
-- ---------------------------------------------------------------------------

create function public.correction_requests_guard_update()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.id                  is distinct from old.id
     or new.company_id       is distinct from old.company_id
     or new.requested_by     is distinct from old.requested_by
     or new.kind             is distinct from old.kind
     or new.time_entry_id    is distinct from old.time_entry_id
     or new.created_at       is distinct from old.created_at
     or new.proposed_started_at is distinct from old.proposed_started_at
     or new.proposed_ended_at   is distinct from old.proposed_ended_at
     or new.proposed_project_id is distinct from old.proposed_project_id
     or new.proposed_task_id    is distinct from old.proposed_task_id
     or new.proposed_note       is distinct from old.proposed_note
     or new.reason              is distinct from old.reason
  then
    raise exception
      'a submitted correction request is immutable — withdraw it and submit a new one'
      using errcode = '23514', detail = 'request_immutable';
  end if;

  if old.status <> 'pending' then
    raise exception 'this request is already % and cannot change again', old.status
      using errcode = '23514', detail = 'request_not_pending';
  end if;

  if new.status = 'pending' then
    raise exception 'pending is a starting state, not a destination'
      using errcode = '23514', detail = 'status_not_a_transition';
  end if;

  return new;
end;
$$;

comment on function public.correction_requests_guard_update() is
  'SPEC.md §7.4. Freezes a submitted request''s body and enforces the lifecycle: pending -> approved | rejected | withdrawn, once, and never back.';

create trigger correction_requests_20_guard_update
  before update on public.correction_requests
  for each row execute function public.correction_requests_guard_update();

-- ---------------------------------------------------------------------------
-- time_entries_guard_update() — REPLACED, NOT DROPPED
--
-- 0005 ends with an instruction addressed to this migration: the guard "will
-- reject the approve-correction function's own mutation of a closed entry — a
-- SECURITY DEFINER function bypasses RLS and column grants but NOT triggers.
-- The fix is a transaction-local flag the approval function sets and the
-- trigger checks, added via a `create or replace function` in a new migration
-- — never by dropping or weakening the trigger, which is the entire mechanism
-- keeping a closed entry immutable to everyone but that one audited path."
--
-- This is that replacement. `create or replace` keeps the function's oid, so
-- trigger time_entries_20_guard_update keeps pointing at it and is never
-- detached for even one statement. Every check in the 0005 body survives
-- verbatim; two of them gain a guarded carve-out.
--
-- THE CARVE-OUT IS TWO CONDITIONS, NOT ONE, AND THE SECOND IS THE LOAD-BEARING
-- ONE:
--
--   1. `timey.bypass_entry_guard` is 'on'. Set with set_config(..., is_local
--      := true) inside apply_entry_change(), and reset to 'off' by the same
--      function the moment its UPDATE returns. Transaction-local, so an
--      aborted transaction takes it with it.
--
--   2. AND the statement is running as the role that owns THIS FUNCTION.
--      Condition 1 alone is not sufficient, and pretending otherwise would be
--      the security hole in this migration. Verified against this database
--      rather than assumed: any role, including `authenticated`, may call
--      set_config('timey.bypass_entry_guard', 'on', true) — custom GUC
--      placeholders are not privileged. What `authenticated` cannot do is
--      BECOME the owner: a SECURITY DEFINER function is the only construct
--      that changes current_user, and the only ones that do so here are the
--      two in this file, both of which snapshot before they mutate. So a
--      client who found a way to set the flag (there is none exposed —
--      set_config lives in pg_catalog, PostgREST only routes to functions in
--      exposed schemas, and PostgREST's own GUCs are confined to the
--      `request.*` namespace) would still be refused, because their raw
--      UPDATE runs as `authenticated`.
--
--      The owner is read from the catalog rather than hard-coded, so the check
--      cannot drift if this schema is ever restored under a different owning
--      role. The catalog lookup only runs when condition 1 already holds,
--      i.e. never on the timer's hot path.
--
-- WHAT THE CARVE-OUT DOES NOT COVER. The four immutability checks — id,
-- user_id, company_id, created_at — are outside it and unconditional. No flag,
-- no function and no role makes an entry change hands, change tenant, or lie
-- about when it was recorded. A correction rewrites WHAT happened, never WHOSE
-- it was.
--
-- WHY THE §5.3 STOP-VALUE CHECK IS ALSO INSIDE THE CARVE-OUT, where 0005's
-- comment expected only the closed-row check to be: §5.4's stale timer. Its
-- prescribed remedy is "submit a correction with the real end time", which is
-- a correction against a RUNNING entry — an open-to-closed transition carrying
-- a deliberately non-now() ended_at. Leaving that clause outside the carve-out
-- would make the one flow §5.4 actually describes impossible. See header note
-- (g).
-- ---------------------------------------------------------------------------

create or replace function public.time_entries_guard_update()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_bypass boolean := false;
begin
  -- Condition 1, then condition 2. Written as nested ifs rather than one
  -- `and`, because SQL does not promise left-to-right short-circuiting and the
  -- catalog lookup should not run on every timer stop.
  if coalesce(current_setting('timey.bypass_entry_guard', true), 'off') = 'on'
  then
    select exists (
      select 1
        from pg_catalog.pg_proc p
        join pg_catalog.pg_roles r on r.oid = p.proowner
       where p.oid = 'public.time_entries_guard_update()'::regprocedure
         and r.rolname = current_user
    )
    into v_bypass;
  end if;

  -- ---- Unconditional. Not reachable by the carve-out. --------------------
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

  -- ---- §7.1 / §7.2: the times on a closed entry are immutable ------------
  -- Unchanged from 0005 except for the `not v_bypass` term. This is the one
  -- thing standing between GRANT UPDATE (ended_at, note) and a licence to
  -- rewrite closed history, so read the carve-out above before touching it.
  if not v_bypass
     and old.ended_at is not null
     and new.ended_at is distinct from old.ended_at then
    raise exception
      'the times on a closed entry change only through a correction request (SPEC.md §7.1)'
      using errcode = '42501';
  end if;

  -- ---- §5.3: the server chooses the ended_at a stop writes ---------------
  -- Also carved out, for §5.4's stale-timer correction — see the header.
  -- Outside a correction this is still absolute: a raw PATCH naming its own
  -- ended_at is refused exactly as it was before this migration.
  if not v_bypass
     and old.ended_at is null
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
  'SPEC.md §7.1/§7.2/§5.3, with the §7.3 carve-out added in 0006. The owner may stop a running entry and edit the note on any of their own entries, but may never change the times on a closed one and may never choose the ended_at a stop writes. Both of those two rules — and ONLY those two — are skipped when timey.bypass_entry_guard is ''on'' AND the statement runs as this function''s owner, which is reachable only from inside apply_entry_change(). The id/user_id/company_id/created_at immutability checks are not skippable by anything.';

-- ---------------------------------------------------------------------------
-- assert_entry_window_valid() — §7.4's re-validation, §5.2, §6.4
--
-- The checks that must hold for any (user, window) an entry is about to
-- occupy, whether that entry is being created, amended or edited by an admin.
-- Raises or returns nothing; it never repairs a value.
--
-- SECURITY INVOKER on purpose, and it is not an oversight that a function
-- reading other users' rows is not a definer. It is only ever called from
-- inside the definer functions below, so it inherits their privileges and
-- reads past RLS there. If its EXECUTE grant ever leaked, a caller would get
-- exactly the same answers RLS already gives them and no privileged read at
-- all. Nothing is granted regardless.
-- ---------------------------------------------------------------------------

create function public.assert_entry_window_valid(
  p_user_id          uuid,
  p_exclude_entry_id uuid,
  p_started_at       timestamptz,
  p_ended_at         timestamptz
)
returns void
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_conflict public.time_entries;
begin
  -- §3.7's CHECK, restated so the failure names the problem instead of a
  -- constraint. The CHECK is still the enforcement.
  if p_ended_at is not null and p_ended_at <= p_started_at then
    raise exception 'an entry has to end after it starts'
      using errcode = '23514', detail = 'ended_before_started';
  end if;

  -- §6.4, re-evaluated at approval time per §7.4. The five-minute grace is
  -- §6.4's, absorbing clock drift; it is not a policy of this function.
  if p_started_at > now() + interval '5 minutes' then
    raise exception 'you cannot log time that has not happened yet'
      using errcode = '22023', detail = 'started_in_future';
  end if;

  -- §6.4 names started_at only, and for a manual entry §7.1's today-only rule
  -- incidentally caps the other end. Corrections are backdated by definition,
  -- so today-only does not apply here and nothing else would stop an approved
  -- correction from recording work that ends next year. Applying the same
  -- five-minute rule to the closing instant is the honest reading of §6.4's
  -- own heading ("No future entries"), and it can refuse nothing legitimate:
  -- an interval that has ENDED ended in the past. Flagged in the phase report
  -- as an extension beyond §6.4's literal sentence; deleting this one branch
  -- reverts it.
  if p_ended_at is not null and p_ended_at > now() + interval '5 minutes' then
    raise exception 'you cannot log time that has not happened yet'
      using errcode = '22023', detail = 'ended_in_future';
  end if;

  -- §5.2 / §7.4. Only closed windows can overlap; a still-running entry is
  -- constrained by time_entries_one_running_per_user instead, which the table
  -- enforces on its own. The predicate is the exclusion constraint's own,
  -- restated as a filter: half-open [) ranges overlap iff
  -- a.started < b.ended and a.ended > b.started — so back-to-back entries
  -- touching at one instant are not conflicts here either.
  if p_ended_at is not null then
    select *
      into v_conflict
      from public.time_entries
     where user_id = p_user_id
       and (p_exclude_entry_id is null or id <> p_exclude_entry_id)
       and ended_at is not null
       and started_at < p_ended_at
       and ended_at   > p_started_at
     order by started_at
     limit 1;

    if found then
      -- §7.4: "it fails with a specific message naming the conflicting entry.
      -- The admin resolves it; the system does not pick a winner." The
      -- timestamps below render in the server's zone (UTC); the HINT carries
      -- the conflicting entry's id so the actions layer can re-read it and
      -- format the range in the COMPANY timezone, which is the only rendering
      -- anybody recognises (§6.1).
      raise exception 'this overlaps an entry from % to %',
        v_conflict.started_at, v_conflict.ended_at
        using errcode = '23P01',
              detail  = 'overlap',
              hint    = v_conflict.id::text;
    end if;
  end if;
end;
$$;

comment on function public.assert_entry_window_valid(uuid, uuid, timestamptz, timestamptz) is
  'SPEC.md §7.4''s re-validation: §3.7 ordering, §6.4''s future guard, and §5.2 overlap with the conflicting entry named (its id is in the exception HINT). Advisory for the overlap — time_entries_no_overlap_per_user is the guarantee. Internal: no EXECUTE grant.';

-- ---------------------------------------------------------------------------
-- assert_project_membership() — §3.6.1 at approval time
--
-- "An admin logging time to a project still needs a membership row —
-- assignment governs time entry, role governs visibility." is_project_member()
-- answers this for auth.uid(); a correction is about the ENTRY OWNER, who is
-- not the caller, so it cannot be reused.
--
-- Called only when the project is CHANGING, and this restraint matters: an
-- employee unassigned from a project last month must still be able to have the
-- times on their old entries corrected. Re-checking membership on an unchanged
-- project would refuse that, which no section of the spec asks for.
-- ---------------------------------------------------------------------------

create function public.assert_project_membership(
  p_user_id    uuid,
  p_project_id uuid
)
returns void
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1
      from public.project_members
     where project_id = p_project_id
       and user_id    = p_user_id
  ) then
    raise exception
      'the entry belongs to somebody who is not a member of that project (SPEC.md §3.6.1)'
      using errcode = '42501', detail = 'not_project_member';
  end if;
end;
$$;

comment on function public.assert_project_membership(uuid, uuid) is
  'SPEC.md §3.6.1 for a user who is not the caller. Used by the correction paths when a proposal moves an entry to a different project. Internal: no EXECUTE grant.';

-- ---------------------------------------------------------------------------
-- record_entry_revision() — the only writer of time_entry_revisions
--
-- One function, so the audit table's column list exists in exactly one place.
-- Four call sites would otherwise be four chances to forget prior_note and
-- lose it silently — a missing column in an audit row is invisible until the
-- day somebody needs it.
--
-- SECURITY INVOKER, deliberately, and this is a safety property rather than an
-- omission: reached from inside a definer function it inserts as the owner and
-- succeeds; called by any client (were EXECUTE ever granted, which it is not)
-- it would run as `authenticated`, where the table has no INSERT grant and an
-- INSERT policy of `with check (false)`. It cannot be turned into a forgery
-- tool by a grant alone.
-- ---------------------------------------------------------------------------

create function public.record_entry_revision(
  p_company_id       uuid,
  p_time_entry_id    uuid,
  p_changed_by       uuid,
  p_request_id       uuid,
  p_prior_started_at timestamptz,
  p_prior_ended_at   timestamptz,
  p_prior_project_id uuid,
  p_prior_task_id    uuid,
  p_prior_note       text
)
returns void
language sql
set search_path = pg_catalog, public
as $$
  insert into public.time_entry_revisions (
    company_id, time_entry_id, changed_by, correction_request_id,
    prior_started_at, prior_ended_at, prior_project_id, prior_task_id,
    prior_note
  )
  values (
    p_company_id, p_time_entry_id, p_changed_by, p_request_id,
    p_prior_started_at, p_prior_ended_at, p_prior_project_id, p_prior_task_id,
    p_prior_note
  );
$$;

comment on function public.record_entry_revision(uuid, uuid, uuid, uuid, timestamptz, timestamptz, uuid, uuid, text) is
  'SPEC.md §3.8. The single insert path into time_entry_revisions. Internal: no EXECUTE grant, and SECURITY INVOKER so that even a leaked grant would hit the table''s with-check-false INSERT policy.';

-- ---------------------------------------------------------------------------
-- apply_entry_change() — snapshot, then mutate, and never one without the
-- other
--
-- §7.3: "Approve -> apply changes directly to time_entries, AFTER inserting
-- the prior state into time_entry_revisions." Both callers (approve_correction
-- for kind='amend', and admin_edit_entry) route through here, so the ordering
-- is a property of the code path rather than a rule two functions have to
-- remember. There is no other function in this schema that can change a closed
-- entry's times at all.
--
-- Effective values are computed by the CALLER and passed whole. This function
-- does not know about the NULL-means-unchanged convention; it receives final
-- values, which keeps the convention stated in exactly one place per caller
-- and keeps this function's UPDATE unconditional and readable.
--
-- The flag is set immediately before the UPDATE and cleared immediately after.
-- set_config(..., true) is transaction-local, and verified against this
-- database: it persists to the end of the TRANSACTION, not the end of the
-- FUNCTION (a function-level SET clause would scope it automatically, but
-- Postgres 17 refuses `set "timey.bypass_entry_guard"` in a CREATE FUNCTION
-- clause for a non-superuser owner). Hence the explicit reset. If the UPDATE
-- raises, the reset is skipped — and irrelevant, because the exception aborts
-- the transaction and GUC settings roll back with it.
--
-- SECURITY INVOKER: same argument as record_entry_revision(). Called by a
-- client it would run as `authenticated`, where the flag check in the guard
-- trigger fails on the owner condition and the UPDATE fails on the column
-- grant besides.
-- ---------------------------------------------------------------------------

create function public.apply_entry_change(
  p_entry_id   uuid,
  p_started_at timestamptz,
  p_ended_at   timestamptz,
  p_project_id uuid,
  p_task_id    uuid,
  p_note       text,
  p_changed_by uuid,
  p_request_id uuid
)
returns public.time_entries
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_old public.time_entries;
  v_new public.time_entries;
begin
  select *
    into v_old
    from public.time_entries
   where id = p_entry_id
     for update;

  if not found then
    raise exception 'that time entry no longer exists'
      using errcode = 'P0002', detail = 'entry_not_found';
  end if;

  -- §5.1, on a row that is STILL BEING MEASURED. Header note (h).
  --
  -- A running entry accepts exactly the two columns 0005 grants its own owner
  -- — ended_at and note — from this path as well. The three refused here are
  -- refused because §5.1 refuses them in terms that carry no role qualifier:
  -- moving project_id "would silently misattribute already-elapsed minutes",
  -- and a backdated started_at manufactures minutes nobody worked. task_id
  -- travels with project_id for the same reason at finer grain.
  --
  -- Placed BEFORE record_entry_revision so a refusal writes no audit row: the
  -- log records changes that happened, and nothing happened here.
  --
  -- This is the whole of the restriction. It does not fire once the entry is
  -- closed, and it never fires on a correction that only supplies an ended_at
  -- — which is §5.4's stale-timer remedy and must keep working (note (g)).
  if v_old.ended_at is null then
    if p_started_at is distinct from v_old.started_at then
      raise exception
        'a running entry''s start time cannot be changed while it is still running (SPEC.md §5.1)'
        using errcode = '23514', detail = 'running_entry_reattribution';
    end if;

    if p_project_id is distinct from v_old.project_id
       or p_task_id is distinct from v_old.task_id then
      raise exception
        'a running entry cannot be moved to another project or task — stop it and start a new one (SPEC.md §5.1)'
        using errcode = '23514', detail = 'running_entry_reattribution';
    end if;
  end if;

  -- §3.6.1, only when the project actually moves. See
  -- assert_project_membership().
  if p_project_id is distinct from v_old.project_id then
    perform public.assert_project_membership(v_old.user_id, p_project_id);
  end if;

  -- §7.4's re-validation. The entry excludes itself from the overlap search,
  -- or every amend would collide with the row it is amending.
  perform public.assert_entry_window_valid(
    v_old.user_id, v_old.id, p_started_at, p_ended_at
  );

  -- §7.3: snapshot BEFORE the mutation. Written even when the effective values
  -- turn out identical to the current ones — "an admin applied this at 14:02"
  -- is a fact worth keeping, and deciding what counts as a real change is a
  -- judgement the audit log should not be making.
  perform public.record_entry_revision(
    v_old.company_id, v_old.id, p_changed_by, p_request_id,
    v_old.started_at, v_old.ended_at, v_old.project_id, v_old.task_id,
    v_old.note
  );

  perform set_config('timey.bypass_entry_guard', 'on', true);

  update public.time_entries
     set started_at = p_started_at,
         ended_at   = p_ended_at,
         project_id = p_project_id,
         task_id    = p_task_id,
         note       = p_note
   where id = v_old.id
  returning * into v_new;

  perform set_config('timey.bypass_entry_guard', 'off', true);

  return v_new;
end;
$$;

comment on function public.apply_entry_change(uuid, timestamptz, timestamptz, uuid, uuid, text, uuid, uuid) is
  'SPEC.md §7.3. The only path that mutates a closed time entry: validates (§7.4), writes the prior state to time_entry_revisions, then updates behind the guard-trigger carve-out. Snapshot and mutation are one function so neither can happen without the other. On a RUNNING entry it accepts only ended_at and note (§5.1, §5.4) and refuses any change to started_at/project_id/task_id with 23514/running_entry_reattribution, before writing any revision row. Internal: no EXECUTE grant.';

-- ---------------------------------------------------------------------------
-- approve_correction() — §7.3, §7.4. The core of this phase.
--
-- One transaction: validate -> snapshot -> mutate/insert/delete -> mark
-- approved. "Partial application is not possible" (§7.4), and the mechanism is
-- the absence of machinery rather than the presence of it: there is NO
-- EXCEPTION block anywhere below. A BEGIN...EXCEPTION would open a
-- subtransaction and make partial state expressible; without one, every raise
-- — including one from a constraint, a trigger, or a helper — aborts the
-- caller's transaction whole. The same argument 0003's accept_invitation()
-- makes, for a function with more to lose.
--
-- The auto-withdraw branch (§7.4) is therefore an `if not found`, not an
-- exception handler: it is a normal outcome that COMMITS, which is exactly
-- what "auto-marked withdrawn rather than erroring" asks for.
--
-- Locking order: the request first, then the entry. admin_edit_entry() takes
-- only the entry lock, so no cycle exists between the two functions.
--
-- Returns the request row in its final state, so the caller can tell an
-- approval from an auto-withdrawal without a second read. Every path either
-- returns a real row or raises, so the all-NULL composite hazard 0005
-- documents for stop_timer() cannot arise here.
-- ---------------------------------------------------------------------------

create function public.approve_correction(p_request_id uuid)
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
  v_new_id  uuid;
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
  -- Enforced here rather than in a policy because RLS cannot reach this path:
  -- approval is a definer function precisely because it must write two tables
  -- and delete from a third. A policy would guard a door this function does
  -- not use. There is no second entrance — no plain UPDATE can set
  -- status='approved' (the only UPDATE policy pins the new status to
  -- 'withdrawn'), and no client can execute apply_entry_change().
  if v_req.requested_by = v_admin then
    raise exception
      'an admin cannot approve their own correction request — a second admin must review it (SPEC.md §7.4)'
      using errcode = '42501', detail = 'self_approval';
  end if;

  -- -----------------------------------------------------------------------
  -- kind = 'create' (§7.1: "Create an entry dated before today — No ->
  -- correction request"). Nothing to snapshot; the revision row records the
  -- creation with all-NULL priors. See header note (d).
  -- -----------------------------------------------------------------------
  if v_req.kind = 'create' then
    -- The shape CHECK guarantees all four proposed values are present, so
    -- there is nothing to coalesce over.
    perform public.assert_project_membership(
      v_req.requested_by, v_req.proposed_project_id
    );

    perform public.assert_entry_window_valid(
      v_req.requested_by, null,
      v_req.proposed_started_at, v_req.proposed_ended_at
    );

    -- user_id is named explicitly: the entry belongs to the REQUESTER, not to
    -- the approving admin, and the column's default (auth.uid()) would
    -- silently produce the second. company_id is left to
    -- time_entries_10_set_company_id, which derives it from the project.
    -- source is 'manual' — header note (e).
    insert into public.time_entries (
      user_id, project_id, task_id, started_at, ended_at, source, note
    )
    values (
      v_req.requested_by, v_req.proposed_project_id, v_req.proposed_task_id,
      v_req.proposed_started_at, v_req.proposed_ended_at, 'manual',
      v_req.proposed_note
    )
    returning id into v_new_id;

    perform public.record_entry_revision(
      v_req.company_id, v_new_id, v_admin, v_req.id,
      null, null, null, null, null
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
    -- immutable (0005's guard, outside this migration's carve-out), so an
    -- entry cannot change hands afterwards. Kept because the cost of being
    -- wrong about that is an admin unknowingly rewriting a third party's
    -- timesheet.
    if v_entry.user_id <> v_req.requested_by then
      raise exception 'that entry does not belong to the person who requested this change'
        using errcode = '42501', detail = 'entry_not_requesters';
    end if;

    if v_req.kind = 'delete' then
      -- §3.11's "hard delete for nothing, except through an audited path".
      -- The revision row is written FIRST and is the only remaining record of
      -- what the entry was — which is why time_entry_revisions.time_entry_id
      -- carries no foreign key.
      perform public.record_entry_revision(
        v_entry.company_id, v_entry.id, v_admin, v_req.id,
        v_entry.started_at, v_entry.ended_at, v_entry.project_id,
        v_entry.task_id, v_entry.note
      );

      -- No guard-trigger flag needed: time_entries_20_guard_update is BEFORE
      -- UPDATE only, and the DELETE policy that limits clients to running
      -- entries does not apply to a definer context.
      delete from public.time_entries where id = v_entry.id;

    else
      -- kind = 'amend'. NULL proposed value = leave that field alone
      -- (header note (a)). Note the consequence: a closed entry cannot be
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
  'SPEC.md §7.3, §7.4. Approves one pending correction in one transaction: validate (re-checking overlap, §6.4 and project membership at APPROVAL time), snapshot the prior state into time_entry_revisions, apply the create/amend/delete, mark the request approved. Refuses self-approval (42501/self_approval). Auto-withdraws and returns cleanly when the referenced entry is gone. No EXCEPTION block anywhere: partial application is not expressible.';

-- ---------------------------------------------------------------------------
-- reject_correction() — §7.4's other terminal decision
--
-- A function rather than a plain UPDATE; see header note (c). Rejection needs
-- none of approval's machinery, but it does need reviewed_at to be the
-- server's clock rather than the client's, and it keeps every admin decision
-- on this table in one auditable place.
--
-- Self-rejection is ALLOWED, where self-approval is not, and the asymmetry is
-- deliberate: §7.4 forbids exactly one thing, approving your own request.
-- Rejecting your own is strictly weaker than withdrawing it — which every
-- requester may already do — and it produces a more informative record (a
-- reason, in review_note) than a bare withdrawal.
-- ---------------------------------------------------------------------------

create function public.reject_correction(
  p_request_id  uuid,
  p_review_note text
)
returns public.correction_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_req   public.correction_requests;
begin
  if v_admin is null then
    raise exception 'not authenticated'
      using errcode = '28000', detail = 'not_authenticated';
  end if;

  if not public.is_admin() then
    raise exception 'only an admin may review correction requests'
      using errcode = '42501', detail = 'not_an_admin';
  end if;

  -- §3.9 / §7.4: a rejection without a note is not a rejection, it is a
  -- refusal with no trail. The table CHECK refuses NULL; this refuses the
  -- whitespace that would satisfy it.
  if p_review_note is null or btrim(p_review_note) = '' then
    raise exception 'rejecting a correction requires a note explaining why'
      using errcode = '23514', detail = 'review_note_required';
  end if;

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

  update public.correction_requests
     set status      = 'rejected',
         reviewed_by = v_admin,
         reviewed_at = now(),
         review_note = btrim(p_review_note)
   where id = v_req.id
  returning * into v_req;

  return v_req;
end;
$$;

comment on function public.reject_correction(uuid, text) is
  'SPEC.md §7.4. Rejects one pending correction with a mandatory note. Terminal: correction_requests_guard_update() refuses any later transition. reviewed_at is the server''s clock, which is why this is a function and not a granted UPDATE.';

-- ---------------------------------------------------------------------------
-- admin_edit_entry() — §7.4's single-admin path
--
-- "If a company has one admin, that admin edits entries directly (admin edits
-- also write revision rows) rather than routing through a request."
--
-- This is that path, and PLAN.md flags it as "easy to forget and leaves an
-- audit gap if missed". It shares everything with approval except the request:
-- same validation, same snapshot, same carve-out, correction_request_id NULL
-- on the revision row (§3.8 allows exactly that).
--
-- What it deliberately does NOT do:
--   * no self-approval check — there is no request and no approver, so §7.4's
--     rule has nothing to bite on. The consequence is real and is the spec's
--     own resolution rather than this migration's: an admin can rewrite their
--     OWN closed entries without a second signature. §7.4 sanctions it in the
--     same sentence that forbids self-approval, and the control it offers is
--     the revision row, not a reviewer. Every such edit is attributed and
--     timestamped in an append-only table the editor cannot alter or delete.
--   * no DELETE. §7.4 describes direct EDITS only. Deleting an entry outright
--     stays behind an approved kind='delete' correction, which means a
--     single-admin company genuinely cannot delete a closed entry — flagged in
--     the phase report rather than papered over with an invented function.
--   * no re-validation FRAMING — but every re-validation. There was no queue
--     delay, yet the checks are identical, because they are properties of the
--     resulting entry rather than of the workflow that produced it.
--   * no RUNNING entries. CLOSED ENTRIES ONLY, and this is the one place in
--     this file where a restriction is stricter than what the surrounding
--     machinery would allow, so it is worth stating why rather than just
--     coding it.
--
--     An earlier cut of this function had no such restriction and flagged the
--     consequence as an open "§7.4-vs-§5.1 question for the spec". It is
--     answered here in §5.1's favour, because §5.1 is the section that
--     actually speaks to it and it speaks without a role qualifier: "Never
--     mutate project_id on a running timer — that would silently misattribute
--     already-elapsed minutes." Verified against this database before the fix:
--     an admin could move a 19-hour running timer to another project AND
--     backdate its started_at in one call, and the entry stayed running
--     throughout. §7.2 frames the whole of this file as being about entries
--     that are "once closed ... immutable to the employee"; a running row is
--     not closed-and-immutable, it is still being measured, and the timer's
--     own owner-scoped path (0005's column grant plus the guard trigger) is
--     what governs it.
--
--     WHAT THIS COSTS, stated rather than discovered: an admin can no longer
--     close somebody's stale timer for them in one call. §5.4 does not ask
--     them to — the remedy it describes is the employee's ("stop now, or
--     submit a correction with the real end time") and the admin's role in it
--     is an exception QUEUE, which is a read. The admin-side path is not
--     removed either, only made two steps: stop_timer() closes the row at the
--     true current moment, and this function then corrects that stop time on
--     what is now a closed entry. Every actor keeps a working route, including
--     the sole admin of a single-admin company fixing their own stale timer,
--     who cannot self-approve a request and therefore has only this one.
--
--     The correction path is NOT restricted the same way — it may still reach
--     a running entry, because §5.4 requires it to. What it may DO there is
--     bounded instead; see header note (h) and apply_entry_change().
--
-- NULL argument = leave that field alone, matching the proposed_* convention
-- (header note (a)), which also means an admin cannot clear another user's
-- note through this function.
-- ---------------------------------------------------------------------------

create function public.admin_edit_entry(
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
  v_admin uuid := auth.uid();
  v_entry public.time_entries;
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
  -- Company 1 timesheet.
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

  -- §5.1 / §7.2. Closed entries only — see the block comment above for the
  -- argument and for what it costs. Checked after the tenancy filter, so a
  -- Company 2 admin probing Company 1 ids still learns only "no such entry"
  -- and never which of them are running.
  --
  -- Raised here rather than left to apply_entry_change()'s narrower check
  -- (header note (h)): this function has no legitimate business with a running
  -- row at all, and refusing the whole call is a clearer contract than
  -- accepting one that silently turns out to be a note-only edit.
  if v_entry.ended_at is null then
    raise exception
      'that entry''s timer is still running — stop it before editing it (SPEC.md §5.1)'
      using errcode = '23514', detail = 'entry_still_running';
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
  'SPEC.md §7.4''s single-admin path: an admin edits a CLOSED entry in their own company directly, and the edit writes a time_entry_revisions row with correction_request_id NULL. NULL argument means "leave unchanged". Same validation and same audit trail as an approved correction; no deletion path. Refuses a still-running entry outright (23514/entry_still_running) per §5.1 — stop it with stop_timer() first, then correct the stop time here.';

-- ---------------------------------------------------------------------------
-- Privileges
--
-- RLS decides which rows; these grants decide which verbs and which columns.
--
-- correction_requests INSERT names the request BODY and nothing else:
-- company_id, requested_by and status are all defaulted and ungranted, so the
-- correct payload never mentions them and a payload that does is refused on
-- privilege (42501) before RLS is consulted. reviewed_by / reviewed_at /
-- review_note are ungranted for any verb — a review is written by a function
-- or not at all.
--
-- correction_requests UPDATE names ONLY status, which is what makes §4.2's
-- "employee: withdraw own pending" the only client-issued update this table
-- has. Combined with the withdraw policy's WITH CHECK (status = 'withdrawn')
-- and correction_requests_guard_update(), the reachable set of client updates
-- is exactly one transition.
--
-- time_entry_revisions gets SELECT and nothing else. Not INSERT: §3.8 is
-- insert-only for the SYSTEM, not for clients.
--
-- The three internal helpers are granted to nobody. They are reached only from
-- inside the definer functions below, where EXECUTE is not re-checked against
-- the original caller.
-- ---------------------------------------------------------------------------

revoke all on public.correction_requests   from anon, authenticated;
revoke all on public.time_entry_revisions  from anon, authenticated;

grant select on public.correction_requests to authenticated;

grant insert (
  kind, time_entry_id,
  proposed_started_at, proposed_ended_at,
  proposed_project_id, proposed_task_id, proposed_note,
  reason
) on public.correction_requests to authenticated;

grant update (status) on public.correction_requests to authenticated;

grant select on public.time_entry_revisions to authenticated;

-- Trigger and internal functions: no client role may call any of these
-- directly. The guard functions are reached as triggers (trigger execution
-- does not check EXECUTE against the invoker); the helpers are reached from
-- inside the definer RPCs.
revoke execute on function public.correction_requests_guard_update() from public;
revoke execute on function public.assert_entry_window_valid(uuid, uuid, timestamptz, timestamptz) from public;
revoke execute on function public.assert_project_membership(uuid, uuid) from public;
revoke execute on function public.record_entry_revision(uuid, uuid, uuid, uuid, timestamptz, timestamptz, uuid, uuid, text) from public;
revoke execute on function public.apply_entry_change(uuid, timestamptz, timestamptz, uuid, uuid, text, uuid, uuid) from public;

-- The three RPCs. EXECUTE goes to `authenticated` because PostgREST calls
-- everything as that role — there is no Postgres role corresponding to "admin"
-- in this schema, since admin-ness is a profiles column, not role membership.
-- The role check is therefore INSIDE each function (is_admin(), raising
-- 42501/not_an_admin), which is also where it can be combined with the tenancy
-- filter §4.3 requires. anon gets nothing: none of these mean anything without
-- a profile.
revoke execute on function public.approve_correction(uuid)   from public;
revoke execute on function public.reject_correction(uuid, text) from public;
revoke execute on function public.admin_edit_entry(uuid, timestamptz, timestamptz, uuid, uuid, text) from public;

grant execute on function public.approve_correction(uuid)   to authenticated;
grant execute on function public.reject_correction(uuid, text) to authenticated;
grant execute on function public.admin_edit_entry(uuid, timestamptz, timestamptz, uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS (§4.2 matrix, §4.3 tenancy filter)
--
-- Every policy is `to authenticated` and every policy filters on
-- company_id = current_company_id(), including the ones that already check
-- role or ownership. §9.0's `(select ...)` form is used for the row-
-- independent helpers so the planner hoists them into an InitPlan.
-- ---------------------------------------------------------------------------

alter table public.correction_requests  enable row level security;
alter table public.time_entry_revisions enable row level security;

-- correction_requests SELECT ------------------------------------------------
-- §4.2: "admin: all. employee: own." Both branches sit inside the company
-- filter, so this narrows tenancy and never widens it.

create policy correction_requests_select_own_or_admin
  on public.correction_requests for select to authenticated
  using (
    company_id = (select public.current_company_id())
    and (
      requested_by = (select auth.uid())
      or (select public.is_admin())
    )
  );

-- correction_requests INSERT ------------------------------------------------
-- §4.2: "employee, own". Role-agnostic on purpose: an admin is also somebody
-- with a timesheet, and §7.4's self-approval rule presupposes that an admin
-- can be a requester.
--
-- The third term is the one this policy exists for. time_entry_id carries no
-- foreign key (see the column comment), so nothing structural stops a request
-- from naming a COLLEAGUE'S entry — and an admin approving it would then
-- rewrite that colleague's timesheet, which §7.1's "touch another user's
-- entry: never" forbids outright. The EXISTS closes it at submission, and it
-- is doubly scoped: the subquery runs as the caller, so time_entries' own
-- SELECT policy applies, and `user_id = auth.uid()` pins it even for an admin,
-- to whom that policy is company-wide.
--
-- Nothing here needs to say status = 'pending' or reviewed_by IS NULL: those
-- columns carry no INSERT grant, so the defaults are the only reachable
-- values.

create policy correction_requests_insert_own
  on public.correction_requests for insert to authenticated
  with check (
    company_id = (select public.current_company_id())
    and requested_by = (select auth.uid())
    and (
      time_entry_id is null
      or exists (
        select 1
          from public.time_entries te
         where te.id = time_entry_id
           and te.user_id = (select auth.uid())
           and te.company_id = (select public.current_company_id())
      )
    )
  );

-- correction_requests UPDATE ------------------------------------------------
-- §4.2's cell reads "employee: withdraw own pending. admin: review any." Only
-- the first half is a policy; the second is reject_correction() /
-- approve_correction(). See header note (c) for why, and for the record that
-- this is a deliberate deviation from the matrix rather than an omission.
--
-- This is the whole of the client-reachable write surface after submission,
-- and it is expressible as a policy — unlike time_entries' update rule —
-- because BOTH sides of the transition are constants: USING pins the old
-- status to 'pending', WITH CHECK pins the new one to 'withdrawn'. Nothing
-- here has to compare OLD to NEW.
--
-- Consequences worth stating: no client-issued UPDATE can set status to
-- 'approved' or 'rejected' from any role, an admin cannot withdraw somebody
-- else's request, and nobody can withdraw a request that has already been
-- decided. The reviewed_* columns are additionally unreachable because they
-- carry no UPDATE grant, and the request body is frozen by both the grant and
-- correction_requests_guard_update().
--
-- THE ZERO-ROW HAZARD, which is 0005's stop_timer() note in a second place.
-- Two of those three refusals are SILENT: when the USING clause excludes the
-- row — someone else's request, or one that is no longer pending — PostgREST
-- answers HTTP 200 with `[]` and nothing is mutated. Only "set status to
-- something other than 'withdrawn'" trips the WITH CHECK and raises 42501.
-- Measured, not assumed. So the withdraw action MUST use `.select()` and treat
-- an empty result as a refusal; `if (!error)` reports a withdrawal that never
-- happened. Approving and rejecting do not share this hazard — they are
-- functions and raise.

create policy correction_requests_update_withdraw_own_pending
  on public.correction_requests for update to authenticated
  using (
    company_id = (select public.current_company_id())
    and requested_by = (select auth.uid())
    and status = 'pending'
  )
  with check (
    company_id = (select public.current_company_id())
    and requested_by = (select auth.uid())
    and status = 'withdrawn'
  );

-- correction_requests DELETE ------------------------------------------------
-- §4.2: "none". A rejected request "stays for the audit trail" (§7.4), and so
-- does a withdrawn one — the record that somebody asked is part of the trail
-- whatever the answer was. Stated as an explicit false policy rather than left
-- to the absence of one, matching 0003 and 0004: a reader should not have to
-- infer a rule from silence.

create policy correction_requests_delete_never
  on public.correction_requests for delete to authenticated
  using (false);

-- time_entry_revisions SELECT -----------------------------------------------
-- §4.2: "admin". Read literally, and the literal reading has a consequence
-- worth naming rather than discovering: an EMPLOYEE CANNOT SEE THE REVISION
-- HISTORY OF THEIR OWN ENTRIES, including corrections they themselves
-- requested and an admin approved. They see the request (their own) and the
-- entry's current state, but not the before-and-after.
--
-- Not widened here. Adding `or exists (... the entry is mine ...)` would be a
-- policy change made to suit an unbuilt UI, which is the failure mode §0.2
-- exists to prevent; if §7's intent is that an employee can audit changes to
-- their own timesheet, that is an additive amendment to §4.2, not an
-- implementation detail.

create policy time_entry_revisions_select_admin
  on public.time_entry_revisions for select to authenticated
  using (
    company_id = (select public.current_company_id())
    and (select public.is_admin())
  );

-- time_entry_revisions INSERT / UPDATE / DELETE -----------------------------
-- §3.8: "No UPDATE or DELETE policy exists on this table for anyone."
-- Extended to INSERT, because §4.2 marks that cell "server-side only" and the
-- server side is record_entry_revision(), which runs as the table owner and
-- consults no policy. Every one of these is stated explicitly so that "no
-- policy" can never be mistaken for "not thought about" — and so that adding a
-- permissive one later is a visible edit rather than a new line in an empty
-- space.

create policy time_entry_revisions_insert_never
  on public.time_entry_revisions for insert to authenticated
  with check (false);

create policy time_entry_revisions_update_never
  on public.time_entry_revisions for update to authenticated
  using (false);

create policy time_entry_revisions_delete_never
  on public.time_entry_revisions for delete to authenticated
  using (false);
