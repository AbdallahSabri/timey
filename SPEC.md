# Timey — Product & Technical Spec

**Version:** 1.1 — reconciled against the repository
**Scope:** Decisions and rules only. No task ordering, no milestones (see `PLAN.md`).

**How to read this:** Every ruling is numbered. `[R]` marks a ruling made without explicit input that is cheap to reverse before implementation starts. `[OPEN]` marks a decision still owed. Sections 3–8 are the contract; if implementation disagrees with them, the spec wins or the spec changes — not silently either way.

---

## 0. Changelog — v1.0 → v1.1

Reconciliation against the repo found **no data-model conflicts**. The repo is a blank slate: no `supabase/` directory, no migrations, empty `src/lib/actions/**` and `src/lib/validations/**`, placeholder `src/types/supabase.ts`. Amendments made:

| Change | Section |
|---|---|
| Added CLI init + `citext` extension as prerequisites | §0.1, §3 preamble |
| Service-role key to be stripped from the template (ruled) | §4.4 |
| SQL/migrations agent ownership added (ruled) | §0.2 |
| Automated DB tests deferred; manual verification checklist added (ruled) | §12 |
| Missing shadcn primitives inventoried | §12.3 |
| Struck the `todos.ts` reference — file no longer exists | §11 |
| §11 rewritten from a checklist into resolved findings | §11 |

### 0.1 Prerequisites before the first migration

1. `supabase init` — no `supabase/config.toml` exists; no local project is linked.
2. Recreate `supabase/migrations/` — the directory is gone entirely after the todo-demo removal.
3. First migration enables **both** required extensions:
   ```sql
   create extension if not exists btree_gist;  -- §3.7 exclusion constraint
   create extension if not exists citext;      -- §3.10 invitation email
   ```
   Without `btree_gist` the overlap constraint fails to create. Verify both exist after running.
4. `supabase gen types` after every migration — `src/types/supabase.ts` is currently a hand-written placeholder (`Tables: Record<string, never>`) and is aspirational until generated against a real database.

### 0.2 Agent ownership for SQL

`CLAUDE.md`'s routing table has no owner for `supabase/migrations/**`. Add one. The rules:

- SQL migrations, RLS policies, and `SECURITY DEFINER` functions are owned by a dedicated migration-scoped agent.
- **RLS policies are never written in the same pass as the server actions that call them.** A single pass optimizing for "the query returns rows" will loosen a policy to make its own code work.
- `code-reviewer` reviews migrations with a different posture than components: policy bugs are the failure mode where *works* and *correct* diverge silently.

---

## 1. Product Definition

Timey records how long people work, against what. Users start and stop a timer, or enter hours manually, attributed to a client → project → task hierarchy. Those entries roll up into timesheets and reports.

**In scope:** time capture, project/task structure, team membership, missed-punch corrections with admin approval, reporting.

**Out of scope (v1), and absent from the schema entirely:** billing, hourly rates, invoicing, cost tracking, payroll export, screenshots or activity monitoring, GPS, idle detection.

Rates are not a "later column" — they are excluded by design. If billing ever arrives it comes as a new table, not a nullable field added to `projects`.

---

## 2. Roles & Tenancy

| Concept | Ruling |
|---|---|
| Tenant boundary | `company`. Every tenant-owned row carries `company_id` directly. |
| User → company | Exactly one. A user belongs to one company for the life of the account. |
| Roles | `admin`, `employee`. Two only. |
| Company creator | Becomes `admin` automatically. |
| Role changes | Admin may promote/demote any member except themselves. |
| Last admin | A company must always have ≥1 active admin. Demoting or deactivating the last one is rejected. |

**2.1 [R] `company_id` is denormalized onto every tenant table** — including `tasks`, which could derive it through `projects`. Rationale: RLS policies become single-column equality checks with no joins. Joins inside policies are the main source of slow queries and recursive-policy bugs in Postgres RLS. Cost is a trigger-enforced consistency check on insert.

**2.2 [R] There is no cross-company anything.** No shared clients, no contractor belonging to two companies, no super-admin view. If a person works for two companies they hold two accounts with two emails.

**2.3 Deactivation, not deletion.** A removed employee gets `status = 'inactive'`: loses access, keeps their time entries. Hard-deleting a user would orphan historical records that reports depend on.

---

## 3. Data Model

Postgres via Supabase. All timestamps are `timestamptz` stored in UTC. All ids are `uuid` with `gen_random_uuid()` defaults. Requires the `btree_gist` and `citext` extensions (§0.1).

### 3.1 `companies`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `name` | text NOT NULL | |
| `timezone` | text NOT NULL | IANA name, e.g. `Africa/Cairo`. Defines report day boundaries (§6.1). |
| `week_starts_on` | smallint NOT NULL DEFAULT 1 | 0=Sunday, 1=Monday. |
| `max_timer_hours` | smallint NOT NULL DEFAULT 12 | Stale-timer threshold (§5.4). |
| `created_at` | timestamptz DEFAULT now() | |

### 3.2 `profiles`

Extends `auth.users`. Created by trigger on user signup, or on invitation acceptance. **Does not exist yet — no table, no trigger.**

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | FK → `auth.users.id`, ON DELETE CASCADE |
| `company_id` | uuid | FK → `companies.id`. **Nullable** — a user exists between signup and company creation/invite acceptance. |
| `role` | `user_role` enum | `admin` \| `employee` |
| `full_name` | text NOT NULL | |
| `status` | `member_status` enum | `active` \| `inactive`, default `active` |
| `created_at` | timestamptz | |

Index: `(company_id, status)`.

### 3.3 `clients`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `company_id` | uuid NOT NULL | |
| `name` | text NOT NULL | |
| `archived_at` | timestamptz NULL | Soft delete (§3.11) |

Unique: `(company_id, lower(name)) WHERE archived_at IS NULL`.

### 3.4 `projects`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `company_id` | uuid NOT NULL | |
| `client_id` | uuid NULL | **Nullable** — internal projects have no client |
| `name` | text NOT NULL | |
| `description` | text NULL | |
| `archived_at` | timestamptz NULL | |

Index: `(company_id, archived_at)`.

### 3.5 `tasks`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `company_id` | uuid NOT NULL | Denormalized (§2.1) |
| `project_id` | uuid NOT NULL | |
| `name` | text NOT NULL | |
| `archived_at` | timestamptz NULL | |

Unique: `(project_id, lower(name)) WHERE archived_at IS NULL`. Index: `(project_id, archived_at)`.

**3.5.1 [R] Tasks do not nest.** Flat list under a project. Subtasks would require recursive queries in every report for no stated need.

**3.5.2 [R] Every time entry requires a task.** Not just a project. Rationale: optional `task_id` means half the data is unreportable at task level, and "General" is a task the user can create in ten seconds. On project creation, auto-create one task named "General" so the flow is never blocked.

