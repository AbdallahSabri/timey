# Production environment: Supabase Cloud (free) + Netlify

> Reference document, not a committed decision. No credentials here — values are placeholders. Real values live in `.env.production` (gitignored) and the Netlify / Supabase dashboards.

## Context

Timey runs against a local Supabase CLI stack on the 545xx port range (`BLOCKERS.md` R-1). There is no working production environment yet, and the repo reflects that in three ways:

- **`.env.prod` is inert.** Nothing reads it — not a script, not the `Dockerfile`, not Next.js. Next only auto-loads `.env`, `.env.local`, `.env.production`, `.env.development`. Its header comments still describe the local 545xx stack even though its values are hosted ones.
- **No cloud project is linked.** `supabase/.temp/` has no `project-ref`, so `supabase link` has never run in this working copy. A Supabase Cloud project exists and `.env.prod` holds its URL and anon key, but nothing in the repo records the link and the ten migrations have not demonstrably been pushed to it.
- **The only documented deploy target is Coolify.** `README.md` §"Deploy on Coolify" and the `Dockerfile`'s build-arg pattern assume a Docker host. The actual target is Netlify, on the custom domain `timely.abdallahsabri.com`.

Intended outcome: the free-tier Supabase Cloud project carrying the full schema, a Netlify site building against it, and both `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` wired correctly in the three places they must exist — the Netlify build environment, a local `.env.production` for prod-mode builds, and (unchanged) the Docker build args that keep the Coolify path valid.

**The central constraint:** both vars are `NEXT_PUBLIC_*`, so Next.js **inlines them into the client bundle at build time**. Setting them as runtime-only env vars produces a build that ships `undefined` to the browser. This fails quietly — `src/lib/supabase/middleware.ts:62-67` is the only guard in the codebase and it *returns early* when they're missing, so `/` and `/api/health` still answer 200 while every authenticated page throws. `client.ts:7-8` and `server.ts:10-11` both use non-null assertions with no guard.

---

## Part 0 — Rotate the Resend key first

