# Two dashboards — an employee's own, and the admin's team overview

> Reference document. Phase 10's plan as approved, kept as the record of why each widget is
> on the page and which ones are deliberately absent.
>
> **Three things were done differently, and `BLOCKERS.md` D-19 is the authority on all of
> them.** (1) `listRunningTimers()` is *not* role-gated — `listPendingCorrectionRequests`
> argues the opposite case for the identical situation, and RLS is the boundary either way.
> (2) `readCurrentMember` landed in `lib/auth/`, not `lib/supabase/`; `CLAUDE.md` scopes the
> latter to clients and session refresh. (3) The running-timer list is capped, which this
> plan did not anticipate: each row owns a 1 Hz interval. The code review also caught two
> real defects — a running count read from two sources, and a `progressbar` announcing `0%`
> against a target that does not exist — both recorded in D-19.

## Context

`/dashboard` today is a timer page. It carries one figure — §9.8's month-to-date worked vs
expected (`MonthProgressCard`) — and otherwise answers only "what am I doing right now" and
"what did I log recently". Everything that answers *how is this going* lives on `/reports`,
behind a range picker and a grouping selector you have to operate before it tells you
anything.

So nobody has a landing surface. An employee has no at-a-glance read on their own week; an
admin has none at all on their team — no page says who is on the clock, who is behind, or
where the team's hours went. `/reports` can answer each of those one query at a time, if you
know which grouping to pick.

Two rulings already in the contract are unbuilt and belong here:

- **`SPEC.md` §5.4** — "The admin dashboard lists stale timers as an exception queue."
  Ruled, never implemented: there is no admin dashboard to put it on.
- **`SPEC.md` has no dashboard section at all.** Every dashboard ruling is a sentence
  embedded in §5.4, §9.8.1 and §9.8.2. That is why this work *amends* the spec rather than
  slotting into it (`CLAUDE.md`: a conflict amends the document, it is not coded around).

**The whole feature is a read surface over aggregates that already exist.** All seven report
RPCs are in place (`0007`, `0013`, `0014`) and wrapped in `src/lib/actions/reports.ts` with
§9.2's scoping applied in one private `prepare()`. **No migration, no new SQL, no new
dependency.** Baseline before starting: `pnpm test` 37 files / 377 tests green, lint and
`format:check` clean.

## Decisions taken (confirmed with the user)

1. **`/dashboard` stays personal for both roles** — the timer keeps its first-class spot. A
   new **admin-only `/overview`** holds the team dashboard, guarded in
   `src/lib/supabase/middleware.ts`'s `ADMIN_ONLY_PATHS` *and* by a page-level
   `redirect("/dashboard")` — the double guard §4.2.2 requires, because middleware does not
   run on every rendering path.
2. **Charts are hand-rolled CSS/SVG. No new dependency.** The five `--chart-1` … `--chart-5`
   tokens in `globals.css` are defined and completely unspent; this is what they are for.
   `month-progress-card.tsx` already hand-rolls a `role="progressbar"`, so this is the
   established precedent. It also keeps the widgets server-rendered and assertable in jsdom,
   which has no layout and would render a recharts chart as nothing.
3. **"On the clock now" is a server-rendered snapshot with client-side ticking counters**,
   reusing `useElapsedSeconds`. No polling, no Realtime.

## Two rulings this plan makes, and their reasons

Both are new and both belong in `SPEC.md` §9.9 (§5 below).

- **No dashboard invents a target the database does not compute.** The bar charts show
  worked hours only. A per-day expected line is tempting and would be wrong: expected is a
  *range* quantity in `report_expected_by_user`, accruing from each assignment's `added_at`,
  and there is no per-day RPC. Reconstructing one in Node from
  `listMemberProjectSchedules` would ignore accrual and produce a second, disagreeing
  target beside §9.8's. Worked-vs-expected stays exactly where §9.8 put it — the month card
  and the attendance meters. Non-working days in the chart are *dimmed*, which is
  presentation, not a target.
- **A truncated list carries no total** (§12.2, `BLOCKERS.md` D-16). The team attendance
  widget shows the top N people and links to `/reports` for the rest, so it shows no sum.

## 1. Schema and types

