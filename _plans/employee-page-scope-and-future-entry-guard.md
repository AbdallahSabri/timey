# Employee page scope + manual-entry future guard

> Reference document. Two unrelated changes, filed together because they arrived together.

## Context

Two requests:

1. An employee should not see `/members`, `/clients`, or `/projects`. `/corrections` stays, minus the admin queue.
2. Manual time entry should refuse future time and require end > start.

They're at opposite ends of the effort scale, and neither is what it looks like at first glance.

**(1) contradicts the spec as written** and needs a `SPEC.md` amendment, not a workaround — `CLAUDE.md` and `SPEC.md` §11 both rule that a conflict amends the document. `src/components/layout/nav.ts` carries a 30-line comment arguing the current behaviour on purpose ("A link is presentation, never a permission"), and §4.2's policy matrix lists `clients` and `profiles` SELECT as company-wide. Changing this is a deliberate reversal, so it gets written down.

**(2) is already 80% built.** `endedAt > startedAt` is enforced in three places today. The genuine gap is one missing branch, and the corrections subsystem already closes the identical hole on its own path.

### Read this before implementing Part 1

Three of six destinations are being hidden. An employee is left with `/dashboard`, `/corrections`, and `/reports`. Two notes:

- **`/corrections` needs no work at all.** The admin queue is *already* employee-invisible, at both ends: the fetch is conditional (`corrections/page.tsx:50`, `isAdmin ? await listPendingCorrectionRequests() : null`) and so is the render (`{isAdmin ? <Card>…</Card> : null}`). `MyCorrectionsList` renders for everyone, which is what §7.4 entitles an employee to. The page already does exactly what was asked — it simply must not be added to the route guard.
- **`/projects` is prefix-matched, not exact.** `/projects/[id]` exists, and an exact-match `Set` lets `/projects/abc` straight through. Logging time is unaffected — the timer and manual-entry forms pick project/task through `ProjectTaskFields` / `useProjectTasks`, not through this route — so what's lost is browsing and the project detail page.

---

## Part 1 — Restrict `/members`, `/clients`, `/projects` to admins

### What this can and cannot be

This must be a **navigation and routing change, not an RLS change.** That is not a shortcut — tightening the policies breaks working features:

- **`clients` SELECT must stay company-wide.** `listProjects()` embeds `clients (id, name)` to label each project with its client, and `src/lib/actions/projects.ts:171-172` says so explicitly: *"The `clients` embed is safe for employees too — `clients_select_own_company` is company-wide, so an employee sees the client label of a project they are [assigned to]."* Restricting it to admin blanks that label wherever projects are listed.
- **`profiles` SELECT must stay company-wide.** Member names are read across reports, corrections, and project-member assignment. Narrowing it breaks all three, and §4.2.1 already documents a load-bearing `OR id = auth.uid()` on that policy for limbo-state routing.
- **`projects` SELECT must stay employee-visible.** It is already project-scoped for employees via `project_members` (§3.6.1), and the timer and manual-entry forms depend on it to populate their project pickers. Locking the table would stop an employee logging time at all.

**State the consequence plainly rather than implying otherwise:** after this change an employee still sees client names, project names, and member names throughout the app. Three dedicated pages become unreachable; none of the underlying data becomes secret. If genuine confidentiality is wanted, that is a different and much larger change — new admin-only policies plus replacements for the features above — and should be its own plan.

### 1a. Route guard in middleware

`src/lib/supabase/middleware.ts` is where every other routing rule already lives, and it already queries `profiles` for `company_id` (line ~119). Add `role` and `status` to that same `select` — same round trip, no added cost — then guard alongside the existing checks.

**Exact matches and prefixes are two different lists**, because `/projects/[id]` exists and a `Set.has()` on `/projects/abc` returns false. The file already has this exact shape for `INVITE_PATH_PREFIX`; follow it:

```ts
const ADMIN_ONLY_PATHS = new Set(["/members", "/clients"]);
const ADMIN_ONLY_PREFIXES = ["/projects"];
```

Match `pathname === "/projects"` or `pathname.startsWith("/projects/")` — a bare `startsWith("/projects")` would also catch a future `/projects-archive`, the same trap `isActivePath` already documents.

An employee hitting any of them gets `redirectTo(request, DASHBOARD_PATH, supabaseResponse)`, reusing the existing helper so the refreshed auth cookies carry over (a bare `NextResponse.redirect` drops them and loops).

Follow the file's existing failure posture: the `company_id` read is already wrapped in try/catch and fails toward limbo. Treat an unreadable role the same way — **fail closed to "employee"**, so a transient error hides an admin page rather than exposing a restricted one.

### 1b. Page-level guard in the three pages

Middleware is not a security boundary — it doesn't run on every rendering path, and `SPEC.md` treats RLS as the guarantee. All three pages already call `getCurrentMember()` and compute `isAdmin`, so the guard is two lines each:

```ts
if (!isAdmin) redirect("/dashboard");
```

