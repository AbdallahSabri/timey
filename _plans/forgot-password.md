# Forgot password — recovery link, neutral messaging, straight back into the app

## Context

Timey has three auth actions — `signUp`, `signIn`, `signOut` — and no way to recover an
account. A user who forgets their password is locked out permanently: there is no
`/forgot-password` route, no `resetPasswordForEmail` call anywhere in the repo, and no
recovery email template. `SPEC.md` mentions password reset exactly once (§8.4.1), and only
to place it *outside* the app's own Resend module as "a separate GoTrue-owned delivery
path". So it is unruled rather than forbidden — this adds a numbered §8.5 amendment rather
than contradicting anything. `PLAN.md` has no phase for it either; all nine phases are
complete, so this is a standalone chunk.

The real-world case that makes it urgent is already in the log: `BLOCKERS.md` D-14 records
that local data was destroyed during Phase 3 work and the user's own account had to be
recreated *"with a new password"*, because there was no other way back in.

### Decisions taken (confirmed with the user)

1. **Forgot-password only.** A link on `/sign-in`, an email, and a page to set a new
   password. No "change your password" surface for signed-in users.
2. **Neutral messaging.** The request form says the same thing whether or not the address
   has an account, matching the anti-enumeration rule already written into
   `signInErrorMessage` ("Incorrect email or password.", `src/lib/actions/auth.ts:62`).
3. **Straight into the app.** The recovery link establishes a session, so after setting the
   new password the user lands in the app rather than retyping it at `/sign-in`.
4. **A marker cookie gates `/reset-password`** — see §2 below for why this is not optional.
5. **Hosted SMTP and the confirmation template are already configured** in the Supabase
   dashboard, so Phase 0 is one paste rather than a deploy project.

---

## 1. Two defects this uncovers, both fixed here

### 1.1 `pending_next` silently hijacks any future `verifyOtp` — real, verified

`src/app/auth/confirm/route.ts:62-65`:

```ts
const stashed = data.user?.user_metadata?.[PENDING_NEXT_KEY];
if (verified && typeof stashed === "string") {
  next = safeNextPath(stashed, queryNext);
}
```

`pending_next` is written in exactly one place (`src/lib/actions/auth.ts:135`, only when
signup carried a `?next=` — i.e. for **invited employees**), read in exactly one place, and
**never cleared**. It is permanent user metadata that outranks the query string.

So an invitee who later requests a password reset would be redirected to their stale
`/invite/<token>` instead of the reset form — landing in the app holding a live recovery
session with an **unchanged password**. A reset that silently does nothing, for precisely
the population most likely to need one.

**Fix at the root, not with a guard:** `pending_next` is a signup-only concept, so
`/auth/confirm` hardcodes `type: "signup"` and stops accepting `type` from the query.
Worth landing on its own merits regardless of this feature.

### 1.2 The `type` cast asserts nothing

`route.ts:30` reads `searchParams.get("type") as EmailOtpType | null`, and `EmailOtpType`
is `'signup' | 'invite' | … | (string & {})` — the union absorbs any string, so the cast is
decorative. The route already accepts `type=recovery` from anyone, today. Hardcoding the
type deletes the cast and the problem together.

---

## 2. Why a dedicated `/auth/reset`, and why `/reset-password` needs a cookie

**Reusing `/auth/confirm` was the first design and is rejected.** It looks free because
`type` and `next` are query-driven, but it needs three `type`-conditionals — skip
`pending_next`, pick the failure destination, pick the default `next` — at which point it
is two routes sharing a file. Two further reasons decide it:

- **The failure copy is signup-specific.** `/sign-in?error=confirmation_failed` renders
  *"…Sign in, or sign up again to get a new one"* (`src/app/sign-in/page.tsx:35`), which is
  wrong advice for an expired reset link.
- **`next` is caller-controlled on the highest-value token in the system.** A recovery token
  grants a session; a dedicated route hardcodes both the type and the destination, so the
  emailed link carries `token_hash` and nothing else.