**Nothing.** `time_entries_select_own_or_admin` (`0005`) is already company-wide for an
active admin, so every figure and every running row on `/overview` is readable under
existing RLS. `src/types/supabase.ts` is unchanged.

## 2. Actions — owner `implement-logic`

### 2a. `listRunningTimers()` — new, in `src/lib/actions/time-entries.ts`

The one thing no action can answer today: `getRunningTimer()` is own-row only.

```ts
export type TeamRunningTimer = {
  id: string;
  userId: string;
  userName: string | null;   // null is real — see below
  projectName: string | null;
  taskName: string | null;
  startedAt: string;         // the UTC instant; elapsed is computed at the edge (§5.3)
};

export async function listRunningTimers(): Promise<ActionResult<TeamRunningTimer[]>>;
```

- Query `time_entries` `.is("ended_at", null)`, ordered `started_at asc` (longest-running
  first, which is the reading order of an exception queue), embedding
  `profiles!time_entries_user_id_company_id_fkey (id, full_name)` plus `projects (id, name)`
  and `tasks (id, name)` — the embed pattern `listMyEntries` and `corrections.ts` already
  use. Every label stays `string | null` for the §2.3/§3.6.1 reason the other actions
  document at length.
- **Gate it on `role === "admin" && status === "active"`**, the same expression `prepare()`
  restates from `is_admin()`. Not because RLS would leak — it filters an employee to their
  own row — but so the action's contract is "the team's timers" rather than "whatever you
  can see", and an employee calling it gets a refusal instead of a one-row team.
- Error contract and the `NOT_CONFIGURED` / `NOT_SIGNED_IN` constants already in that file.
- Index note: `time_entries_one_running_per_user` is a partial unique index on `(user_id)
  where ended_at is null`, so the running set is tiny and a company filter on top of it is
  cheap. No new index.
- **No `initialNow` on the rows.** The page passes one `Date.now()` down for every row, as
  `dashboard/page.tsx` already does — one server clock per render, not one per row.

### 2b. One request-scoped read of the current member — recommended, contained

Every report action calls `prepare()`, which calls `getCurrentMember()`, which calls
`supabase.auth.getUser()` — a network round trip to Supabase Auth. `/overview` makes four
report calls plus the layout's own read, so it would do **six or more `getUser()` calls to
render one page**. That is the only real cost this feature adds.

The fix is not a second definition of "who is an admin" (§0.2 warns against exactly that) —
it is one memo of the existing one:

- New `src/lib/supabase/current-member.ts` (no `"use server"`, so it may export a non-async
  value) holding `CurrentMember` and `readCurrentMember = cache(async () => …)` — React's
  `cache`, request-scoped.
- `getCurrentMember()` in `src/lib/actions/companies.ts` becomes a one-line `"use server"`
  wrapper over it and re-exports the type, so every existing caller is untouched.
- `prepare()` in `reports.ts` imports `readCurrentMember` directly.

Per-request only: a server *action* invoked from the browser is its own request, so nothing
is cached across a mutation. If this is judged out of scope, the alternative is to cut
`/overview` to two report calls — say so and I will take that branch instead.

## 3. Pure helpers — tested, no React, no Supabase

Three of the five are genuinely missing today.

| Helper | Home | Why |
|---|---|---|
| `startOfWeek(day, weekStartsOn)` | `src/components/reports/report-days.ts` | `startOfMonth`/`endOfMonth` exist; a week start does not. Label arithmetic in UTC, like its neighbours — **not** timezone math. |
| `dayOfWeek(day): Weekday` | same | The bar chart needs a weekday letter from a `YYYY-MM-DD` label. Returns `working-days.ts`'s `Weekday` (0=Sun, `extract(dow)` numbering) so it feeds `weekdayShortName` with no offset arithmetic. |
| `fillDaySeries(rows, from, to)` | `src/components/charts/day-series.ts` | `report_by_day` returns only days that *have* entries. A chart missing its empty days draws a dishonest axis. **This is presentation, not aggregation** (§9.1) — it adds zeroes, it sums nothing; say so in the comment, the way `report-expected.ts` justifies its own merge. |
| `topNWithOther(rows, n)` | `src/components/charts/top-n.ts` | Collapses the tail of an already-aggregated breakdown into one "Other" row. Sums buckets Postgres produced, never entries. |
| `byShortfall(rows)` | `src/components/dashboard/attendance-rows.ts` | Orders attendance worst-first. Deliberately **not** SQL's `total_seconds desc` order, which `report-expected.ts` keeps for the report table — a shortfall list is read worst-first. Note the divergence in both files. |