Cover `projects/[id]/page.tsx` as well as `projects/page.tsx`.

Rewrite the doc comment at the top of each — both `members/page.tsx` and `clients/page.tsx` currently open by arguing the opposite ("Everyone in the company can see who else is in it", "Everyone in the company can read the client list") and would be actively misleading left in place. **Leave `corrections/page.tsx` untouched**, comment included: its "Reaching `/corrections` as an employee is neither prevented nor interesting: everything on it is theirs" stays true.

### 1c. Nav filtering

Add `adminOnly?: boolean` to `NavLinkSpec`, mark the `/members`, `/clients` and `/projects` entries, and export a `navLinksFor(role)` helper. Both chrome pieces (`desktop-nav.tsx`, `mobile-tab-bar.tsx`) must call it — the entire reason `nav.ts` exists is that "a link that exists in one but not the other is a bug."

**`mobile-tab-bar.tsx` needs restructuring, not just a filter.** Lines 18-19 compute `PRIMARY` and `OVERFLOW` as module-level constants from `NAV_LINKS` at import time; role-dependent lists cannot be module constants. They become per-render values derived from `navLinksFor(role)`. Two layout consequences follow:

- An employee's overflow is **empty** — both non-primary links (`/clients`, `/members`) are admin-only. The "More" trigger must not render when the overflow is empty, or the tab bar shows a control that opens nothing.
- An employee's primary set is **three items** (`/dashboard`, `/corrections`, `/reports`) in a bar built for four slots, since `/projects` is `primary: true` and now hidden. Check the layout holds at three rather than leaving a dead column — `build-ui`'s call per `CLAUDE.md`'s routing table.

Rewrite the file's header comment. Its current argument — that these destinations are listed for everyone because withholding a link protects nothing — is precisely what's being reversed. The new comment should say why the product wants them hidden anyway (they are admin surfaces; an employee has no task there) while being honest that this is decluttering plus a route guard, not access control.

### 1d. Spec and blockers

- `SPEC.md` §4.2 — the policy matrix cells stay as they are (no policy changes). Add an amendment note recording that these three are now admin-only **routes** over unchanged company-readable **data**, and why the two were separated.
- §7.4 needs **no** amendment: `/corrections` stays reachable and `MyCorrectionsList` still shows an employee their own requests and outcomes, which is exactly what §7.4 promises.
- `BLOCKERS.md` — a resolved `D-<n>` entry, newest first, recording the reversal of `nav.ts`'s stated position.

### 1e. Tests

`src/components/layout/nav.test.ts` and `mobile-tab-bar.test.tsx` both consume `NAV_LINKS` and will need cases for both roles:

- `navLinksFor("employee")` returns exactly `/dashboard`, `/corrections` and `/reports`; `navLinksFor("admin")` returns all six.
- The tab bar renders no "More" trigger for an employee, and does render one for an admin.

---

## Part 2 — Manual entry: future time and ordering

### What already works — no change needed

**`endedAt > startedAt` is enforced three times over.** Nothing to build:

| Layer | Where |
| --- | --- |
| Action | `src/lib/actions/time-entries.ts:946` — `"An entry has to end after it starts."` |
| Database | `0005_time_entries.sql:216` — `check (ended_at is null or ended_at > started_at)` |
| Corrections | `0006_corrections.sql:783-787` — `assert_entry_window_valid`, `ended_before_started` |

Deliberately *not* in the zod schema, and `validations/time-entries.ts:145-150` explains why: these are wall clocks, and wall-clock order isn't instant order. Across a DST fall-back, `02:30 → 01:30` is a real 50-minute entry and `01:30 → 01:30` can be a real 60-minute one. Comparing the strings would refuse both. The action compares resolved instants instead. **Do not add a schema-level refinement** — it would reintroduce exactly that bug.

**Future `started_at` is already refused** at `time-entries.ts:950`, with §6.4's five-minute drift grace via the shared `FUTURE_GRACE_MS` (`src/lib/time/company-time.ts:89`).

### The actual hole: `ended_at` is unguarded

`createManualEntry` checks `startedAt` against the clock and against today's company-local date. **It never checks `endedAt` against either.** So at 10:00 you can save `09:00 → 23:59` and book fourteen hours nobody has worked — and since the today-only rule also only looks at `startedAt`, `09:00 → tomorrow 05:00` passes too.

The corrections path already closes this exact hole. `0006_corrections.sql:803-806`:

```sql
if p_ended_at is not null and p_ended_at > now() + interval '5 minutes' then
  raise exception 'you cannot log time that has not happened yet'
    using errcode = '22023', detail = 'ended_in_future';
end if;
```

Its comment justifies the extension beyond §6.4's literal wording — *"an interval that has ENDED ended in the past"* — but also claims that for a manual entry *"§7.1's today-only rule incidentally caps the other end."* **That claim is wrong**, and it's why the gap survived: today-only tests `companyLocalDate(startedAt)`, so it constrains the opening instant's calendar day and nothing about the closing one.

### The change

