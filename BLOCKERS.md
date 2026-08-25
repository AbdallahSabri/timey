# Blockers

Things that stop a phase, or that were worked around in a way worth knowing about. Newest first within each section.

Each open blocker names the phase it stops and the **default it will proceed on** if unanswered — nothing here silently waits forever. A default is always the standing `SPEC.md` ruling, never an invention.

---

## Open — decisions owed

### B-4 · Should project names be unique per company? — non-blocking

**`SPEC.md` §3.4.** §3.3 (`clients`) and §3.5 (`tasks`) both specify a case-insensitive unique index scoped to active rows; §3.4 (`projects`) specifies none, and Phase 4 built exactly that — confirmed in verification, creating two projects named "Website Rebuild" in the same company succeeds. Likely an oversight rather than a deliberate asymmetry, but the spec is unambiguous as written, so implementation followed it rather than guessing.

**Default if unanswered:** leave as-is — no uniqueness constraint on `projects.name`. Adding one later is a straightforward additive migration (`clients_write_error_message`-style branching in `src/lib/actions/projects.ts` already anticipates the constraint's error text, so the code change is near-zero once the index exists).

### B-5 · CSV only, or PDF timesheets too? — non-blocking

**`SPEC.md` §10 item 6, §9.6.** CSV export is required for v1 regardless of the answer; PDF (for signature) is the open question.

**Default if unanswered:** CSV only for Phase 8. PDF generation is additive — a separate chunk with its own rendering dependency, not a blocker to shipping reporting.

---

## Resolved — decisions answered

### D-4 · N-7 closed — deactivated members lose all access, 2026-08-25

**`SPEC.md` §2.3, §4.1.1.** `current_company_id()` (migration `0008_deactivation_scope.sql`) now filters on `status = 'active'`, matching `is_admin()`'s existing check. Since every RLS policy in the schema keys off this one function, a single body-only change closed read and write access to all ten tenant tables at once — verified per table, including the specific Phase 5 finding (new timer starts) that first escalated this. Reactivation restores access immediately, same session, no re-login (the function reads live, nothing is cached in a claim). One new gap surfaced while closing this one — see N-10.

### D-3 · `correction_grace_minutes` — proceeded on default, 2026-08-25

**`SPEC.md` §10 item 1, §7.1.1.** Unanswered through Phase 7; proceeded on the stated default — strict zero-tolerance, no grace window. Every closed-entry edit routes through a correction request or `admin_edit_entry`, with no exception for a fix made minutes after stopping. Adding a grace window later is additive (a `companies` column plus a branch in the entry-edit path); the corrections machinery it would sit alongside is already built and doesn't need to change shape to accommodate it.

### D-1 · `task_id` is mandatory — answered 2026-08-25

**`SPEC.md` §10 item 2, §3.5.2.** Confirmed as the spec's standing ruling: `time_entries.task_id` is `NOT NULL`, and every project auto-creates a `"General"` task so the entry flow is never blocked. All data stays reportable at task level. Applies from Phase 4.

### D-2 · Employees see only their own time — answered 2026-08-25

**`SPEC.md` §10 item 7, §4.2, §9.2.** Confirmed as the spec's assumption. The `time_entries` SELECT policy scopes employees to `user_id = auth.uid()`; only admins see company-wide data. Applies from Phase 5.

---

## Resolved — worked around, recorded for context

### R-1 · Local Supabase port range moved to 545xx (Phase 0)

The Supabase default port range (54321–54327) was **fully occupied by another local Supabase project** (`social-scheduler`) plus a self-hosted stack. `supabase start` failed on `Bind for 0.0.0.0:54322: port is already allocated`.

**Resolution:** moved this project to the 545xx range in `supabase/config.toml` (API 54521, DB 54522, Studio 54523, Inbucket 54524, shadow 54520, pooler 54529, analytics 54527) rather than stopping the other project's stack. Both now run side by side. Documented in the README.

**Consequence:** anyone cloning this repo gets the non-default ports. `NEXT_PUBLIC_SUPABASE_URL` must point at `http://127.0.0.1:54521` locally, not the usual `54321`.

### R-2 · `pnpm test` could not pass (Phase 0)

The gate requires `pnpm test` clean, but Vitest was exiting 1 with "No test files found" — the todo demo's tests had been the entire suite, so every phase in `PLAN.md` was claiming a green gate against a suite that structurally could not produce one.

**Resolution:** added five real tests for `src/app/api/health/route.ts` covering its actual branches. Rejected `passWithNoTests: true`, which would have made an empty suite permanently acceptable.

### R-3 · `supabase/` tree broke lint and format (Phase 0)

Once `supabase/` existed, `pnpm lint` reported 205 problems and `pnpm format:check` failed — all from generated Deno edge-runtime files under `supabase/.temp/`.

**Resolution:** ignored `supabase/**` in `eslint.config.mjs` and `.prettierignore`. That tree is SQL, TOML, and Deno; none of it belongs to the Next/TypeScript toolchain.

---

## Known, not blocking

### N-10 · A running timer becomes unstoppable if its owner is deactivated mid-shift (found closing N-7)

**`SPEC.md` §2.3, §5.1, §7.4.1.** Proven with an isolated repro, not reasoned: deactivate a user while their timer is running, and *every* closing path refuses. The owner is blocked by N-7's own fix (`current_company_id()` now NULL for them). An admin's `stop_timer()`/raw `UPDATE`/`DELETE` all silently no-op — `time_entries` has no admin-write policy at all, by design (corrections are the only admin path). `admin_edit_entry()` explicitly refuses a *running* entry (Phase 7's deliberate guard, added after review). Neither the owner nor an admin can file a correction against it either — the owner is locked out entirely, and `correction_requests` INSERT requires `requested_by = auth.uid()` on the requester's own entry, which an admin's account never satisfies for someone else's row.

The one working exception: a correction filed **before** deactivation can still be approved afterward (`approve_correction` doesn't check the requester's current status) — so the dead end is specifically *running timer + no pre-filed request + deactivation*.

Admins can still **see** the stuck entry (`report_summary.running_count` includes it), so it surfaces as something visible in the exception queue that nothing can act on — worse than silent, since it looks fixable and isn't.

**Default if unanswered:** the one confirmed working escape is reactivate → owner stops their own timer normally → deactivate again. A real workaround, not a fix. Closing it properly is a human call between two options, both of which are deliberate departures from decisions already made on record: weakening Phase 7's running-entry refusal on `admin_edit_entry` (added after explicit review, and §5.1's "never mutate a running timer" carries no role exception in its wording), or adding a new, currently-unspecified admin capability to close or discard someone else's running entry. Closest existing shape to extend is N-8's `admin_apply_entry_change()` proposal.

### N-9 · §5.4's "submit a correction with the real end time" has no UI entry point yet (Phase 5/7)

**`SPEC.md` §5.4, §7.4.1.** The database fully supports this: `approve_correction` explicitly allows an amend proposing only `proposed_ended_at` against a **running** entry, closing it at the corrected time (verified end to end in Phase 7). But the correction-submission UI only offers its affordance on **closed** entries — my own scoping instruction for the Phase 7 UI pass restricted it that way, before this specific running-entry case was fully worked through. The stale-timer prompt (Phase 5) honestly says a correction "can't be done from here yet" rather than offering a broken link, so nothing is misleading — but §5.4's second option is currently unreachable through the product.

**Default if unanswered:** leave the honest gap as-is. Closing it is additive and small: the stale-timer prompt needs a path to the existing amend-correction form, scoped to propose only `proposedEndedAt` against the running entry — no new backend work, since `approve_correction` already handles this case correctly.

### N-8 · A single-admin company cannot delete or create a backdated entry at all (Phase 7)

**`SPEC.md` §7.4.** The correction queue requires a *different* admin to approve (self-approval is blocked, deliberately — §7.4 [R]). `admin_edit_entry` (the direct-edit path for single-admin companies) only amends an existing entry; it has no delete or create counterpart. Put together: a company with exactly one admin has no path to ever delete an erroneous closed entry or create a backdated one on an employee's behalf — not through the queue (no second admin to approve it) and not directly (the function doesn't cover those two kinds).