### 3.6 `project_members`

Controls who may log time where.

| Column | Type | Notes |
|---|---|---|
| `project_id` | uuid | Composite PK with `user_id` |
| `user_id` | uuid | |
| `company_id` | uuid NOT NULL | Denormalized |
| `added_at` | timestamptz | |

**3.6.1 [R] Employees see only their assigned projects.** Admins see all projects in the company regardless of membership. An admin logging time to a project still needs a membership row — assignment governs time entry, role governs visibility.

### 3.7 `time_entries`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `company_id` | uuid NOT NULL | |
| `user_id` | uuid NOT NULL | Who the time belongs to |
| `project_id` | uuid NOT NULL | |
| `task_id` | uuid NOT NULL | |
| `started_at` | timestamptz NOT NULL | |
| `ended_at` | timestamptz NULL | **NULL = timer currently running** |
| `duration_seconds` | int GENERATED STORED | `extract(epoch from (ended_at - started_at))::int`. NULL while running. |
| `source` | `entry_source` enum | `timer` \| `manual` |
| `note` | text NULL | |
| `created_at` / `updated_at` | timestamptz | |

**Constraints:**

- `CHECK (ended_at IS NULL OR ended_at > started_at)` — zero-length and reversed entries rejected.
- `CREATE UNIQUE INDEX ... ON time_entries (user_id) WHERE ended_at IS NULL` — **at most one running timer per user, enforced by the database.** Not by application logic. Two browser tabs racing must fail at the constraint, not produce two timers.
- `EXCLUDE USING gist (user_id WITH =, tstzrange(started_at, ended_at) WITH &&) WHERE (ended_at IS NOT NULL)` — **no overlapping closed entries per user** (§5.2). Requires `btree_gist`.

**Indexes:** `(company_id, user_id, started_at DESC)`, `(project_id, started_at DESC)`, `(task_id)`.

### 3.8 `time_entry_revisions`

Append-only audit log. Written whenever a closed entry changes (§7.3).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `company_id` | uuid NOT NULL | |
| `time_entry_id` | uuid NOT NULL | |
| `changed_by` | uuid NOT NULL | The admin who approved |
| `correction_request_id` | uuid NULL | Source of the change, if any |
| `prior_started_at` / `prior_ended_at` | timestamptz | Snapshot **before** the change |
| `prior_project_id` / `prior_task_id` / `prior_note` | — | Snapshot before |
| `changed_at` | timestamptz DEFAULT now() | |

No UPDATE or DELETE policy exists on this table for anyone. Insert-only.

### 3.9 `correction_requests`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `company_id` | uuid NOT NULL | |
| `requested_by` | uuid NOT NULL | |
| `kind` | `correction_kind` enum | `create` \| `amend` \| `delete` |
| `time_entry_id` | uuid NULL | NULL when `kind = 'create'` |
| `proposed_started_at` | timestamptz NULL | NULL when `kind = 'delete'` |
| `proposed_ended_at` | timestamptz NULL | |
| `proposed_project_id` / `proposed_task_id` | uuid NULL | |
| `proposed_note` | text NULL | |
| `reason` | text NOT NULL | Required from the employee. Non-negotiable — it's the entire point of the approval step. |
| `status` | `correction_status` enum | `pending` \| `approved` \| `rejected` \| `withdrawn` |
| `reviewed_by` | uuid NULL | |
| `reviewed_at` | timestamptz NULL | |
| `review_note` | text NULL | Required when rejecting. |
| `created_at` | timestamptz | |

Index: `(company_id, status, created_at DESC)` — drives the admin queue.

### 3.10 `invitations`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `company_id` | uuid NOT NULL | |
| `email` | citext NOT NULL | Requires `citext` extension (§0.1) |
| `role` | `user_role` | |
| `token_hash` | text NOT NULL | **Hash only.** Raw token exists only in the emailed URL. |
| `invited_by` | uuid NOT NULL | |
| `expires_at` | timestamptz NOT NULL | Default now() + 7 days |
| `accepted_at` | timestamptz NULL | |

Unique: `(company_id, email) WHERE accepted_at IS NULL`.

### 3.6.2 Amendments from implementation (Phase 4)

- **`company_id` on `tasks` and `project_members` is derived, never accepted from a client** — a trigger sets it from the row's `project_id` on every insert/update, and neither role has an INSERT/UPDATE grant on the column at all. This is stronger than §2.1's "trigger-enforced consistency check": a mismatched value isn't validated and rejected, it's structurally impossible to submit. Backed independently by composite FKs (`tasks(project_id, company_id) -> projects(id, company_id)`, and the equivalent on `project_members`), so the guarantee survives even if the trigger were ever dropped.
- **Hard-delete prevention (§3.11) is a missing grant, not a guard trigger.** §4.2 already lists DELETE as `none` for `clients`/`projects`/`tasks`; the verb simply isn't granted to `authenticated`, so there's no trigger to bypass or forget. `ON DELETE RESTRICT` on the relevant FKs backs it for any higher-privileged path.
- **§3.6.1's two questions stay genuinely separate.** `projects` SELECT (visibility: admin sees all, employee sees only member projects) is built. Nothing in this migration decides "may log time to this project" — that is `time_entries` INSERT in Phase 5, and it must consult `project_members` directly rather than an `is_admin()` shortcut, or an admin with no membership row silently gets to log time despite §3.6.1 saying assignment governs entry regardless of role.
- **Inactive members are not filtered by these policies, and this is inherited from Phase 1, not introduced here.** `current_company_id()` doesn't check `profiles.status`; only `is_admin()` does. A deactivated employee with a live session still reads their company's clients and their assigned projects/tasks — losing admin verbs on deactivation works, losing all access does not. Closing this changes `current_company_id()`'s semantics for every table that calls it, not just this phase's four — flagged rather than fixed here.
- **`project_members` SELECT is company-wide, read literally from §4.2's "own company."** An employee can see the `(project_id, user_id)` assignment pairs for projects whose names they can't read (`projects` SELECT still blocks those). Not a deviation — this is what the matrix says — but worth naming since it wasn't obviously intended.

### 3.11 [R] Soft delete for structure, hard delete for nothing

`clients`, `projects`, `tasks` archive via `archived_at`. Archived rows stay selectable so historical entries keep a readable label; they're excluded from pickers. A client with projects, or a task with entries, can never be hard-deleted.

---

## 4. Row-Level Security

RLS enabled on every table with explicit policies. No table relies on "no policy = no access."

### 4.1 The recursion trap

A policy on `profiles` that reads `profiles` to determine the caller's company recurses infinitely. Two `SECURITY DEFINER` helpers break the cycle by bypassing RLS on their own read:

