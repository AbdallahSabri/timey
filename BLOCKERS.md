# Blockers

Things that stop a phase, or that were worked around in a way worth knowing about. Newest first within each section.

Each open blocker names the phase it stops and the **default it will proceed on** if unanswered — nothing here silently waits forever. A default is always the standing `SPEC.md` ruling, never an invention.

---

## Resolved — decisions answered

### D-19 · Two dashboards, and five rulings that keep them honest, 2026-09-12

**`SPEC.md` §9.9 (new), §4.2.2, §5.4, §12.2, §12.3; `PLAN.md` Phase 10.** Phases 8 and 9 could answer "how much" and "is that enough", but only after two controls were set on `/reports`. This adds the two landing surfaces, and builds §5.4's stale-timer exception queue, which had been ruled since Phase 5 and never had an admin dashboard to live on.

**Five decisions, four of them confirmed with the user before any code.**

1. **Two surfaces, not one that branches.** `/dashboard` stays personal for both roles — the timer is what the product is for, and an admin logs time like anybody else — and `/overview` is a new admin-only route. The alternative considered was a role-branched `/dashboard`, which sinks the timer below three team cards for exactly the people who also have to use it.
2. **Hand-rolled charts, no dependency.** The `--chart-1` … `--chart-5` tokens had been defined in `globals.css` since Phase 0 and spent **nowhere**. Against `pnpm dlx shadcn@latest add chart` (recharts): a rendered bar is worth nothing to a screen reader and nothing in jsdom, which has no layout — so the accessible reading had to be the chart either way, and once it is, the library is drawing a decoration. §12.3's "build chunk with its own dependency" bar is not cleared by bars and meters.
3. **Snapshot plus ticking counters** for "on the clock now", reusing `useElapsedSeconds`. Not polling, not Realtime — neither is used anywhere in this app, and a list that is correct on load and counts upward answers the question.
4. **No dashboard invents a per-day expected target** (§9.9.2). This is the one that took the most argument. A daily target beside the daily bars is the obvious feature and it cannot be built honestly: expected is a *range* quantity accruing from each assignment's `added_at` (D-17), there is no per-day RPC, and rebuilding one at the edge from `project_members` would sit next to §9.8's figure disagreeing with it. `weeklySecondsOf()` already carries a comment making the same distinction. Charts dim non-working days instead, which claims nothing about what was owed — and dim nothing at all where no schedule exists, since dimming every day would imply the person is never due in.
5. **A truncated list carries no total** (§9.9.3), which is D-16 applied one surface further along.

**One departure from the approved plan, taken on the codebase's own reasoning.** The plan had `listRunningTimers()` gated on `role === "admin" && status === "active"`. `listPendingCorrectionRequests` refuses to do that in the identical situation and says why: `time_entries_select_own_or_admin` is the boundary, and a role test in TypeScript is a third opinion free to disagree with it. So the action is ungated and an employee calling it gets their own running timer — the same row `getRunningTimer()` gives them. The page is admin-only in the UI; the team is admin-only in the database.

**§4.2.2 gained a paragraph rather than just a route.** `/overview` is the **first** entry on that list whose contents really are confidential. The original three hide a surface whose tables stay company-readable, and §4.2.2 is careful to say so. This one reads `time_entries`, which scopes an employee to their own rows — so an employee who got past the redirect would see a page about themselves under a heading about the team. The redirect is a convenience over a boundary that already holds. Recorded because it changes what the §12.2 tenancy check is testing.

**Two refactors folded in, both removing duplication rather than adding a layer.** `FIGURE_CLASS` had been copied verbatim into `report-summary.tsx` and `month-progress-card.tsx` and was about to go into two more surfaces; it is now `StatTile` in `structure/`. `MonthProgressCard`'s progress bar — including its two guards, the 100% clamp and the zero-target case — is now `ProgressMeter`, which `/overview`'s attendance card uses once per person. Both existing test files pass untouched, which is the check that the extraction changed nothing.

**One performance fix the feature forced.** `prepare()` calls `getCurrentMember()` per report, and each call is a `supabase.auth.getUser()` round trip. A page composed of four reports would have validated the same JWT six times. `readCurrentMember` in `lib/supabase/current-member.ts` wraps the query in React's `cache` — request-scoped, so no stale role is possible and a mutation cannot be followed by a stale read. It could not live in `lib/actions/companies.ts`: a `"use server"` module may only export async functions, and `cache(fn)` is a value. `getCurrentMember()` is now a one-line door onto it, so no existing caller changed (`BLOCKERS.md` N-4's "one path" stands).

**Two defects the review caught, both of which the gate was green through.** Recorded because both are the same species — a figure that is correct and a sentence that is not.