`RESEND_API_KEY` was pasted into a chat transcript. Revoke it at [resend.com/api-keys](https://resend.com/api-keys), issue a replacement, and use the new one everywhere below (`.env`, `.env.production`, Netlify, and the Supabase SMTP password in step 7). The Supabase anon key and project URL are public by design — they ship in the client bundle — and need no rotation.

---

## Part 1 — Populate the Supabase project

Run from the repo root. The Supabase CLI is already a devDependency (`supabase@^2.115.0`), so use `pnpm exec`, never a global install.

1. **Confirm the project.** The ref is the subdomain in `NEXT_PUBLIC_SUPABASE_URL` (`https://<ref>.supabase.co`). If it was created recently and never pushed to, its schema is empty — steps 2–3 are the real work. You'll need its database password for `link`; reset it under **Settings → Database** if it wasn't saved.

2. **Link and push the schema:**

   ```bash
   pnpm exec supabase login
   pnpm exec supabase link --project-ref <ref>
   pnpm exec supabase db push
   ```

   `db push` applies all ten migrations in order. Two things to watch, both expected to succeed on hosted Supabase but worth reading the output for:
   - `0001_extensions.sql` creates `btree_gist` and `citext` — both available on hosted, both required by later constraints.
   - `0002_tenancy_core.sql:186` creates a trigger on `auth.users`. This is the one line needing elevated ownership; `db push` runs as `postgres`, which has it.

   Confirm with `pnpm exec supabase migration list` — local and remote columns should match on all ten.

3. **Regenerate types against the real schema:**

   ```bash
   pnpm exec supabase gen types typescript --project-id <ref> > src/types/supabase.ts
   ```

   A clean `git diff` here is the strongest available signal that the push landed identically to local. A non-empty diff means something didn't apply — investigate before committing the drift.

4. **Credentials** come from **Settings → API Keys**: Project URL → `NEXT_PUBLIC_SUPABASE_URL`, publishable key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

   The key currently in `.env.prod` is a legacy `anon` JWT. [Legacy keys are deprecated by end of 2026](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys); newer projects issue `sb_publishable_…` instead. `@supabase/ssr` accepts either format with no code change, and both can coexist — switching to the publishable key is a low-cost future-proofing, not urgent.

   There is still **no service-role key** anywhere in this project, by design (`SPEC.md` §4.4). Do not add one.

---

## Part 2 — Configure hosted Auth

`supabase/config.toml` is local-only. None of it reaches the cloud project, so these must be set in the dashboard by hand.

5. **Authentication → URL Configuration:**
   - Site URL: `https://timely.abdallahsabri.com` (the custom domain, **not** the `*.netlify.app` fallback — this is what ends up in every confirmation email)
   - Redirect URLs: `https://timely.abdallahsabri.com/**`, plus `https://<site>.netlify.app/**` if you want the Netlify subdomain to keep working, and `https://*--<site>.netlify.app/**` for deploy previews

   The Site URL matters more than usual here: `supabase/templates/confirmation.html` builds its link from `{{ .SiteURL }}`, so a wrong value sends every confirmation email to the wrong origin.

6. **Authentication → Emails → Confirm signup:** replace the default template body with the contents of `supabase/templates/confirmation.html`.

   This is not cosmetic. The hosted default uses `{{ .ConfirmationURL }}`, which lands the session as a **URL fragment** that no server can read. The repo's template instead points at `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup&next=/dashboard`, which `src/app/auth/confirm/route.ts` exchanges server-side so the session arrives as a cookie. Skipping this step breaks signup confirmation entirely (`BLOCKERS.md` D-8).

7. **Authentication → Emails → SMTP Settings** — enable custom SMTP with Resend:

   | Field | Value |
   | --- | --- |
   | Host | `smtp.resend.com` |
   | Port | `465` (implicit TLS) |
   | Username | `resend` |
   | Password | the **rotated** Resend API key from Part 0 |
   | Sender email | `timely@abdallahsabri.com` (on the Resend-verified `abdallahsabri.com`) |
   | Sender name | Timey |

   This closes the gap `BLOCKERS.md` D-9 explicitly left open ("Supabase Auth's own emails … configured via SMTP settings on a hosted project. Revisit only if those need real delivery too"). Without it, the free built-in mailer caps at a couple of emails per hour and Supabase labels it test-only.

   Leave **Confirm email ON** (the hosted default). Local dev keeps `enable_confirmations = false` — that divergence is intentional and stays.

---

## Part 3 — Repo changes

Four files. Small, but they're what makes the config reproducible rather than dashboard-only.

### 3a. `.env.prod` → `.env.production` (rename + rewrite)

Next.js loads `.env.production`; it will never load `.env.prod`. Rename it and **rewrite the stale header comments** — they currently describe the local 545xx CLI stack, which is actively misleading in a file holding production credentials. The new header should say what this file actually is:

> Production values for local prod-mode builds (`pnpm build && pnpm start`). Gitignored — this file never reaches Netlify. Netlify's own copies of these live in the site's build environment.

Keys stay the same five. Two notes on the current values:

- `EMAIL_FROM` uses display-name form (`Timey <timely@abdallahsabri.com>`) — valid for Resend, and worth mirroring in the Supabase SMTP sender fields.
- `APP_URL` has a trailing slash. Harmless: `buildInviteUrl` (`src/lib/actions/invitations.ts:310`) strips trailing slashes with `.replace(/\/+$/, "")` before appending `/invite/<token>`.

Already gitignored by `.env*` / `!.env.example` and dockerignored — no `.gitignore` change needed. One trap worth knowing: Next ranks `.env.local` **above** `.env.production`. There is no `.env.local` in this repo today (only `.env`), so `.env.production` wins — but creating one later would silently shadow production values during a local prod build.

### 3b. `netlify.toml` (new, at repo root)

```toml
[build]
  command = "pnpm build"
  publish = ".next"

[build.environment]
  NODE_VERSION = "24"
  SECRETS_SCAN_OMIT_KEYS = "NEXT_PUBLIC_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY"
```

Three deliberate choices:

- **`NODE_VERSION = "24"`** — `package.json` requires `node >=24`. `.nvmrc` already says 24 and Netlify reads it, but pinning here keeps build config in one file.
- **`SECRETS_SCAN_OMIT_KEYS`** — this is the failure you would otherwise hit first. Netlify's [secret scanning](https://docs.netlify.com/manage/security/secret-scanning/) fails a build when a declared env var's *value* appears in build output. `NEXT_PUBLIC_*` vars are inlined into the client bundle by definition, so the scanner finds the anon key in `.next/static/**` and kills the deploy. These two are public by design; omitting them is correct, not a workaround.
- **No `[[plugins]]` block** — Netlify auto-installs `@netlify/plugin-nextjs` for detected Next sites. Declaring it here would require managing the version by hand.

**No `next.config.ts` change.** `output: "standalone"` is compatible: Netlify's runtime sets `NEXT_PRIVATE_STANDALONE=true` itself and consumes `.next/standalone` (verified in the adapter's `src/index.ts:54-55`); it only special-cases `output: "export"`. The setting stays required by the Docker `runner` stage regardless.

### 3c. `README.md`