```sql
create function public.current_company_id() returns uuid
  language sql stable security definer set search_path = public as
$$ select company_id from public.profiles
   where id = auth.uid() and status = 'active' $$;

create function public.is_admin() returns boolean
  language sql stable security definer set search_path = public as
$$ select exists (
     select 1 from public.profiles
     where id = auth.uid() and role = 'admin' and status = 'active'
   ) $$;
```

`set search_path` is mandatory on both — a `SECURITY DEFINER` function without it is a privilege-escalation vector.

**4.1.1 `current_company_id()` filters on `status = 'active'`, added post-Phase-8 (`0008_deactivation_scope.sql`).** Every tenancy check in this schema is `company_id = current_company_id()`, so this single filter is what makes §2.3's "loses access" real rather than aspirational — without it, a deactivated user's still-valid session kept full read *and write* access everywhere their `company_id` matched, confirmed reachable including starting new timers. `is_admin()` already carried the equivalent check from Phase 1; this closed the same gap in the more heavily-relied-on helper. Body-only change, no policy touched — every table's enforcement updated from this one function.

### 4.2 Policy matrix

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `companies` | own company | authenticated, no company yet | admin | none |
| `profiles` | own company | trigger only | self (name) / admin (role, status) | none |
| `clients` | own company | admin | admin | none |
| `projects` | admin: all in company. employee: via `project_members` | admin | admin | none |
| `tasks` | same as parent project | admin | admin | none |
| `project_members` | own company | admin | admin | admin |
| `time_entries` | admin: all in company. employee: `user_id = auth.uid()` | self, own row, member of project | **self only while `ended_at IS NULL`** (§7.2) | none |
| `time_entry_revisions` | admin | server-side only | none | none |
| `correction_requests` | admin: all. employee: own | employee, own | employee: withdraw own pending. admin: review any | none |
| `invitations` | admin | admin | admin (revoke) | admin |

**4.3 Every policy is also filtered by `company_id = public.current_company_id()`**, including the ones above that read as role-based. Role and tenancy are independent checks; an admin is an admin of one company only.

### 4.2.1 Amendments from implementation (Phase 1)

Recorded because §11 requires conflicts to amend the spec rather than be coded around.

- **`profiles` SELECT is `company_id = current_company_id() OR id = auth.uid()`**, not the bare "own company" in the matrix. A limbo user's `current_company_id()` is NULL, so a pure tenancy filter would hide their own row and make §8.3's limbo state undetectable by the very middleware that must route on it. The `OR` is PK equality, so it exposes exactly one extra row: the caller's own. Not a tenancy widening.
- **§4.2's "self (name) / admin (role, status)" split is a column concern, and a row policy cannot express it.** Enforced as column-level `GRANT UPDATE (full_name, role, status)` plus a trigger. This is the same problem §7.2's note-only path hits on `time_entries`; the GRANT + trigger pairing is the working precedent to reuse there.
- **An admin may not rename a member.** The matrix reads "self (name)", enforced literally — a name belongs to the person it names. If admins should be able to correct a member's name, that is an additive spec change, not an implementation detail.
- **The last-admin guard covers UPDATE only, not DELETE.** Deleting an `auth.users` row cascades to `profiles` and would strand a company with zero admins. §2.3 rules deletion out of the product so no application path reaches it, but the cascade exists at the database level. Known gap, deliberately not closed — closing it changes `auth.users` deletion behavior.
- **The `companies` INSERT policy permits an orphan the application must never create.** A limbo user can insert a company directly and then remain in limbo, unable even to `SELECT` the row they just created. §8.2's `SECURITY DEFINER` function exists precisely to prevent that; the policy is the floor, the function is the only sanctioned path.
- **`companies.timezone` is validated by trigger, not `CHECK`** — a CHECK constraint cannot subquery `pg_timezone_names`. This matters because §6.1 evaluates `started_at AT TIME ZONE timezone` in every report, so an invalid value would break reporting rather than fail at write time.
- **`profiles.full_name` cannot be guaranteed meaningful by the database.** The signup trigger falls back through user metadata → email local-part → a placeholder, because an OAuth or magic-link signup carrying no name would otherwise hit NOT NULL and lock the user out entirely. The application must still collect a real name; the database guarantees only non-blank.

### 4.2.2 Admin-only routes — RULED

`/members`, `/clients`, `/projects` and `/projects/[id]` render for an admin only. An employee reaching one is redirected to `/dashboard`, by `src/lib/supabase/middleware.ts` and again by the page itself — middleware does not run on every rendering path, so neither check is sufficient alone.

**No policy in §4.2 changes, and that is the ruling, not an omission.** Every table behind these routes stays company-readable because other screens an employee is entitled to read through them:

- `clients` SELECT stays company-wide — `listProjects()` embeds it to label an employee's own projects with their client.
- `profiles` SELECT stays company-wide — member names are read across reports, corrections, and project assignment.
- `projects` SELECT stays `admin_or_member` — the timer and the manual-entry form populate their pickers through it, so narrowing it would stop an employee logging time at all.

**So this hides three admin surfaces; it does not make their contents confidential.** An employee still sees client names on the dashboard's project picker and member names throughout corrections and reports. If confidentiality is ever wanted, it is a separate change: new admin-only policies *plus* replacements for the three readers above. Recorded here so the limit is arguable rather than assumed.

This reverses the position previously argued in `src/components/layout/nav.ts` — that withholding a link protects nothing, therefore every link is shown to every role. That was right about the protection and wrong about the conclusion: a link to a page whose every control refuses you is a dead end, not a neutral one.

`/corrections` is deliberately **not** on the list. §7.4 gives an employee their own requests and their outcomes, and `corrections/page.tsx` already renders the admin review queue for an admin only — so the page needed no change.

### 8.1.1 An invited account may not create a company — RULED

A limbo user (§8.3) with an unexpired invitation outstanding cannot create a company. `create_company()` refuses with 23514, DETAIL `pending_invitation`, and `/onboarding` shows the invitation in place of the form.

**The problem this fixes is a role, not a route.** Middleware parks every limbo user on `/onboarding`, and §8.2 binds whoever creates a company as its `admin`. Nothing asked whether that person had been invited — so an invitee who did not complete the accept step silently lost the role their invitation named and became the admin of a second, unwanted company. Three routes reached it without email confirmation involved: abandoning the accept page and signing in later; signing up under an address that differs from the invited one (§8.4.1 then refuses at click time, stranding them); or never opening the link. With Confirm email ON it was not a possibility but the default path.

`accept_invitation()` was never at fault and is unchanged — it binds the invitation's role faithfully. The other door was the unguarded one.

**Only an unexpired invitation blocks.** After §8.4's seven days the door reopens: a lapsed invitation must not lock somebody out of the product permanently.

