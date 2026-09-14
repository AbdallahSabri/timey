# Employee progress cards, and a guided client → project → employee setup

> Reference document. Phase 11's plan, following Phase 10 (`e018583`), which built the two
> dashboards. Kept as the record of why each card is on the page, and of the one thing the
> schema would not let the flow do.

## Context

Two complaints, both about `/overview`.

**The team data is there but it does not read as employee data.** "Keeping up" renders one
compact row per person — a name, a thin bar, `44:00:00 of 50:00:00`, and `6:00:00 behind`.
It is a table in all but markup: correct, dense, and hard to scan. It shows **no
percentage**, which is the one figure that makes "is this person keeping up" answerable at a
glance. It is also capped at eight people with a link to `/reports` for the rest, so there
is no team-wide figure anywhere on the page — `report_summary.expectedSeconds` is null for a
team-wide report by §9.8.1, so nothing on `/overview` currently says what the company as a
whole owed or delivered.

**The creation flow is spread across three routes and nothing says what order to use them
in.** A client is made on `/clients`, a project on `/projects`, a person is invited on
`/members`, and they are assigned to a project on `/projects/[id]`. Each page carries a
sentence gesturing at the next step — `/projects` even says "Creating it does not assign
anyone — including you. Open the project to add people." — but an admin setting up for the
first time has to discover the sequence by failing at it. There is no first-run guidance
anywhere in the app; `grep` for `wizard|checklist|get started` across `src/` returns nothing.

The outcome: `/overview` gains a card per employee with a real percentage, a team-total card
above them, and a persistent setup card at the top that drives the whole creation sequence
from dialogs without leaving the page.

## Decisions taken (confirmed with the user)

1. **No migration; the invite → assign gap is surfaced, not hidden.** See below — it is a
   real schema constraint, not an oversight.
2. **"Keeping up" is replaced by a grid of employee cards showing *everyone*.** Not
   truncated, because that is what makes the team-total card honest under §12.2.
3. **One setup card at the top of `/overview`**, always present, collapsing to the tip plus
   three buttons once all three steps have content.

## The constraint behind decision 1, stated plainly

The requested flow was "create an employee related to project and **invite them to the
project**". The schema cannot express that, and three independent things stop it:

- `invitations` has columns `{id, company_id, email, role, token_hash, invited_by,
  expires_at, accepted_at}` — **no `project_id`**, and no migration in `0001`–`0014` adds
  one.
- `accept_invitation()` (`0003_invitations.sql`) sets `profiles.company_id`, `role` and
  `status` and marks the invitation accepted. It never touches `project_members`.
- `project_members` has `foreign key (user_id, company_id) references profiles (id,
  company_id)`. A person who was invited but has not accepted has either no `profiles` row
  or a limbo one with `company_id IS NULL`. Neither satisfies that FK, so the assignment is
  not merely unsupported by the UI — it is unrepresentable.

So the sequence is forced: **client → project → invite → (they accept) → assign.** The plan
does not pretend otherwise. The setup card's third step invites, and a fourth line appears
**only when there is something to finish**: "2 invited, waiting to accept" and "1 member
isn't on any project yet — nobody can log time until they are", each linking to where to do
it. Closing the gap for real would mean `invitations.project_id` plus schedule columns and an
edit to a `SECURITY DEFINER` function — a migration that §0.2 says lands alone. Worth doing
later; recorded in `BLOCKERS.md` as the option not taken and why.

## 1. Schema, types, RPCs

**None.** Every figure below comes from report actions that already exist.

## 2. Actions — owner `implement-logic`

One new read, and it is deliberately not a report action:

```ts
// src/lib/actions/project-members.ts
export async function listProjectMemberships(): Promise<
  ActionResult<{ projectId: string; userId: string }[]>
>;
```