Reuse rather than re-derive:

- `differenceSeconds()` (`report-expected.ts`) — the one place the worked-minus-expected
  sign convention lives.
- `formatSecondsHms()` (`lib/reports/csv.ts`) — the one duration formatter.
- `UNKNOWN_PERSON` / `UNKNOWN_PROJECT` / `NO_CLIENT_CELL` (`report-rows.ts`) — the one set
  of words for a label RLS hid.
- `isStale()` / `formatApproxHours()` / `elapsedSeconds()` (`time-entries/elapsed.ts`) —
  §5.4 is already answered here; the dashboards must not re-derive "stale".
- **`reportHref(query, overrides)`** with `resolveReportQuery({}, { from, to })`
  (`report-params.ts`) — every "see all in Reports" link is built with these, never with a
  hand-assembled query string, so a seventh report parameter cannot silently go missing
  from a dashboard link.
- **`/members`' existing `MemberSchedulesDialog`** — the attendance widget's "no expected
  hours set" state links there. It does not reimplement a schedule editor.
- `weeklySecondsOf()` (`project-members/format-schedule.ts`) is deliberately **not** reused:
  its own comment warns it is the flat weekly rate, not the report figure, which is exactly
  the second-disagreeing-target trap §2 above rules out.

## 4. Chart primitives — owner `build-ui`, new dir `src/components/charts/`

Feature layer, not `src/components/ui/**` (shadcn-managed, never hand-written). Each is a
**server component** that takes integer seconds and formats them; none fetches anything.

**Accessibility is not optional here: a chart with no readable equivalent is not
acceptable.** Every primitive below is a semantic list or meter whose exact figures are in
the accessible name — which is also what makes it testable in jsdom, where nothing has a
size.

```ts
// day-bar-chart.tsx — the 14-day column chart
export type DayBar = {
  day: string;          // YYYY-MM-DD, a company-local label
  seconds: number;
  offDay?: boolean;     // dimmed: outside the working days — presentation, not a target
  isToday?: boolean;    // outlined rather than filled
};
export function DayBarChart(props: {
  bars: DayBar[];
  /** Tallest bar's value; the caller decides so two charts can share a scale. */
  maxSeconds: number;
  emptyLabel: string;
}): React.ReactElement;
```
`<ul role="list">` of `<li>`s, each `aria-label={`${formatDayLabel(day)}: ${formatSecondsHms(seconds)}`}`,
with the bar as a `bg-chart-1` div at `height: {seconds/maxSeconds*100}%` and the weekday
letter beneath. Test: `getByRole("listitem", { name: /8 Sep 2026: 7:30:00/ })`, plus that a
zero day still renders a listitem and that `offDay` and `isToday` are reflected in the
accessible name, not only in a class.

```ts
// proportion-bar-list.tsx — "where the time went"
export type ProportionRow = {
  key: string;
  label: React.ReactNode;
  muted?: boolean;      // a placeholder for a label this caller cannot read
  seconds: number;
};
export function ProportionBarList(props: {
  rows: ProportionRow[];
  /** Longest row, for the bar scale. Not a sum — this list shows no total. */
  maxSeconds: number;
}): React.ReactElement;
```
Colours cycle `bg-chart-1` → `bg-chart-5`; the `Other` row gets `bg-muted-foreground/30`, so
it never reads as a project. Renders as a `<dl>` so the duration is programmatically tied to
its label, the way `DataCard` does.

```ts
// progress-meter.tsx — worked against a target
export function ProgressMeter(props: {
  valueSeconds: number;
  /** null = no target set. Renders the bar track empty and says so; never 100%. */
  targetSeconds: number | null;
  ariaLabel: string;
  className?: string;
}): React.ReactElement;
```
This is `MonthProgressCard`'s existing bar, extracted verbatim including its two guards (a
zero target reads full rather than dividing by zero; the fill is clamped to 100 so an
overshoot cannot paint outside the track). **`MonthProgressCard` is then refactored onto it**
— reuse, not a second implementation — and its existing test must stay green untouched.