- **`/overview` counted running timers two ways.** The "On the clock" tile used `listRunningTimers()`; §9.9.4's "not counted yet" disclosure under the attendance card used `report_summary.running_count`. Those disagree exactly where it matters: `report_summary` buckets by *start day*, so a timer running since 30 August counts zero in a 12 September month-to-date report — a 300-hour stale timer, which is the case §5.4 built the page for — and the disclosure would have been silent while a **Stale** badge sat two cards above it. Same thing every 1st of the month for anything started the night before. Now one source for every running-timer statement on the page, which is §9.9.1's two-paths rule applied to a count rather than a total.
- **`ProgressMeter` would announce `0%` against a target that does not exist — latent, not live.** `MonthProgressCard` had gated the bar behind `hasTarget`; extracting the bar left the guard in the only caller that had one, so `TeamAttendanceList` rendered the meter unconditionally. A null target mapped to `aria-valuenow="0"`, which is §9.8.2's zero-versus-omit rule broken in the one channel where the number is the only thing said. The guard now lives **in** the component: a null target renders a track with no role and no value, so no future caller can make the claim either. A test asserting the old behaviour was deleted rather than adjusted; it was locking in the bug.

  **Walking §12.2 established that this was unreachable in practice, and the first draft of this entry overstated it.** `getReportByUser` returns a null `expectedSeconds` only when `expectedArgsFor` refuses a task filter, and `/overview` passes no task filter — so on the page as built, a person with no schedule arrives with `expectedSeconds: 0`, not null, because `mergeExpectedByUser` reads `?? 0` by design (`report-expected.ts`: "the absence of a schedule is a statement that nothing was asked of them"). Verified against the live stack: QA Employee 10, with no schedule and 18 hours logged, renders `0:00:00` expected — the same as `/reports` shows for them. So the defect was a latent one in a shared component, not a screen-reader regression anybody could have hit, and `TeamAttendanceList`'s own `difference === null` branch is defensive rather than a live state. Both are worth keeping: the type permits null and a task-filtered caller would reach it.

**Four claims that outran their code, all fixed by changing the claim.** A caption that says more than the data supports is the failure mode this whole feature is most prone to:

- "Longest first" on the project breakdown, where `topNWithOther`'s collapsed tail can legitimately outweigh every row it collapsed and draw the longest bar at the *bottom*. The bars were honest; the caption was not. Now "the biggest few first, then everything else together", with a test for the oversized-`Other` case.
- "Weekends are dimmed by the company's week" on `/overview`, which hardcoded Saturday and Sunday. `companies.week_starts_on` would not have fixed it — that column says which day a week is read *from*, not which days are the weekend — and a team has no single working week at all, since schedules are per assignment. The caption now names the two days.
- "(not a working day)" in the chart's accessible label, which is a claim about a *past* day made from the schedule in force *now*. `project_members` keeps no schedule history, so a person assigned last week had the preceding fortnight's weekends named for them. Present tense — "(outside working days)" — is the strongest claim the data supports, and it is the same gap §9.8's accrual-from-`added_at` rule exists for.
- §9.9.1's "no dashboard runs a query of its own", which two reads on these pages falsify (`listRunningTimers`, `listMemberProjectSchedules`). Amended to say what is actually true: no dashboard adds an RPC, and every *figure* comes from a report action — the two exceptions produce rows and a dimming rule, not numbers.

**Two more the review was right about.** `listRunningTimers()` had no bound and its consumer mounts a 1 Hz interval per row, so a two-hundred-person company would have handed one admin two hundred intervals; the list is now capped, and capping an exception queue is safe only because it is ordered oldest-first, so the stalest rows are the ones that survive — the tile above still counts the whole set. And `readCurrentMember` sat in `lib/supabase/`, which `CLAUDE.md` scopes to clients and session refresh; it moved to `lib/auth/`, the row written for "auth-flow state a `'use server'` module can't publish". Its docblock had also claimed outright that "a mutation cannot be followed by a stale read" — true today only because no `profiles`-mutating action happens to read the member first, which is a property of the call graph and not of `cache()`. Now stated as the constraint it is.

**One stated-but-undone refactor.** `month-progress-card.tsx` still carried its own byte-identical `FIGURE_CLASS` while `stat-tile.tsx` and this entry both claimed the duplicate was gone — the exact drift the extraction was justified by, now with a document asserting it could not happen. It imports the shared one.

**Not covered by the suite.** `listRunningTimers` is an action, and `src/lib/actions/**` has no test harness in this repo — it needs a real database (§12.1, N-2). It is verified by the §12.2 Dashboards checks. The helpers and all five presentational components did gain unit coverage: the suite went from 377 tests to 443, and every chart assertion reads the accessible name rather than a class, which is the property that makes the charts testable at all.