**`pending_invitation_for_me()` (`0012`) takes no argument**, so unlike `email_is_company_member()` (§8.4.2) it needs no admin check — it can only ever describe an invitation sent to the caller's own address. It returns no token, and could not: only `token_hash` is stored. That is deliberate. §8.4.1 makes the token *and* the address together the evidence of who was invited; accepting on an address match alone would drop the token half, and where `enable_confirmations` is off the address half is unverified too. Onboarding therefore blocks and explains — it never offers to accept, and the emailed link stays the only way in.

### 8.1.2 The destination survives email confirmation — RULED

`signUp` stores where the account was heading in `user_metadata.pending_next`; `/auth/confirm` reads it after `verifyOtp()` and redirects there.

Previously the confirmation link hardcoded `next=/dashboard`, so §8.1 Path B could not survive a confirmation email at all: `SignUpForm` has no session to navigate with on that branch and dropped the destination entirely.

**Metadata rather than `emailRedirectTo`.** GoTrue exposes that option to the template as `{{ .RedirectTo }}` — an absolute URL that *defaults to the Site URL when unset*, so a template built around it emits a malformed link the moment the option is missing, and it must additionally clear the project's redirect allow-list. Metadata needs neither, and needs no change to the hosted email template.

**It is attacker-influenceable and is treated as such.** `user_metadata` is writable by its own user, so the value is re-validated through `safeNextPath` on read, exactly like `?next=`. The worst a caller achieves is choosing their own same-origin landing page; an invite token planted there by somebody else still buys nothing, because §8.4.1 checks the caller's address.

### 8.4.2 Inviting an existing member — RULED

An invitation to an address that already belongs to the caller's company is refused at send time, not at redemption.

`accept_invitation()` has always refused it (23505, "this account already belongs to a company"), but that is the right refusal in the wrong place: the admin learns nothing, the row occupies the pending list until it expires, and a configured Resend has already delivered a link that can never work. Observed for real — a company's sole admin invited their own address as an employee and got a structurally un-acceptable invitation.

The check needs a database function because the actions layer cannot ask the question: `profiles` carries no email column, `auth.users` is unreadable without a service-role key, and §4.4 forbids one. `email_is_company_member(citext)` (`0011`) is the narrow `SECURITY DEFINER` answer, scoped to `current_company_id()`.

**It is admin-only (42501 otherwise), and that is the ruling.** The function is an email oracle — it answers "does this address belong to your company" for any address named. §4.2 lets a member see *who* is in the company but not their addresses, so granting this to every member would widen the matrix by a column nobody asked for. Only an admin invites, so only an admin needs the answer.

`accept_invitation()` remains the enforcement. The new check is advisory and can lose a race with a signup completing between send and redemption; it moves a guaranteed failure forward to the person who can act on it.

### 4.4 No service-role key in the application — RULED

Anything requiring elevated privileges runs as a `SECURITY DEFINER` Postgres function with a narrow signature. Handing the service key to a Next.js server action means one forgotten `company_id` filter leaks every tenant.

**Reconciliation found the template actively inviting this pattern:** `.env.example` documents `SUPABASE_SERVICE_ROLE_KEY` with the comment *"Only needed if a server action/route requires bypassing Row Level Security."* That is precisely what this section forbids.

**Ruling: strip it.** Remove `SUPABASE_SERVICE_ROLE_KEY` from `.env.example`, the README, and the Dockerfile. If an operational script ever needs it (backups, admin tooling), the key lives in that script's own environment — never in the app's. A documented env var is an invitation, and this one invites a tenant leak.

---

## 5. Timer Semantics

### 5.1 State machine

A timer is not a separate entity. **A running timer is a `time_entries` row with `ended_at IS NULL`.** There is no in-memory timer state, no client-held state, no Redis.

```
[no active entry] --start--> [running] --stop--> [closed]
                                 |
                                 +--discard--> [deleted]
```

- **Start:** insert with `started_at = now()` (server clock), `ended_at = NULL`.
- **Stop:** update `ended_at = now()`. Only transition allowed on a running entry besides discard.
- **Discard:** delete a *running* entry outright. Permitted because nothing was ever recorded as complete. The only DELETE any user can perform on `time_entries`.
- **Switch project mid-timer:** stop, then start a new entry. Never mutate `project_id` on a running timer — that would silently misattribute already-elapsed minutes.

### 5.2 Overlap

**[R] Overlapping entries for the same user are forbidden**, enforced by the exclusion constraint in §3.7. One person cannot be in two places. This surfaces as a database error the actions layer must translate into a readable message ("This overlaps an entry from 14:00–15:30"), not a stack trace.

Different users overlapping is normal and unconstrained.

### 5.3 Clock skew

**[R] The client never sends a timestamp for timer start or stop.** Both are `now()` evaluated in Postgres. A device with a wrong clock or a user gaming their phone's time cannot affect recorded duration.

The elapsed counter shown in the UI is display-only, computed from `started_at` returned by the server. It is never the source of the saved value.

Manual entries *do* accept client-supplied times — they're a deliberate assertion, not a measurement. They're validated server-side (§6.4, §7.1).

### 5.4 Stale timers

A timer running longer than `companies.max_timer_hours` (default 12) is **stale**.

**[R] Stale timers are never auto-closed.** Silently writing an `ended_at` the system invented is fabricating a work record. Instead:

- The employee sees a blocking prompt on next load: *"Your timer has been running 19 hours. When did you actually stop?"* — offering (a) stop now, or (b) submit a correction with the real end time.
- The admin dashboard lists stale timers as an exception queue.
- The entry contributes zero to reports while `ended_at IS NULL`. Running time is never counted.

### 5.4.1 Amendments from implementation (`BLOCKERS.md` N-9, closed 2026-08-25)

- **Option (b) — "submit a correction with the real end time" — now has a UI entry point on the stale-timer prompt itself.** Phase 7's correction-submission UI originally offered its affordance only on closed entries (a scoping choice made before this specific running-entry case was worked through), leaving the database-supported path unreachable through the product; §7.4.1 records the backend side (`approve_correction`'s narrow running-entry exception) as always having supported this. `StaleTimerPrompt` now switches, in place, between the two-choice prompt and `CorrectRunningEndTimeForm` — a form deliberately narrower than the general amend-correction form, proposing only `proposedEndedAt` (no start, project, task or note), matching exactly what `running_entry_reattribution` permits on a running row. Filing the correction counts as "keep going": the timer stays running until an admin approves it, so a successful submit dismisses the prompt for the page load the same way the explicit "It's still running" button does.

### 5.1.1 Amendments from implementation (Phase 5)