This is a real, reachable gap for the most common company size — every company starts with exactly one admin (§8.1 Path A) and many will stay that way. Not blocking Phase 7's own exit criteria (the `amend` path works fully, verified end to end), but it should be closed before real single-admin companies rely on corrections.

**Default if unanswered:** leave the gap open — an affected company's workaround today is temporarily promoting a second admin to approve, then demoting them back (both already-working paths from Phase 1/3). Closing it properly means extending `admin_edit_entry` to a `kind`-aware `admin_apply_entry_change()` covering delete and create, mirroring `approve_correction`'s three branches — an additive migration, not a redesign.

### N-3 · No email-confirmation callback route (Phase 2)

`signUp` already handles the case where Supabase returns no session (confirmations on) by returning `confirmationRequired: true`, and the UI shows a "check your email" state — but there is no `/auth/confirm` route to exchange the email link's `token_hash` for a session. `enable_confirmations = false` locally, so this path has never actually run.

Not blocking today because local dev has confirmations off. It becomes blocking the moment a hosted Supabase project (which defaults confirmations on) is targeted, or naturally lands as part of Phase 3's invitation-acceptance work, which needs the same token-exchange machinery. Whoever picks it up should flip `enable_confirmations = true` locally once and walk the flow for real before shipping it — it has never been exercised, only typechecked.

