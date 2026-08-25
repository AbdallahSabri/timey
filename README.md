# Timey

Time tracking for small teams. People start and stop a timer — or enter hours manually — against a **client → project → task** hierarchy, and those entries roll up into reports. Fixing a closed entry goes through an admin-approved correction, because the design intent behind the whole product is one sentence: **an employee cannot quietly rewrite their own history.**

**In scope:** time capture, project/task structure, team membership, missed-punch corrections, reporting, CSV export.
**Out of scope by design (not "later"):** billing, rates, invoicing, payroll export, screenshots, activity monitoring, GPS, idle detection.

All eight build phases are complete — the app is functional end to end against a real Supabase project.

## The documents

This repo is spec-driven; the prose is load-bearing, not decoration.

| File | What it holds |
| --- | --- |
| `SPEC.md` | The behavioral contract — numbered rulings on tenancy, RLS, timer semantics, corrections, reporting. If the code disagrees, the spec wins or the spec changes. |
| `PLAN.md` | Phase ordering (0–8) and the exit criteria each phase had to clear. |
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

Ten migrations, applied in order. Every tenant table carries `company_id` directly so RLS policies are single-column equality checks with no joins (`SPEC.md` §2.1).

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

Regenerate types after any schema change:

```bash
pnpm exec supabase gen types typescript --local > src/types/supabase.ts
# or, against a hosted project:
pnpm dlx supabase gen types typescript --project-id <project-id> > src/types/supabase.ts
```

### Pointing at a hosted project

1. Create a project at [supabase.com](https://supabase.com) (or a self-hosted instance).
2. `supabase link --project-ref <ref>` then `supabase db push` to apply `supabase/migrations/`.
3. Copy the Project URL and anon key from **Settings → API** into `.env.local` and into your host's env config (see "Deploy on Coolify").
4. Regenerate `src/types/supabase.ts` against the real schema.

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
