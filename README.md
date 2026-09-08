# Timey

Time tracking for small teams. People start and stop a timer — or enter hours manually — against a **client → project → task** hierarchy, and those entries roll up into reports. Fixing a closed entry goes through an admin-approved correction, because the design intent behind the whole product is one sentence: **an employee cannot quietly rewrite their own history.**

**In scope:** time capture, project/task structure, team membership, missed-punch corrections, reporting, CSV export.
**Out of scope by design (not "later"):** billing, rates, invoicing, payroll export, screenshots, activity monitoring, GPS, idle detection.

All nine build phases are complete — the app is functional end to end against a real Supabase project.

## The documents

This repo is spec-driven; the prose is load-bearing, not decoration.

| File | What it holds |
| --- | --- |
| `SPEC.md` | The behavioral contract — numbered rulings on tenancy, RLS, timer semantics, corrections, reporting. If the code disagrees, the spec wins or the spec changes. |
| `PLAN.md` | Phase ordering (0–9) and the exit criteria each phase had to clear. |
| `BLOCKERS.md` | Decisions taken, workarounds recorded, and known non-blocking issues. Newest first. |
| `CLAUDE.md` | Stack rules, the gate, and the `.claude/agents/` routing table for working on this repo with Claude Code. |

## Stack

Next.js 15 (App Router, TS strict, `src/`) · Tailwind CSS v4 (CSS-first — tokens in `src/app/globals.css`, no `tailwind.config.ts`) · shadcn/ui (Radix, "Nova" preset) · `next-themes` · Supabase via `@supabase/ssr` · zod + react-hook-form · TanStack Table · date-fns · Resend · pnpm · ESLint + Prettier · Husky + lint-staged · Vitest + React Testing Library · Docker (Coolify-ready).

**Theme:** ledger green + live amber, light/dark/system. Green is the settled record and every action that writes one; `--live` (amber) marks a running timer and nothing else. Durations and clock times are always `font-mono tabular-nums`. Lists render as cards below `md` and as tables at `md` and up; navigation is a header row on desktop and a tab bar on a phone.

## Quick start

```bash
pnpm install
pnpm exec supabase start     # local Postgres + Auth (needs Docker running)
cp .env.example .env.local   # fill in the local URL + anon key printed above
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). Migrations under `supabase/migrations/` are applied by `supabase start`; `pnpm exec supabase db reset` replays them from scratch.

Node 24 is the declared engine floor (`.nvmrc`, `package.json`). The app still boots with Supabase unconfigured — `/` and `/api/health` work regardless — but nothing behind auth does.

### Local Supabase ports

This project runs on the **545xx** range rather than the Supabase default 543xx, so it can run alongside another local Supabase project without port collisions (`BLOCKERS.md` R-1). `supabase start` prints the URLs; the ones you'll want:

| Service | URL |
| --- | --- |
| API | `http://127.0.0.1:54521` |
| Database | `postgresql://postgres:postgres@127.0.0.1:54522/postgres` |
| Studio | `http://127.0.0.1:54523` |
| Mailpit (test email) | `http://127.0.0.1:54524` |

Set `NEXT_PUBLIC_SUPABASE_URL` to the API URL and `NEXT_PUBLIC_SUPABASE_ANON_KEY` to the anon key `supabase start` prints. Email confirmations are off locally by default; when flipped on, the confirmation mail lands in Mailpit, not a real inbox.

## Environment variables

| Variable | Where it's used | Exposed to browser? |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser + server Supabase clients | Yes — inlined at **build time** |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser + server Supabase clients | Yes — inlined at **build time** |
| `RESEND_API_KEY` | Invitation emails (`src/lib/email/resend.ts`) | No — server only |
| `EMAIL_FROM` | Invitation emails — must be on a Resend-verified domain for real delivery | No — server only |
| `APP_URL` | Building the invite link inside the email (a server action has no `window.location.origin`) | No — server only |

Get the Supabase two from your project's **Settings → API**. The last three are optional: unset, `createInvitation()` still succeeds and returns `emailSent: false`, and the admin gets the same copyable link the product always had. Copy `.env.example` to `.env.local` for local dev.

**There is no service-role key in this project, by design.** Anything needing elevated privilege is a `SECURITY DEFINER` Postgres function with a narrow signature, never a key handed to application code — one forgotten `company_id` filter would leak every tenant. See `SPEC.md` §4.4.

## Database

Fourteen migrations, applied in order. Every tenant table carries `company_id` directly so RLS policies are single-column equality checks with no joins (`SPEC.md` §2.1).

