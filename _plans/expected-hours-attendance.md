# Expected hours — per-assignment schedules, attendance in Reports and on the Dashboard

## Context

Timey records what people *did*. It has no idea what they were *supposed* to do, so
there is no way to answer "is this employee keeping up?". Every total in the app is
an absolute number of seconds with nothing to compare it against.

This adds the missing half. An admin declares, for each employee **on each project**,
how many hours a day they work and which days of the week they work them — so the same
person can be 4h/day Mon–Fri on one project and 3h/day Mon/Tue/Thu/Fri on another.
Those per-project schedules sum into one expected figure per person, which is then
shown next to the actual figure in two places:

- **Employee dashboard** — worked vs expected, month-to-date: `16:15:40 of 20:00:00`.
- **Reports** — an Expected column beside Worked, so an admin can read the whole team's
  attendance for any range.

This is greenfield. Nothing resembling expected hours, working days, capacity or
targets exists in the schema, the types, `SPEC.md` or the UI today.

### Decisions taken (confirmed with the user)

1. **Today counts in full.** Expected covers every working day from the range start
   through today inclusive. A 4h/day Mon–Fri employee is expected to have done
   `20:00:00` by Friday, whatever time Friday it is.
2. **Expected accrues from the assignment date.** Days before the employee's
   `project_members.added_at` (read as a company-local date) contribute nothing, so
   backfilling an assignment does not retroactively invent a shortfall.
3. **Two admin surfaces**, one row of data: the project detail page and the Team page.
4. **Reports shows expected in all four places**: summary header, By person, By person
   + project, and the CSV export.

### One consequence to confirm at approval

The schedule columns go on `public.project_members`, whose SELECT policy
(`project_members_select_own_company`, `0004_structure.sql`) is **company-wide** — so
every employee would be able to read every colleague's hours/day. That is consistent
with `project_members` already disclosing the whole assignment graph to everyone, but
it is a new disclosure of something closer to contract data.

The alternative, if that is not wanted: a separate `project_member_schedules` table
(1:1 with the membership) carrying a `select` policy of *own rows or admin*, mirroring
`time_entries_select_own_or_admin`. Same columns, same functions, one extra table and
one extra join. **Say so at approval and I will take that branch instead** — it is much
cheaper to decide now than to migrate later.

---

## 1. Migration — `supabase/migrations/0014_member_schedules.sql`

Owner: `write-migrations`. Lands alone, before any TypeScript touches it (`SPEC.md` §0.2).

> **Check first:** the commit for `0013_report_entries.sql` records that it was never
> applied, and `src/types/supabase.ts` was hand-written to match. Confirm 0013 is
> actually applied before adding 0014 on top of it.

Two columns on `public.project_members`:

```sql
alter table public.project_members
  add column expected_daily_seconds integer  not null default 0,
  add column working_days           smallint[] not null default '{1,2,3,4,5}';
```

- **Integer seconds, never float hours** — `SPEC.md` §9.5. The admin types `4` or `3.5`
  and the action stores `14400` / `12600`. A `numeric` hours column would drift against
  the `sum(duration_seconds)` it is compared to.
- `check (expected_daily_seconds between 0 and 86400)`. Zero means *no target*, which
  is what an assignment created before this feature has.
- `working_days` uses Postgres `extract(dow)` numbering — **0 = Sunday … 6 = Saturday** —
  so the comparison is a direct `= any(working_days)` with no offset arithmetic. It also
  matches `companies.week_starts_on`'s existing 0=Sun/1=Mon convention.
- Validity is split the way `0004` splits it elsewhere: a CHECK for the range
  (`working_days <@ array[0,1,2,3,4,5,6]::smallint[]`), and a
  `project_members_20_normalize_working_days()` BEFORE INSERT/UPDATE trigger that sorts
  and de-duplicates. A CHECK cannot express "distinct" without a subquery, and the
  codebase's stated preference (`0004_structure.sql`, the `company_id` derivation note)
  is to make the bad value unrepresentable rather than to validate it. An empty array is
  legal and means "no working days on this project".

Extend the existing column GRANTs — nothing else about the table's security changes,
because `project_members_insert_admin` / `_update_admin` already gate both verbs to
active admins of the company:

```sql
grant insert (project_id, user_id, expected_daily_seconds, working_days)
  on public.project_members to authenticated;
grant update (project_id, user_id, expected_daily_seconds, working_days)
  on public.project_members to authenticated;
```