- One `project_members` select of `(project_id, user_id)`, company-scoped by RLS
  (`project_members_select_own_company` is company-wide, §3.6.2). No role gate and no
  `company_id` filter, following `listPendingCorrectionRequests`' reasoning that RLS is the
  boundary and a second opinion in TypeScript can only disagree with it.
- It exists for one purpose: the setup card's "N members aren't on any project yet". The
  alternative is `listProjectMembers(projectId)` once per project, which is N+1.
- It returns **rows, not a figure**, which is why it is allowed on a dashboard at all —
  §9.9.1 already carves out exactly this for `listRunningTimers()` and
  `listMemberProjectSchedules()`. §9.9.1 gets amended to name a third.

Three existing forms gain an optional completion callback so a dialog can close itself and a
caller can chain. The shape is already established by `manual-entry-form.tsx` and
`create-correction-form.tsx` (`onCompleted?: () => void`, called after `toast.success` and
`form.reset` and **before** `router.refresh()`):

- `CreateClientForm` → `onCompleted?: (client: Client) => void`
- `CreateProjectForm` → `onCompleted?: (project: Project) => void`
- `InviteMemberForm` → `onSent?: () => void` — **and its dialog must not close on it.** The
  raw token is rendered exactly once by `InviteLink` and the copy says so: "It appears once:
  leaving this page loses it." A dialog that closed on success would destroy the only copy
  of the link. The callback exists only so the dialog can re-render around the link.

## 3. The percentage — the first one in the product

Nothing in `src/` renders a percentage to a user today. The only percentages anywhere are
CSS widths/heights and `ProgressMeter`'s `aria-valuenow`; the sole formatting convention in
the codebase is `formatSecondsHms`. So this establishes a convention, and it needs three
rules.

```ts
// src/components/reports/report-expected.ts — beside differenceSeconds, which owns the
// sign convention for the same pair of numbers.
export function percentOf(
  totalSeconds: number,
  expectedSeconds: number | null,
): number | null;
```

- **Null when there is no target to be a percentage of** — `expectedSeconds` null *or* zero.
  On `/overview` the live case is **zero**, not null: `mergeExpectedByUser` reads `?? 0` by
  design, so somebody with no schedule arrives as 0 (`ReportUserRow.expectedSeconds` is null
  only under a task filter, which this page never sets). Rendering `0%` there would claim
  they achieved nothing of something asked; rendering `∞` or `100%` would be worse. The card
  shows `FIGURE_UNAVAILABLE` (`—`) and the caption already says "No expected hours set".
- **Unclamped, and this diverges from the bar on purpose.** `ProgressMeter` clamps its fill
  at 100% so an overshoot cannot paint outside its track. The *text* must not clamp: `156%`
  is the true reading and the interesting one, and a card reading `100%` beside `54:00:00 of
  36:00:00` would be visibly wrong. This is the same split `formatSecondsHms` already makes
  by clamping negatives and letting the words carry the sign — comment it there, because
  "the bar says 100 and the label says 156" otherwise reads as a bug.
- **`Math.round`, no decimals** — matching `aria-valuenow`, the only rounding precedent.

## 4. Employee cards — owner `build-ui`

### `src/components/dashboard/employee-progress-card.tsx`

```ts
export function EmployeeProgressCard({
  row,
  running,
  href,
}: {
  row: AttendanceRow;          // already the shape getReportByUser returns
  /** That person has a timer going right now. Amber, per `CLAUDE.md`. */
  running: boolean;
  /** Their own row in /reports, built with reportHref — never a hand-made query string. */
  href: string;
}): React.ReactElement;
```

Contents, in reading order: the name (muted italic for an unreadable one, via
`UNKNOWN_PERSON`); the percentage in `FIGURE_CLASS`; a `ProgressMeter`; `44:00:00 of
50:00:00`; and the difference line with the existing colour rule — ledger green at-or-above,
plain text behind, **never** amber and never `destructive`, because §9.8 counts today in full
so reading short is the ordinary state of a Tuesday morning.