**Verified against the live local stack, 2026-09-12.** Eleven of the thirteen §12.2 Dashboards checks pass; the two outstanding ones are visual and need a browser (see below). Fixtures were a throwaway `QA Dashboards Co` on `Asia/Hebron` with eleven accounts, four projects and 83 closed entries plus three open timers, so `Easy Cloud Web` was never touched. Highlights, because several of these are the checks most likely to be got wrong:

- **The two-paths check (§12.2).** `/overview`'s "Hours this month" read `261:45:00`; `/reports` by-user footer over the same range read `261:45:00` across 83 entries. On the employee side, `/dashboard`'s month tile read `44:00:00` and `/reports` agreed, as did the `44:00:00 of 50:00:00` card against the table's `50:00:00` Expected and `−6:00:00` Difference.
- **Tiles equal their own visible bars.** "This week" read `26:00:00`; summing the chart's own `aria-label`s from Mon 7 Sept gave `26:00:00` exactly. "Today" read `0:00:00` and today's bar was `0:00:00`.
- **§9.8.3's union row.** QA Employee 09, scheduled and with zero entries, appeared **first** in the attendance card at `0:00:00 of 36:00:00`, and in `/reports` too.
- **§9.4.** Starting a third timer mid-walk left `261:45:00` unmoved, took the count 2 → 3, and repluralised the disclosure.
- **§5.4.** The 11-hour timer carried the Stale badge, `ring-destructive/40`, and "Running 11 hours"; the card contains **zero buttons** (D-5).
- **§6.1.** An entry at `2026-09-10 21:30Z` landed on `2026-09-11` in `Asia/Hebron`, where UTC bucketing would have filed it a day earlier. Separately, in a throwaway `America/Havana` company an entry at `2026-11-01 03:30Z` stayed in **October** — that date is both a month boundary and Cuba's DST transition, and UTC bucketing would have moved it into November.
- **Tenancy.** A signed-in employee hitting `/overview` got `307 → /dashboard`; the link is absent from their nav (0 occurrences in the HTML, 1 for an admin). A second company saw none of the first's entries, projects or people. An employee passing the admin's `p_user_id` to `report_by_user` got **zero rows** — RLS, not the parameter.
- **Labels RLS hides.** Removing an employee from a project they had logged against turned the breakdown row into a muted italic "Unknown project · —" — never blank, never the string "null".

**One thing the walk changed my mind about.** `report_expected_by_user` is *not* collapsed to the caller by RLS — `project_members` SELECT is company-wide (§3.6.3) — and an employee asking for a colleague's expected figure gets it. That is documented in `0014` and handled by `prepare()`'s `userId = isAdmin ? … : member.data.id`, and it holds; but it means the TypeScript layer is load-bearing for that one function in a way it is for nothing else in the reporting surface. Worth knowing before anyone refactors `prepare()`.

**Still outstanding, and therefore this is not fully done per N-2:** §12.2's responsive check and its light/dark check. Both need a browser and no browser was available here; statically, every `--chart-*` token plus `--live` and `--muted-foreground` is defined in both the light and `.dark` blocks, and neither page emits a fixed width wider than a phone. The remaining risk is visual, not structural.

### D-18 · Password recovery built, and a latent `pending_next` hijack closed with it, 2026-09-09

**`SPEC.md` §8.5 (new), §8.1.2 (amended).** Timey had no account recovery at all — a
forgotten password locked a user out for good. D-14 is the proof it mattered: when the
local database was destroyed, the user's own account had to be recreated *"with a new
password"* because nothing else could reach it.

`/forgot-password` → `requestPasswordReset()` → GoTrue mails
`supabase/templates/recovery.html` → `/auth/reset` exchanges `token_hash` via
`verifyOtp({ type: "recovery" })` → `/reset-password` → `updatePassword()`, and the user is
already signed in when it lands.

**A defect found on the way in, and fixed at the root.** `/auth/confirm` read its OTP
`type` from the query string, and that cast asserted nothing — `EmailOtpType` includes
`(string & {})`, so the union absorbs any string. Meanwhile `user_metadata.pending_next` is
written once at signup (only when signup carried a `?next=`, i.e. for **invited
employees**), read only there, and never cleared — and it *overrides* the query `next`. Put
together: a recovery token verified through that route would have redirected an invitee to
their stale `/invite/<token>` instead of the reset form, landing them in the app holding a
live session with the password they came to change still in place. A reset that silently
does nothing, for exactly the population most likely to need one.

Fixed by hardcoding `type: "signup"` rather than by guarding the read: `pending_next` is a
signup-scoped concept, and scoping the route is what makes permanent metadata safe to keep.
This was latent, not live — nothing minted recovery tokens before now — but it was reachable
by anyone who could put `type=recovery` in a URL. `src/app/auth/confirm/route.test.ts` is
the regression net, and it is the first test in this repo to mock a Supabase client.