### Two expected-hours functions

Both `security invoker`, `set search_path = pg_catalog, public`,
`revoke execute … from public; grant execute … to authenticated;` — the house style of
`0007_reports.sql` and `0013_report_entries.sql`. `security invoker` matters: RLS on
`project_members` and `profiles` stays the only scope in play, exactly as the seven
existing report functions rely on.

```sql
public.report_expected_by_user(p_from date, p_to date,
                               p_user_id uuid, p_client_id uuid, p_project_id uuid)
  returns table (user_id uuid, user_name text, expected_seconds bigint)

public.report_expected_by_user_project(p_from date, p_to date,
                               p_user_id uuid, p_client_id uuid, p_project_id uuid)
  returns table (user_id uuid, user_name text,
                 project_id uuid, project_name text, expected_seconds bigint)
```

The core expression, per membership row:

```sql
pm.expected_daily_seconds::bigint * (
  select count(*)
  from generate_series(
         greatest(p_from, (pm.added_at at time zone c.timezone)::date),
         p_to,
         interval '1 day'
       ) as d
  where extract(dow from d)::smallint = any(pm.working_days)
)
```

- `(pm.added_at at time zone c.timezone)::date` is the **same** company-local bucketing
  expression every report function uses for `started_at`. `PLAN.md:404` names UTC
  bucketing as the single most likely defect in this area; do not use `date_trunc`.
- `greatest(…)` past `p_to` yields an empty series and therefore zero — the mid-month
  assignment case falls out of the arithmetic with no special branch.
- Summed with `sum(...)` grouped by `user_id` (or `user_id, project_id`), so a person on
  three projects gets one combined figure.

**No `p_task_id` parameter, deliberately.** Schedules are per project; an expected
figure filtered to one task would be a number with no meaning. The UI suppresses
Expected whenever a task filter is active (§4 below).

`user_name` / `project_name` are joined in and returned so the report can show a row for
someone who was **expected to work and logged nothing** — see §4.

---

## 2. Types

Regenerate `src/types/supabase.ts`: the two new `project_members` columns across
Row/Insert/Update, and the two new function signatures. Match the existing generated
shape exactly; this file is genuinely in sync with the migrations today and should stay
that way.

---

## 3. Validation and actions

Owner: `implement-logic`. Result shape is the existing
`ActionResult<T> = { ok: true; data: T } | { ok: false; error: string }`.

### `src/lib/validations/project-members.ts`

```ts
export const workingDaysSchema = z.array(z.number().int().min(0).max(6)) // 0=Sun..6=Sat
export const projectMemberScheduleSchema = z.object({
  expectedDailyHours: /* 0..24, one decimal */,   // transforms → expectedDailySeconds
  workingDays: workingDaysSchema,
})
```

Follow `src/lib/validations/members.ts` for message tone and the three-generic
`useForm<Input, unknown, Values>` transform pattern the repo's forms rely on
(schemas here transform: hours → integer seconds, `""` → `undefined`).

### `src/lib/actions/project-members.ts`

- `updateProjectMemberSchedule(projectId, userId, input)` — new. Copy the shape used by
  `updateMemberRole` in `src/lib/actions/companies.ts` verbatim, **including the
  zero-rows branch**: an RLS `USING` failure filters rather than raises, so PostgREST
  returns success with an empty set and it must be surfaced as not-found rather than a
  silent no-op. Ends with `revalidatePath("/", "layout")`.
- `addProjectMember(projectId, userId, schedule?)` — accept an optional schedule so a
  member can be assigned and scheduled in one submit. `company_id` and `added_at` stay
  out of the payload; they are derived and non-grantable.
- `listProjectMembers(projectId)` — return `expectedDailySeconds` and `workingDays`.
- `listMemberProjectSchedules(userId)` — new, for the Team page: that member's
  memberships with project name and schedule, ordered by project name.

### `src/lib/actions/reports.ts`

- `getReportExpectedByUser(filters)` / `getReportExpectedByUserProject(filters)` — thin
  wrappers over the RPCs, reusing the existing `prepare()` so §9.2's employee scoping
  (`const userId = isAdmin ? parsed.data.userId : member.data.id`) lives in exactly one
  place and applies here unchanged.
- `getReportSummary` gains `expectedSeconds: number | null` on `ReportSummary`. `null`
  when the report does not resolve to a single person, or when a task filter is active.