| Migration | What it lands |
| --- | --- |
| `0001_extensions` | `btree_gist` (overlap constraint) + `citext` (invitation email) |
| `0002_tenancy_core` | `companies`, `profiles`, the recursion-safe RLS helpers, `create_company()`, the last-admin guard |
| `0003_invitations` | `invitations` (hashed tokens, 7-day expiry), `accept_invitation()`, `invitation_preview()` |
| `0004_structure` | `clients`, `projects`, `tasks`, `project_members`, soft delete via `archived_at` |
| `0005_time_entries` | `time_entries`, the no-overlap exclusion constraint, `stop_timer()`, the guard trigger that makes a closed entry immutable |
| `0006_corrections` | `correction_requests`, `time_entry_revisions`, `approve_correction()` — the audited path |
| `0007_reports` | Seven aggregate functions bucketing days in the company timezone |
| `0008_deactivation_scope` | Deactivated members lose access everywhere (one helper, ten tables) |
| `0009_orphaned_running_entries` | An admin may close — not reattribute — a running entry whose owner is inactive |
| `0010_admin_direct_entry_paths` | Direct admin create/delete, so a single-admin company isn't stuck behind the no-self-approval rule |
| `0011_invite_existing_member_guard` | `email_is_company_member()` — refuse an invitation to somebody already on the team |
| `0012_pending_invitation_guard` | `pending_invitation_for_me()` — the onboarding-vs-invitation branch |
| `0013_report_entries` | `report_entries()` — the paginated detail view behind a total |
| `0014_member_schedules` | Expected hours per assignment (`expected_daily_seconds`, `working_days`) and the two attendance functions (`SPEC.md` §9.8) |

Regenerate types after any schema change — `pnpm db:types` wraps the local case, including the Prettier
pass the raw CLI output needs to survive `pnpm format:check`:

```bash
pnpm db:types                  # local: generate + format, in one step
# or, against a hosted project:
pnpm exec supabase gen types typescript --project-id <ref> > src/types/supabase.ts
pnpm prettier --write src/types/supabase.ts
```

The CLI emits semicolon-free output that the repo's Prettier config rejects, so a bare `gen types` leaves the
gate red. That is the only reason the script exists.

### Pointing at a hosted project

