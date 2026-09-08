-- 0014_member_schedules.sql
--
-- Expected hours. The half of the record Timey has never had: what a person was
-- SUPPOSED to work, against which §9's totals of what they DID work finally
-- mean something. Implements the approved plan at
-- _plans/expected-hours-attendance.md, on §6.1's day-bucketing rule and §9.5's
-- integer-seconds rule, both of which govern this file as strictly as they
-- govern 0007.
--
-- Unlike 0007 and 0013, this migration DOES add columns:
--
--   project_members.expected_daily_seconds  integer    not null default 0
--   project_members.working_days            smallint[] not null default '{1,2,3,4,5}'
--
-- plus one CHECK on each, one BEFORE INSERT OR UPDATE trigger that normalizes
-- working_days, two column GRANTs extended, and two report functions:
--
--   report_expected_by_user          — one expected figure per person, summed
--                                      across all their assignments
--   report_expected_by_user_project  — the same figure split by project, to sit
--                                      beside report_by_user_project
--
-- It creates no table, no policy and no index, and it changes no existing
-- policy, function, constraint or grant beyond widening the two column lists
-- named below.
--
-- ---------------------------------------------------------------------------
-- Reversibility
-- ---------------------------------------------------------------------------
--
-- Nothing existing is lost by APPLYING this. It drops no column, no
-- constraint, no policy and no function; the two ALTER TABLE ... ADD COLUMN
-- statements carry non-volatile defaults, so under PG11+ they are a catalog
-- update rather than a table rewrite, and every pre-existing membership row
-- reads back as `0 seconds, Mon-Fri` — i.e. NO TARGET, which is the correct
-- reading of an assignment made before targets existed.
--
-- Reverting it WOULD lose data, and this is the one thing to say out loud:
-- `alter table public.project_members drop column expected_daily_seconds, drop
-- column working_days` destroys every schedule an admin has entered. There is
-- no other copy — schedules are not derived from anything and are not recorded
-- anywhere else. Dropping the two functions, the trigger, the trigger function
-- and the widened grants loses nothing.
--
-- ---------------------------------------------------------------------------
-- Why the columns live on project_members (and what that discloses)
-- ---------------------------------------------------------------------------
--
-- A schedule is a property OF AN ASSIGNMENT, not of a person: the same employee
-- can be 4h/day Mon-Fri on one project and 3h/day Mon/Tue/Thu/Fri on another,
-- and §3.6's row is exactly "this person, on this project". Putting the two
-- columns anywhere else would need a second table 1:1 with a primary key that
-- already exists.
--
-- THE CONSEQUENCE, STATED PLAINLY because it is a new disclosure and not an
-- oversight: project_members_select_own_company (0004) is COMPANY-WIDE — §4.2's
-- SELECT cell for this table is "own company", not "own rows or admin". So
-- every employee can already read every colleague's assignment rows, and after
-- this migration those rows carry hours/day and working days. That was put to
-- the user in the plan's Context section, alongside the alternative (a separate
-- project_member_schedules table with an own-rows-or-admin policy mirroring
-- time_entries_select_own_or_admin), and this shape was the one approved.
--
-- No policy is added, changed or weakened here. The disclosure is the existing
-- policy applied to new columns, which is precisely why it had to be a decision
-- rather than a detail.
--
-- ---------------------------------------------------------------------------
-- Error codes raised or reachable through this migration
-- ---------------------------------------------------------------------------
--
--   22023  working_days was given as a multi-dimensional array (the trigger
--          refuses it before the CHECK below can see it)                 -> 400
--   23502  working_days or expected_daily_seconds explicitly set to NULL
--          (both are NOT NULL; the trigger deliberately does not "fix" a
--          NULL into '{}')                                              -> 400
--   23514  expected_daily_seconds outside 0..86400, or working_days
--          containing a day number outside 0..6 or a NULL element        -> 400
--   42501  a non-admin, or an admin of another company, attempting the
--          INSERT or UPDATE — refused by the 0004 policies, unchanged     -> 403
--
-- The two functions raise nothing of their own; they are pure reads, and the
-- only SQLSTATEs a caller can see are 22008 (unparseable date) and 22P02 (bad
-- uuid) from the parameters themselves, exactly as in 0007.

