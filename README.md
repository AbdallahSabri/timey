# Next.js Template

Production-ready Next.js starter, optimized for forking into new projects fast.

**Stack**: Next.js 15 (App Router, TS strict, `src/`) · Tailwind CSS v4 · shadcn/ui (Radix, neutral theme) · Supabase (`@supabase/ssr`) · pnpm · ESLint + Prettier · Husky + lint-staged · Vitest + React Testing Library · Docker (Coolify-ready).

See `CLAUDE.md` for stack rules, the lint/build gate, and the `.claude/agents/` routing table if you're working on this repo with Claude Code.

## Quick start

```bash
pnpm install
cp .env.example .env.local   # fill in your Supabase project (see below)
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). The app runs even without Supabase configured — `/` and `/api/health` work regardless.

## Environment variables

| Variable | Where it's used | Exposed to browser? |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser + server Supabase clients | Yes — inlined at **build time** |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser + server Supabase clients | Yes — inlined at **build time** |
| `SUPABASE_SERVICE_ROLE_KEY` | Only if a server action needs to bypass RLS | No — server-only, runtime |

Get these from your Supabase project's **Settings → API**. Copy `.env.example` to `.env.local` for local dev.

## Fork this as a new project

1. `git clone` (or use this repo as a GitHub template), then `rm -rf .git && git init`.
2. Update `package.json`'s `name` field.
3. Create a new Supabase project and set env vars — see "Swap the Supabase project" below.
4. Add your first migration under `supabase/migrations/` and run it against your new project.
5. Update `README.md`/`CLAUDE.md` titles and this fork checklist for your project.
6. `pnpm install && pnpm dev` to confirm it boots clean, then `pnpm lint && pnpm typecheck && pnpm test && pnpm build` before your first commit.

## Swap the Supabase project

1. Create a project at [supabase.com](https://supabase.com) (or point at a self-hosted instance).
2. Add a migration under `supabase/migrations/` for your first table, then run it via the SQL editor or `supabase db push` if you're using the Supabase CLI locally.
3. Copy the Project URL and anon key from **Settings → API** into `.env.local` (local dev) and into your host's env var config (production — see "Deploy on Coolify").
4. Regenerate typed models against the real schema:
   ```bash
   pnpm dlx supabase gen types typescript --project-id <project-id> > src/types/supabase.ts
   ```
   This overwrites the empty placeholder in `src/types/supabase.ts` — safe to do any time your schema changes.

## Project structure

```
src/
  app/              routes (App Router)
    api/health/     container health check
  components/
    ui/             shadcn primitives — presentational only, CLI-managed
  lib/
    supabase/       browser/server Supabase clients + middleware session refresh
    actions/        server actions (implement-logic owns this pattern)
    validations/    zod schemas
    utils.ts        cn() helper
  types/            Database types (regenerate via `supabase gen types`)
  middleware.ts     Supabase session refresh
supabase/migrations/  SQL migrations
.claude/agents/       build-ui, implement-logic, code-reviewer, test-runner
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

## Deploy on Coolify

This repo ships a multi-stage `Dockerfile` (`deps` → `builder` → `runner`) producing a minimal non-root image from `output: 'standalone'`.

1. **Connect the repo** in Coolify as a new Docker-based application, pointing at this repository/branch.
2. **Set build-time env vars** — Coolify needs to pass `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` as **Docker build args**, since Next.js inlines `NEXT_PUBLIC_*` vars into the client bundle at build time. In Coolify's build settings, add them as build arguments (not just runtime env vars) — see the `ARG`/`ENV` pairs in the `builder` stage of the `Dockerfile`.
3. **Set runtime env vars** — anything server-only (e.g. `SUPABASE_SERVICE_ROLE_KEY`) goes in Coolify's regular environment variable config. These are injected at container start, never baked into the image.
4. **Expose port 3000** — the container listens on `3000` (`EXPOSE 3000`, `PORT=3000` in the `Dockerfile`).
5. **Health check** — point Coolify's health check at `/api/health`. It always returns `200` with a JSON body (`{ status: "ok", supabase: "connected" | "unreachable", timestamp }`) so a transient Supabase outage doesn't flap the container's liveness state.
6. **Auto-deploy on push** — enable Coolify's webhook/auto-deploy for your branch so pushes trigger a rebuild.

### Build and run locally

```bash
docker build \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key \
  -t template-app .

docker run -p 3000:3000 \
  -e NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co \
  -e NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key \
  template-app

curl http://localhost:3000/api/health
```