**Why a separate `/auth/reset` rather than a `type` on `/auth/confirm`.** The failure copy on
`/sign-in?error=confirmation_failed` tells the user to sign up again, which is wrong advice
for a dead reset link; and `next` would be caller-controlled on a token that grants a
session. The recovery link now carries `token_hash` and nothing else.

**`/reset-password` sits in `PUBLIC_PATHS` and gates itself on a marker cookie.** That set's
early return is the only exit before the profile lookup, so anywhere else bounces a limbo
invitee to `/onboarding` before they can set a password — and an invited employee who never
onboarded is precisely who needs the link to work.

The marker's value is the user id `verifyOtp` returned, not a bare flag, and the gate refuses
unless it names the user the request is authenticated as — a browser-scoped marker would have
handed the form to whoever signed in next on a shared machine, changing *their* password with
no old password asked for. The check runs inside `updatePassword` as well as on the page: a
server action is network-reachable, so a page-only gate is one a crafted POST walks past
(§4.2.2, §8.1.1). It carries no secret and cannot; the `verifyOtp` session is the authority,
and a user id is an identifier, not a credential.

**The rate-limit message is reported as success, on purpose.** GoTrue enforces
`max_frequency` against the user row, so an unknown address asked twice gets 200/200 and a
known one 200 then 429 — surfacing `over_email_send_rate_limit` would rebuild the
enumeration oracle that the neutral copy exists to close.

**Deploy-ordering hazard, the D-15 shape.** `supabase/config.toml` binds the local container
only. The hosted project needs "Reset Password" pasted into Auth → Email Templates, or
production sends GoTrue's default `{{ .ConfirmationURL }}` mail, which lands the session as
a URL fragment no server can read — and it fails in production only. Confirm "Secure
password change" is off there too, or `updateUser({ password })` demands a nonce this flow
never collects.

**Not verified against a live stack yet.** The gate is green and the flow is covered by unit
tests, but `SPEC.md` §12.2's new auth block — real mail in Mailpit, the invitee case, the
limbo case, an expired link — has not been walked. Per `BLOCKERS.md` N-2, that means this is
not done.

### D-17 · Expected hours — four rulings that fix the arithmetic, 2026-09-08

`SPEC.md` §9.8 pairs actual logged time with an expected figure. Four questions had to be
answered before any of it could be written, because each one changes the number rather
than the presentation.

**1. The schedule hangs off the assignment, not the person.** An employee can work 4h/day
Mon–Fri on one project and 3h/day Mon/Tue/Thu/Fri on another; a `profiles`-level schedule
cannot express that without an allocation model layered on top. `project_members` gains
`expected_daily_seconds` and `working_days`, and the per-person figure is always a sum
over assignments (§3.6.3).

**2. Today counts in full.** Expected runs through the range end inclusive with no
proration by time of day. Rejected: prorating today, which makes the figure move while
you look at it and makes two people's numbers incomparable without also knowing when each
was rendered. The cost is that a mid-morning employee reads as a full day behind, and it
is paid with a caption rather than with arithmetic.

**3. Accrual starts at `added_at`.** Someone added to a project on the 20th owes nothing
for the 1st–19th, so back-filling an assignment cannot retroactively invent a shortfall.
Rejected: a separate `effective_from` column — it is the more general answer, and nothing
yet needs the generality; `added_at` already records the fact. Revisit if a real contract
change ever has to be dated independently of when the row was created.

**4. Expected is omitted, not zeroed, under a task filter.** Schedules are per project, so
"hours owed against one task" is not a quantity. Rendering `0:00:00` would assert that
nothing was expected, which is a stronger and falser claim than rendering nothing. The
functions take no `p_task_id` at all, so there is no path by which the edge could ask the
question (§9.8.2).

**Accepted consequence, recorded so it is a decision and not an oversight:**
`project_members_select_own_company` is company-wide, so every employee can read every
colleague's hours/day. That matches the disclosure §3.6.1 already accepts for the
assignment graph. If it must become private, the move is a separate
`project_member_schedules` table with an own-rows-or-admin SELECT policy — not a
column-level patch, because RLS is row-level and cannot hide a column from a caller
entitled to read the row.

### D-16 · §12.2's "totals equal their own visible line items" is scoped to aggregate views, 2026-09-02

**`SPEC.md` §9.7 (new), §12.2.** The detail view added to `/reports` lists one row per time
entry over a range, and a 366-day company-wide range is unbounded in a way no §9.3 grouping
is — so it pages. That collides head-on with §12.2's checklist line "report totals equal the
sum of their own visible line items", which is the rule that makes a timesheet trustworthy:
a footer disagreeing with the rows above it destroys confidence faster than a wrong number.