`running` renders a small `RunningBadge`-style marker. It is the only amber on the card and
the data is already on the page from `listRunningTimers()`, so it costs no read.

### `src/components/dashboard/employee-progress-grid.tsx`

```ts
export function EmployeeProgressGrid({
  rows,
  runningUserIds,
  from,
  to,
  emptyLabel,
}: {
  rows: AttendanceRow[];
  runningUserIds: ReadonlySet<string>;
  /** The range, so each card can build its own /reports link. */
  from: string;
  to: string;
  emptyLabel: string;
}): React.ReactElement;
```

- Orders with the existing `byShortfall` — worst shortfall first, which is the whole reason
  that helper exists and diverges from SQL's `total_seconds desc`.
- **Renders every row.** No `limit`. This is the change that lets the team card carry a
  total: §12.2 asks that a total equal the sum of its own visible line items, and with
  nothing truncated it does. A forty-person team is forty compact cards; `/reports` already
  renders that many rows in a table, and the link to it stays for the detailed view.
- `grid gap-3 sm:grid-cols-2 lg:grid-cols-3`.

### `src/components/dashboard/team-progress-card.tsx`

```ts
export function TeamProgressCard({
  workedSeconds,
  expectedSeconds,
  counts,
  rangeLabel,
}: {
  /** From report_summary — §9.8.1's sanctioned source of range totals. */
  workedSeconds: number | null;
  /** Summed from the employee cards below, because no team-wide expected aggregate exists. */
  expectedSeconds: number;
  counts: { behind: number; ahead: number; onTarget: number; noTarget: number };
  rangeLabel: string;
}): React.ReactElement;
```

**Each number comes from the one place that owns it, and the card says so.** Worked is
`report_summary.totalSeconds` (§9.8.1). Expected is the sum of the rows rendered beneath —
there is no company-wide expected RPC, and `report_summary.expectedSeconds` is null for a
team-wide report by §9.8.1, so summing the visible line items is the only honest route and
is exactly what `/reports`' own footer does via `totalsOf`. The worked figure therefore
appears twice on the page, in the "Hours this month" tile and here; that is §12.2's
two-independent-paths check, which `report-summary.tsx` already documents as a feature, and
a disagreement between them is the bug §12.2 exists to catch.

Carries §9.9.4's two disclosures, because it pairs worked with expected.

### `src/components/dashboard/attendance-rows.ts` — one addition

```ts
export function teamTotals(rows: readonly AttendanceRow[]): {
  expectedSeconds: number;
  behind: number;
  ahead: number;
  onTarget: number;
  noTarget: number;
};
```

Pure, tested, and mirroring `totalsOf`'s treatment of a null expected. `noTarget` counts the
rows `percentOf` returns null for, so the card's counts and the cards' own figures cannot
drift.

### Retired

`src/components/dashboard/team-attendance-list.tsx` is deleted — the grid replaces it. It has
no test file, so nothing is orphaned. `byShortfall` and `AttendanceRow` stay; they are what
the grid uses.

## 5. The setup card — owner `build-ui`

### `src/components/dashboard/setup-checklist.tsx` (client — it owns dialog state)

```ts
export function SetupChecklist({
  clientCount,
  projectCount,
  memberCount,
  pendingInvitationCount,
  unassignedMemberCount,
  clients,
  weekStartsOn,
}: {
  clientCount: number;
  projectCount: number;
  memberCount: number;
  pendingInvitationCount: number;
  unassignedMemberCount: number;
  /** For the project dialog's client picker. */
  clients: Client[];
  weekStartsOn: number;
}): React.ReactElement;
```

- **The tip is static and always rendered**, in both states: *"Clients hold projects;
  projects hold the time. Create a client, then a project for it, then invite the people who
  will log time to it."*
