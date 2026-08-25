# Blockers

Things that stop a phase, or that were worked around in a way worth knowing about. Newest first within each section.

Each open blocker names the phase it stops and the **default it will proceed on** if unanswered — nothing here silently waits forever. A default is always the standing `SPEC.md` ruling, never an invention.

---

## Open — decisions owed

### B-3 · `correction_grace_minutes` — blocks Phase 7

**`SPEC.md` §10 item 1, §7.1.1.**

Whether an employee may fix a typo within N minutes of stopping a timer without an admin approval round-trip. Reduces queue noise; slightly weakens the audit line.

**Default if unanswered:** strict zero-tolerance (no grace window), matching §7.1 as written. Adding the setting later is additive; removing it after employees rely on it is not.

---

## Resolved — decisions answered

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

### N-1 · Node version below the declared engine floor

`package.json` requires `node >=24`; the local machine runs **v22.14.0**. Every `pnpm` invocation prints an unsupported-engine warning. The Dockerfile builds on 24, so production is unaffected, and the full gate passes on 22.

Worth resolving so the warning does not train everyone to ignore pnpm's output — but it blocks nothing today.

### N-2 · A green gate does not verify the security model

Not a defect, but the most important standing caveat in the project, and it is easy to forget: `pnpm test` runs on jsdom and **cannot see Postgres** (`SPEC.md` §12.1). No RLS policy, constraint, or transaction in this project is covered by the automated gate. Those are verified by hand against the §12.2 checklist.

Every phase from 1 onward ends at *gate green **plus** its named §12.2 manual checks*. A phase reported as done on the gate alone is not done. Revisit automated DB tests after Phase 5 (`SPEC.md` §10 item 4), when the RLS surface is largest.