1. Create a project at [supabase.com](https://supabase.com) (or a self-hosted instance).
2. `pnpm exec supabase link --project-ref <ref>` — the ref is the subdomain of your Project URL,
   `https://<ref>.supabase.co`. You will need the database password (resettable under **Settings → Database**).
3. Publish the schema — see the guide immediately below.
4. Copy the Project URL and anon key from **Settings → API** into `.env.local` and into your host's env config
   (see "Deploy on Coolify").
5. Regenerate `src/types/supabase.ts` against the real schema.

Use `pnpm exec` rather than a global `supabase`: the CLI is a devDependency, so this runs the version the repo
was built against instead of whatever happens to be on your PATH.

## Publishing migrations to production

Migrations are **never** applied by deploying. Merging a branch ships code; `supabase db push` ships schema, and
nothing connects the two. Doing them in the wrong order has taken this product down once already — see the
warning below, which is the reason this section exists.

### The procedure

```bash
# 1. See what production is actually missing. Read-only; changes nothing.
pnpm exec supabase migration list --linked

# 2. Apply every pending migration, in order.
pnpm exec supabase db push

# 3. Confirm. The Local and Remote columns must now match on every row.
pnpm exec supabase migration list --linked

# 4. Only now deploy the code that uses the new schema.
git push
```

Step 1 is not optional politeness. `db push` applies **everything** pending, not just the migration you have in
mind, so it is the difference between a one-migration push and discovering that four earlier ones never landed.

### Push the schema before the code that calls it

The two halves are never atomic: the host redeploys on a push to the branch, while `db push` is a separate manual
step you run yourself. Deploy the code first and any action calling a not-yet-created function gets PostgREST's
`PGRST202`, which surfaces as that action's generic failure message rather than as anything diagnosable.

That is not hypothetical. `0011`'s function was called by code that shipped in one PR while the migration shipped
in another, and every invitation in production failed — for every address — until the migration was pushed
(`BLOCKERS.md` D-15). The entry's own conclusion is worth keeping in mind: *merging code has never applied a
migration.*

**The gate cannot catch this.** `pnpm build` never talks to the production database, and `pnpm test` runs on
jsdom and cannot see Postgres at all (`SPEC.md` §12.1). No amount of green proves production has the schema.

### Additive migrations are safe ahead of the code

A migration that only **adds** things — new tables, new columns with defaults, new functions, no policy changes —
can be pushed before its code merges, with no window in which production is broken in either direction: the
running code simply ignores what it does not know about. `0014_member_schedules` is exactly this shape.

A migration that **changes or removes** something reachable by the currently-deployed code has no such window,
and needs to be split into an additive step now and a removal step after the code is live.

### After pushing

Regenerate the types against the real schema and confirm they match what is committed:

```bash
pnpm exec supabase gen types typescript --project-id <ref> > src/types/supabase.ts
pnpm prettier --write src/types/supabase.ts
git diff --stat src/types/supabase.ts    # empty means production agrees with the committed types
```

A non-empty diff means production's schema and this repo's types disagree — investigate before deploying, rather
than committing the difference away.

Then walk the `SPEC.md` §12.2 checks that touch what you changed. Anything under `supabase/migrations/**` alters
RLS-adjacent surface, and the automated suite verifies none of it.

## Routes

| Route | Who | What |
| --- | --- | --- |
| `/` | Anyone | Marketing root |
| `/sign-up`, `/sign-in` | Signed out | Auth surface |
| `/auth/confirm` | Any state | Exchanges an emailed `token_hash` for a session, then redirects |
| `/onboarding` | Signed in, no company | Create a company and become its admin. The only valid `company_id IS NULL` state |
| `/invite/[token]` | Any state | Accept an invitation; refuses plainly if you already belong to a company |
| `/dashboard` | Members | The running timer, today's entries, manual entry, the stale-timer prompt |
| `/projects`, `/projects/[id]` | Members | Projects (assigned ones for an employee), tasks, project membership |
| `/clients` | Members | Clients, archive/unarchive |
| `/members` | Members | The team list; role changes and deactivation are admin-gated at the database |
| `/corrections` | Members | Your own requests; the review queue renders for admins |
| `/reports` | Members | Day / user / project / task / client / user × project groupings, date-ranged |
| `/api/reports/export` | Members | CSV download of any report view (`GET`, so it can be a plain link) |
| `/api/health` | Anyone | Always `200` with `{ status, supabase, timestamp }` — a diagnostic field, not a liveness signal |

Middleware (`src/lib/supabase/middleware.ts`) refreshes the session and enforces the routing above; a link is never a permission — RLS decides what an account can read.

## Project structure

```
src/
  app/
    (app)/            authenticated shell: dashboard, projects, clients, members, corrections, reports
    auth/confirm/     email-confirmation callback
    invite/[token]/   invitation acceptance
    onboarding/       company creation
    api/health/       container health check
    api/reports/      CSV export route handler
  components/
    ui/               shadcn primitives — presentational only, CLI-managed
    layout/           header, desktop nav, mobile tab bar; destinations declared once in nav.ts
    structure/        DataCard (the below-md list form), archive dialog/toggle
    time-entries/     timer, elapsed counter, manual entry, stale-timer prompt
    corrections/      submit, review queue, approve/reject/amend dialogs
    clients/ projects/ tasks/ project-members/ members/ invitations/ reports/ auth/ theme/
  lib/
    supabase/         browser/server clients + middleware session refresh
    actions/          server actions — {ok: true, data} | {ok: false, error}
    validations/      zod schemas
    time/             company-timezone wall-clock resolution (DST-sensitive, shared)
    email/            Resend delivery — never throws, {ok: false} on any failure
    reports/          CSV columns + quoting
  types/              generated Database types
  middleware.ts       session refresh + the limbo/auth guard
supabase/migrations/  SQL migrations (see above)
supabase/templates/   confirmation email override
.claude/agents/       build-ui, implement-logic, write-migrations, code-reviewer, test-runner
```

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Start the dev server |
| `pnpm build` | Production build (`output: 'standalone'`) |
| `pnpm start` | Run the production build locally |
| `pnpm lint` / `pnpm lint:fix` | ESLint |
| `pnpm format` / `pnpm format:check` | Prettier |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` / `pnpm test:watch` | Vitest |
| `pnpm db:new <name>` | Scaffold a migration under `supabase/migrations/` |
| `pnpm db:status` | Local versus applied migrations. Add `--linked` via `pnpm exec` for production |
| `pnpm db:migrate` | Apply pending migrations to the **local** stack |
| `pnpm db:types` | Regenerate `src/types/supabase.ts` from the local schema, Prettier-formatted |

### The gate

Nothing is done until all five are clean:

```bash
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm build
```

**A green gate proves less than it looks like it does.** Vitest runs on jsdom and cannot see Postgres, so it verifies none of the RLS policies, constraints, or `SECURITY DEFINER` functions that hold the security model up (`SPEC.md` §12.1, `BLOCKERS.md` N-2). Anything touching `supabase/migrations/**` also needs the matching manual checks in `SPEC.md` §12.2, run against a real database.

## Deploy on Coolify

This repo ships a multi-stage `Dockerfile` (`deps` → `builder` → `runner`) producing a minimal non-root image from `output: 'standalone'`.

1. **Connect the repo** in Coolify as a new Docker-based application, pointing at this repository/branch.
2. **Set build-time env vars** — Coolify needs to pass `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` as **Docker build args**, since Next.js inlines `NEXT_PUBLIC_*` vars into the client bundle at build time. In Coolify's build settings, add them as build arguments (not just runtime env vars) — see the `ARG`/`ENV` pairs in the `builder` stage of the `Dockerfile`.
3. **Set runtime env vars** — `RESEND_API_KEY`, `EMAIL_FROM` and `APP_URL` are the only server-only vars the app reads, injected at container start and never baked into the image. There is no service-role key (`SPEC.md` §4.4). Only invitation email delivery depends on those three; everything else works with none of them set.
4. **Expose port 3000** — the container listens on `3000` (`EXPOSE 3000`, `PORT=3000` in the `Dockerfile`).
5. **Health check** — point Coolify's health check at `/api/health`. It always returns `200` so a transient Supabase outage doesn't flap the container's liveness state.
6. **Auto-deploy on push** — enable Coolify's webhook/auto-deploy for your branch.

### Build and run locally

```bash
docker build \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key \
  -t timey .

docker run -p 3000:3000 \
  -e NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co \
  -e NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key \
  timey

curl http://localhost:3000/api/health
```