- Three numbered steps, each showing its own state and a button that opens the existing form
  in a dialog, so the admin never leaves the page:
  1. **Client** — "2 clients" / "None yet" → `AddClientDialog`
  2. **Project** — "4 projects" / "None yet" → `NewProjectDialog`
  3. **People** — "11 members · 1 invitation pending" → `InviteMemberDialog`
- **A fourth line, only when there is something to finish** — this is where decision 1's gap
  is made visible rather than papered over: "1 member isn't on any project yet — nobody can
  log time until they are", linking to `/projects`. And, when invitations are outstanding,
  "1 invitation waiting to be accepted", linking to `/members`.
- **Collapses when every step has content**: the tip, three small buttons, and the fourth
  line if it applies. Tall while any step is empty. It never disappears — the user asked for
  a static tip, and the buttons stay useful as shortcuts.

### Three dialogs, matching `manual-entry-dialog.tsx`'s shape exactly

`src/components/clients/add-client-dialog.tsx`,
`src/components/projects/new-project-dialog.tsx`,
`src/components/invitations/invite-member-dialog.tsx` — each a `Dialog` + `DialogTrigger
asChild` + `DialogContent className="sm:max-w-lg"` wrapping the existing form. They live
beside the forms they wrap, not in `dashboard/`, so `/clients` and `/projects` can adopt
them later.

The invite dialog is the exception noted in §2: it closes only on explicit dismissal, and
renders `InviteLink` inside itself.

**Dialogs are not chained.** Creating a client does not auto-open the project dialog with it
preselected. The tip carries the order; wiring the steps together is a state coupling nobody
asked for and it would fight `CreateProjectForm`'s deliberate "keep the chosen client on
reset" behaviour. Noted as a possible follow-up.

## 6. `/overview` — what changes

`src/app/(app)/overview/page.tsx`. Four reads added to the existing `Promise.all`
(`listClients`, `listMembers`, `listInvitations`, `listProjectMemberships`) — all cheap
row reads, none a report. The §2b per-request member memo from Phase 10 already stops these
multiplying `getUser()` calls.

New order:

1. Header
2. **`SetupChecklist`** ← new, top
3. Pulse tiles (unchanged)
4. "On the clock now" (unchanged)
5. **"Keeping up" → `TeamProgressCard` + `EmployeeProgressGrid`** ← replaces the list
6. The two charts (unchanged)

`runningUserIds` is `new Set(running.map(t => t.userId))` — derived from the read already
there. `unassignedMemberCount` is `listMembers()` minus the distinct `userId`s in
`listProjectMemberships()`, computed in a pure tested helper, not inline:

```ts
// src/components/dashboard/setup-state.ts
export function unassignedMemberCount(
  members: readonly { id: string }[],
  memberships: readonly { userId: string }[],
): number;
```

## 7. Docs

- **`SPEC.md` §9.9** — the `/overview` bullet is now: setup checklist, pulse tiles, stale
  queue, team progress + a card per employee, the two charts.
- **§9.9.1** — name `listProjectMemberships()` as a third non-report read alongside
  `listRunningTimers()` and `listMemberProjectSchedules()`, on the same grounds: rows, not
  figures.
- **§9.9.3** — amend. The employee grid is **not** truncated, and the reason is the rule
  itself: showing every line item is what entitles the team card to a total. The project
  breakdown still truncates into "Other" and still shows no total, so the rule stands where
  it applies; what changes is that one card chose the other side of the trade.
- **New §9.9.6 — percentages.** The three rules in §3: null for no target, unclamped text
  against a clamped bar and why, `Math.round` with no decimals. This is the product's first
  user-visible percentage and there is no other convention to defer to.
- **New §9.9.7 — the setup checklist.** That it is guidance and a set of shortcuts, not a
  wizard; that it is always present; and that the invite → assign gap is **displayed**
  because the schema forces it — with a pointer to the migration that would close it.
