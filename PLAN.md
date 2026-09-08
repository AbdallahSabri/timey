# Timey — Implementation Plan

**Companion to `SPEC.md` v1.1.** The spec holds decisions and rules; this file holds ordering. Where they disagree, the spec wins — amend the spec deliberately rather than coding around it.

**How to read this:** Phases are sequential. Each ends at a green gate and is independently committable. Every phase cites the spec sections it implements; if a work item has no spec citation, it doesn't belong in the phase.

## The gate

Every phase ends here, all five clean:

```
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm build
```

**A green gate proves less than it appears to.** Vitest runs on jsdom and cannot see Postgres (`SPEC.md` §12.1). No phase that touches RLS, constraints, or `time_entries` is done at the gate alone — it is done at the gate *plus* the named `SPEC.md` §12.2 manual checks. Each phase below lists which ones apply. Treat an unrun manual check as an unfinished phase.

## Agent routing

Per `CLAUDE.md` and `SPEC.md` §0.2. SQL and the code that queries it are never written in the same pass.

| Layer | Agent |
|---|---|
| `supabase/migrations/**`, RLS, `SECURITY DEFINER` | `write-migrations` |
| `src/lib/actions/**`, `src/lib/validations/**`, `src/app/api/**`, `src/types/**` | `implement-logic` |
| `src/components/**`, `src/app/**/*.tsx` | `build-ui` |
| Review before each commit | `code-reviewer` |
| Gate enforcement | `test-runner` |

Within a phase the order is always **migrations → types → actions → UI**. `implement-logic` reacts to regenerated types; it does not anticipate them.

---

## Decision gates

`SPEC.md` §10 leaves seven decisions open. Each becomes blocking at a specific phase — answering late means rework, not just delay.

| # | Decision | Blocks | Why there |
|---|---|---|---|
| 2 | §3.5.2 — mandatory vs. optional `task_id` | **Phase 4** | Nullable `task_id` changes the `tasks` migration and every report join. Cannot be deferred past the structure migration. |
| 7 | Employee sees company-wide totals, or only their own | **Phase 5** | It's the `time_entries` SELECT policy. Writing it wrong means rewriting the policy and re-running every tenancy check. |
| 1 | §7.1.1 — `correction_grace_minutes` | **Phase 7** | Adds a `companies` column and a branch in the entry-edit path. A `companies` column added later is a second migration, which is fine — but the edit-path branch is not cheap to retrofit. |
| 6 | §9.6 — CSV only, or PDF timesheets | **Phase 8** | Additive. CSV ships regardless; PDF is a separate chunk. |
| 3 | Timesheet period approval | Post-v1 | Additive (`timesheet_periods` + a lock check on every write). Deferring costs a later migration, not rework. |
| 5 | Notifications beyond invite email | Post-v1 | Additive. |
| 4 | §12.1 — when to revisit automated DB tests | Reassess after Phase 5 | The RLS surface is largest and riskiest once `time_entries` exists. That's the natural moment to re-ask, not the end of the build. |

---

## Phase 0 — Prerequisites and template cleanup

**Implements:** `SPEC.md` §0.1, §0.2, §4.4, §12.1
**Agents:** `write-migrations` (Supabase init, migration 0001), `implement-logic` (health test), docs by hand
**Depends on:** nothing

No product code. This phase makes the repo capable of holding a migration and makes the gate honest.

### Work items