Three options were considered. **Sum only the page** — a footer reading 6:40 above 50 of 312
rows, technically consistent and completely useless. **Sum the whole range in the footer** —
the literal violation, and the exact failure the rule names. **No footer at all**, taken:
the range figures already exist one card higher up, in `report_summary`, which is the
sanctioned source of a range total (closed entries only, running counted separately, §9.4),
and the table carries a caption saying so.

So the rule is not weakened and not excepted — it is scoped. It governs a view that presents
a total. The detail view presents none, and §9.7 says that in the spec rather than leaving it
as an absence someone later "fixes" by adding a footer.

The second consequence worth recording: this view **includes running entries**, the only
report surface that does. Nothing there sums, so §9.4 is untouched — but `report_entries` is
now the one function in the reporting surface without `where ended_at is not null`, and any
future caller that sums its rows must exclude the NULL durations itself. The migration says
this in its header; it is repeated here because the next person to write a total over these
rows will read this file, not that one.

### D-15 · Production invitations broke on a code-ahead-of-schema deploy, 2026-08-29

**`README.md` §"Pointing at a hosted project".** Every invitation in production failed with "Could not send the invitation. Please try again." for every address.

D-13's `createInvitation` calls `email_is_company_member`, added in `0011`. The code was deployed; the migration was not. PostgREST answered `PGRST202`, `createInvitationErrorMessage` had no case for it, and `default:` returned `CREATE_FAILED`. Probing the cloud project confirmed the shape: tables answered `401/42501` (present — `anon` simply lacks the grant) while `email_is_company_member` and `pending_invitation_for_me` answered `PGRST202`. Note that probing an RPC *without* its parameters also returns `PGRST202`, so the first probe was a false signal until each function was called with its real argument.

**Two defects, and the second is the one worth keeping.** The deploy ordering caused the outage; but the check was implemented as fatal despite its own comment calling it *"Advisory, not the enforcement"*. A check permitted to be **stale** — it can lose a race with a signup between send and redemption — has no business being **fatal**. It now ignores any RPC error and refuses only on a definite yes, degrading to exactly the pre-`0011` behaviour: the invitation is created, and the wrong one is refused at redemption by `accept_invitation()` (23505/42501), which was always the enforcement. `getPendingInvitation()` already had this shape, which is why onboarding degraded gracefully on the same missing migration while invitations did not.

Verified by reproducing production locally rather than reasoning about it: dropped `email_is_company_member`, reloaded PostgREST's schema cache, and drove the real `createInvitation` through a temporary route handler. Function absent → invitation created and token issued (previously `CREATE_FAILED`); function restored → an existing member refused at send time again. Route removed afterwards. A probe route must not live in a folder starting with `_` — Next treats those as private and excludes them from routing, which cost a confusing 404.

**The trigger was a split merge.** PR #3 merged `79417cd`..`095ebb9`; the follow-up commit `4406b41` (migration `0012` and D-14's fix) was pushed afterwards and merged separately as PR #4. In the window between, `main` — and production — carried `0011`'s *caller* without `0011`'s *function*. Both migrations still need `supabase db push`: merging code has never applied a migration, and that is exactly the gap this entry is about.

Also fixed here: local dev had started demanding email confirmation. `supabase/config.toml` was restored after D-14's testing but the stack was never restarted, so the auth container still carried `GOTRUE_MAILER_AUTOCONFIRM=false`. Restarted with `supabase stop` **without** `--no-backup` — data preserved across the restart. Reading the config file does not diagnose this: the GoTrue flag is inverted relative to `enable_confirmations`, so `docker inspect ... | grep AUTOCONFIRM` is the check that answers it.

Not a defect, recorded because it looked like one: the reported body `0:{"a":"$@1",...}` / `1:{"ok":false,...}` is the React Server Actions RSC stream format, not malformed JSON. Line `1:` is the `ActionResult`.

### D-14 · Invited accounts can no longer become admins, 2026-08-29

**`SPEC.md` §8.1.1, §8.1.2 (both new).** Reported as "register an employee, log in, and they show as admin".

`accept_invitation()` was not the cause — it binds `role = v_inv.role` faithfully, and `/sign-up` and `/sign-in` both forward `?next=` correctly. The unguarded door was `/onboarding`: middleware parks every limbo user there and `create_company()` makes whoever uses it an admin, without ever asking whether they had been invited.

`0012_pending_invitation_guard.sql` adds `pending_invitation_for_me()` and replaces `create_company()` with the refusal (23514, DETAIL `pending_invitation`). Onboarding renders the invitation instead of the form; the function, not the page, is the enforcement. Expired invitations deliberately do not block — a lapsed invite must not lock someone out for good.

Separately, the destination now survives a confirmation email via `user_metadata.pending_next`, read back through `safeNextPath` in `/auth/confirm`. **An `emailRedirectTo` + `{{ .RedirectTo }}` template was built first and abandoned**: that variable defaults to the Site URL when the option is unset, which produces a malformed link (`http://host&token_hash=…`) rather than a wrong one — a silent break of every signup email. The metadata route needs no hosted-template change at all, which also means nothing to paste into the dashboard on deploy.