- **Merging is a left-join in Node, not a total in Node.** The expected figure is
  computed in Postgres (`SPEC.md` §9.1); zipping two result sets on `user_id` is not
  arithmetic over entries. Put the merge in a pure exported function in
  `src/components/reports/report-rows.ts` (already a pure, well-tested module) so it is
  unit-testable without a database.
- **The merge must be a union, not an inner join.** `report_by_user` only returns people
  who logged something in the range. Someone expected to work 20:00:00 who logged
  nothing is precisely the row an attendance view exists to show, so expected-only rows
  are appended with `totalSeconds: 0` — that is why the SQL returns `user_name`.

---

## 4. Reports UI

Owner: `build-ui`. Durations render through the single existing formatter,
**`formatSecondsHms(seconds)` at `src/lib/reports/csv.ts:163`** — the only place a report
duration stops being an integer. Everything stays `font-mono tabular-nums`.

- **`src/components/reports/report-summary.tsx`** — a fourth figure, `Expected`, shown
  when the report resolves to one person (always for an employee; for an admin when the
  person filter is set). The team-wide case is served by the By person column instead.
- **`src/components/reports/report-rows.ts`** — `ReportUserRow` and
  `ReportUserProjectRow` gain `expectedSeconds: number | null` and a derived
  `differenceSeconds`. Column order here must keep matching the CSV column table; there
  is a test asserting exactly that.
- **`src/components/reports/report-data-table.tsx`** — Expected and Difference columns.
  Difference sorts numerically, not as text (existing test convention). Sign is carried
  by colour + an explicit `+`/`−`: ledger green for at-or-above, `--live` amber is
  **not** used — that token marks a running timer and nothing else (`CLAUDE.md`).
- **`src/lib/reports/columns.ts`** — `Expected` and `Difference` in the by-user and
  by-user-project CSV tables. The file's own comment warns that the exhaustive switches
  in `csvForReport` and `describeReport` must be updated together.
- **Task filter** — when `taskId` is set, Expected/Difference are omitted (not shown as
  zero, which would read as "expected nothing"), with the same kind of explanatory
  caption `report-entries-table.tsx` already uses to explain why it carries no total.

Below `md` these views are `DataCard`s, so the two new figures need a place in the card
body as well as the table — see `src/components/structure/data-card.tsx`.

---

## 5. Employee dashboard

`src/app/(app)/dashboard/page.tsx` gains a **This month** card above the running-timer
card, added to the existing single `Promise.all`.

- Range: `startOfMonth(companyToday(timezone, Date.now()))` → `companyToday(...)`.
  Both helpers already exist in `src/components/reports/report-days.ts`; reuse them
  rather than doing date math in the page.
- Worked comes from `getReportSummary(range)` — the file calls `report_summary` "the
  sanctioned source of range totals", and using anything else here would create a second
  number that could disagree with `/reports`.
- Renders `16:15:40 of 20:00:00`, plus the shortfall/surplus and a thin progress bar.
- **Two captions that are not optional:**
  - Expected counts today in full — so a mid-morning shortfall explains itself instead
    of looking like a warning.
  - `report_summary` excludes running entries from every sum (§9.4). If
    `runningCount > 0` the card must say the figure does not include the timer that is
    running right now, or an employee will watch their number sit still all afternoon.
- New component `src/components/dashboard/month-progress-card.tsx` — presentational,
  takes seconds in and formats; the page does the fetching.