**Supabase toolchain (§0.1)**
- Add the Supabase CLI as a pinned devDependency rather than relying on a global install — none exists on this machine, and a pinned version keeps CI reproducible. Docker 28.0.1 is present, which `supabase start` requires.
- `supabase init` — creates `supabase/config.toml`. Absent today.
- Recreate `supabase/migrations/` (removed with the todo demo; git doesn't track empty directories).
- Confirm the local stack starts and is reachable before writing any schema.

**Migration `0001_extensions.sql` (§0.1)**
```sql
create extension if not exists btree_gist;  -- §3.7 exclusion constraint
create extension if not exists citext;      -- §3.10 invitation email
```
Verify both are present after applying. `btree_gist` missing means the overlap constraint in Phase 5 fails to create — discovering that four phases later is expensive.

**Strip the service-role key (§4.4)**
- Remove `SUPABASE_SERVICE_ROLE_KEY` from `.env.example` (line 12 and its comment block).
- Remove both README references (the env var table, and the Coolify runtime-env step that names it as the example).
- **The Dockerfile is already clean** — it passes only `NEXT_PUBLIC_*` build args. No change needed there despite §4.4 naming it.

**Agent ownership (§0.2)**
- Add a `supabase/migrations/**` → `write-migrations` row to the `CLAUDE.md` routing table. The agent definition exists; the routing table doesn't mention it, which is the half that gets read.

**Unblock the gate**
- `pnpm test` currently **exits 1 with "No test files found"** — the todo tests were the only suite in the repo. Every phase below claims a green gate, so this is fixed here, not worked around later.
- Preferred fix: a real unit test for `src/app/api/health/route.ts`, which has genuine branching (missing env vars → `"unreachable"`, non-ok response → `"unreachable"`). It gives the suite a true first member.
- The alternative, `passWithNoTests: true` in `vitest.config.ts`, silently tolerates an empty suite for the life of the project. Not recommended.

**Housekeeping (non-blocking)**
- Local Node is v22.14.0; `package.json` `engines` requires `>=24`. Every pnpm invocation prints an unsupported-engine warning, and the Dockerfile builds on 24. Worth resolving now so the warning doesn't train everyone to ignore pnpm output.

### Exit criteria
- Gate green, `pnpm test` genuinely running at least one test.
- `supabase/config.toml` and `supabase/migrations/0001_extensions.sql` exist; local stack applies them cleanly.
- `grep -ri "SERVICE_ROLE"` returns hits in `SPEC.md` only (where it's documented as forbidden).
- `CLAUDE.md` routing table names `write-migrations`.

### Manual verification
None — no RLS or schema yet.

---

## Phase 1 — Tenancy core

**Implements:** `SPEC.md` §2, §2.1, §2.3, §3.1, §3.2, §4.1, §4.2, §4.3, §8.2
**Agents:** `write-migrations` → `implement-logic`
**Depends on:** Phase 0

The foundation every later policy calls. Nothing user-facing ships here; correctness here is load-bearing for all of §4.

### Work items

**Migration — enums and tables (§3.1, §3.2)**
- Enums: `user_role` (`admin` | `employee`), `member_status` (`active` | `inactive`).
- `companies` — `timezone`, `week_starts_on`, `max_timer_hours` per §3.1. These drive §6.1 report bucketing and §5.4 staleness; they are not decorative defaults.
- `profiles` — FK to `auth.users` with `ON DELETE CASCADE`, **nullable `company_id`** (§8.3: the only valid null), index on `(company_id, status)`.

**Migration — the recursion-safe helpers (§4.1)**
- `public.current_company_id()` and `public.is_admin()`, both `stable security definer set search_path = public`.
- `set search_path` is mandatory on both. A `SECURITY DEFINER` function without it is a privilege-escalation vector, and it is the single most reviewable line in the migration.

**Migration — triggers and functions (§2, §8.2)**
- Profile-creation trigger on `auth.users` insert (§3.2: "created by trigger on user signup").
- `create_company()` as `SECURITY DEFINER` — creates the company and sets `profiles.company_id` + `role = 'admin'` **atomically** (§8.2). Two client-side inserts can strand a user outside a company they just created.
- Last-admin guard (§2): demoting or deactivating the final active admin is rejected. Enforce in the database — an application check loses to two concurrent demotions.

**Migration — RLS (§4.2, §4.3)**
- Enable RLS on both tables with the §4.2 matrix policies.
- Every policy filters `company_id = public.current_company_id()` **even where it already checks role** (§4.3). Role and tenancy are independent.
- `companies` INSERT is the one deliberate exception in shape: authenticated user with no company yet.

**Types**
- Regenerate `src/types/supabase.ts` from the local database. It replaces the hand-written `Tables: Record<string, never>` placeholder — the first time this file reflects reality.

### Exit criteria
- Gate green.
- `src/types/supabase.ts` is generated, not hand-written, and contains `companies` + `profiles`.
- Every policy added is stated in the phase report with its `using` / `with check` clause.

### Manual verification (§12.2)
Cannot fully run yet — no second user, no UI. Verify by direct SQL as two seeded auth users:
- A user with `company_id IS NULL` selects from `companies` → zero rows.
- `create_company()` leaves exactly one company and a profile bound to it with `role = 'admin'`.
- Demoting the only admin → rejected.

---

## Phase 2 — Auth surface and the limbo guard

**Implements:** `SPEC.md` §8.1, §8.3
**Agents:** `implement-logic` (middleware, actions) → `build-ui` (routes)
**Depends on:** Phase 1

`SPEC.md` §8 calls this "the largest single gap between spec and repo," and §11 agrees. `src/app/` contains only `/` and `/api/health`. This is a route tree from zero.

### Work items

**Middleware (§8.3)**
- `src/lib/supabase/middleware.ts` currently performs session refresh only — no auth guard, no `company_id` check. Extend it to: refresh session, then route by state.
- Three states, three destinations: unauthenticated → sign-in; authenticated with `company_id IS NULL` → onboarding, **and blocked from every other authenticated route**; authenticated with a company → through.
- Preserve the existing "no Supabase env configured" early return so a fresh clone still boots.
- Do not run logic between client creation and `getUser()` — the existing comment in that file is correct and load-bearing.

**Routes (§8.1 Path A)**
- Sign-up, sign-in, sign-out.
- Onboarding: create-company form calling the Phase 1 `create_company()` RPC.
- An authenticated app shell layout to hang later phases on.

**Actions**
- Auth actions returning the `{ ok, data } | { ok, error }` shape.
- Company creation calls the `SECURITY DEFINER` function by RPC — never two inserts (§8.2).

**Primitives (§12.3)**
- Whatever the forms need beyond `button`/`card`/`input`/`label`/`field`, added via `pnpm dlx shadcn@latest add`.

### Exit criteria
- Gate green.
- A new user can sign up, land in onboarding, create a company, and reach an authenticated shell.
- A user in limbo cannot reach any authenticated route by typing its URL.

### Manual verification (§12.2)
- [ ] Employee hitting an admin route directly by URL is blocked, not just hidden from the nav — *(partial: the guard exists; no admin routes yet to test against)*
- Limbo user cannot escape onboarding by direct URL.

---

## Phase 3 — Invitations and team management

**Implements:** `SPEC.md` §2.3, §3.10, §8.1 (Path B), §8.4
**Agents:** `write-migrations` → `implement-logic` → `build-ui`
**Depends on:** Phase 2

**Sequenced here deliberately.** §12.2's checklist requires two accounts in one company, and without invitations every account creates its own company. Until this phase ships, no tenancy check in the entire spec is genuinely runnable. This is the phase that makes verification possible for everything after it.

### Work items

**Migration (§3.10)**
- `invitations` — `email citext` (needs the Phase 0 extension), `token_hash text NOT NULL`, `expires_at` defaulting to 7 days out, partial unique on `(company_id, email) WHERE accepted_at IS NULL`.
- RLS: admin-only across the board, `company_id`-filtered (§4.2, §4.3).
- Acceptance as a `SECURITY DEFINER` function — it must bind `profiles.company_id` + `role` and set `accepted_at` atomically, and it runs for a user who is *not yet* in the company, so it cannot be a plain policy-governed update.

**Actions (§8.4)**
- Token: raw value generated server-side, **hashed before storage**, raw form appearing only in the emailed URL. A leaked backup must not grant access.
- Expiry enforced **server-side at acceptance**, not merely filtered out of the list view.
- A user who already belongs to a company gets a plain-language refusal (§2, §8.4) — not a generic failure.
- Re-inviting an email replaces the outstanding invitation rather than stacking a second.
- Revoke deletes the row; the link dies immediately.
- Deactivation, not deletion, for removed members (§2.3) — subject to the Phase 1 last-admin guard.

**UI**
- Admin: member list, invite form, revoke, role change, deactivate.
- Invitee: accept-invitation route handling signed-out, signed-in, and already-in-a-company cases distinctly.
- Email delivery for invites is required (§10 item 5); notification emails beyond that stay deferred.

### Exit criteria
- Gate green.
- Two real accounts exist in one company, one admin and one employee. **This is the phase's real deliverable** — later phases depend on it for verification.

### Manual verification (§12.2)
- [ ] A user from Company 2 sees nothing belonging to Company 1
- [ ] Expired invitation link → rejected at acceptance, not just hidden
- [ ] A user already in a company gets the specific error, not a generic one
- [ ] Revoked link stops working immediately

---

## Phase 4 — Structure: clients, projects, tasks, membership

**Implements:** `SPEC.md` §2.1, §3.3, §3.4, §3.5, §3.5.1, §3.5.2, §3.6, §3.6.1, §3.11
**Agents:** `write-migrations` → `implement-logic` → `build-ui`
**Depends on:** Phase 3

> **Blocking decision:** §10 item 2 — mandatory vs. optional `task_id` — must be answered before this migration. The spec's standing ruling (§3.5.2) is mandatory. Optional changes this migration and every report join in Phase 8.

### Work items

**Migration (§3.3–3.6)**
- `clients`, `projects`, `tasks`, `project_members` with `company_id` denormalized onto every one (§2.1), including `tasks` where it could be derived through `projects`.
- **Trigger-enforced consistency** is the stated cost of that denormalization (§2.1): `tasks.company_id` must equal its project's, `project_members.company_id` likewise. Without these triggers the denormalization becomes a tenancy hole rather than an optimization.
- Soft delete via `archived_at` on all three structure tables (§3.11); archived rows stay selectable so historical entries keep readable labels.
- Partial unique indexes: `clients (company_id, lower(name)) WHERE archived_at IS NULL`, `tasks (project_id, lower(name)) WHERE archived_at IS NULL`.
- Auto-create a `"General"` task on project insert (§3.5.2) so the entry flow is never blocked by a missing task.
- Tasks do not nest (§3.5.1) — no parent reference, no recursive structure.

**RLS (§4.2, §3.6.1)**
- `projects` SELECT is the asymmetric one: admins see all projects in the company; employees see only those they're a member of.
- `tasks` SELECT follows the parent project.
- Note the §3.6.1 subtlety: **an admin still needs a `project_members` row to log time** to a project. Assignment governs time entry; role governs visibility. These are different questions and the policies must not conflate them.

**Actions and UI**
- CRUD for clients/projects/tasks, archive rather than delete, membership management.
- Pickers exclude archived rows but historical references still render.
- Primitives (§12.3): combobox/select for the client → project → task cascade.

### Exit criteria
- Gate green.
- An admin can build a client → project → task tree; a new project has a `"General"` task without intervention.

### Manual verification (§12.2)
- [ ] Employee cannot see a project they aren't a member of
- [ ] A user from Company 2 sees nothing belonging to Company 1
- [ ] Archived client disappears from pickers but its name still renders on existing rows
- [ ] Cross-company `company_id` mismatch on task insert → rejected by trigger

---

## Phase 5 — Time entries and the timer

**Implements:** `SPEC.md` §3.7, §5.1, §5.2, §5.3, §5.4, §5.5, §6.1, §6.3
**Agents:** `write-migrations` → `implement-logic` → `build-ui`
**Depends on:** Phase 4

The core of the product. Also the phase where the gap between "gate green" and "actually correct" is widest — every constraint below is invisible to Vitest.

> **Blocking decision:** §10 item 7 — do employees see company-wide totals or only their own? It's the `time_entries` SELECT policy. Answer before writing it.

### Work items

**Migration (§3.7)**
- `time_entries` with `ended_at NULL` meaning *running* (§5.1). No separate timer entity, no client-held state.
- `duration_seconds` as `GENERATED ALWAYS AS ... STORED`. **Verify Postgres accepts the expression as immutable** at migration time — generated columns require it, and discovering a rejection here is much cheaper than discovering it in Phase 8.
- Three constraints, all database-enforced, none application-enforced:
  - `CHECK (ended_at IS NULL OR ended_at > started_at)`
  - `UNIQUE INDEX (user_id) WHERE ended_at IS NULL` — at most one running timer per user. Two racing tabs must fail here, not produce two timers.
  - `EXCLUDE USING gist (user_id WITH =, tstzrange(started_at, ended_at) WITH &&) WHERE (ended_at IS NOT NULL)` — no overlapping closed entries (§5.2). Needs `btree_gist` from Phase 0.
- Indexes per §3.7.

**RLS (§4.2, §7.2)**
- SELECT: admin sees all in company; employee sees `user_id = auth.uid()` — subject to the decision above.
- INSERT: self, own row, and a member of the project.
- UPDATE: **owner only while `ended_at IS NULL`** (§7.2). Once closed, immutable to the employee *at the database*, not merely hidden in the UI.
- DELETE: running entries only — the discard transition (§5.1), and the only DELETE any user may perform.
- **Implementation subtlety worth surfacing now:** §7.1 permits editing the `note` on a closed entry, but RLS policies gate rows, not columns. A note-only path on a closed row needs column-level `GRANT UPDATE (note)` or a trigger rejecting other column changes — a row policy alone cannot express it. Decide the mechanism in this phase even if the note UI lands in Phase 7.

**Actions (§5.3, §5.2)**
- Start / stop / discard. `started_at` and `ended_at` are **`now()` evaluated in Postgres** — the client never sends a timer timestamp (§5.3).
- Translate constraint violations by error code into readable messages: the overlap constraint becomes "This overlaps an entry from 14:00–15:30", never a constraint name (§5.2).
- Switching project mid-timer is stop-then-start, never a mutation of `project_id` on a running row (§5.1).

**UI (§5.3, §5.4)**
- Elapsed counter is **display-only**, computed from the server's `started_at`, never the source of the saved value.
- Stale timer (past `companies.max_timer_hours`, default 12) gets a **blocking prompt** asking when work actually stopped — stop now, or submit a correction. Never a silent auto-close (§5.4); the system does not invent an `ended_at`.
- Entries are never split across days (§5.5); a 22:00→03:00 shift is one row.
- Primitives (§12.3): badge for status pills, date/time picker groundwork.

### Exit criteria
- Gate green.
- A timer can be started, stopped, and discarded; exactly one runs per user.

### Manual verification (§12.2) — the full timer block, no exceptions
- [ ] Two tabs, both press Start → second fails with a readable message, not a second timer
- [ ] Entry with `ended_at` before `started_at` → rejected
- [ ] Employee B cannot see Employee A's time entries anywhere in the UI
- [ ] Employee cannot edit a closed entry via a direct API call — RLS, not UI
- [ ] A 22:00→03:00 entry appears entirely on the start day, in company timezone
- [ ] A running timer contributes zero to any total

**Reassess §10 item 4 here.** The RLS surface is now at its largest and most consequential. This is the natural moment to re-ask whether automated database tests stay deferred (§12.1).

---

## Phase 6 — Manual entries

**Implements:** `SPEC.md` §5.3, §6.4, §7.1
**Agents:** `implement-logic` → `build-ui`
**Depends on:** Phase 5

Separated from Phase 5 deliberately: Phase 5 proves the constraint machinery using server-generated timestamps only. This phase introduces **client-supplied** timestamps and the validation that guards them. Keeping them apart means a failure in either is unambiguous.

### Work items
- Manual entry creation with client-supplied times — a deliberate assertion, not a measurement (§5.3), and therefore validated server-side rather than trusted.
- **Today only** (§7.1). "Today" means the current date in the **company** timezone, not the browser's. Anything earlier routes to a correction request in Phase 7.
- Future guard (§6.4): `started_at` may not exceed `now() + 5 minutes`. The grace absorbs clock drift; beyond it is rejected.
- Overlap errors surface with the conflicting range named (§5.2), reusing Phase 5's error translation.
- Note editing on own entries (§7.1), via the column mechanism decided in Phase 5.
- Primitives (§12.3): date/time picker.

### Exit criteria
- Gate green.
- A manual entry for today succeeds; one dated yesterday is refused with a pointer to corrections.

### Manual verification (§12.2)
- [ ] Manual entry overlapping an existing entry → rejected, conflicting range named
- [ ] Entry starting an hour in the future → rejected
- [ ] Entry dated before today → refused, directed to a correction request
- [ ] Day boundary honors company timezone, not the browser's

---

## Phase 7 — Corrections

**Implements:** `SPEC.md` §3.8, §3.9, §7.1, §7.2, §7.3, §7.4
**Agents:** `write-migrations` → `implement-logic` → `build-ui`
**Depends on:** Phase 6

`SPEC.md` §7 names this "the heart of the product and the section most likely to be misimplemented." The design intent is one sentence: **an employee cannot quietly rewrite their own history.**

> **Blocking decision:** §10 item 1 — `correction_grace_minutes` (§7.1.1), or strict zero-tolerance. It adds a `companies` column and a branch in the entry-edit path.

### Work items

**Migration (§3.8, §3.9)**
- `time_entry_revisions` — append-only. **No UPDATE or DELETE policy exists for anyone**, at any privilege level. Insert-only is the entire point.
- `correction_requests` — `kind` (`create` | `amend` | `delete`), the `proposed_*` columns, `reason text NOT NULL`, status lifecycle, `(company_id, status, created_at DESC)` index driving the admin queue.
- `reason` is NOT NULL at the database, not merely required by a form. It is the justification for the whole approval step.

**The approval function (§7.3, §7.4)**
- One `SECURITY DEFINER` function, one transaction: validate → snapshot prior state into `time_entry_revisions` → mutate/insert/delete the entry → mark the request approved. **Partial application is not possible** — this is why it is a database function and not four action calls.
- Approval **re-validates** overlap and future-date rules *at approval time*, not submission time. The world moved while the request sat in the queue.
- An overlap at approval fails with the conflicting entry named. The admin resolves it; the system does not pick a winner.
- **An admin cannot approve their own request** (§7.4). Single-admin companies edit entries directly instead — and those direct admin edits **also write revision rows**. That path is easy to forget and leaves an audit gap if missed.
- Requests against a since-deleted entry auto-mark `withdrawn` rather than erroring.
- Rejection is terminal and requires `review_note`; the rejected record persists for the trail.

**UI**
- Employee: submit correction, view own requests, withdraw while pending.
- Admin: review queue with approve/reject.
- **No edit affordance on a closed entry, ever** (§7.1, §7.2). A button that fails on RLS is a bug in the UI layer, not a caught error.
- Primitives (§12.3): tabs (admin queue vs. own requests), badge (status pills).

### Exit criteria
- Gate green.
- A correction round-trips: submit → approve → entry changed → revision row written with correct prior values.

### Manual verification (§12.2) — the full corrections block
- [ ] Employee cannot edit a closed entry through the UI
- [ ] Employee cannot edit a closed entry via a direct API call
- [ ] Approving a correction writes a `time_entry_revisions` row with correct prior values
- [ ] Approving a correction that would now overlap → fails cleanly, entry unchanged, request still pending
- [ ] Admin cannot approve their own request
- [ ] A direct admin edit also writes a revision row
- [ ] No path exists to update or delete a revision row

---

## Phase 8 — Reporting and export

**Implements:** `SPEC.md` §6.1, §9.1, §9.2, §9.3, §9.4, §9.5, §9.6
**Agents:** `implement-logic` → `build-ui`
**Depends on:** Phase 7

> **Blocking decision:** §10 item 6 — CSV only, or PDF timesheets for signature. CSV ships regardless; PDF is a separate chunk.

### Work items

**Queries (§9.1–9.5)**
- Aggregate SQL through `lib/actions/**`. No materialized views, no nightly rollups, no client-side aggregation of raw entries.
- Day bucketing is **`(started_at AT TIME ZONE c.timezone)::date`** — never `date_trunc('day', ...)`, which buckets by UTC and shifts every report by the offset (§6.1). This is the single most likely defect in the phase.
- **`WHERE ended_at IS NOT NULL`** on every total (§9.4). Running entries contribute zero and are shown separately as "in progress".
- **Sum integer seconds; format at the edge** (§9.5). Never sum floating-point hours — drift across hundreds of rows produces totals that don't match their own line items.
- Groupings: day, user, project, task, client, plus user × project cross-tabs (§9.3).
- Employees are hard-scoped by RLS regardless of what the UI sends (§9.2) — the filter is a convenience, never the boundary.

**UI**
- Date-range filtering in company-local days, inclusive; filters on user, client, project, task.
- Primitives (§12.3): calendar (range picker).
- **The report and queue grids need a sortable, filterable data table.** In shadcn that's a TanStack Table recipe with its own dependency — a build chunk, not a `pnpm dlx add` away (§12.3). Budget for it rather than discovering it mid-phase.

**Export (§9.6)**
- CSV of any report view.

### Exit criteria
- Gate green.
- Every §9.3 grouping renders; CSV matches the on-screen totals exactly.

### Manual verification (§12.2)
- [ ] Report totals equal the sum of their own visible line items
- [ ] A running timer contributes zero to report totals
- [ ] A 22:00→03:00 entry appears entirely on the start day, in company timezone
- [ ] An employee filtering for another user's data gets their own, not an error and not the other user's

## Phase 9 — Expected hours and attendance

**Implements:** `SPEC.md` §3.6.3, §9.8, §9.8.1, §9.8.2, §9.8.3
**Agents:** `write-migrations` → `implement-logic` → `build-ui`
**Depends on:** Phase 8 (every surface here sits beside a Phase 8 figure)

Phase 8 answers *how much*. This phase answers *is that enough*, by letting an admin
declare what each employee is expected to work and showing the two numbers together.

### Work items

**Migration (§3.6.3) — lands alone, before any TypeScript (§0.2)**
- `project_members` gains `expected_daily_seconds integer not null default 0` and
  `working_days smallint[] not null default '{1,2,3,4,5}'`.
- Day-of-week is Postgres `extract(dow)` numbering, 0=Sun … 6=Sat, so the comparison is
  `= any(working_days)` with no offset arithmetic and it agrees with the numbering
  `companies.week_starts_on` already uses.
- Range/shape enforced by CHECK; ordering and de-duplication by a
  `project_members_20_normalize_working_days()` BEFORE trigger. A CHECK cannot express
  "distinct" without a subquery, and 0004's stated preference is to make a bad value
  unrepresentable rather than merely rejected.
- Extend the existing column GRANTs. **No new policies** — `project_members_insert_admin`
  and `_update_admin` already gate both verbs to active admins of the company.
- Two `security invoker` functions, `report_expected_by_user` and
  `report_expected_by_user_project`, taking §9.2's filters minus `p_task_id`.

**The four arithmetic rules (`BLOCKERS.md` D-17) — each is a defect if missed**
- Working days are counted over **company-local dates**:
  `generate_series(greatest(p_from, (added_at at time zone c.timezone)::date), p_to, interval '1 day')`.
  Never `date_trunc`, never UTC — the same trap Phase 8 names as its most likely defect,
  and worse here, because an expected figure bucketed in a different zone from the actual
  it sits beside is wrong without looking wrong.
- **Today counts in full.** Inclusive through `p_to`, no proration.
- **Accrual starts at `added_at`**, so a back-filled assignment invents no shortfall.
- **Integer seconds** (§9.5). The admin types hours; the action stores seconds.

**Actions**
- Schedule read/write on `project_members`, reusing `updateMemberRole`'s shape — including
  its zero-rows branch, since an RLS `USING` failure filters rather than raises and
  PostgREST reports success on an empty set.
- Report wrappers reuse Phase 8's `prepare()`, so §9.2's employee scoping stays in one place.
- **The by-user merge is a union, not a join** (§9.8.3). Someone expected to work who
  logged nothing has no `report_by_user` row and is exactly the row that must appear. Keep
  the merge a pure function so it is testable without a database.

**UI**
- Admin sets the schedule from two entry points against one row: the project detail page
  and the Team page.
- Reports: Expected + Difference in the by-user and by-user × project views and their CSVs;
  an Expected figure in the summary header when the report resolves to one person.
- Employee dashboard: worked vs expected, month to date, reading `report_summary` rather
  than aggregating again — a dashboard figure that could disagree with `/reports` would be
  worse than no figure.
- Two captions are load-bearing, not decoration (§9.8.2): today is counted whole, and
  §9.4 keeps a running timer out of the worked side.
- `companies.week_starts_on` has been written since Phase 1 and never read. The day picker
  is the first thing with a reason to care — plumb it through `getCurrentMember` and order
  the checkboxes by it. Stored values stay 0–6 dow; only display order changes.

### Exit criteria
- Gate green.
- An employee with two differently-scheduled projects shows one combined expected figure,
  identical on the dashboard and in `/reports` for the same range.

### Manual verification (§12.2)
- [ ] An employee scheduled 4h/day Mon–Fri and 3h/day Mon/Tue/Thu/Fri on a second project sums to one figure
- [ ] Someone with a schedule and zero entries still appears in the by-user view, with a non-zero expected
- [ ] An assignment created mid-month accrues expected only from that day forward
- [ ] Expected disappears — not zeroes — under a task filter, in the table and in the CSV
- [ ] The dashboard says the running timer is excluded whenever one is running
- [ ] A month boundary does not shift in a DST-at-midnight zone (`America/Havana`)

---

---

## Sequencing rationale

Three ordering choices worth stating, since each had a defensible alternative:

**Invitations (Phase 3) precede all product surface.** Without a second user in the same company, not one tenancy assertion in §12.2 can actually be run — every account otherwise owns its own company. Building structure and time entries first would mean four phases of untestable RLS, on a stack where `SPEC.md` §12.1 already concedes the automated gate cannot see policies at all.

**Timer (Phase 5) precedes manual entries (Phase 6).** Both write `time_entries`, and merging them is tempting. But Phase 5's timestamps come from Postgres and Phase 6's come from the client — different trust models, different validation surfaces. Split, a failure tells you which one is broken.

**Corrections (Phase 7) come late, and that is not a deprioritization.** They depend on closed entries existing, on RLS immutability being real, and on two accounts with distinct roles. Every one of those is a prior phase's deliverable.

## Standing rules for every phase

- **A failing RLS query is a finding, not an obstacle.** Never loosen a policy to make a query pass. Report it and stop.
- **Migrations are append-only.** Never edit one that has been applied; write a new one.
- **Regenerate types after every migration** — `implement-logic` reacts to the regenerated file rather than anticipating it.
- **`code-reviewer` runs before each commit**, with the SQL posture from its definition: a policy that works and a policy that is correct diverge silently.
- **No `@ts-ignore`, `as any`, weakened tests, or skipped assertions** to reach a green gate (`CLAUDE.md`).
- **Spec conflicts amend the spec.** They do not get coded around, and they do not get resolved inside a phase without saying so.