`/invite/[token]` now states an address mismatch instead of offering an Accept button that §8.4.1 is certain to refuse. `CurrentMember` gained `email` for it, taken from the `auth.getUser()` call `getCurrentMember()` already makes.

Verified with `enable_confirmations` flipped ON locally and restored afterwards: the Mailpit link carries no `next`, `/auth/confirm` still lands on `/invite/<token>`, a limbo invitee gets the invitation card with no form, a mismatched address gets the mismatch card with no Accept button, accepting yields `employee`, and an uninvited signup still creates a company and becomes admin. Four SQL cases too, including that an expired invitation does not block.

**Local data was destroyed during this work.** `supabase stop --no-backup` was run to pick up the config flip; `--no-backup` discards the volume, and the whole local database went with it — the user's own account, its company, and the Phase-1 fixtures (`admin-a`/`emp-a`/… ). A plain restart would have sufficed. `easycloudweb24@gmail.com` and Easy Cloud Web were recreated, with a new password; the fixtures were not. This also voids D-13's note about `emp-a` having role `admin`, since that row no longer exists.

### D-13 · Inviting an existing member now refused at send time, 2026-08-29

**`SPEC.md` §8.4.2 (new), §4.4.** Found while diagnosing a report that "the employee sees every route". The account in question (`easycloudweb24@gmail.com`) was `admin` because it had **created** its company 22 seconds after signup — `create_company()` binds the caller as admin atomically (§8.2), which is correct and not a bug. What was a bug sat next to it: a pending invitation for that same address, role `employee`, to the same company, which `accept_invitation()` would always have refused with 23505.

`createInvitation` never checked whether the address was already a member. It could not: `profiles` has no email column, `auth.users` is unreadable from the actions layer, and §4.4 rules out a service-role key. So `0011_invite_existing_member_guard.sql` adds `email_is_company_member(citext)` — `SECURITY DEFINER`, `stable`, scoped to `current_company_id()`, **admin-only** because it is an email oracle and §4.2 does not otherwise expose member addresses. Migration and calling code were written as separate passes (§0.2), types regenerated in between.

Verified against the real database: as the company admin it returns true for both members, false for an outsider, and false for a member of *another* company (tenancy holds); as an employee it raises 42501; as `anon` it is refused at the GRANT before the body runs. `accept_invitation()` is untouched and remains the enforcement — the new check is advisory and can lose a race with a signup landing between send and redemption.

The stale self-invitation was revoked. Note for whoever reads the member list next: `emp-a.1787682839109@example.com` is a fixture whose profile role is `admin` despite its name — it was invited as an employee and promoted later, and it is easy to mistake for an employee when testing.

### D-12 · Employee route scope narrowed, and §6.4 widened to both ends, 2026-08-29

**`SPEC.md` §4.2.2 (new), §6.4, §7.1.** Two unrelated user requests, landed together.

**Routes.** `/members`, `/clients`, `/projects` and `/projects/[id]` are now admin-only, guarded in `src/lib/supabase/middleware.ts` (`role` rides along on the `profiles` read that already fetched `company_id`, so no extra round trip) and again in each page. `nav.ts` gained an `adminOnly` flag and a `navLinksFor(role)` helper that both pieces of chrome must call; the role is read once in `(app)/layout.tsx` and handed down, so the header row and the tab bar cannot disagree. This **reverses** the position `nav.ts` argued at length — that every link is shown to every role because withholding one protects nothing. The protection claim was correct and is restated in §4.2.2; the conclusion was not, because a link to a page whose every control refuses you is a dead end.

**No policy changed, deliberately.** `clients`, `profiles` and `projects` SELECT all stay as they were, because `listProjects()`'s client-label embed, member names across reports and corrections, and the timer's own project picker read through them. So this hides three admin surfaces without making their contents confidential — stated in §4.2.2 so the limit is arguable rather than assumed. Confidentiality would be a separate change with three replacement readers attached.

`/corrections` was initially in scope and was pulled back out on the user's instruction — keep the page, hide the admin queue only. It turned out to need no change at all: `corrections/page.tsx` already gates the queue at both the fetch (`isAdmin ? await listPendingCorrectionRequests() : null`) and the render, while `MyCorrectionsList` renders for everyone, which is exactly what §7.4 entitles an employee to. So §7.4 needed no amendment either.

**One planned step was wrong and was not taken.** The plan called for suppressing the phone's "More" trigger once an employee's overflow came out empty (both non-primary destinations being admin-only). `MobileTabBar` also carries the **only sign-out reachable on a phone** — the header's is `md`-only — so suppressing it would have stranded every employee in their session. "More" now survives an empty overflow and drops only the separator above sign-out.