- **§4.2's `time_entries` UPDATE cell ("self only while `ended_at IS NULL`") cannot be a row policy's `USING` clause literally** — placed there, it makes a closed row unreachable for any update at all, which contradicts §7.1's "Edit the note on their own entry: Yes" for closed entries. `USING`/`WITH CHECK` can each see only one side of an update (old or new), and "`ended_at` may change only when it was NULL before" is a statement about both sides together — structurally not expressible as a single policy clause, not a matter of finding cleverer SQL. Built as three layers instead: a permissive row policy (owner, own company, any row), a column `GRANT UPDATE (ended_at, note)` restricting *what* can ever be touched, and a trigger (`time_entries_guard_update`) that alone can compare old and new to refuse `ended_at` changing on an already-closed row. The joint behavior matches §4.2 + §7.1 + §7.2 together; no single piece matches §4.2's wording alone. Two permissive policies (one scoped to `ended_at IS NULL`, one unrestricted for notes) was considered and rejected — Postgres ORs permissive policies for the same command, so the narrower one would have contributed nothing.
- **§4.2's `time_entries` DELETE cell reads "none" company-wide; §5.1 and §7.1 both describe an owner-scoped exception for discarding a running entry.** Built per §5.1/§7.1: the matrix's "none" governs the general case no admin bypass exists for, and discard is the explicit carve-out layered on top, not a contradiction of it.
- **Confirmed, not just intended: admins have no UPDATE or DELETE path on `time_entries` at all.** `is_admin()` appears nowhere in either policy. An admin cannot edit or delete anyone's entry, including their own closed ones — corrections (§7.3, §7.4) are the only route once an entry closes, for everyone.
- **Deleting an `auth.users` row now fails (`23503`) for any user who has recorded time entries** (`ON DELETE RESTRICT` from `time_entries` back to the user), where 0002 left this path open for `profiles` generally. This is §2.3's "loses access, keeps their time entries" and §3.11's "hard delete for nothing" made literal — deactivation, not deletion, is the only way to remove someone who has ever logged time. A user with no history can still be hard-deleted.
- **§5.3's clock-skew rule is enforced on `ended_at` as a value check, not a missing grant.** The column stays directly UPDATE-able (`SECURITY INVOKER` functions run with the caller's own privileges, so a `stop_timer()` RPC needs exactly the grant a raw `PATCH` would need — revoking it breaks the legitimate path along with the illegitimate one). Instead, `time_entries_guard_update()` rejects any `ended_at` value on the open-to-closed transition that isn't the database's own `now()`. `public.stop_timer(p_id)` exists as the one path that never has to think about this, but a client that somehow sent literally `now()` as a string would also pass — the invariant is "no client-*chosen* value can be stored," not "no direct PATCH can ever close an entry." Verified against the actual attack: before this fix, a raw API call could set `ended_at` to an arbitrary future timestamp and inflate a real entry to 29,391 hours; after, the same call is rejected `42501`.
- **For Phase 7, read before touching this migration:** `time_entries_guard_update()` will reject the approve-correction function's own mutation of a closed entry — a `SECURITY DEFINER` function bypasses RLS and column grants but not triggers. The fix is a transaction-local flag the approval function sets and the trigger checks, added via a `create or replace function` in a new migration — never by dropping or weakening the trigger, which is the entire mechanism keeping a closed entry immutable to everyone but that one audited path.

### 5.5 Midnight and long spans

**[R] Entries are never split across days.** A shift from 22:00 to 03:00 is one row spanning five hours.

**[R] An entry is attributed entirely to the calendar day of its `started_at`**, evaluated in the company timezone. A 22:00→03:00 shift counts five hours on the start day, zero on the next. Splitting proportionally is more "accurate" and produces reports nobody can reconcile against a paper timesheet.

---

## 6. Time & Timezone Rules

**6.1 [R] Storage is UTC; day boundaries are company-local.** `companies.timezone` defines what "Monday" means in every report:

```sql
(started_at AT TIME ZONE c.timezone)::date
```

Never `date_trunc('day', started_at)` — that buckets by UTC and shifts every report by the offset.

**6.2 [R] Per-user timezones are out of scope for v1.** A single company operating across timezones would need them; none is described. Adding `profiles.timezone` later with fallback to company timezone is additive and cheap. Flagged rather than pre-built.

**6.3 DST.** Because everything is `timestamptz` and durations are computed as instant differences, a shift spanning a DST boundary records true elapsed time (a 23-hour or 25-hour "day" is handled correctly). No special-casing required. This is a consequence of the type choice, stated so nobody "fixes" it later.

**6.4 No future entries.** Neither `started_at` nor `ended_at` may exceed `now() + 5 minutes`. The grace absorbs minor clock drift on manual entry; anything beyond is rejected.

*Amended.* This section originally named `started_at` alone. `assert_entry_window_valid()` (`0006_corrections.sql`) already applied the rule to both ends on the correction path, reasoning that an interval which has *ended* ended in the past — so the wider rule can refuse nothing legitimate. Its comment assumed §7.1's today-only rule "incidentally caps the other end" for a manual entry; it does not, because today-only tests `companyLocalDate(started_at)` and says nothing about where `ended_at` falls. Until `createManualEntry` was brought into line, a manual entry submitted at 10:00 for 09:00 → 23:59 booked fourteen hours nobody had worked, and 09:00 → tomorrow 05:00 passed too. The amendment closes a divergence between the two paths rather than inventing a rule.

---

## 7. Entry Editing & Corrections

This is the heart of the product and the section most likely to be misimplemented. The design intent: **an employee cannot quietly rewrite their own history.**

### 7.1 What an employee may do without approval

| Action | Allowed |
|---|---|
| Start / stop / discard their own timer | Yes |
| Create a manual entry dated **today** | Yes |
| Edit the `note` on their own entry | Yes |
| Edit times on a **closed** entry | **No** → correction request |
| Delete a **closed** entry | **No** → correction request |
| Create an entry dated **before today** | **No** → correction request |
| Touch another user's entry | Never, at any privilege level below admin |

"Today" means the current date in the company timezone.

**7.1.1 [OPEN]** A `correction_grace_minutes` company setting would let an employee fix a typo within, say, 15 minutes of stopping without bothering an admin. Reduces queue noise; slightly weakens the audit line. Not built pending a call — see §10.

### 7.2 Why UPDATE on `time_entries` is restricted at the policy level

The RLS UPDATE policy allows the row owner to update **only while `ended_at IS NULL`** (plus a note-only path). Once closed, the row is immutable to the employee *at the database*, not merely hidden in the UI. Approved corrections are applied by a `SECURITY DEFINER` function, not by a client-issued update.

### 7.3 [R] Approved corrections mutate in place and write a revision row

**Approve → apply changes directly to `time_entries`, after inserting the prior state into `time_entry_revisions`.**

The alternative — voiding the old row and inserting a superseding one — pushes a `WHERE voided_at IS NULL` filter into every single report query forever, and one forgotten filter double-counts hours. Mutation keeps the read path clean while `time_entry_revisions` preserves the full trail: what it was, what it became, who approved, why.