One branch in `createManualEntry` (`src/lib/actions/time-entries.ts`), mirroring the SQL, reusing `FUTURE_GRACE_MS` so the constant stays single-sourced:

```ts
if (endedAt.getTime() > now + FUTURE_GRACE_MS) {
  return { ok: false, error: "You can't log time that hasn't happened yet." };
}
```

Placed **after** the existing `startedAt` future check and **before** the today-only check, preserving the ordering rationale already documented at `time-entries.ts:887-889` (future before today, because "you cannot log time that has not happened yet" is the more useful of two sentences that both refuse tomorrow). Reuse the identical message string — the same refusal shouldn't be worded two ways.

Update that function's doc comment: it currently enumerates "Three validations, in this order, and the order is deliberate" and will be four.

### Leave the form alone

`manual-entry-form.tsx:179-183` carries a deliberate decision not to duplicate these rules client-side:

> *"Deliberately prose and not a client-side check: 'today' means today in the company's timezone, the server owns that clock, and a second copy of the rule computed in the browser would be a second thing that can be wrong."*

That reasoning holds — the browser's zone isn't the company's, so a `max` attribute on the `datetime-local` input would be right only for users whose zone matches. The existing helper text already says future time is refused. Refusals surface as a toast from the server, which is the current, working pattern.

### Spec

`SPEC.md` §6.4 (line 393) currently reads: *"`started_at` may not exceed `now() + 5 minutes`."* Amend it to cover both ends, and record that the database has said so since `0006` while the manual-entry path did not — so the amendment closes a divergence rather than inventing a rule.

---

## Verification

Full gate — both parts touch tested files:

```bash
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm build
```

New unit coverage:

- `createManualEntry` refuses an `endedAt` beyond the grace and accepts one inside it. `src/lib/time/company-time.ts` is pure, so this is testable without a database.
- `navLinksFor("employee")` excludes both hrefs; `navLinksFor("admin")` includes them.

Manual checks against a real database (`SPEC.md` §12.2 — Vitest can't see Postgres, so none of the routing or policy behaviour is covered by the suite):

1. As an **employee**: `/members`, `/clients`, `/projects` and `/projects/<a-real-id>` all redirect to `/dashboard`. The deep link is the one that catches an exact-match `Set`.
2. As an **employee**: `/corrections` still loads, shows "Your requests", and shows **no** "Waiting for review" card. Unchanged behaviour — this is a regression check, not a new one.
3. As an **employee** on a phone: the tab bar shows three destinations and **no "More" trigger**.
4. As an **employee**: starting a timer and saving a manual entry still work, and their project pickers are still populated. This is the regression check for the RLS-untouched decision — if a picker is empty, something tightened `projects` that shouldn't have been touched.
5. As an **admin**: all six pages and all six links still work, and "More" still appears.
5. Manual entry, with the current time around midday: `09:00 → 23:00` is refused with "You can't log time that hasn't happened yet." Previously accepted.
6. Manual entry: `09:00 → 09:30` still saves. The grace still holds — a start three minutes ahead is accepted.
7. Manual entry: `10:00 → 09:00` still gives "An entry has to end after it starts." (Regression check; this path is unchanged.)
8. A DST fall-back day, if convenient: `02:30 → 01:30` in a zone that shifts. Should still save as a positive-duration entry — the guard against re-adding a string comparison.

---

## Files touched

| File | Change |
| --- | --- |
| `src/lib/supabase/middleware.ts` | Add `role`/`status` to the existing `profiles` select; exact-match + prefix admin-only guards; fail closed to employee |
| `src/components/layout/nav.ts` | `adminOnly` flag on three entries, `navLinksFor(role)`, rewritten header comment |
| `src/components/layout/desktop-nav.tsx` | Consume `navLinksFor(role)` |
| `src/components/layout/mobile-tab-bar.tsx` | Module-level `PRIMARY`/`OVERFLOW` become per-render; suppress "More" when overflow is empty; check the two-slot layout |
| `src/app/(app)/{members,clients,projects}/page.tsx` + `projects/[id]/page.tsx` | `redirect("/dashboard")` when not admin; rewritten doc comments |
| `src/app/(app)/corrections/page.tsx` | **No change** — the admin queue is already gated at both fetch and render |
| `src/lib/actions/time-entries.ts` | Fourth validation: `endedAt` future guard; updated doc comment |
| `SPEC.md` | §6.4 covers both ends; §4.2 amendment note on admin-only routes over unchanged data |
| `BLOCKERS.md` | Resolved entry for the `nav.ts` reversal |
| `nav.test.ts`, `mobile-tab-bar.test.tsx`, time-entry action tests | Role cases; empty-overflow case; `ended_in_future` cases |
| `supabase/migrations/**` | **No change** — no policy is altered |
| `src/lib/validations/time-entries.ts` | **No change** — a schema-level ordering refinement would break DST entries |
| `src/components/time-entries/manual-entry-form.tsx` | **No change** — client-side duplication is deliberately avoided |