**`/reset-password` must sit in `PUBLIC_PATHS`, and that has a cost.** Traced against
`src/lib/supabase/middleware.ts`: the early return at `:145` is the only exit before the
profile lookup. In `SIGNED_OUT_PATHS`, a limbo invitee with a fresh recovery session is
bounced to `/onboarding` at `:181` and a company member to `/dashboard` at `:189`. In
neither set, the limbo case still fails at `:181`. `PUBLIC_PATHS` is the only placement that
lets an invited employee who never onboarded set a password at all.

But passing `:145` means an ordinary signed-in user who types `/reset-password` gets a
working change-password form — the surface decision #1 rules out, and a stolen unlocked
session could use it without knowing the old password. `getUser()` carries no recovery
marker, and the JWT `amr` claim is a GoTrue-version gamble.

**So `/auth/reset` sets a short-lived httpOnly marker cookie immediately before redirecting,
and `/reset-password` requires it.** No service key, no JWT decoding, no dependence on
GoTrue internals, and the page gets an explicit contract.

The redirect-on-missing-cookie composes with middleware to give the right answer in every
state, with no dead end anywhere:

| Who types `/reset-password` | Cookie | Lands on |
| --- | --- | --- |
| Followed a live reset link | yes | the form |
| Signed-in member | no | `/forgot-password` → middleware `:189` → `/dashboard` |
| Limbo invitee | no | `/forgot-password` → middleware `:181` → `/onboarding` |
| Signed out | no | `/forgot-password`, error rendered above a working request form |

---

## 3. Phase 0 — dashboard, before any code (the user)

SMTP and the confirmation template are already in place, so this is:

1. **Auth → Email Templates → Reset Password**: paste `supabase/templates/recovery.html`
   once it exists (step 1 below). Skipping this is a silent break: GoTrue's default recovery
   mail uses `{{ .ConfirmationURL }}`, which lands the session as a **URL fragment** no
   server can read — the exact failure `supabase/templates/confirmation.html` exists to
   avoid (`SPEC.md` §8.3.2, `BLOCKERS.md` D-8).
2. **Confirm "Secure password change" is OFF** on the hosted project. `config.toml` has
   `secure_password_change = false`, but that is the *local* container; if the hosted
   setting differs, `updateUser({password})` demands a nonce and the reset fails in
   production only. This is the D-15 shape — local config disagreeing with hosted.

**Local dev needs no config flip.** `enable_confirmations` maps to `GOTRUE_MAILER_AUTOCONFIRM`
and gates the *signup* mail only; `POST /recover` always sends. Do **not** flip it — that is
the path that destroyed the local database in D-14. Verify in one step before building:
request a reset for an existing local account and check Mailpit at `http://127.0.0.1:54524`.
Config-template changes need `supabase stop && supabase start` — **without** `--no-backup`.

---

## 4. Phase 1 — template and config

Owner: `write-migrations` (owns `supabase/**`). **No SQL migration and no type regeneration**
— `auth.users` is not in the generated types and §4.4 keeps it that way. Skip the "types"
step of `migrations → types → actions → UI` deliberately; do not run `pnpm db:types`.

1. **`supabase/templates/recovery.html`** — mirrors `confirmation.html`'s structure. The link:
   ```
   {{ .SiteURL }}/auth/reset?token_hash={{ .TokenHash }}
   ```
   No `type`, no `next` — both are hardcoded in the route. Not `{{ .ConfirmationURL }}`
   (fragment) and not `{{ .RedirectTo }}` (defaults to Site URL when unset → malformed link,
   `SPEC.md` §8.1.2).
2. **`supabase/config.toml`** — add `[auth.email.template.recovery]` with `subject` and
   `content_path`, directly beneath the existing `[auth.email.template.confirmation]` block.

---

## 5. Phase 2 — logic

Owner: `implement-logic`.