**Reversible before implementation.** If strict immutability is ever required (some payroll audits are), it changes `time_entries` and every report query.

### 7.4 Correction lifecycle

```
employee submits ──> pending ──> approved  (applied atomically, revision written)
                        │
                        ├──────> rejected  (review_note required)
                        │
                        └──────> withdrawn (by requester, only while pending)
```

**Rules:**

- Applying a correction is one transaction: validate → snapshot to revisions → mutate/insert/delete → mark request approved. Partial application is not possible.
- Approval **re-validates** against overlap and future-date rules at approval time, not submission time. The world moved while it sat in the queue.
- If approval would create an overlap, it fails with a specific message naming the conflicting entry. The admin resolves it; the system does not pick a winner.
- An admin cannot approve their own correction request. **[R]** — self-approval makes the whole workflow decorative. A second admin reviews. If a company has one admin, that admin edits entries directly (admin edits also write revision rows) rather than routing through a request.
- A rejected request is terminal. The employee submits a new one; the rejected record stays for the audit trail.
- Requests referencing an entry that was since deleted are auto-marked `withdrawn` at approval time rather than erroring.

---

### 7.4.1 Amendments from implementation (Phase 7)

- **The guard-trigger bypass from §5.1.1 (Phase 5's `time_entries_guard_update`) is defeated by `SECURITY DEFINER` ownership, not by the transaction-local flag alone.** The flag (`timey.bypass_entry_guard`) is a custom GUC and *is* forgeable by any authenticated client — proven directly. What actually holds the line is that the trigger also checks `current_user` equals the function owner, and no authenticated session can become that role (`SET ROLE`, a forged JWT claiming `role: postgres`, and every PostgREST-reachable GUC-injection vector were each tried and refused). Recorded because "the flag is scoped" would have been a false description of the real mechanism — the flag alone proves nothing; only the combination does.
- **Corrections cannot reattribute a running entry's `project_id`/`task_id`/`started_at`, but can still close one with a backdated `ended_at`.** §5.1's "never mutate `project_id` on a running timer" has no admin exception in its wording, and nothing in §7 needs one — reattribution was an unused capability the implementation exposed, not a flow any part of §7 or §5.4 requires. The §5.4 stale-timer flow's second option ("submit a correction with the real end time") **does** need to touch a running entry, and remains fully supported: an amend correction supplying only `proposed_ended_at` closes a stale running entry at the true time, re-validated at approval like any other correction. If future work ever wants full reattribution on a running row, that is a spec change to §5.1, not an implementation gap.
- **§5.4's "(a) stop now, or (b) submit a correction with the real end time" is read as two alternatives, not two sequential steps** — confirmed by re-reading against the rule immediately above it ("stale timers are never auto-closed... the entry contributes zero to reports while `ended_at IS NULL`"). A stop-then-correct reading would force every stale timer through a materialized, fully-counted, wrong-duration closed entry before it could ever be fixed — exactly what that rule forbids. Flagged explicitly since the alternate reading was seriously considered and rejected, not overlooked.
- **A single-admin company now has direct paths for all three correction kinds, not just amend (`0010_admin_direct_entry_paths.sql`, closing `BLOCKERS.md` N-8).** `admin_delete_entry`/`admin_create_entry` join `admin_edit_entry`, sharing their validation with `approve_correction`'s matching branches (`apply_entry_create`/`apply_entry_delete`, extracted alongside the pre-existing `apply_entry_change`) rather than duplicating overlap/future-date/membership logic a third time. `admin_delete_entry` stays closed-entries-only — it does not inherit §4.1.1's orphaned-running-entry exception, since deleting a still-running measurement in one step is new scope N-8 never asked for; an orphan is closed first (`admin_edit_entry`), then deleted normally. `admin_create_entry` carries no today-only restriction, matching `approve_correction`'s own `create` kind — this path is explicitly the backdating escape hatch, and §6.4's future guard is what actually bounds it.
- **Employees cannot see revisions of their own entries.** §4.2 states `time_entry_revisions` SELECT as "admin," read literally — not widened to admit self-viewing, since building that without a UI need for it would be exactly the kind of unrequested surface §0.2 warns against. If employee-visible correction history is wanted, that's an additive §4.2 amendment when a UI actually needs it.
- **PostgREST's HTTP status for a raised error code is not a reliable signal — branch on `error.code`, never on HTTP status.** Measured directly: a custom `P0002` (not-found) surfaces as a bare `500`, indistinguishable from a real server fault unless the Postgres error code in `error.details`/`error.code` is read; `23P01` (the overlap exclusion) surfaces as `400`. The implementation-layer error table in `0006_corrections.sql` now states both the wire status and the intended API-facing status side by side specifically so this isn't rediscovered per-action.
- **`admin_edit_entry` has one narrow exception to "running entries are refused" (`0009_orphaned_running_entries.sql`, closing `BLOCKERS.md` N-10).** Deactivating a user (§4.1.1) correctly locks them out of stopping their own running timer — but left no path for anyone else to close it either, since this function's running-entry refusal has no role exception in its own wording and `time_entries` has no admin-write RLS policy at all. The exception is scoped to exactly that dead end: an admin may close (not reattribute) a running entry **only when its owner is currently inactive**. An active employee's running timer remains completely untouchable by any admin, unchanged. Reattribution (`project_id`/`task_id`/`started_at`) stays refused even in the exception case — the fix makes an orphaned entry *closeable*, not *editable while still running*; full editing is available afterward, once closed, through the same admin-edit path everything else uses.

## 8. Onboarding & Invitations

**Status: entirely unbuilt.** `src/app/` contains only `/` and `/api/health`. No sign-in, sign-up, onboarding, or invite-accept route exists. §8 is a full route tree from zero, not an addition to an existing auth surface.

### 8.1 Two entry paths

```
Path A — founder:   sign up → create company (becomes admin) → clients/projects/tasks → invite team
Path B — invitee:   receives link → sign up or sign in → profile bound to that company_id + role
```

**8.2 [R] Company creation is a `SECURITY DEFINER` function**, not two client-side inserts. It creates the company and sets `profiles.company_id` + `role = 'admin'` atomically. Two separate inserts can leave a user stranded with a company they aren't a member of.

**8.3 A user whose `profiles.company_id IS NULL` is in limbo.** Middleware routes them to onboarding and blocks every other authenticated route. This state exists between signup and company creation, and is the only valid null.

**Built in Phase 2.** `src/lib/supabase/middleware.ts` now performs the full guard: unauthenticated → `/sign-in`; authenticated + `company_id IS NULL` → `/onboarding`, blocked from every other route; authenticated + has a company → through, with `/onboarding` and the auth-only pages redirecting on to `/dashboard`. Verified against the local stack, not just typechecked.

**8.3.1 Amendment — a limbo user hitting `/sign-in` is bounced to `/onboarding`, not shown the sign-in form.** The spec doesn't say where this case goes. Redirecting to onboarding is consistent with "blocks every other authenticated route" read literally — but it means a signed-in limbo user cannot reach `/sign-in` to switch accounts without first signing out. `/onboarding` therefore carries a sign-out control as the only way off the page. Without it, that user would be stuck.

**8.3.2 Amendment — the email-confirmation callback (`BLOCKERS.md` N-3, closed 2026-08-25).** `signUp()` already returned `confirmationRequired: true` when Supabase's `enable_confirmations` is on, but no route existed to complete the loop: nothing exchanged the emailed link's token for a session. Built as `GET /auth/confirm` (`src/app/auth/confirm/route.ts`), calling `supabase.auth.verifyOtp({ type, token_hash })` and redirecting on to `next` (default `/dashboard`, validated through the same `safeNextPath` the other auth pages use) or, on failure, to `/sign-in?error=confirmation_failed`. Added to middleware's public paths — the visitor has no session until this route creates one. `supabase/templates/confirmation.html` overrides the default "Confirm signup" email to link here with `token_hash`/`type=signup` in the query string, rather than at Supabase's own hosted verify endpoint, whose default template lands a session as a URL fragment no server component can read. Verified end to end against the local stack with `enable_confirmations` temporarily flipped on: signed up via the real Auth API, pulled the actual email from Mailpit, followed its link, confirmed the session cookie was set and a limbo user landed on `/onboarding` through ordinary middleware routing — then flipped the setting back off, matching `BLOCKERS.md`'s standing default for local dev.

**8.4 Invitation rules:**

- The raw token appears only in the emailed URL; the database stores a hash. A leaked database backup must not grant company access.
- One-time use: `accepted_at` set atomically on acceptance.
- Expiry: 7 days, enforced server-side at acceptance, not just filtered in the list view.
- **A user who already belongs to a company cannot accept an invitation.** Direct consequence of §2. The error must say so plainly rather than failing generically.
- Re-inviting the same email replaces the outstanding invitation rather than stacking a second one.
- Revoking deletes the row; the link stops working immediately.

### 8.4.1 Amendments from implementation (Phase 3)

- **§4.2's "admin (revoke)" UPDATE cell on `invitations` is not built.** §4.2 and §8.4 disagree: the matrix lists UPDATE as an admin verb, but §8.4 describes only deletion for revoke and no other in-place mutation. Resolved toward §8.4, the more specific rule — `invitations` has no UPDATE policy (`using (false)`) and no UPDATE grant at all. The only write to `accepted_at` is `accept_invitation()`, which is `SECURITY DEFINER` and bypasses policy entirely. A write surface with no legitimate caller, on a table whose rows are bearer credentials, is worth removing rather than granting. Reopening an update path later is additive.
- **The invitation token is matched to the signed-in account's email, case-insensitively — not just to whichever account redeems it.** §8.1 Path B doesn't say whether the accepting account must match the invited address. Enforced because without it the token becomes a bearer credential for company membership: forwarded, pasted into Slack, or read from a shared inbox, it would admit whoever holds it. The failure is legible and recoverable — "this invitation was sent to X, but you are signed in as Y" — and the admin re-invites the address actually in use.
  - This is defense-in-depth, not proof of identity: with `enable_confirmations = false` (true for local dev), an email address is a claim, not a verified one, so the token itself remains the load-bearing credential.
  - A caller with no email on their account (`auth.users.email IS NULL` — a phone-only signup) can never accept any invitation under this rule. No case in the current signup flow produces such an account, so this is latent rather than active, but it should be revisited if a phone-auth path is ever added.
- **Re-invite "replace" (§8.4) is delete-then-insert at the application layer, not atomic.** The partial unique index (`(company_id, email) WHERE accepted_at IS NULL`) makes stacking a second outstanding invitation impossible, but two admins re-inviting the same address concurrently can race: one succeeds, one gets `23505` on the insert. Accepted as a known, safe-failing limitation — the loser sees "an invitation to this address is already pending," not a security or data-integrity issue, and this is a two-admin-races-in-the-same-second scenario, not a v1 priority. Revisit if it proves to matter in practice; the fix is a `SECURITY DEFINER` `create_invitation()` doing both steps in one transaction.
- **§10 item 5's "email on invite is required" is answered: Resend (`BLOCKERS.md` N-6, closed 2026-08-25).** `createInvitation()` now attempts a send through `src/lib/email/resend.ts` after the invitation row exists, using a server-only `APP_URL` env var to build the link — `InviteLink`'s `window.location.origin` trick isn't available outside a browser. Deliberately best-effort and outside the action's own try/catch: the invitation and its copyable link are the ground truth (`accept_invitation()` never knows or cares how the invitee got the token), so a missing Resend key, a missing `APP_URL`, or a provider outage degrades to `emailSent: false` — the same copyable-link fallback the product already had — rather than turning a created invitation into a reported failure. This is also why a freshly forked template keeps working with zero email configuration, matching `CLAUDE.md`'s "the app still starts without Supabase configured" posture. Only invitation email is in scope here; Supabase Auth's own emails (§8.3.2's confirmation link, password reset) are a separate delivery path GoTrue owns, configured via SMTP on a hosted project rather than through this module.
- **`invitation_preview(p_token)` was added beyond the three tables/functions this phase's plan named.** `SECURITY DEFINER`, granted to `anon` and `authenticated`, returns only what the invitation email itself would already say (company name, invited email, role, expiry, accepted/expired flags) for a valid token — never `token_hash`, `id`, or `company_id`. Necessary because the accept page must name the company before the invitee has an account at all, and `invitations` SELECT is admin-only; without this function the next implementation pass would have faced a query that only works by loosening that policy, which is the exact failure `write-migrations` exists to prevent (§0.2). It is a token-validity oracle by nature — inherent to any accept endpoint — mitigated by tokens being 256-bit random.

---

## 9. Reporting

**9.0 Policy performance note (from Phase 1).** Phase 1's policies call `public.current_company_id()` directly, which Postgres evaluates per row. Wrapping it as `(select public.current_company_id())` lets the planner hoist it to an InitPlan and evaluate it once per statement. Negligible on `companies` and `profiles`; adopt the subselect form from `time_entries` onward, where row counts make it matter.

**9.1 [R] Reports are aggregate SQL run through `lib/actions/**`.** No materialized views, no client-side aggregation of raw entries, no nightly rollup jobs in v1. At the scale of one company's timesheets, a properly indexed `GROUP BY` is correct and stays correct.

**9.2 Every report is defined by:** a date range (company-local days, inclusive) plus filters on any of user, client, project, task. Admins may filter by any user; employees are hard-scoped to themselves by RLS regardless of what the UI sends.

**9.3 Required groupings:** by day, by user, by project, by task, by client. Cross-tabs (user × project) are the useful ones in practice.

**9.4 Running entries are excluded from all report totals** (`WHERE ended_at IS NOT NULL`). Shown separately as "in progress" where useful.

**9.5 [R] Durations are summed as integer seconds and formatted at the edge.** Never summed as floating-point hours — rounding drift across hundreds of rows produces totals that don't match their own line items, which destroys trust in a timesheet faster than any bug.

**9.6 CSV export** of any report view. **[OPEN]** — is CSV enough for v1, or are PDF timesheets needed for signature?

---

## 10. Open Decisions

Ordered by how much rework a late answer causes.

| # | Decision | Impact if deferred |
|---|---|---|
| 1 | **§7.1.1** — `correction_grace_minutes` window for self-service fixes, or strict zero-tolerance | Medium. Adds a company setting and a branch in the entry-edit action. |
| 2 | **§3.5.2** — mandatory task on every entry (current ruling) vs. optional | Medium. Nullable `task_id` changes report joins. Decide before the first migration. |
| 3 | Timesheet **period approval** — does an admin approve a whole week, locking it? Currently entries count immediately and only *corrections* are approved. | Medium. Adds a `timesheet_periods` table and a lock check on every write. Additive if deferred. |
| 4 | **§12.1** — when to revisit automated DB tests (deferred, not cancelled) | Medium and growing. The longer the RLS surface grows untested, the more expensive retrofitting becomes. |
| 5 | Notifications — email on invite is required. Email on correction submitted/approved/rejected? | Low. Additive. |
| 6 | **§9.6** — CSV only, or PDF timesheets too | Low. Additive. |
| 7 | Does an employee see **company-wide** totals, or only their own? Spec assumes only their own. | Low, but it's an RLS policy, so confirm before writing it. |

**Resolved in v1.1:** §7.3 correction model (mutate + revision log), §4.4 service-role key (strip it), §0.2 SQL agent ownership (add it), §12.1 automated DB tests (defer with manual fallback).

---

## 11. Reconciliation Findings — Resolved

Verified against the repository. Summary: **no data-model conflicts.** The repo is a blank slate.

| Area | Finding | Status |
|---|---|---|
| `supabase/migrations/` | Does not exist. Removed with the todo demo; git doesn't track empty dirs. | No conflict. Recreate — §0.1 |
| `supabase/config.toml` | Absent. No local Supabase project initialized. | Blocking prerequisite — §0.1 |
| `src/types/supabase.ts` | Hand-written placeholder, `Tables: Record<string, never>`. Not generated. | No conflict. Regenerate per migration — §0.1 |
| `src/lib/actions/**`, `src/lib/validations/**` | Empty/absent. `todos.ts` deleted. | No pattern to inherit beyond the `{ ok, data } \| { ok, error }` shape in `CLAUDE.md`. Original §11 item 4 **struck**. |
| Middleware | Session refresh only. No auth guard, no `company_id` check, no destination routes. | Largest gap — §8.3 |
| `btree_gist` / `citext` | Unverifiable from the repo; no migrations, no config. | Must be migration #1 — §0.1 |
| Service-role key | `.env.example` documents it as an RLS bypass for server actions — directly contradicts §4.4. | **Resolved: strip it** — §4.4 |
| Agent routing | No owner for `supabase/migrations/**` or RLS policies. | **Resolved: add a SQL agent** — §0.2 |
| DB test coverage | Vitest + jsdom only. Constraints, RLS, and the approve transaction are untestable by the current suite. | **Resolved: defer, with manual checklist** — §12 |

---

## 12. Verification & Testing

### 12.1 [R] Automated database tests are deferred for v1

The gate stays as `CLAUDE.md` defines it: `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm build`.

**What this means in practice, stated plainly so it isn't discovered later:** a green gate does **not** verify that an employee can't read another employee's entries, that two tabs can't start two timers, or that the approve-correction transaction is atomic. Those live in Postgres; Vitest + jsdom cannot see them. Every RLS policy and constraint in this spec is, for now, verified by hand (§12.2).

Deferred, not cancelled. Revisit (§10, item 4) when either happens:

- the first real user data exists, or
- a second company is onboarded — the moment a tenancy bug stops being theoretical.

The likely eventual shape: Vitest integration tests against a local Supabase stack under a separate `pnpm test:db` command, authenticating as two real users through `supabase-js` and asserting what each can and cannot see. Not pgTAP — asserting through the same client the app uses is a stronger guarantee than asserting about SQL objects, and it avoids a second toolchain.

### 12.2 Manual verification checklist

Run after any migration touching RLS or `time_entries`. Two browser profiles, two accounts, one company.

**Tenancy**
- [ ] Employee B cannot see Employee A's time entries anywhere in the UI
- [ ] Employee cannot see a project they aren't a member of
- [ ] A user from Company 2 sees nothing belonging to Company 1
- [ ] Employee hitting an admin route directly by URL is blocked, not just hidden from the nav

**Timer constraints**
- [ ] Two tabs, both press Start → second fails with a readable message, not a second timer
- [ ] Manual entry overlapping an existing entry → rejected, with the conflicting time range named
- [ ] Entry with `ended_at` before `started_at` → rejected
- [ ] Entry starting an hour in the future → rejected

**Corrections**
- [ ] Employee cannot edit a closed entry through the UI
- [ ] Employee cannot edit a closed entry via a direct API call (the real test — RLS, not UI)
- [ ] Approving a correction writes a `time_entry_revisions` row with correct prior values
- [ ] Approving a correction that would now overlap → fails cleanly, entry unchanged, request still pending
- [ ] Admin cannot approve their own request

**Time & reporting**
- [ ] A 22:00→03:00 entry appears entirely on the start day, in company timezone
- [ ] A running timer contributes zero to report totals
- [ ] Report totals equal the sum of their own visible line items

### 12.3 shadcn primitives

**Installed:** button, card, dialog, dropdown-menu, field, input, label, separator, sonner, table.

**Needed, not yet installed:**

| Primitive | Needed for |
|---|---|
| date/time picker | Manual entries and correction proposals (§7.1) |
| combobox / select | Client → project → task cascade |
| tabs | Admin queue vs. own corrections |
| badge | Status pills: pending / approved / rejected / stale |
| calendar (range) | Report date filters (§9.2) |

Note: the report and queue grids need a sortable, filterable data table. In shadcn that's a TanStack Table recipe, not a single primitive — treat it as a build chunk with its own dependency, not a `pnpm dlx` away.

Add via `pnpm dlx shadcn@latest add <name>`. Per `CLAUDE.md`, generated files in `src/components/ui/**` are not hand-edited.