> This is a deliberate reversal of two existing comments — `entry-list.tsx` ("this table
> deliberately computes no total at all") and `listMyEntries` ("Not a report… there is no
> date range and no aggregation on purpose"). Both stand: the entry list still totals
> nothing, and `listMyEntries` still aggregates nothing. The new card is a *report*
> reading `report_summary`, which is the sanctioned path. Update the wording of both
> comments so the next reader isn't misled.

---

## 6. Admin UI — both surfaces, one row

### `src/app/(app)/projects/[id]/page.tsx` + `src/components/project-members/`

Each assigned member row gains `4h/day · M T W T F` and an Edit control opening a
`Dialog` with an hours field and a seven-checkbox day picker.
`add-project-member-form.tsx` gains the same two fields so assignment and scheduling are
one submit.

### `src/app/(app)/members/page.tsx` + `src/components/members/`

A row action on `member-list.tsx`'s existing `DropdownMenu` — "Schedule" — opens a dialog
listing that member's projects with a schedule row each, plus a computed weekly total
(`Σ hours × working days`). Same action, same validation; only the entry point differs.

Both use the repo's one form pattern: react-hook-form + `zodResolver`, shadcn
`Field / FieldLabel / FieldError / FieldDescription`, `sonner` `toast.error(result.error)`
on failure, `router.refresh()` on success. No `useActionState` anywhere in this codebase.

### One small plumbing job worth doing here

`companies.week_starts_on` is written at onboarding and **never read** — it is not even
selected by `getCurrentMember`. The day picker is the first thing in the app that has a
reason to care. Add `week_starts_on` to `getCurrentMember`'s select and to
`CurrentMember.company`, and order the seven checkboxes from it, so a Sunday-start
company sees `S M T W T F S` and a Monday-start one sees `M T W T F S S`. The stored
values stay 0–6 dow regardless; only the display order changes.

---

## 7. Docs

`CLAUDE.md`: "A conflict with `SPEC.md` amends that document — it is not coded around."

- **`SPEC.md`** — a new section defining expected hours: the per-assignment schedule, the
  dow convention, today-counts-in-full, accrual from `added_at`, integer seconds, and the
  fact that expected is undefined under a task filter. §9 gains the two new report
  functions. Note in §6 that expected days are bucketed with the same company-local
  expression as entries.
- **`PLAN.md`** — a phase entry ordering migration → types → actions → UI.
- **`BLOCKERS.md`** — record the four decisions above, and whichever way the
  company-wide-visibility question in the Context section is answered.

---

## 8. Order of work

Strictly `migrations → types → actions → UI` (`CLAUDE.md`), never a migration in the same
pass as the code that queries through it:

1. `write-migrations` → `0014_member_schedules.sql`, alone.
2. Regenerate `src/types/supabase.ts`.
3. `implement-logic` → validations, `project-members.ts` actions, `reports.ts` actions,
   `week_starts_on` on `getCurrentMember`.
4. `build-ui` → schedule dialogs, the two admin surfaces, report columns, dashboard card.
5. `code-reviewer` read-only pass, then `test-runner` on the full gate.

---

## 9. Verification

**Tests** (colocated `*.test.ts(x)`, vitest + jsdom — there are no `__tests__` dirs):

- `src/lib/validations/project-members.test.ts` — hours → integer seconds (4 → 14400,
  3.5 → 12600), rejects >24h and out-of-range dow, accepts an empty working-days array.
- `src/components/reports/report-rows.test.ts` — the merge is a **union**: an
  expected-only person appears with `totalSeconds: 0`; a worked-only person appears with
  `expectedSeconds: 0`; difference sign is right in both directions; column order still
  matches the CSV table.
- `src/lib/reports/columns.test.ts` — Expected/Difference in the by-user CSVs; blank, not
  `0:00:00`, when a task filter suppressed them.
- `src/components/dashboard/month-progress-card.test.tsx` — renders `16:15:40 of
  20:00:00`; shows the running-timer caption only when `runningCount > 0`.
- `report-data-table.test.tsx` — Difference sorts numerically, `aria-sort` correct.

**Manual, against a real Supabase project** (`pnpm dev`):

1. As admin, assign an employee to Project A at 4h/day Mon–Fri and to Project B at
   3h/day Mon/Tue/Thu/Fri. Confirm both surfaces (project page and Team dialog) show and
   edit the same values.
2. Log ~16h against them across the current month.
3. Sign in as that employee → dashboard shows worked vs expected month-to-date, and the
   expected figure includes today.
4. `/reports`, By person, range = this month → the same expected figure; the footer total
   and the header total still agree (the two-independent-paths check, §12.2).
5. Assign a **third** employee with a schedule and log nothing for them → they must still
   appear in By person with `0:00:00` worked and a non-zero expected. This is the union
   case and the easiest thing in the whole plan to get wrong.
6. Add a fourth employee to a project **mid-month** → their expected covers only from
   that day forward.
7. Set a task filter → Expected/Difference disappear with the caption, and the CSV for
   that view omits them.
8. Export the by-person CSV and check Expected/Difference match the screen.
9. Sanity-check a non-UTC company (e.g. `America/Havana`, the zone `0007_reports.sql`
   names for its DST-at-midnight cushion): a month boundary must not shift a day.

**Gate** — all five must be clean before this is done:

```
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm build
```