### N-4 · Repeated inline `profiles` + `companies` reads — closed in Phase 3

The dashboard queried `profiles`/`companies` directly in a Server Component (an explicitly allowed read-only exception, not a new server action). Phase 3's member list and admin-gating UI wanted the same "current member + company + role" read.

**Closed:** `getCurrentMember()` exists in `src/lib/actions/companies.ts` and is now the only path — `/dashboard`, `/members`, and `/invite/[token]` all call it, and no page queries `profiles` inline any more.

### N-6 · No email delivery for invitations (Phase 3)

`SPEC.md` §8.4 describes the raw token as appearing "only in the emailed URL", and `PLAN.md` Phase 3 lists invite email as required (§10 item 5). **No email provider is wired up.** Nothing sends anything.

Phase 3 ships the link instead: `createInvitation` returns the raw token once, and `/members` renders `${origin}/invite/{token}` with a copy button and the on-screen caveat *"Share this link directly — email delivery isn't set up yet."* The admin pastes it into whatever channel they already use.

Two consequences worth stating rather than discovering:

- **The link is shown exactly once.** Only the SHA-256 is stored (§8.4), so navigating away from the page loses the raw token permanently — the remedy is revoke + re-invite, and the UI says so.
- **The channel is now the admin's problem.** A token pasted into a shared Slack channel is a bearer credential for one specific address; the §8.4.1 email match is what keeps it from being a bearer credential for *anyone*.

Not blocking Phase 3 — the flow is complete and verifiable without it. It becomes blocking for anything resembling real use, and it needs a provider decision plus a server-side send, which is `implement-logic` territory rather than a UI change.

### N-5 · Local database carries throwaway accounts from Phase 1 and 2 verification

Several `@example.test`/`@example.com` accounts and companies exist in the local stack from adversarial testing, including a few limbo profiles. Harmless — `pnpm exec supabase db reset` clears them via the migrations — but Phase 3's two-accounts-one-company manual verification (§12.2) may want a clean slate first.

### N-1 · Node version below the declared engine floor

`package.json` requires `node >=24`; the local machine runs **v22.14.0**. Every `pnpm` invocation prints an unsupported-engine warning. The Dockerfile builds on 24, so production is unaffected, and the full gate passes on 22.

Worth resolving so the warning does not train everyone to ignore pnpm's output — but it blocks nothing today.

### N-2 · A green gate does not verify the security model

Not a defect, but the most important standing caveat in the project, and it is easy to forget: `pnpm test` runs on jsdom and **cannot see Postgres** (`SPEC.md` §12.1). No RLS policy, constraint, or transaction in this project is covered by the automated gate. Those are verified by hand against the §12.2 checklist.

Every phase from 1 onward ends at *gate green **plus** its named §12.2 manual checks*. A phase reported as done on the gate alone is not done. Revisit automated DB tests after Phase 5 (`SPEC.md` §10 item 4), when the RLS surface is largest.