3. **`src/lib/validations/auth.ts`** — add `forgotPasswordSchema` (`{ email: emailSchema }`)
   and `resetPasswordSchema` (`{ password: passwordSchema }`) plus their inferred types,
   beside the existing `SignUpInput`/`SignInInput`. Reuse the exported `emailSchema` (its
   comment requires every address the product accepts to normalise identically) and the
   module-private `passwordSchema` — **do not export it**, the new schema is in the same file.

4. **`src/lib/auth/recovery.ts`** — new module for the marker cookie: the cookie name,
   `setRecoveryCookie()`, `hasRecoveryCookie()`, `clearRecoveryCookie()`, over `cookies()`
   from `next/headers`. httpOnly, `sameSite: "lax"`, `secure` outside dev, path `/`, ~15
   minute lifetime. It needs its own module because a route handler, a Server Component and
   a server action all read it, and a `"use server"` file cannot export the non-async parts —
   the same constraint that produced `next-path.ts` (documented at `next-path.ts:68-73`).
   **This adds a row to `CLAUDE.md`'s routing table** (`src/lib/auth/**` → `implement-logic`),
   following the `src/lib/time/**` and `src/lib/email/**` precedent.

5. **`src/app/auth/confirm/route.ts`** — the §1 fix. Hardcode `type: "signup"` in the
   `verifyOtp` call, delete the `as EmailOtpType` cast and its now-unused import, and extend
   the `pending_next` comment to say the scoping is what keeps a recovery from being
   hijacked.

6. **`src/app/auth/reset/route.ts`** — new. `verifyOtp({ type: "recovery", token_hash })`;
   on success set the marker cookie and `redirect("/reset-password")`; on failure
   `redirect("/forgot-password?error=reset_link_invalid")`. No `next`, no metadata read.
   Keep `redirect()` **outside** the `try` — it throws as Next's control-flow signal, and
   catching it swallows the navigation (reason documented at `confirm/route.ts:34-39`). A
   route handler rather than a Server Component, because `verifyOtp`'s cookies must be
   written before the redirect.

7. **`src/lib/supabase/middleware.ts`** — `/auth/reset` and `/reset-password` join
   `PUBLIC_PATHS`; `/forgot-password` joins `SIGNED_OUT_PATHS`. Extend both doc comments,
   which enumerate their members and reasons; the `/reset-password` entry needs the §2 table's
   reasoning in a sentence.

8. **`src/lib/actions/auth.ts`** — two actions and two error mappers, in the file's existing
   shape (`ActionResult`, `NOT_CONFIGURED` from every catch, `revalidatePath("/", "layout")`
   at the end).

   - **`requestPasswordReset`** → `supabase.auth.resetPasswordForEmail(email)` with **no**
     `redirectTo` (§8.1.2 — the template builds the URL from `{{ .SiteURL }}`).
     **`over_email_send_rate_limit` returns `{ ok: true }`, not an error.** GoTrue enforces
     `max_frequency` per user row, so a distinct rate-limit message is itself an enumeration
     oracle: unknown address twice → 200, 200; known address twice → 200, 429. Folding it
     into the neutral success is not even a lie — the code means a mail *was* recently sent
     to that address, which is exactly what the neutral copy claims. Only
     `validation_failed`/`email_address_invalid` (a fact about the input, not the account)
     and the `NOT_CONFIGURED` catch produce `ok: false`. Carry a comment in the style of the
     one at `auth.ts:62`.
   - **`updatePassword`** → `supabase.auth.updateUser({ password })`, then
     `clearRecoveryCookie()` on success.

   **The trap in the mapper:** with no session, `updateUser` returns
   `{ data: { user: null }, error }` where `error.code` is **`undefined`**, `error.status` is
   **400**, and `error.name` is `"AuthSessionMissingError"`. Copying `signInErrorMessage`'s
   `default: error.status === 400 ? …` branch would report the wrong thing. Detect it with
   `isAuthSessionMissingError` (a first-class export of `@supabase/supabase-js`) **before**
   the switch.

   | code / detection | message |
   | --- | --- |
   | `isAuthSessionMissingError`, `session_not_found`, `bad_jwt`, `session_expired` | "That reset link has expired. Request a new one." |
   | `same_password` | "That is already your password. Choose a different one." |
   | `weak_password` | reuse `signUpErrorMessage`'s exact string |
   | `over_request_rate_limit` | reuse verbatim: "Too many attempts. Wait a minute and try again." |
   | `reauthentication_needed` | "Request a new reset link and try again." (the hosted-only case from Phase 0) |
   | default | "Could not update your password. Please try again." |