**§6.4.** `createManualEntry` guarded `started_at` against the future but never `ended_at`, so an entry submitted at 10:00 for 09:00 → 23:59 booked fourteen unworked hours, and 09:00 → tomorrow 05:00 passed too. `assert_entry_window_valid()` (`0006`) had guarded both ends since Phase 7, on the reasoning that an interval which has ended ended in the past; its comment assumed §7.1's today-only rule "incidentally caps the other end" for manual entries, which is false — today-only tests `companyLocalDate(started_at)` only. One branch added, reusing `FUTURE_GRACE_MS`; §6.4 amended to name both ends. `ended_at > started_at` needed no work: it was already enforced in the action, by the `time_entries` CHECK, and by `assert_entry_window_valid()`.

**Not covered by the suite.** `src/lib/actions/**` has no test harness in this repo — it needs a real database (§12.1, N-2) — so the `ended_at` branch is verified by the §12.2-style manual checks, not by Vitest. Nav and tab-bar behaviour did gain unit coverage (both roles, the empty-overflow case, and the fail-closed null role). Full gate green.

### D-11 · B-5 answered — CSV only, no PDF, 2026-08-25

**`SPEC.md` §10 item 6, §9.6.** User confirmed the standing default rather than requesting PDF timesheets. No change: CSV export (Phase 8) is the only export format. PDF generation stays additive — a separate chunk with its own rendering dependency — if it's ever wanted later.

### D-10 · B-4 answered — project names stay non-unique per company, 2026-08-25

**`SPEC.md` §3.4.** User confirmed the standing default rather than adding a uniqueness constraint. No change: `projects.name` has no unique index, unlike `clients.name` and `tasks.name`, which do (§3.3, §3.5). Two projects named "Website Rebuild" in the same company remain both valid. Adding the constraint later is still a straightforward additive migration if this is ever revisited — `src/lib/actions/projects.ts` already anticipates the error text a `clients_write_error_message`-style branch would need.

### D-9 · N-6 closed — invitation emails send through Resend, provider chosen 2026-08-25

**`SPEC.md` §8.4, §8.4.1, §10 item 5.** Provider: Resend, picked by the user over Supabase-SMTP / SendGrid / Postmark. `createInvitation()` (`src/lib/actions/invitations.ts`) now attempts a send after the invitation row exists, via a new `src/lib/email/resend.ts` (`{ ok }`-tagged, never throws). Three new server-only env vars, all optional: `RESEND_API_KEY`, `EMAIL_FROM`, `APP_URL` — the last because a server action has no `window.location.origin` to build the emailed link from, unlike the on-screen copy link. Unset (a freshly forked template, or local dev today — none of the three are in `.env`), `createInvitation` still succeeds and returns `emailSent: false`, and `InviteLink` shows the same copyable-link fallback the product always had, just reworded to cover "not configured" and "attempt failed" as one case with one remedy. `emailSent: true` reworded it to "emailed to X, keep this copy handy."

Verified: full gate green including two new tests (`src/lib/email/resend.test.ts`) covering `sendEmail`'s two not-configured branches and `escapeHtml`; confirmed via direct inspection that the repo's own `.env`/`.env.example` ship none of the three vars set, so a fresh clone exercises exactly the no-`APP_URL` → `emailSent: false` path. **Real delivery verified 2026-08-25**, end to end and twice: first with a real `RESEND_API_KEY` and an unverified `EMAIL_FROM` domain, which Resend correctly rejected (`sendEmail()` degraded to `{ ok: false }` exactly as designed, no crash) — then again after the user verified `abdallahsabri.com` at resend.com/domains, with the real `EMAIL_FROM=timely@abdallahsabri.com`, which the user confirmed arrived.

Deliberately out of scope: Supabase Auth's own emails (§8.3.2's signup confirmation, password reset) are a separate GoTrue-owned delivery path, configured via SMTP settings on a hosted project rather than through this module. Revisit only if those need real delivery too.

### D-8 · N-3 closed — email-confirmation callback route built and walked end to end, 2026-08-25

**`SPEC.md` §8.3, §8.3.2.** `GET /auth/confirm` (`src/app/auth/confirm/route.ts`) exchanges the emailed link's `token_hash` for a session via `verifyOtp()`, then redirects to `next` (validated through `safeNextPath`, default `/dashboard`) or, on any failure, to `/sign-in?error=confirmation_failed` — which now renders a plain-language explanation instead of a silent bounce. Added to middleware's public paths, since its visitor is signed out by definition until the route itself creates a session. `supabase/templates/confirmation.html` + a new `[auth.email.template.confirmation]` block in `config.toml` override Supabase's default "Confirm signup" email to link here instead of its own hosted verify endpoint. Verified for real, not just typechecked: flipped `enable_confirmations = true` locally, signed up through the actual Auth API, pulled the real email out of Mailpit, followed its link, confirmed the session cookie landed and a limbo user reached `/onboarding` through ordinary middleware routing, exercised the invalid-token path too, then flipped the setting back off and deleted the test user — local dev's default (confirmations off) is unchanged.