```ts
// src/components/structure/stat-tile.tsx — the label / figure / caption tile
export function StatTileGrid(props: { children: React.ReactNode; columns: 3 | 4 }): …;
export function StatTile(props: {
  label: string;
  figure: React.ReactNode;
  caption?: React.ReactNode;
  /** Amber, for a running-timer count and nothing else (`CLAUDE.md`). */
  live?: boolean;
}): React.ReactElement;
```
Lives in `structure/` beside `DataCard` because it is a shared composition, not a chart.
`FIGURE_CLASS` is currently **duplicated verbatim** between `report-summary.tsx` and
`month-progress-card.tsx`; this is where it goes, and `ReportSummaryHeader` adopts it too,
so the extraction removes a duplication instead of adding a layer. Its test asserts the
tests already in `report-summary.test.tsx` still pass unchanged.

## 5. The employee dashboard — `src/app/(app)/dashboard/page.tsx`

**Two new report calls, total.** `getCurrentMember()` is already awaited first (the page
needs the timezone and the caller's id before it can build a range), then everything else
goes in the existing single `Promise.all`.

New range, resolved in the page beside the existing month range:
`chartFrom = addDays(today, -13)`.

| Widget | Position | Fed by | Why it earns its place |
|---|---|---|---|
| **Stat tiles** — Today · This week · This month · Awaiting review | top, above the month card | Today and This week are **summed from the 14-day `getReportByDay` series** (a week is ≤ 7 days, so both windows sit inside it); This month is `getReportSummary`'s existing figure; Awaiting review is the pending count from the `listMyCorrectionRequests` call the page **already makes** | Three horizons answer "am I on track *now*" which the month figure alone cannot. Zero extra calls for three of the four. §9.8.1 requires the month figure to come from `report_summary`, so it stays the card's — there is exactly one month number on the page. |
| **This month** (`MonthProgressCard`) | unchanged, above the timer | unchanged | §9.8. Both its load-bearing captions stay. |
| **Last 14 days** (`DayBarChart`) | under the month card | **new**: `getReportByDay({ from: chartFrom, to: today, userId: member.id })` | The consistency question no total answers: five 8-hour days and one 40-hour Friday give the same month figure. Non-working days dimmed from the union of `working_days` across `listMemberProjectSchedules` — which the page does *not* currently fetch, so this is one more call, or the dimming is dropped. **Recommend fetching it**: an undimmed weekend reads as a gap. |
| **Where your time went** (`ProportionBarList`) | under the chart | **new**: `getReportByProject({ monthStart → today, userId: member.id })` → `topNWithOther(rows, 6)` | "What did I actually spend the month on" is the second question everyone asks, and `/reports` needs three controls set to answer it. |
| Timer slot, manual-entry row, recent entries | unchanged | unchanged | The timer is what the product is for; nothing moves above it except the month card that is already there. |

Ruled out: a pie/donut (a horizontal bar list is more legible at phone width and needs no
label-collision logic); a by-task breakdown (§3.5.2's mandatory "General" task makes it
noisy for most companies); anything comparing the employee to a colleague (`BLOCKERS.md`
D-2 — an employee sees only their own time).

## 6. The admin overview — `src/app/(app)/overview/page.tsx` (new)

Guarded twice: `"/overview"` added to `ADMIN_ONLY_PATHS` in
`src/lib/supabase/middleware.ts`, and `if (!isAdmin) redirect("/dashboard")` in the page,
copying `members/page.tsx` including its comment about why the redirect is not what protects
anything.

| Widget | Fed by | Why |
|---|---|---|
| **Team pulse** (`StatTileGrid`, 4 tiles) — Hours this month · Logged today · On the clock now · Awaiting review | `getReportSummary({ monthStart → today })` (team-wide, `expectedSeconds` is null by §9.8.1 and is not shown); "Logged today" from the by-day series; the running count from `listRunningTimers()`; the review count from `listPendingCorrectionRequests()` | The four numbers an admin opens the app for. The running count is the one place `--live` amber appears, and only when it is non-zero — `ReportSummaryHeader` already sets that precedent. |
| **On the clock now**, stale ones first | `listRunningTimers()` + `initialNow` | The only genuinely live thing in the product, and unanswerable today. |
| **§5.4 stale-timer exception queue** | the *same* rows, `isStale(elapsed, member.company.maxTimerHours)` | The unbuilt §5.4 ruling. **One data source, two readings, one client component** (`team-running-timers.tsx`): staleness depends on the ticking clock, so splitting it across a server and a client component would let the two disagree at the boundary second. `ring-destructive/40`, matching `RunningTimerCard`'s own escalation. **No stop button** — `BLOCKERS.md` D-5 lets an admin close a running entry only when its owner is *inactive*; an active employee's timer is untouchable, so the card says what to do (ask them, or `/corrections`) instead of offering a control the database will refuse. |
| **Attendance, month to date** (`ProgressMeter` per person, worst first) | `getReportByUser({ monthStart → today })` — **already union-merged with expected by `mergeExpectedByUser`**, so somebody who logged nothing still appears (§9.8.3) | The admin half of §9.8, and the widget with the highest information density on the page. Top 8 via `byShortfall`, then a link to `/reports?grouping=user&from=…&to=…` for the rest. **No total on the list** (§12.2, D-16). Carries §9.8.2's two disclosures — today counted whole, running timers excluded — because it pairs worked with expected. |
| **Team hours, last 14 days** (`DayBarChart`) | `getReportByDay({ chartFrom → today })` | Same primitive as the employee chart; also supplies the "Logged today" tile. Weekends dimmed from `dayOfWeek` — a team has no single working-days set, so this one dims Sat/Sun by `weekStartsOn` convention only and says so. |
| **Where the team's hours went** (`ProportionBarList`) | `getReportByProject({ monthStart → today })` → `topNWithOther(rows, 6)`, each row labelled `project · client` | By project rather than by client: a client total is a rollup of projects an admin then has to drill into anyway, and `ReportProjectRow` already carries the client label. |

Ruled out: a separate "nobody logged today" list (the attendance union already surfaces
zero-worked people, and a second list of the same people is noise); a headcount denominator
from `listMembers()` (one more call for a number the attendance list already implies);
per-client revenue or utilisation of any kind (`SPEC.md` §1 — billing and rates do not exist
and are not a later column).

## 7. Navigation

- `src/components/layout/nav.ts` — one entry, after `/dashboard`:
  `{ href: "/overview", label: "Overview", icon: LayoutDashboardIcon, primary: false, adminOnly: true }`.
  **`primary: false` is forced**: `MobileTabBar` has four slots, an admin already fills all
  four, and `nav.test.ts` asserts `primary` length is exactly 4. It lands in the phone's
  "More" overflow, which grows from two entries to three — an employee's stays empty, so
  `mobile-tab-bar.test.tsx` is unaffected.
- `src/components/layout/desktop-nav.tsx` — comment says "an admin's six links"; now seven.
  Check the row still fits the `max-w-5xl` header at `md` (the tightest case: seven labels
  plus the logo, theme toggle and sign-out).
- `nav.test.ts` — extend the employee-destinations assertion (unchanged list) and add
  `/overview` to the admin expectations.

## 8. Docs — the amendments this feature owes

`CLAUDE.md`: a conflict with `SPEC.md`/`PLAN.md` amends that document.

- **`SPEC.md` — new §9.9 "Dashboards"**, after §9.8.3: the two surfaces and who reaches
  each; that every figure comes from a §9.3/§9.8 aggregate and **no dashboard aggregates raw
  entries** (a day or project bucket may be summed only as §12.2's "sum of its own visible
  line items", which is what `totalsOf` already does); that a truncated list carries no
  total; that **no dashboard invents a per-day expected target** (§2 above); that both
  §9.8.2 disclosures apply wherever worked meets expected; and that charts are hand-rolled
  against the `--chart-*` tokens with an accessible reading, not a charting dependency.
- **`SPEC.md` §4.2.2** — add `/overview`, and record that it is **the first entry on that
  list whose contents really are confidential**. The existing three hide a surface without
  hiding data (`clients`, `profiles` and `projects` SELECT all stay readable, and §4.2.2
  says so at length). `/overview` is different: `time_entries_select_own_or_admin` scopes an
  employee to their own rows, so the team's hours and running timers are *not* reachable by
  an employee who types the URL — the redirect is a convenience over a boundary that
  already holds, rather than the whole of it. That strengthens §4.2.2's argument instead of
  repeating its caveat, and it is worth writing down because it changes what the manual
  tenancy check is testing.
- **`SPEC.md` §5.4** — name `/overview` as the home of the exception queue, and record that
  the queue is informational because of D-5.
- **`SPEC.md` §12.2** — a new **Dashboards** block of checkboxes (the manual list in §10
  below), plus one line added to the existing **Tenancy** block for `/overview`. The
  checklist is what `PLAN.md` treats as the other half of "done", so the checks have to
  live there and not only in this document.
- **`SPEC.md` §12.3** — the installed/needed primitive lists are already stale (every
  "needed" primitive has since been installed); note that the charts add no primitive and
  no dependency, which is the standing answer to the next person who reaches for one.
- **`PLAN.md` — Phase 10 "Dashboards"**, depending on Phases 8–9, with the work items,
  exit criteria and manual checks below. Phase 9 is currently the last phase.
- **`BLOCKERS.md` — D-19**, recording the four decisions: separate admin route; hand-rolled
  charts with no new dependency; snapshot-plus-ticking-counters; and no per-day expected
  target. Plus whichever way §2b (the member-read memo) is answered.
- **`README.md`** — a `/overview` row in the route table (marked admin), and the features
  line.
- Two stale comments to correct while nearby: `src/components/time-entries/elapsed.ts` says
  `getCurrentMember()` returns `{ id, name, timezone }` for the company and calls
  `max_timer_hours` "a gap" — it has returned `maxTimerHours` since Phase 9; and
  `desktop-nav.tsx`'s link count.

## 9. Order of work

No migration, so the usual chain starts one step in: **actions → helpers → UI → docs.**

1. `implement-logic` — `listRunningTimers()`; the §2b member-read memo if approved.
2. `implement-logic` / `build-ui` — the five pure helpers in §3, each with its colocated
   `*.test.ts`, landed before anything renders them.
3. `build-ui` — the four primitives in §4, including refactoring `MonthProgressCard` onto
   `ProgressMeter` and `ReportSummaryHeader` onto `StatTile` with both existing test files
   left untouched and green.
4. `build-ui` — `/overview` (page + `team-running-timers.tsx` + attendance list), then the
   `/dashboard` additions, then nav and middleware.
5. Docs (§8).
6. `code-reviewer` read-only pass, then `test-runner` on the full gate.

## 9a. Every file, at a glance

**New**

| File | Purpose |
|---|---|
| `src/app/(app)/overview/page.tsx` | The admin team dashboard; double-guarded, fetches and composes |
| `src/components/charts/day-bar-chart.tsx` (+ test) | The 14-day column chart, both dashboards |
| `src/components/charts/proportion-bar-list.tsx` (+ test) | "Where the time went" horizontal bars |
| `src/components/charts/progress-meter.tsx` (+ test) | Worked against a target; the extracted `MonthProgressCard` bar |
| `src/components/charts/day-series.ts` (+ test) | `fillDaySeries` — zero-fills a sparse `report_by_day` result |
| `src/components/charts/top-n.ts` (+ test) | `topNWithOther` — collapses a breakdown's tail |
| `src/components/structure/stat-tile.tsx` (+ test) | The label / figure / caption tile, shared with `/reports` |
| `src/components/dashboard/team-running-timers.tsx` | Client: on-the-clock list + §5.4 stale section, ticking |
| `src/components/dashboard/team-attendance-list.tsx` | Worked-vs-expected meters per person, worst first |
| `src/components/dashboard/attendance-rows.ts` (+ test) | `byShortfall` ordering |
| `src/lib/supabase/current-member.ts` | §2b's `cache()`d member read (if approved) |

**Modified**

| File | Change |
|---|---|
| `src/lib/actions/time-entries.ts` | `listRunningTimers()` + `TeamRunningTimer` |
| `src/lib/actions/companies.ts` | `getCurrentMember` becomes a wrapper over §2b (if approved) |
| `src/lib/actions/reports.ts` | `prepare()` reads the cached member (if approved) |
| `src/app/(app)/dashboard/page.tsx` | Two new fetches; stat tiles, day chart, breakdown |
| `src/components/dashboard/month-progress-card.tsx` | Refactored onto `ProgressMeter`; test untouched |
| `src/components/reports/report-summary.tsx` | Adopts `StatTile`; test untouched |
| `src/components/reports/report-days.ts` (+ test) | `startOfWeek`, `dayOfWeek` |
| `src/components/layout/nav.ts` (+ test) | The `/overview` entry |
| `src/components/layout/desktop-nav.tsx` | Stale link-count comment |
| `src/lib/supabase/middleware.ts` | `/overview` in `ADMIN_ONLY_PATHS` |
| `src/components/time-entries/elapsed.ts` | Stale `getCurrentMember` comment |
| `SPEC.md`, `PLAN.md`, `BLOCKERS.md`, `README.md` | §8 above |

## 10. Verification

### Automated

```
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm build
```

New colocated tests (vitest + jsdom; **`src/lib/actions/**` has no test harness** —
`BLOCKERS.md` D-12/N-2 — so `listRunningTimers` is covered by the manual checks only):

- `report-days.test.ts` — `startOfWeek` for both `weekStartsOn` values, across a month and a
  year boundary; `dayOfWeek` against known dates.
- `day-series.test.ts` — a sparse `report_by_day` result gains a zero row for every missing
  day, the endpoints are inclusive, and a day outside the range is not invented.
- `top-n.test.ts` — a 9-row breakdown becomes 6 + Other; Other's seconds equal the tail's
  sum exactly; ≤ 6 rows produce no Other row at all.
- `attendance-rows.test.ts` — worst shortfall first; a zero-worked person with a real
  expected sorts above a person who is merely slightly behind; ties break stably by name.
- `day-bar-chart.test.tsx` — every day in the range renders a listitem including zero days;
  the accessible name carries the exact `H:MM:SS`; `offDay` and `isToday` are readable, not
  only styled.
- `proportion-bar-list.test.tsx` — a muted label renders as its placeholder word, never
  blank or "null"; **no total is rendered**.
- `progress-meter.test.tsx` — `aria-valuenow` clamps at 100 on an overshoot; a null target
  renders no percentage claim; a zero target does not divide by zero.
- `stat-tile.test.tsx` — `live` styling appears only when asked for.
- `nav.test.ts` — admin gets `/overview`, employee does not, `primary` count is still 4.

### Manual, against a real Supabase project (`pnpm dev`), two accounts

These are the §12.2-style checks; an unrun one means the phase is unfinished (`PLAN.md`).

1. **Tenancy** — an employee visiting `/overview` by URL is redirected to `/dashboard`, and
   `/overview` is absent from both their header row and their phone "More" menu.
2. **The two-paths check (§12.2)** — the employee dashboard's "This month" figure equals
   `/reports`' summary total for `monthStart → today` with the person filter set to
   themselves; and the 14-day series summed over that month's portion agrees with it.
3. **Running entries count zero (§9.4)** — start a timer; every figure on both dashboards
   holds still, the running count goes up, and the attendance card says the running timer is
   not counted.
4. **Today counted whole (§9.8)** — read the attendance card mid-morning: the shortfall is
   explained by its caption rather than looking like an alarm.
5. **The union case (§9.8.3)** — a third employee with a schedule and no entries at all
   appears in the attendance widget with `0:00:00` worked and a non-zero expected. The
   easiest thing here to get wrong.
6. **On the clock** — two employees running timers appear with counters that tick; stopping
   one removes it on the next load; the list is empty-stated, not blank, when nobody is
   running.
7. **§5.4** — set `max_timer_hours` low (or leave a timer overnight): the entry moves into
   the stale section with the escalated ring, and the card offers no stop button for an
   *active* employee's timer (D-5).
8. **No total on a truncated list** — with nine or more people, the attendance widget shows
   eight and a link, and carries no sum.
9. **Labels RLS hid** — remove an employee from a project they logged against: the
   breakdown reads "Unknown project", muted, never blank and never "null".
10. **Timezone (§6.1)** — on a company set to `America/Havana` (the zone `0007` names for
    its DST-at-midnight cushion), the 14-day chart's last bar is the company's today and no
    month boundary shifts by a day.
11. **Responsive** — both pages at phone width: charts legible, no horizontal scroll except
    where a table is deliberately allowed to, and nothing hidden under the tab bar.
12. **Both themes** — light and dark: the five `--chart-*` tokens stay distinguishable, and
    amber appears only on a running count.