- **`PLAN.md`** — Phase 11, depending on Phase 10.
- **`BLOCKERS.md` D-20** — the four decisions, and prominently the one *not* taken: no
  `invitations.project_id`. Record the cost of closing it later (a migration touching
  `accept_invitation()`, §0.2) and the one upside anybody proposing it should know —
  `added_at` would become the accept moment, which is when the person could first log time,
  making §9.8 accrual more correct rather than less.
- **`README.md`** — the `/overview` route row.

## 8. Order of work

No migration, so: actions → helpers → UI → docs.

1. `implement-logic` — `listProjectMemberships()`; the three `onCompleted`/`onSent` props.
2. Pure helpers with colocated tests, landed before anything renders them: `percentOf`,
   `teamTotals`, `unassignedMemberCount`.
3. `build-ui` — `EmployeeProgressCard`, `EmployeeProgressGrid`, `TeamProgressCard`; delete
   `team-attendance-list.tsx`.
4. `build-ui` — the three dialogs, then `SetupChecklist`.
5. `build-ui` — rewire `/overview`.
6. Docs (§7).
7. `code-reviewer` read-only pass, then `test-runner` on the full gate.

## 9. Verification

### Automated

```
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm build
```

New colocated tests (vitest + jsdom; `src/lib/actions/**` has no harness — `BLOCKERS.md`
D-12/N-2 — so `listProjectMemberships` is covered by the manual checks):

- `report-expected.test.ts` — `percentOf`: null for a null *and* a zero target; **unclamped
  above 100**; rounds to whole numbers; 0 worked against a real target is `0`, which is a
  measurement and must not be confused with the no-target case.
- `attendance-rows.test.ts` — `teamTotals`: the four counts partition the rows exactly;
  `noTarget` agrees with the rows `percentOf` nulls.
- `setup-state.test.ts` — `unassignedMemberCount`: a member on two projects counts once; a
  membership for somebody no longer in `members` does not go negative.
- `employee-progress-card.test.tsx` — the percentage is rendered as text; a no-target card
  shows `—` and **no `progressbar`** (inherited from `ProgressMeter`); the running marker
  appears only when `running`; an unreadable name renders `UNKNOWN_PERSON`, muted.
- `employee-progress-grid.test.tsx` — **every** row renders, worst first; no "showing N of
  M" line exists.
- `team-progress-card.test.tsx` — the percentage and both figures; counts; both §9.9.4
  disclosures present; `—` rather than `0:00:00` when the worked read failed.
- `setup-checklist.test.tsx` — the tip renders in both states; three steps with their
  counts; collapses when all three have content; the unassigned and pending lines appear
  only when non-zero.

### Manual, against the local stack (the QA fixtures from Phase 10 still fit)

Add to `SPEC.md` §12.2's Dashboards block:

- [ ] The team card's expected total equals the sum of the employee cards' expected figures,
      and its worked figure equals the "Hours this month" tile (§12.2's two paths)
- [ ] Every employee appears as a card — with 11 people there are 11 cards and no "showing
      N of M"
- [ ] A person with no schedule shows `—` rather than `0%`, and their card has no progressbar
- [ ] Somebody over their target reads above 100% in text while their bar stays full
- [ ] A person with a timer running is marked, and that is the only amber on the card
- [ ] With no clients, the setup card is tall and step 1 reads "None yet"; with all three
      populated it collapses to the tip plus three buttons, and the tip is present in both
- [ ] Each of the three dialogs creates its row and the page reflects it without a reload
- [ ] The invite dialog does **not** close on success, and the invite link is still copyable
- [ ] Invite somebody and do not accept: "1 invitation waiting to be accepted" appears.
      Accept it: that line goes and "1 member isn't on any project yet" takes its place.
      Assign them: both lines go
- [ ] An employee still cannot reach `/overview`
- [ ] Phone width and both themes on the new cards — the two checks still outstanding from
      Phase 10, now covering these too