-- ---------------------------------------------------------------------------
-- The columns (§9.5, and the dow convention)
--
-- INTEGER SECONDS, NEVER FLOAT HOURS. §9.5: "durations are summed as integer
-- seconds and formatted at the edge... rounding drift across hundreds of rows
-- produces totals that don't match their own line items". This column is
-- compared directly against `sum(time_entries.duration_seconds)`, which is an
-- integer-second GENERATED column (§3.7). A `numeric` hours column would make
-- the two halves of the comparison disagree by construction: 3.5h stores
-- exactly, 7h20m does not, and the shortfall the UI renders would be an
-- artefact of the storage type. The admin types hours; validations/** turns
-- them into seconds; nothing below an hour is lost because nothing is divided.
--
-- 0 is a legal, defaulted value meaning NO TARGET — which is what every row
-- that predates this migration has, and what an admin who does not want to
-- track a person's attendance leaves it as. 86400 is the ceiling because a
-- day is 86400 seconds; a target above it can only be a units mistake.
--
-- working_days uses POSTGRES `extract(dow)` NUMBERING: 0 = Sunday .. 6 =
-- Saturday. Chosen so the day test in both functions below is a direct
-- `extract(dow from d)::smallint = any(pm.working_days)` with no offset
-- arithmetic anywhere — an off-by-one in a day-of-week remap is invisible in
-- code review and shifts a whole month's expected figure by one day's target.
-- It also matches companies.week_starts_on's existing 0=Sun/1=Mon convention
-- (0002, companies_week_starts_on_valid), so the app has ONE day numbering.
--
-- An EMPTY array is legal and means "no working days on this project" — the
-- expected figure for that membership is zero regardless of hours/day. It is
-- not the same value as a zero target and the two are reachable independently;
-- both produce 0, so neither needs special handling downstream.
--
-- Validity is split the way 0004 splits company_id: a declarative CHECK for
-- what a value may BE, and a trigger for the shape it must be STORED in. See
-- the trigger below for why "distinct" cannot be a CHECK.
-- ---------------------------------------------------------------------------

alter table public.project_members
  add column expected_daily_seconds integer    not null default 0,
  add column working_days           smallint[] not null default '{1,2,3,4,5}',

  add constraint project_members_expected_daily_seconds_range
    check (expected_daily_seconds between 0 and 86400),

  -- Three separate claims, deliberately in one constraint so a violation names
  -- the column rather than one of three near-identical constraint names:
  --
  --   (1) one dimension only. array_ndims returns NULL, not 0, for the empty
  --       array, so the coalesce is what keeps '{}' legal; without it the term
  --       would evaluate NULL and pass by accident rather than by intent.
  --   (2) no NULL elements. `<@` alone does NOT reliably reject them — array
  --       containment compares elements with an equality that has its own
  --       rules about NULL, and depending on it to mean "contains no NULL"
  --       is depending on a side effect. array_position(arr, null) is the
  --       documented way to ask the question directly: it returns the position
  --       of the first NULL, or NULL if there is none.
  --   (3) every element is a real dow number. `<@` is the whole test: true for
  --       the empty array (correct — see above), false as soon as any element
  --       falls outside 0..6.
  --
  -- A multi-dimensional array never reaches term (2) — array_position raises
  -- 0A000 on one — which is why the trigger below rejects that shape first,
  -- with a legible 22023. If the trigger were ever disabled, a 2-D array would
  -- still be unstorable; only the error code would degrade.
  add constraint project_members_working_days_valid
    check (
      coalesce(array_ndims(working_days), 1) = 1
      and array_position(working_days, null::smallint) is null
      and working_days <@ array[0,1,2,3,4,5,6]::smallint[]
    );

comment on column public.project_members.expected_daily_seconds is
  'Expected work per working day, in INTEGER SECONDS (§9.5) — never float hours, because this is compared against sum(time_entries.duration_seconds). 0 means "no target", which is what every assignment made before this column existed has.';
comment on column public.project_members.working_days is
  'Days this assignment is worked, in Postgres extract(dow) numbering: 0 = Sunday .. 6 = Saturday, matching companies.week_starts_on. Stored sorted and de-duplicated by project_members_20_normalize_working_days. The empty array is legal and means "no working days on this project".';

-- ---------------------------------------------------------------------------
-- Normalizing working_days (0004's "unrepresentable, not merely validated")
--
-- A CHECK constraint cannot express "the elements are distinct" — that needs a
-- subquery, which CHECK forbids — and it cannot express "sorted" at all. Both
-- are properties of the STORED value rather than of the value's legality, so
-- they belong in a BEFORE trigger, which is the only place in Postgres that can
-- rewrite a row instead of rejecting it.
--
-- Why bother normalizing at all, when '{5,1,1}' and '{1,5}' produce the same
-- count in both functions below:
--
--   * `= any(...)` is indifferent to order and duplicates, but a human reading
--     the row, a diff of two rows, and any future `working_days = working_days`
--     comparison are all NOT. Two rows that mean the same thing should BE the
--     same thing.
--   * the UI renders the array as a row of day chips. Rendering '{5,1,1}' in
--     stored order gives "F M M", which reads as a data bug to the admin who
--     just typed it.
--   * it removes a whole class of question from the actions layer: nothing
--     downstream has to sort, de-duplicate, or wonder whether it should.
--
-- SECURITY INVOKER (the default, and no SECURITY DEFINER is wanted): this
-- function reads no table, calls nothing, and needs no privilege the caller
-- lacks. `set search_path = pg_catalog, public` is still declared, matching
-- companies_validate_timezone (0002) — every function in this schema pins its
-- search_path whether or not it is a definer.
--
-- It fires on EVERY insert and update rather than `update of working_days`,
-- for the reason 0004 gives for project_members_10_set_company_id: no future
-- path should be able to leave the column in a shape this trigger would have
-- refused. Normalization is idempotent, so the cost of the extra firings is a
-- sort of at most seven elements.
--
-- A NULL working_days is passed through UNTOUCHED and deliberately. array()
-- over unnest(NULL) is '{}', not NULL, so "fixing" it here would silently turn
-- an explicit `working_days: null` into "no working days" and the NOT NULL
-- constraint would never fire. Refusing a NULL is the column's job; this
-- trigger returns the row unchanged so 23502 is what the caller sees.
--
-- The _NN_ in the trigger name follows 0002/0004/0005: the number orders the
-- triggers on the table, since Postgres fires BEFORE triggers in name order.
-- 10 is project_members_10_set_company_id, which derives company_id (§2.1);
-- this is 20 and must stay after it — not because it reads company_id today,
-- but because a normalization step that could run before the row's tenancy is
-- settled is a hazard waiting for the first trigger that does.
-- ---------------------------------------------------------------------------

create function public.project_members_normalize_working_days()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  -- Let the NOT NULL constraint speak for itself (see above).
  if new.working_days is null then
    return new;
  end if;

  -- Refused here rather than by the CHECK, because array_position() raises
  -- 0A000 (feature_not_supported -> a 500 at the API edge) on a
  -- multi-dimensional array. This is the same shape rejection, one step
  -- earlier, with an SQLSTATE PostgREST maps to 400. Flattening it instead —
  -- unnest() would do that for free — was rejected: '{{1,2},{3,4}}' is not a
  -- set of working days with a typo in it, it is a caller sending the wrong
  -- thing, and quietly accepting it would store a schedule nobody wrote.
  if coalesce(array_ndims(new.working_days), 1) <> 1 then
    raise exception 'working_days must be a one-dimensional array of day numbers (0 = Sunday .. 6 = Saturday)'
      using errcode = '22023';
  end if;

  -- NULL elements survive this on purpose: DISTINCT keeps one of them and the
  -- CHECK then rejects the row with a legible 23514. Silently dropping them
  -- would accept '{1,null,5}' as '{1,5}'.
  new.working_days := array(
    select distinct d
      from unnest(new.working_days) as d
     order by d
  );

  return new;
end;
$$;

comment on function public.project_members_normalize_working_days() is
  'Stores project_members.working_days sorted ascending and de-duplicated, and refuses a multi-dimensional array with 22023. A CHECK cannot express "distinct" without a subquery, and cannot express "sorted" at all. A NULL array is passed through untouched so the column''s NOT NULL raises 23502 rather than the value being silently rewritten to ''{}''.';

create trigger project_members_20_normalize_working_days
  before insert or update on public.project_members
  for each row execute function public.project_members_normalize_working_days();

-- ---------------------------------------------------------------------------
-- Privileges — the two new columns, and nothing else
--
-- A column GRANT is a list, and ADD COLUMN does not extend it: a column added
-- to a table whose INSERT/UPDATE privileges were granted per-column is granted
-- to nobody until it is named. So without the two statements below, an admin
-- inserting {project_id, user_id, expected_daily_seconds, working_days} would
-- be refused 42501 by the column privilege check BEFORE RLS is ever consulted
-- — the schedule would be unwritable through PostgREST entirely. This is the
-- only privilege change in this file.
--
-- Postgres has no "grant these as well" form; a column grant is re-stated in
-- full and accumulates rather than replacing. So these two statements repeat
-- 0004's project_id and user_id and add the two new columns, and the effective
-- grant afterwards is the union either way.
--
-- company_id and added_at stay OUT, unchanged from 0004: company_id is derived
-- from the project by project_members_10_set_company_id (§2.1), and added_at is
-- a record of when something happened — which this migration gives a SECOND
-- job (it is the accrual start date of every expected figure below), making it
-- more important, not less, that no caller can name one. A client-settable
-- added_at would be a client-settable answer to "how many hours did you owe
-- last month".
--
-- NO RLS CHANGE IS NEEDED, and the claim was checked against 0004 rather than
-- assumed. project_members carries exactly four policies, all `to
-- authenticated`:
--   project_members_select_own_company  using       company_id = current_company_id()
--   project_members_insert_admin        with check  company_id = current_company_id() and is_admin()
--   project_members_update_admin        using       company_id = current_company_id() and is_admin()
--                                       with check  company_id = current_company_id() and is_admin()
--   project_members_delete_admin        using       company_id = current_company_id() and is_admin()
-- The two write policies are column-agnostic — they constrain WHICH ROW, and a
-- row policy cannot see which columns an UPDATE touched. So both verbs are
-- already gated to an active admin OF THIS COMPANY for the new columns exactly
-- as they are for project_id and user_id, and every one of the four filters on
-- company_id (§4.3) in addition to role. Nothing here needs loosening, and
-- nothing here is loosened.
-- ---------------------------------------------------------------------------

grant insert (project_id, user_id, expected_daily_seconds, working_days)
  on public.project_members to authenticated;
grant update (project_id, user_id, expected_daily_seconds, working_days)
  on public.project_members to authenticated;

-- ---------------------------------------------------------------------------
-- The two expected-hours functions
--
-- Both are 0007's template with time_entries swapped for project_members, and
-- they keep every property of it that still applies. What follows is only what
-- DIFFERS, since 0007 states the shared reasoning at length.
--
-- SECURITY INVOKER, AND THE ONE PLACE ITS MEANING IS NOT 0007'S.
--
-- Mandatory here for the reason it is mandatory there: RLS must remain the only
-- scope in play, with no `is_admin() or user_id = auth.uid()` restated inside a
-- function body where it could drift from the policy it duplicates (§0.2). A
-- definer version would be a company-wide read behind a signature that takes a
-- caller-supplied p_user_id, which §4.4 rules out.
--
-- BUT the policy being inherited is NOT time_entries_select_own_or_admin. It is
-- project_members_select_own_company, which is company-wide for every role.
-- So, unlike all eight functions in 0007 and 0013:
--
--     AN EMPLOYEE IS *NOT* COLLAPSED TO THEIR OWN ROW HERE.
--
-- An employee who calls this RPC with a colleague's p_user_id gets that
-- colleague's expected figure. That is not a hole these functions open — the
-- same employee can read the same two columns straight off the table with one
-- PostgREST select, because §4.2 makes SELECT on project_members "own company"
-- (see the disclosure note at the top of this file). The functions disclose
-- exactly what the table discloses and not one column more.
--
-- What it does mean, and what the actions layer must not get wrong: for THESE
-- TWO functions p_user_id is a FILTER and not a BOUNDARY. §9.2's employee
-- scoping (`const userId = isAdmin ? parsed.userId : member.id`) is what makes
-- an employee's report show their own figure, and there is no RLS behind it to
-- catch a mistake. Passing NULL for an employee returns the whole company's
-- schedules rather than an empty result — which is the opposite of how the
-- 0007 functions fail, and the reason this paragraph exists.
--
-- NO p_task_id PARAMETER, DELIBERATELY.
--
-- The five other filters exist; a task filter does not, and its absence is a
-- decision rather than an omission. A schedule is attached to an ASSIGNMENT,
-- which is per project (§3.6) — nobody declares "3h/day on the Deploy task".
-- An expected figure narrowed to one task would have to either ignore the
-- filter (reporting a project-wide target beside a task-sized actual, which
-- reads as a catastrophic shortfall) or invent an apportionment rule no admin
-- entered. Both are worse than no column at all: the UI suppresses Expected
-- entirely whenever a task filter is active, and a parameter that existed would
-- invite a caller to pass one.
--
-- 0007's `started_at >= / <` PLANNER-HINT PAIR IS ABSENT, ALSO DELIBERATELY.
--
-- That pair exists only to keep a non-sargable `between` over time_entries from
-- scanning every entry the caller can see for all time. There is no range
-- predicate on added_at here at all — added_at BOUNDS THE SERIES rather than
-- filtering rows — and project_members holds one row per assignment, orders of
-- magnitude below time_entries. A cushion here would guard nothing and could
-- only be got wrong. Its DST reasoning does still apply, in a different place:
-- see the ::timestamp casts on the series bounds below.
--
-- A MEMBERSHIP THAT EXPECTS NOTHING IS ABSENT, NOT PRESENT AS A ZERO.
--
-- The one departure from the plan's literal SQL, and it is one predicate in
-- each function. It changes no figure — a zero contribution sums to the same
-- total whether it is included or not. What it changes is which ROWS EXIST:
-- without it every membership in the company produces a row, so a person with
-- no target at all comes back with expected_seconds = 0, and the edge's union
-- merge (which appends expected-only people so that someone who logged nothing
-- still shows) would append the entire company roster to every report as "0:00
-- worked, 0:00 expected". "Nothing expected" is an absence, and the honest
-- representation of an absence is a missing row rather than a zero. The
-- actions layer already reads a missing person as expecting zero, so the two
-- halves agree.
--
-- THE PREDICATE IS ON THE COMPUTED CONTRIBUTION, NOT ON THE INPUT COLUMN, and
-- that distinction is the whole reason for the `cross join lateral` below.
-- There are three independent ways for a membership to expect nothing, and
-- they must not arrive shaped differently:
--
--     * expected_daily_seconds = 0            — no target was ever set;
--     * working_days = '{}'                   — a target, but no days to
--                                               apply it to;
--     * no working day falls in the range     — assigned after p_to, or a
--                                               range that misses every one of
--                                               this assignment's days.
--
-- `where pm.expected_daily_seconds > 0` would catch only the first and leave
-- the other two as rows of zero — two ways of saying the same thing, one
-- absent and one present, which the edge would then have to know about.
-- Filtering on `hours/day x working days > 0` collapses all three into the
-- same shape. The lateral exists so that product is written ONCE and the
-- filter and the sum are demonstrably the same arithmetic; a HAVING clause
-- would have had to restate the whole expression, since Postgres does not
-- allow an output alias there.
--
-- Note the filter is in WHERE, per membership, not in HAVING, per person. A
-- person with one real assignment and one empty one keeps the first and loses
-- the second — their by-user total is unchanged, and the by-project breakdown
-- lists only the projects they actually owe time on.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- report_expected_by_user — one row per person, all assignments summed
--
-- THE DAY COUNT, which is the entire function:
--
--   expected_daily_seconds x (number of working days in the range, from the
--   later of the range start and the day the assignment was made, through
--   p_to inclusive)
--
-- Four things about it, in descending order of how expensive they are to get
-- wrong:
--
-- (1) `(pm.added_at at time zone c.timezone)::date` is the SAME company-local
--     bucketing expression every function in 0007 applies to started_at, and it
--     is here for the same §6.1 reason. `date_trunc('day', pm.added_at)` or a
--     bare `pm.added_at::date` buckets in UTC and shifts the accrual start by
--     the company's offset — for a UTC+13 company an assignment made at 09:00
--     local on the 1st reads as the previous month, and the employee starts the
--     month already owing a day. PLAN.md:404 names UTC bucketing as the single
--     most likely defect in this area; this is the third file it has to be got
--     right in.
--
-- (2) THE SERIES BOUNDS ARE CAST TO `::timestamp` AND MUST STAY THAT WAY.
--     generate_series has no (date, date, interval) overload. date casts
--     implicitly to BOTH timestamp and timestamptz, and timestamptz is the
--     PREFERRED type of the datetime category — so an uncast pair resolves to
--     the TIMESTAMPTZ overload, which drags the session's TimeZone GUC into a
--     day count that must depend only on the company's own timezone, and steps
--     across DST transitions in whatever zone the connection happens to be set
--     to. The explicit ::timestamp casts pin the zone-free overload: the local
--     dates are resolved ONCE, by (1), and the stepping that follows is pure
--     calendar arithmetic no timezone can perturb. This is 0007's
--     DST-at-midnight cushion (its note (b), proven with America/Havana) making
--     its appearance in the one place this file can be bitten by it.
--
-- (3) `greatest(p_from, <assignment date>)` is how "assigned mid-month owes
--     nothing for the earlier days" is expressed — and when the assignment is
--     LATER than p_to, greatest() puts the series start past its stop, which
--     yields an empty series and therefore a zero contribution, which the
--     predicate above then removes from the result altogether. There is no
--     branch for either case because neither needs one; a special case would be
--     a second statement of the rule that could disagree with this one.
--
-- (4) The series runs THROUGH p_to INCLUSIVE, so TODAY COUNTS IN FULL. A 4h/day
--     Mon-Fri employee is expected to have done 20:00:00 by Friday, whatever
--     time Friday it is. Prorating today by the hour was rejected: it makes the
--     number move on its own, and every employee reading their dashboard before
--     lunch would see a shortfall that is an artefact of the clock. The UI
--     carries a caption saying so.
--
-- No `coalesce(sum(...), 0)` here, unlike every total in 0007. That coalesce
-- guards a group whose rows all had a NULL duration_seconds; here both factors
-- are NOT NULL and count(*) is never NULL, so a sum over a non-empty group
-- cannot be NULL, and a group is never empty. Writing one anyway would imply a
-- case that does not exist.
--
-- The `cross join lateral` cannot drop a membership even though it is not a
-- LEFT join: its body is an unfiltered aggregate, and count(*) over an empty
-- series is 0, never no-rows. Every membership therefore reaches the WHERE
-- clause exactly once, carrying its own day count.
--
-- The other joins follow 0007 note (a): LEFT to profiles and projects, INNER
-- only to companies. The companies join is INNER for 0007's reason — the timezone
-- is not optional, and a membership whose company row is unreadable has no
-- calendar to count days in. The projects join must be LEFT, and that is not
-- theoretical here: project_members SELECT is company-wide while projects
-- SELECT is admin-or-member (§3.6.1), so an employee reading a colleague's
-- membership row on a project they are not themselves on gets a NULL project
-- label. LEFT keeps the SECONDS correct and loses only the name; INNER would
-- drop the row and understate a total.
--
-- One consequence of that LEFT join to name, because it is the same trap 0007
-- documents for p_client_id: filtering by a client the caller cannot read
-- returns ZERO ROWS rather than a refusal, since pr.client_id reads NULL when
-- the projects row is invisible. That is RLS declining to distinguish "not
-- yours" from "not there", and it is the intended behaviour.
-- ---------------------------------------------------------------------------

create function public.report_expected_by_user(
  p_from date,
  p_to date,
  p_user_id uuid default null,
  p_client_id uuid default null,
  p_project_id uuid default null
)
returns table (
  user_id uuid,
  user_name text,
  expected_seconds bigint
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select pm.user_id                                            as user_id,
         p.full_name                                           as user_name,
         sum(pm.expected_daily_seconds::bigint * wd.day_count)::bigint
                                                               as expected_seconds
    from public.project_members pm
    join public.companies c on c.id = pm.company_id
    left join public.projects pr on pr.id = pm.project_id
    left join public.profiles p on p.id = pm.user_id
    cross join lateral (
      select count(*)::bigint as day_count
        from generate_series(
               greatest(p_from, (pm.added_at at time zone c.timezone)::date)::timestamp,
               p_to::timestamp,
               interval '1 day'
             ) as d
       where extract(dow from d)::smallint = any (pm.working_days)
    ) wd
   where pm.expected_daily_seconds * wd.day_count > 0
     and (p_user_id    is null or pm.user_id    = p_user_id)
     and (p_project_id is null or pm.project_id = p_project_id)
     and (p_client_id  is null or pr.client_id  = p_client_id)
   group by pm.user_id, p.full_name
   order by expected_seconds desc, user_name asc nulls last, pm.user_id;
$$;

comment on function public.report_expected_by_user(date, date, uuid, uuid, uuid) is
  'Expected work per person for a date range, in integer seconds (§9.5): hours/day x working days, from the assignment date through p_to inclusive, summed over all of that person''s assignments. The accrual start is (added_at AT TIME ZONE companies.timezone)::date — §6.1 bucketing, never UTC. Today counts in full. No p_task_id: schedules are per project, so a task-filtered expected figure would be meaningless. SECURITY INVOKER — but note the inherited policy is project_members_select_own_company, which is COMPANY-WIDE (§4.2): unlike the 0007 functions this does NOT collapse an employee to their own row, so p_user_id is a filter and §9.2''s scoping in the actions layer is what makes an employee''s report their own. A person who expects nothing in the range — no target, no working days, or assigned after it — is ABSENT rather than present with a zero.';

-- ---------------------------------------------------------------------------
-- report_expected_by_user_project — the same figure, split by project
--
-- The companion to report_by_user_project, so that cross-tab can carry an
-- Expected column beside its Worked one. Identical arithmetic; only the
-- grouping and the extra label columns differ.
--
-- IT RETURNS client_id AND client_name, sourced exactly as report_by_user_project
-- sources them (pr.client_id, plus a LEFT join to clients for the name), for the
-- same reason it returns project_name: these rows are used to APPEND people who
-- were expected to work on a project and logged nothing (§9.8.3's union case),
-- and such a row has no actual entry beside it to borrow a label from. Without
-- the two columns the cross-tab would render its "no client" placeholder for a
-- project that has a client — not a missing label, but a wrong claim.
--
-- The NULL client case carries the SAME two meanings 0007 documents at length on
-- report_by_project, and this function cannot tell them apart either: the
-- project is genuinely internal (§3.4 — projects.client_id is nullable), or the
-- caller cannot read the projects row at all (§3.6.1 — company-wide
-- project_members SELECT vs. admin-or-member projects SELECT, which is a live
-- case here rather than a hypothetical), so pr.client_id itself reads NULL. The
-- expected seconds are correct in both cases; only the label is absent, and the
-- edge must render the blank as an absence of a label and never as "internal".
--
-- The sum() is over exactly one row per group, because (project_id, user_id) is
-- project_members' primary key, every join below is on a primary key, and the
-- lateral yields exactly one row — so nothing here can fan out. It is written
-- as a sum anyway, for two reasons: the
-- two functions then read as one expression under two groupings rather than as
-- two different calculations, and if a membership ever grows more than one
-- schedule row this stays a total instead of silently becoming "one of them".
--
-- Ordering follows report_by_user_project exactly, and for the reason spelled
-- out there: user FIRST (this is a per-person breakdown, not a leaderboard),
-- with pm.user_id immediately after the name because nothing constrains
-- full_name to be unique and two people called "John Smith" would otherwise
-- interleave. The trailing pm.project_id makes the order total, so two rows
-- agreeing on user, seconds and project name cannot swap between runs of the
-- same report and read as data having changed.
-- ---------------------------------------------------------------------------

create function public.report_expected_by_user_project(
  p_from date,
  p_to date,
  p_user_id uuid default null,
  p_client_id uuid default null,
  p_project_id uuid default null
)
returns table (
  user_id uuid,
  user_name text,
  project_id uuid,
  project_name text,
  client_id uuid,
  client_name text,
  expected_seconds bigint
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select pm.user_id                                            as user_id,
         p.full_name                                           as user_name,
         pm.project_id                                         as project_id,
         pr.name                                               as project_name,
         pr.client_id                                          as client_id,
         cl.name                                               as client_name,
         sum(pm.expected_daily_seconds::bigint * wd.day_count)::bigint
                                                               as expected_seconds
    from public.project_members pm
    join public.companies c on c.id = pm.company_id
    left join public.projects pr on pr.id = pm.project_id
    left join public.profiles p on p.id = pm.user_id
    left join public.clients cl on cl.id = pr.client_id
    cross join lateral (
      select count(*)::bigint as day_count
        from generate_series(
               greatest(p_from, (pm.added_at at time zone c.timezone)::date)::timestamp,
               p_to::timestamp,
               interval '1 day'
             ) as d
       where extract(dow from d)::smallint = any (pm.working_days)
    ) wd
   where pm.expected_daily_seconds * wd.day_count > 0
     and (p_user_id    is null or pm.user_id    = p_user_id)
     and (p_project_id is null or pm.project_id = p_project_id)
     and (p_client_id  is null or pr.client_id  = p_client_id)
   group by pm.user_id, p.full_name, pm.project_id, pr.name, pr.client_id, cl.name
   order by user_name asc nulls last,
            pm.user_id,
            expected_seconds desc,
            project_name asc nulls last,
            pm.project_id;
$$;

comment on function public.report_expected_by_user_project(date, date, uuid, uuid, uuid) is
  'report_expected_by_user split by project, to sit beside report_by_user_project''s Worked column. Same arithmetic: hours/day x working days from (added_at AT TIME ZONE companies.timezone)::date through p_to inclusive, integer seconds (§9.5), §6.1 bucketing, today in full. No p_task_id, deliberately — schedules are per project. SECURITY INVOKER over project_members_select_own_company, which is company-wide, so p_user_id is a filter and not a boundary (see report_expected_by_user). Carries client_id and client_name so an expected-only row (§9.8.3''s union case) can render the cross-tab''s Client column instead of a "no client" placeholder it has no entry to borrow a label from. project_name, client_id and client_name are LEFT-joined and may be NULL when the caller can read the membership but not the project (§3.6.1), and a NULL client also means "internal" (§3.4) — the two are indistinguishable here, exactly as in report_by_project; the seconds are correct either way. Memberships contributing zero are absent rather than present as a zero.';

-- ---------------------------------------------------------------------------
-- Privileges
--
-- 0007's posture, verbatim: EXECUTE is granted to PUBLIC by default at
-- creation, so the revoke has to come first or the grant takes nothing away.
-- authenticated only — anon has no company, so both functions would return
-- nothing, and a reachable report RPC on the anon key is a probing surface for
-- no benefit.
--
-- No table grants are needed: these are SECURITY INVOKER and read through the
-- SELECT privileges authenticated already holds from 0002 and 0004, filtered by
-- those migrations' policies.
--
-- The trigger function is granted to NO client role, as in 0004: a trigger
-- function is reachable only as a trigger, and firing one needs no EXECUTE on
-- the invoker's part.
-- ---------------------------------------------------------------------------

revoke execute on function public.project_members_normalize_working_days() from public;

revoke execute on function public.report_expected_by_user(date, date, uuid, uuid, uuid)         from public;
revoke execute on function public.report_expected_by_user_project(date, date, uuid, uuid, uuid) from public;

grant execute on function public.report_expected_by_user(date, date, uuid, uuid, uuid)         to authenticated;
grant execute on function public.report_expected_by_user_project(date, date, uuid, uuid, uuid) to authenticated;