---

## 6. Phase 3 — UI

Owner: `build-ui`. Every form follows `sign-in-form.tsx` / `sign-up-form.tsx`: react-hook-form
+ `zodResolver`, `formState.isSubmitting` for pending state, `noValidate`, `Field`/`FieldLabel`/
`FieldError`/`FieldDescription`, `data-invalid` + `aria-invalid`, server errors to
`toast.error(result.error)` **verbatim and never inline**, success via `router.replace()` +
`router.refresh()`.

9. **`src/components/auth/forgot-password-form.tsx`** — one email field. On `ok: true` swap to
   a terminal `<div role="status">` mirroring `sign-up-form.tsx:69-83`, with copy that does not
   depend on whether the account exists, plus a "try a different address" affordance back to
   the form so the terminal state is not a dead end.
10. **`src/components/auth/reset-password-form.tsx`** — a single password field,
    `autoComplete="new-password"`, `FieldDescription` reading `At least {MIN_PASSWORD_LENGTH}
    characters.` when there is no error. **No confirm-password field** — `SignUpForm` has none
    and accepted the same typo risk; a reset typo costs one more email, not an account. On
    success `router.replace("/dashboard")` + `router.refresh()`, letting middleware carry a
    limbo user on to `/onboarding`.
11. **`src/app/forgot-password/page.tsx`** — `Card` shell copied from `sign-in/page.tsx`, a
    `SEARCH_PARAM_ERRORS` map carrying `reset_link_invalid`, footer link back to `/sign-in`.