Add a **"Deploy on Netlify"** section next to the existing Coolify one (keep Coolify — the Dockerfile path still works and shouldn't be orphaned). Cover: env vars set in **Site configuration → Environment variables**, scoped to **all contexts including Builds**; the `NEXT_PUBLIC_*` build-time inlining rule; and the fact that Netlify's "secret" flag makes a var unavailable at build time, so the two Supabase vars must **not** be marked secret while `RESEND_API_KEY` should be.

Also amend §"Pointing at a hosted project" (currently a bare four-step list) to mention the two dashboard-only steps — Auth URL configuration and the confirmation-template paste — since neither is inferable from `config.toml`.

### 3d. `BLOCKERS.md`

Add a resolved entry (newest first, `D-<n>` format) recording: Netlify chosen as the host over Coolify; the free-tier Supabase project as production on `timely.abdallahsabri.com`; and D-9's SMTP question now answered with Resend SMTP on the hosted project.

---

## Part 4 — Netlify site configuration

8. **Site configuration → Environment variables**, all scoped to every context (Builds included):

   | Variable | Value | Mark secret? |
   | --- | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` | **No** — needed at build |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | publishable / anon key | **No** — needed at build |
   | `RESEND_API_KEY` | rotated Resend key | Yes |
   | `EMAIL_FROM` | `Timey <timely@abdallahsabri.com>` | No |
   | `APP_URL` | `https://timely.abdallahsabri.com` | No |

   The last three are server-only and optional — unset, `createInvitation()` still succeeds with `emailSent: false` and the admin gets the copyable link.

9. Connect the repo, branch `main`. Build command and publish dir come from `netlify.toml`; pnpm is auto-detected from `pnpm-lock.yaml` + the `packageManager` field.

10. **Add the custom domain** `timely.abdallahsabri.com` under Domain management and let the certificate provision before testing signup — the confirmation-email link points there, so an unresolvable domain breaks the one flow that's hardest to debug after the fact.

---

## Verification

Run the gate first — the types regen in step 3 touches a checked-in file:

```bash
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm build
```

Then, locally against the cloud project:

```bash
pnpm build && pnpm start
curl http://localhost:3000/api/health   # expect {"status":"ok","supabase":"connected",…}
```

`supabase: "unreachable"` here means the two vars didn't reach the build — that is exactly the failure this document exists to prevent, and the health route is the cheapest place to catch it.

After the Netlify deploy, walk the paths that only a real database exercises (`SPEC.md` §12.2 — Vitest runs on jsdom and verifies none of the RLS policies, constraints, or `SECURITY DEFINER` functions):

1. `curl https://timely.abdallahsabri.com/api/health` → `supabase: "connected"`.
2. **Signup → confirmation.** Sign up at `/sign-up`. The email must arrive via Resend (check the Resend dashboard for the send), and its link must point at `https://timely.abdallahsabri.com/auth/confirm?token_hash=…` — not at a `supabase.co` verify URL. Following it should land a session cookie and redirect to `/onboarding`. This single check validates steps 5, 6, and 7 at once.
3. **Onboarding.** Create a company; `create_company()` should return you to `/dashboard` as admin. Confirms migration `0002` and its `auth.users` trigger landed.
4. **Timer round-trip.** Start a timer, stop it, confirm the entry appears with the right duration. Exercises `stop_timer()`, the overlap exclusion constraint (`btree_gist`), and RLS on `time_entries`.
5. **Invite a member.** Confirms the app's own Resend path (`src/lib/email/resend.ts`) and `APP_URL` — a separate code path from the Auth SMTP in step 7, so it needs its own check.
6. **Signed-out routing.** In a private window, hit `/dashboard` and confirm the middleware bounce to `/sign-in`. A missing-env deploy skips this guard silently, so a *successful* redirect is the positive signal.

---

## Known caveats to accept going in

- **Free projects pause after ~1 week without database activity** ([docs](https://supabase.com/docs/guides/platform/free-project-pausing)). A paused project makes the app look broken; restore from the dashboard, or upgrade to Pro. Free plan also caps at 2 active projects.
- **`.env.production` is for local prod builds only.** It's gitignored, so it never reaches Netlify. Netlify's copies must be maintained separately in the dashboard — two sources of truth for these values, with no mechanism keeping them in sync.
- **Nothing validates env at startup.** There is no env schema module in this repo; a bad deploy surfaces as a 500 on an authenticated page, not a build failure. Closing that with a small fail-fast assertion module is an easy separate follow-up.
- **The Coolify/Docker path is untouched and still works.** `docker build --build-arg NEXT_PUBLIC_SUPABASE_URL=… --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=…` remains valid against the cloud project.

---

## Files touched

| File | Change |
| --- | --- |
| `.env.prod` → `.env.production` | Rename; rewrite stale local-stack header comments |
| `netlify.toml` | New — build command, publish dir, `NODE_VERSION`, `SECRETS_SCAN_OMIT_KEYS` |
| `src/types/supabase.ts` | Regenerated against the hosted project (expect no diff) |
| `README.md` | New "Deploy on Netlify" section; amend "Pointing at a hosted project" |
| `BLOCKERS.md` | Resolved entry: Netlify host, cloud Supabase, Resend SMTP answers D-9's open note |
| `next.config.ts` | **No change** — `output: "standalone"` is Netlify-compatible |
| `Dockerfile` | **No change** — Coolify path preserved |
