# Production environment: Supabase Cloud (free) + Coolify

> Reference document, not a committed decision. No credentials here — values are placeholders. Real values live in `.env.production` (gitignored), the Coolify application config, and the Supabase dashboard.

> **Rewritten 2026-09-14.** This started life as `production-supabase-netlify.md`, planning a Netlify site. **Netlify was never adopted** — no `netlify.toml` was ever committed and no other file in the repo mentions it. The live host is a self-managed **Coolify** server serving `https://timely.abdallahsabri.com` over HTTPS, driven by the `Dockerfile` that was in the repo all along and by the `deploy` job in `.github/workflows/ci.yml`. Everything Netlify-specific has been replaced with what is actually deployed rather than left as history, because nothing downstream referenced it.

## Where this stands

Most of the original plan is done. What follows marks each part, so this reads as a state-of-production document rather than a to-do list that has quietly gone stale.

| Part | State |
| --- | --- |
| 0 · Rotate the Resend key | Not verifiable from the repo — confirm at [resend.com/api-keys](https://resend.com/api-keys) |
| 1 · Populate the Supabase project | **Done.** `supabase/.temp/project-ref` records the link; D-15 is an incident report from a live production deploy |
| 2 · Configure hosted Auth | **Partly done, and the gap caused a production outage** — see step 6b |
| 3 · Repo changes | **`.env.prod` rename still outstanding**; README is done; this entry adds the `BLOCKERS.md` record |
| 4 · Host configuration | **Done.** Coolify application + CI deploy job |

## Context

Timey develops against a local Supabase CLI stack on the 545xx port range (`BLOCKERS.md` R-1) and deploys against a free-tier Supabase Cloud project, `vjliuuzttrbuoiehkbss`, on `https://timely.abdallahsabri.com`.

**The central constraint, and it outlives every other detail here:** `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are `NEXT_PUBLIC_*`, so Next.js **inlines them into the client bundle at build time**. Supplying them as runtime-only env vars produces a build that ships `undefined` to the browser. This fails quietly — `src/lib/supabase/middleware.ts:62-67` is the only guard in the codebase and it *returns early* when they're missing, so `/` and `/api/health` still answer 200 while every authenticated page throws. `client.ts:7-8` and `server.ts:10-11` both use non-null assertions with no guard.

On Coolify that means **Docker build args**, not runtime env vars. The `builder` stage of the `Dockerfile` declares the `ARG`/`ENV` pair for exactly this reason.

---

## Part 0 — Rotate the Resend key

`RESEND_API_KEY` was pasted into a chat transcript. Revoke it at [resend.com/api-keys](https://resend.com/api-keys), issue a replacement, and use the new one in all three places it lives: the local `.env`/`.env.production`, the Coolify runtime env, and the Supabase SMTP password in step 7. The Supabase anon key and project URL are public by design — they ship in the client bundle — and need no rotation.

---

## Part 1 — Populate the Supabase project — **done**

Kept for the procedure, which is still the one to follow after any schema change. Run from the repo root and use `pnpm exec`, never a global install: the CLI is a devDependency, so this runs the version the repo was built against.

1. **Confirm the project.** The ref is the subdomain in `NEXT_PUBLIC_SUPABASE_URL` (`https://<ref>.supabase.co`), and is recorded in `supabase/.temp/project-ref`. You need the database password for `link`; reset it under **Settings → Database** if it wasn't saved.

2. **Link and push the schema:**

   ```bash
   pnpm exec supabase login
   pnpm exec supabase link --project-ref <ref>
   pnpm exec supabase db push
   ```

   `db push` applies every migration in `supabase/migrations/` in order — fourteen as of this rewrite. Two worth reading the output for:
   - `0001_extensions.sql` creates `btree_gist` and `citext` — both available on hosted, both required by later constraints.
   - `0002_tenancy_core.sql:186` creates a trigger on `auth.users`. This is the one line needing elevated ownership; `db push` runs as `postgres`, which has it.

   Confirm with `pnpm exec supabase migration list` — the Local and Remote columns must match on every row.

   **Ordering is not optional.** `BLOCKERS.md` D-15 is the incident where code shipped ahead of its schema and production invitations broke; `README.md` §"Publishing migrations to production" is the procedure that came out of it, and the `migration-guard` job in CI warns on any PR that touches `supabase/migrations/`.

3. **Regenerate types against the real schema:**

   ```bash
   pnpm exec supabase gen types typescript --project-id <ref> > src/types/supabase.ts
   ```

   A clean `git diff` here is the strongest available signal that the push landed identically to local. A non-empty diff means something didn't apply — investigate before committing the drift.

4. **Credentials** come from **Settings → API Keys**: Project URL → `NEXT_PUBLIC_SUPABASE_URL`, publishable key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

   The key currently in use is a legacy `anon` JWT. [Legacy keys are deprecated by end of 2026](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys); newer projects issue `sb_publishable_…` instead. `@supabase/ssr` accepts either format with no code change, and both can coexist — switching is low-cost future-proofing, not urgent.

   There is still **no service-role key** anywhere in this project, by design (`SPEC.md` §4.4). Do not add one.

---

## Part 2 — Configure hosted Auth

`supabase/config.toml` is local-only. None of it reaches the cloud project, so every setting below is dashboard-only and invisible to the repo — which is precisely how step 6b stayed broken in production for as long as it did.

Direct links use the live project ref, `vjliuuzttrbuoiehkbss`.

5. **[Authentication → URL Configuration](https://supabase.com/dashboard/project/vjliuuzttrbuoiehkbss/auth/url-configuration):**
   - **Site URL**: `https://timely.abdallahsabri.com` — the custom domain Coolify serves.
   - **Redirect URLs**: `https://timely.abdallahsabri.com/**` is all production needs. Coolify has no preview-deploy domain to allow, so unlike a PaaS there is no wildcard-subdomain entry here; add `http://127.0.0.1:3000/**` only if you want hosted-project links to resolve against a local `pnpm dev`.

   The Site URL matters more than usual: **both** templates in `supabase/templates/` build their link from `{{ .SiteURL }}`, so a wrong value sends every confirmation *and* every password-reset email to the wrong origin.

6. **[Authentication → Emails](https://supabase.com/dashboard/project/vjliuuzttrbuoiehkbss/auth/templates) → Templates → Confirm signup:** replace the default body with the contents of `supabase/templates/confirmation.html`.

   Not cosmetic. The hosted default uses `{{ .ConfirmationURL }}`, which routes through GoTrue's own `/auth/v1/verify` — GoTrue verifies the token itself and then redirects to the Site URL carrying the result in a form no server here can consume: a **URL fragment** under the implicit flow, or a bare **`?code=`** under PKCE (which is what `@supabase/ssr` uses, so it is the one you actually get). The repo's template instead points at `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup`, which `src/app/auth/confirm/route.ts` exchanges server-side so the session arrives as a cookie (`BLOCKERS.md` D-8).

6b. **Same screen → Reset Password:** replace the default body with the contents of `supabase/templates/recovery.html`.

**This step was missing from the original checklist, and the omission was live in production.** A reset link arrived as `https://timely.abdallahsabri.com/?code=<uuid>` — the hosted default's `{{ .ConfirmationURL }}` landing on the Site URL after GoTrue had already verified the token. Nothing in the app reads `code`, so the user got the marketing homepage instead of the form and `/auth/reset` was never reached. Recorded as `BLOCKERS.md` D-21.

The repo's template points at `{{ .SiteURL }}/auth/reset?token_hash={{ .TokenHash }}` — no `type`, deliberately. `src/app/auth/reset/route.ts` hardcodes `type: "recovery"` and the `/reset-password` destination, because a recovery token grants a session and neither the OTP type nor the landing page is something the emailed URL should get a vote on (`BLOCKERS.md` D-18).

6c. **[Authentication → Sign In / Providers](https://supabase.com/dashboard/project/vjliuuzttrbuoiehkbss/auth/providers) → Email → "Secure password change" OFF.**

With it on, `updateUser({ password })` demands a reauthentication nonce the recovery flow never collects, and `src/lib/actions/auth.ts` has no field for one. It fails at *submit* rather than at landing, so it is the next thing to break once 6b is fixed. Matches `secure_password_change = false` in `config.toml`.

7. **Same screen → SMTP Settings** — enable custom SMTP with Resend:

   | Field | Value |
   | --- | --- |
   | Host | `smtp.resend.com` |
   | Port | `465` (implicit TLS) |
   | Username | `resend` |
   | Password | the **rotated** Resend API key from Part 0 |
   | Sender email | `timely@abdallahsabri.com` (on the Resend-verified `abdallahsabri.com`) |
   | Sender name | Timey |

   This closes the gap `BLOCKERS.md` D-9 explicitly left open ("Supabase Auth's own emails … configured via SMTP settings on a hosted project. Revisit only if those need real delivery too"). Without it, the free built-in mailer caps at a couple of emails per hour and Supabase labels it test-only.

   Leave **Confirm email ON** (the hosted default — the project reports `mailer_autoconfirm: false`, which is the same thing seen from the public settings endpoint). Local dev keeps `enable_confirmations = false`; that divergence is intentional and stays.

---

## Part 3 — Repo changes

### 3a. `.env.prod` → `.env.production` — **still outstanding**

Next.js loads `.env.production`; it will never load `.env.prod`. Nothing reads the file today — not a script, not the `Dockerfile` (`.dockerignore` excludes `.env*`), not Next. Rename it and **rewrite the header comments**, which still describe the local 545xx CLI stack while the file holds hosted credentials. The header should say what the file actually is:

> Production values for local prod-mode builds (`pnpm build && pnpm start`). Gitignored — this file never reaches Coolify. Coolify's own copies live in the application's build-args and runtime-env config.

Keys stay the same five. Two notes on the current values:

- `EMAIL_FROM` uses display-name form (`Timey <timely@abdallahsabri.com>`) — valid for Resend, and worth mirroring in the Supabase SMTP sender fields.
- `APP_URL` is stale: it still points at the old `…sslip.io` HTTP address rather than `https://timely.abdallahsabri.com`. Coolify's runtime env is the copy that matters, but a stale value here will mislead the next local prod-mode build. (A trailing slash would be harmless — `buildInviteUrl` at `src/lib/actions/invitations.ts:310` strips them before appending `/invite/<token>`.)

Already gitignored by `.env*` / `!.env.example` and dockerignored — no `.gitignore` change needed. **One trap, and it is now live:** Next ranks `.env.local` **above** `.env.production`, and a `.env.local` exists in this working copy. Once the rename happens, that file will shadow production values during a local prod build. Worth knowing before debugging a build that seems to ignore the file you just renamed.

### 3b. Build configuration — **no new file; it was already here**

The Netlify plan called for a `netlify.toml`. Coolify needs no equivalent: the repo's multi-stage `Dockerfile` (`deps` → `builder` → `runner`) is the build definition, and it predates all of this.

- **Node version** — pinned by `FROM node:24-alpine` in the `Dockerfile`, matching `engines.node: ">=24"` in `package.json` and `.nvmrc`. CI reads `.nvmrc` via `node-version-file`.
- **`NEXT_PUBLIC_*` at build time** — handled by the `ARG`/`ENV` pair in the `builder` stage. This is the whole of the central constraint, solved in the one place that can solve it.
- **No secret-scanning exemption needed.** Netlify would have failed the build when the anon key appeared in `.next/static/**`; Docker has no such scanner, so the `SECRETS_SCAN_OMIT_KEYS` workaround the old plan required simply doesn't exist here.

**No `next.config.ts` change.** `output: "standalone"` is required by the `runner` stage, which copies `.next/standalone` and runs `node server.js`.

### 3c. `README.md` — **done**

§"Deploy on Coolify" documents the build-arg pattern, the runtime vars, port 3000 and the `/api/health` check. §"Pointing at a hosted project" step 6 covers both template pastes, the Site URL and the "Secure password change" toggle — none of which is inferable from `config.toml`.

Amended in this pass: step 6 described the hosted default as landing the session "as a URL fragment", which is only the implicit-flow half. Under PKCE — what `@supabase/ssr` actually uses — it lands as `?code=`, and that is the symptom someone debugging this will search for.

### 3d. `BLOCKERS.md` — **done in this pass**

`D-21` records Coolify as the host (Netlify considered and dropped), and the recovery-template omission that broke password reset in production.

---

## Part 4 — Coolify application configuration — **done**

8. **Build-time env vars → Docker build args.** In the application's build settings, `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` must be passed as **build arguments**, not runtime env vars. Setting them as runtime-only is the quiet failure described under Context.

9. **Runtime env vars**, injected at container start and never baked into the image:

   | Variable | Value | Stage |
   | --- | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` | **Build arg** |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | publishable / anon key | **Build arg** |
   | `RESEND_API_KEY` | rotated Resend key | Runtime |
   | `EMAIL_FROM` | `Timey <timely@abdallahsabri.com>` | Runtime |
   | `APP_URL` | `https://timely.abdallahsabri.com` | Runtime |

   The last three are server-only and optional — unset, `createInvitation()` still succeeds with `emailSent: false` and the admin gets the copyable link.

10. **Port and health check.** The container listens on `3000` (`EXPOSE 3000`, `PORT=3000`, `HOSTNAME=0.0.0.0`). Point Coolify's health check at `/api/health`, which always returns 200 so a transient Supabase outage doesn't flap liveness — read the `supabase` field for the actual diagnosis.

11. **Domain and TLS.** `timely.abdallahsabri.com` with a provisioned certificate. **HTTPS is load-bearing, not hygiene:** the recovery marker cookie is set `Secure` outside development (`src/lib/auth/recovery.ts:68`), so on a plain-HTTP deployment the browser silently drops it while keeping GoTrue's session cookie — and the user lands signed in on the dashboard with their old password intact. That is the silent no-op reset D-18 closed, reached from the other side. The earlier `…sslip.io` HTTP deployment had exactly this defect; TLS is what retired it.

12. **Deploy on push — via CI, not Coolify's own git watcher.** `.github/workflows/ci.yml` runs the full gate, then a `deploy` job (on `main`, push only) POSTs to `${{ secrets.COOLIFY_WEBHOOK }}` with a bearer token, waits 90s, and asserts `"status":"ok"` from the live `/api/health`. Gating the webhook behind the gate is the point: Coolify's built-in auto-deploy would ship a red build.

---

## Verification

Run the gate first — a types regen touches a checked-in file:

```bash
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm build
```

Then locally against the cloud project:

```bash
pnpm build && pnpm start
curl http://localhost:3000/api/health   # expect {"status":"ok","supabase":"connected",…}
```

`supabase: "unreachable"` here means the two vars didn't reach the build — exactly the failure this document exists to prevent, and the health route is the cheapest place to catch it.

Or through the real image, which is what Coolify builds:

```bash
docker build \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key> \
  -t timey .
docker run -p 3000:3000 timey
```

After a deploy, walk the paths only a real database exercises (`SPEC.md` §12.2 — Vitest runs on jsdom and verifies none of the RLS policies, constraints, or `SECURITY DEFINER` functions):

1. `curl https://timely.abdallahsabri.com/api/health` → `supabase: "connected"`.
2. **Signup → confirmation.** Sign up at `/sign-up`. The email must arrive via Resend (check the Resend dashboard for the send), and its link must point at `https://timely.abdallahsabri.com/auth/confirm?token_hash=…` — not at a `supabase.co` verify URL, and not at the bare domain with `?code=`. Following it lands a session cookie and redirects to `/onboarding`. Validates steps 5, 6 and 7 at once.
3. **Password reset.** `/forgot-password` → the email link must read `https://timely.abdallahsabri.com/auth/reset?token_hash=…` → `/reset-password` renders "Choose a new password" → submitting signs you in with the new one. Validates 6b and 6c, and the token is single-use, so a second click correctly lands on `/forgot-password?error=reset_link_invalid`.
4. **Onboarding.** Create a company; `create_company()` returns you to `/dashboard` as admin. Confirms migration `0002` and its `auth.users` trigger landed.
5. **Timer round-trip.** Start a timer, stop it, confirm the entry appears with the right duration. Exercises `stop_timer()`, the overlap exclusion constraint (`btree_gist`), and RLS on `time_entries`.
6. **Invite a member.** Confirms the app's own Resend path (`src/lib/email/resend.ts`) and `APP_URL` — a separate code path from the Auth SMTP in step 7, so it needs its own check.
7. **Signed-out routing.** In a private window, hit `/dashboard` and confirm the middleware bounce to `/sign-in`. A missing-env deploy skips this guard silently, so a *successful* redirect is the positive signal.

---

## Known caveats to accept going in

- **Auth configuration lives only in the dashboard.** `supabase/config.toml` describes the local stack and reaches nothing hosted, so Part 2 has no representation in the repo and no check that would notice it drifting. That is not hypothetical: it is how 6b stayed broken. `supabase config push` exists, but it pushes the whole `[auth]` block — including `enable_confirmations = false`, which would turn signup confirmation **off** in production — so it needs config.toml reconciled with production intent before it is safe to run.
- **Free projects pause after ~1 week without database activity** ([docs](https://supabase.com/docs/guides/platform/free-project-pausing)). A paused project makes the app look broken; restore from the dashboard, or upgrade to Pro. Free plan also caps at 2 active projects.
- **`.env.production` is for local prod builds only.** Gitignored, so it never reaches Coolify; Coolify's copies are maintained separately in the application config — two sources of truth with no mechanism keeping them in sync.
- **Nothing validates env at startup.** There is no env schema module in this repo; a bad deploy surfaces as a 500 on an authenticated page, not a build failure. Closing that with a small fail-fast assertion module is an easy separate follow-up.
- **The `sleep 90` in the deploy job is a guess, not a signal.** If a Coolify build ever takes longer, the health check runs against the old container and passes for the wrong reason. Polling until the deployment id reports healthy would be strictly better.

---

## Files touched

| File | Change |
| --- | --- |
| `_plans/production-supabase-netlify.md` → `_plans/production-supabase-coolify.md` | Renamed; Netlify parts rewritten for the Docker/Coolify path |
| `.env.prod` → `.env.production` | **Outstanding** — rename; rewrite stale local-stack header; fix stale `APP_URL` |
| `README.md` | §"Pointing at a hosted project" step 6: `?code=` (PKCE) alongside the fragment case |
| `BLOCKERS.md` | New `D-21` — Coolify as host, and the recovery-template omission |
| `src/types/supabase.ts` | Regenerated against the hosted project after any schema push (expect no diff) |
| `next.config.ts` | **No change** — `output: "standalone"` is required by the `runner` stage |
| `Dockerfile` | **No change** — it was the real deploy path all along |