### D-7 · N-9 closed — running-timer correction now reachable from the stale prompt, 2026-08-25

**`SPEC.md` §5.4, §5.4.1, §7.4.1.** `StaleTimerPrompt` (`src/components/time-entries/stale-timer-prompt.tsx`) now offers "Request a correction instead" alongside "Stop it now" / "It's still running", switching the dialog body in place to a new `CorrectRunningEndTimeForm` (`src/components/corrections/correct-running-end-time-form.tsx`). No backend work was needed — `approve_correction`'s running-entry exception (added while closing N-10) already handled this case correctly; the gap was purely the missing UI entry point. The new form is deliberately narrower than `AmendCorrectionForm`: it proposes only `proposedEndedAt`, since `running_entry_reattribution` refuses project/task/start-time changes on a running row and a wider form would collect input the server is guaranteed to reject. Filing the correction dismisses the prompt for the page load, same as "It's still running" — the timer keeps running until an admin approves it. Verified via the full gate (typecheck/lint/format/test/build, all green); live browser click-through was not possible this session (Chrome extension unavailable), so the flow has been read through carefully but not clicked through end to end — worth a real walkthrough next time the app is open in a connected browser.

### D-6 · N-8 closed — single-admin companies can now delete and create directly, 2026-08-25

**`SPEC.md` §7.4, §7.4.1.** `admin_delete_entry` and `admin_create_entry` (migration `0010_admin_direct_entry_paths.sql`) join `admin_edit_entry`, giving a lone admin all three correction kinds without needing a second admin to approve anything. Both share validation with `approve_correction`'s matching branches via two newly-extracted internal helpers (`apply_entry_create`/`apply_entry_delete`) rather than duplicating overlap/future-date/membership logic — after this migration there is exactly one implementation of each operation, called from two places (the direct-admin path and the correction-approval path). `admin_delete_entry` deliberately does not inherit N-10's orphaned-running-entry exception (new scope N-8 never asked for); `admin_create_entry` carries no today-only restriction, matching `approve_correction`'s own `create` kind. Verified end to end against a company asserted to have exactly one admin: queue path reproduced as a dead end first (self-approval refused), then both new direct paths succeeded with correct revision rows.

### D-5 · N-10 closed — orphaned running timer now closeable, 2026-08-25

**`SPEC.md` §2.3, §5.1, §7.4.1.** `admin_edit_entry` (migration `0009_orphaned_running_entries.sql`) now permits closing a running entry in exactly one case: its owner is currently inactive. An active employee's running timer remains completely untouchable by any admin, exactly as Phase 7 established — the fix adds a live owner-status check to the existing refusal rather than loosening it. The exception permits only `ended_at`/`note`; reattributing `project_id`/`task_id`/`started_at` on a still-running row stays refused even for a deactivated owner's entry — full editing is available immediately after closing, through the ordinary closed-entry path. Verified: the pre-fix repro reproduced the dead end live, then confirmed closed; every path that must still fail (active owner, non-admin, cross-tenant, the deactivated owner themself) does.

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

### N-4 · Repeated inline `profiles` + `companies` reads — closed in Phase 3

The dashboard queried `profiles`/`companies` directly in a Server Component (an explicitly allowed read-only exception, not a new server action). Phase 3's member list and admin-gating UI wanted the same "current member + company + role" read.

**Closed:** `getCurrentMember()` exists in `src/lib/actions/companies.ts` and is now the only path — `/dashboard`, `/members`, and `/invite/[token]` all call it, and no page queries `profiles` inline any more.

### N-1 · Node version below the declared engine floor

`package.json` requires `node >=24`; the local machine runs **v22.14.0**. Every `pnpm` invocation prints an unsupported-engine warning. The Dockerfile builds on 24, so production is unaffected, and the full gate passes on 22.

Worth resolving so the warning does not train everyone to ignore pnpm's output — but it blocks nothing today.

### N-2 · A green gate does not verify the security model

Not a defect, but the most important standing caveat in the project, and it is easy to forget: `pnpm test` runs on jsdom and **cannot see Postgres** (`SPEC.md` §12.1). No RLS policy, constraint, or transaction in this project is covered by the automated gate. Those are verified by hand against the §12.2 checklist.

Every phase from 1 onward ends at *gate green **plus** its named §12.2 manual checks*. A phase reported as done on the gate alone is not done. Revisit automated DB tests after Phase 5 (`SPEC.md` §10 item 4), when the RLS surface is largest.