12. **`src/app/reset-password/page.tsx`** — checks `hasRecoveryCookie()` server-side and
    redirects to `/forgot-password?error=reset_link_invalid` when absent (§2's table). No
    "link expired" terminal screen: `nav.ts` and `SPEC.md` §4.2.2 rule that *"a link to a page
    whose every control refuses you is a dead end, not a neutral one"* — the user should land
    one click from a new link.
13. **`src/app/sign-in/page.tsx`** — "Forgot your password?" in `CardFooter`, beside the
    existing "No account yet?" line.

---

## 7. Phase 4 — documentation

14. **`SPEC.md` §8.5 Password recovery — RULED.** Neutral messaging and the residual
    `max_frequency` oracle; why a dedicated `/auth/reset`; the marker cookie and what it
    protects; **the email-scanner risk accepted knowingly** — a GET-exchange link is consumed
    by Outlook Safe Links and corporate AV, and for recovery the scanner ends up holding a
    live session cookie. PKCE is the standard mitigation and §8.1.2 rules it out; record it
    rather than discovering it later. Amend **§8.1.2** to state that `pending_next` is
    signup-scoped and never cleared.
15. **`BLOCKERS.md` D-18** (D-17 is the newest; newest goes first). The `pending_next`
    override defect and its root-cause fix, and the hosted-template paste as a D-15-shaped
    deploy-ordering hazard.
16. **`README.md`** — three rows in §Routes: `/forgot-password` (Signed out),
    `/reset-password` (Any state), `/auth/reset` (Any state). Update the `supabase/templates/`
    line and the `src/app/` tree. Add the email-template step to "Pointing at a hosted project",
    which the production plan already flags as a documentation gap.
17. **`CLAUDE.md`** — the `src/lib/auth/**` routing row from step 4.

---

## 8. Verification

**Tests** (colocated, vitest + jsdom, house style per `corrections.test.ts` and
`amend-correction-form.test.tsx`):

- **`src/lib/validations/auth.test.ts`** — new; this file has no test today. `emailSchema`
  trims and lowercases; rejects at 255 chars; `resetPasswordSchema` rejects at 5 and accepts
  at 6, rejects at 73 and accepts at 72; `forgotPasswordSchema` surfaces "Enter a valid email
  address." verbatim so `firstIssue()` has something readable.
- **`src/app/auth/confirm/route.test.ts`** — new, and **the only thing stopping the §1.1
  regression returning**. Asserts `verifyOtp` is called with `type: "signup"` regardless of
  any `?type=` in the URL; that `pending_next` still overrides `?next=` for a signup; that a
  bad token redirects to `/sign-in?error=confirmation_failed`.
- **`src/app/auth/reset/route.test.ts`** — asserts `verifyOtp` gets `type: "recovery"`;
  success sets the cookie and redirects to `/reset-password` and **never** to
  `user_metadata.pending_next` (drive the mock with a user carrying `pending_next:
  "/invite/xyz"` — this is the regression test for the bug); failure redirects to
  `/forgot-password?error=reset_link_invalid`.
- **`src/components/auth/forgot-password-form.test.tsx`** — the terminal `role="status"`
  renders **the same text for a known and an unknown address** (drive both, compare the
  rendered string — this is what actually encodes decision #2); `ok: false` sends the action's
  string to `toast.error` verbatim and leaves the form mounted; `router.replace` never fires.
- **`src/components/auth/reset-password-form.test.tsx`** — a 5-character password never
  reaches the action and renders the inline `FieldError`; on success `router.replace("/dashboard")`
  and `router.refresh()` both fire; on refusal `toast.error` gets the string verbatim and
  nothing navigates.

> **New precedent worth flagging at review:** the two route tests are the first in the repo to
> mock a Supabase client (`vi.mock("@/lib/supabase/server")`). Nothing has done this before —
> `health/route.test.ts` stubs `fetch`, `resend.test.ts` stubs env vars. Justified here because
> the `pending_next` defect has no other regression net, but `code-reviewer` should confirm the
> mock does not drift from the real client's shape.

**Manual, against the local stack** (`pnpm dev` + Mailpit at `http://127.0.0.1:54524`) — add
as a §12.2 block, which currently has **zero** auth items:

1. `enable_confirmations` stays `false` throughout. Confirm recovery mail still arrives.
2. Unknown address → the neutral state, and **no mail in Mailpit**.
3. Known address → mail arrives; its link points at `/auth/reset?token_hash=…` on the app
   origin, with no fragment.
4. Request twice quickly for a **known** address → still the neutral state, not a rate-limit
   message. Then three in a row, to see whether `email_sent = 2` binds locally at all (its
   comment claims it needs `[auth.email.smtp]`, which is commented out).
5. Follow the link → the reset form. Set a new password → straight to `/dashboard`.
6. Old password no longer signs in; new one does.
7. **The invitee case, the whole point of §1.1:** an account created through
   `/sign-up?next=/invite/<token>` (so it carries `pending_next`) resets its password and
   lands on the reset form, *not* on the stale invite.
8. **The limbo case:** an invitee who never onboarded resets → after setting the password,
   `/onboarding`, not a bounce loop.
9. A used or expired link → `/forgot-password` with the error above a working form.
10. Signed in as an ordinary member, type `/reset-password` → `/dashboard`, no form.
11. Reuse the same reset link twice → second attempt refuses.

**Gate** — all five clean before this is done:

```
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm build
```

Then `code-reviewer` read-only, per `PLAN.md`'s standing rules.

---

## 9. Order of work

1. **User** — Phase 0 dashboard checks (§3).
2. `write-migrations` — template + `config.toml` (§4). No migration, no type regeneration.
3. `implement-logic` — validations, cookie module, the `/auth/confirm` fix, `/auth/reset`,
   middleware, actions (§5).
4. `build-ui` — forms, pages, the sign-in link (§6).
5. `test-runner` — the gate; `code-reviewer` — read-only pass, with the Supabase-mock note.
6. Docs (§7), then the manual checklist (§8).
