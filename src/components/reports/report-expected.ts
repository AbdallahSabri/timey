/**
 * Actual hours and expected hours, put side by side (`SPEC.md` §9.8).
 *
 * **This is a union, not a join, and that is the whole point** (§9.8.3).
 * §9.3's aggregates return only people who logged something in the range —
 * `report_by_user` is a `GROUP BY` over `time_entries`, so somebody with no
 * entries produces no row at all. But an employee who was expected to work
 * 20:00:00 and logged nothing is precisely the row an attendance report exists
 * to surface, and an inner join would silently drop exactly the case the
 * feature was built for. Hence the appended rows below, and hence
 * `report_expected_by_user` returning `user_name` rather than ids alone: there
 * is no actual row to borrow a label from.
 *
 * **Why the merge is in Node and not in SQL.** §9.1 forbids client-side
 * aggregation of raw entries, and this is not that: both sides arrive already
 * aggregated by Postgres, and nothing here sums a duration. Zipping two
 * result sets on a key is presentation. Doing it in SQL would mean either a
 * `FULL OUTER JOIN` inside every one of 0007's functions — changing seven
 * working queries to serve one new column — or a view that has to re-derive
 * §9.2's scoping a second time. Keeping it here also keeps it pure, which is
 * why it can be tested without a database (§12.1).
 *
 * **Ordering.** Rows that came from SQL keep the order SQL gave them
 * (`total_seconds desc`, then name, then id — a total order, established in
 * `0007_reports.sql`). Re-sorting them here would duplicate that logic in a
 * second language with a different collation, and the two would eventually
 * disagree. The appended rows all have a zero total, so they belong after
 * every row that has any hours at all, which is where `total_seconds desc`
 * would have put them anyway; among themselves they are ordered by the size of
 * what is missing, largest first, because that is the reading order of a
 * shortfall list.
 *
 * Pure: no React, no Supabase, no `next/*`.
 */

/** The shape §9.3's by-user aggregate returns, minus the expected column. */
export type ActualUserTotals = {
  userId: string;
  userName: string | null;
  entryCount: number;
  totalSeconds: number;
};

/** The shape §9.3's user × project cross-tab returns. */
export type ActualUserProjectTotals = ActualUserTotals & {
  projectId: string;
  projectName: string | null;
  clientId: string | null;
  clientName: string | null;
};

export type ExpectedForUser = {
  userId: string;
  userName: string | null;
  expectedSeconds: number;
};

export type ExpectedForUserProject = ExpectedForUser & {
  projectId: string;
  projectName: string | null;
  clientId: string | null;
  clientName: string | null;
};

/**
 * Largest shortfall first among the rows that logged nothing.
 *
 * The name is the tiebreak so the order is stable across renders; a null name
 * sorts last, matching `nulls last` in 0007's `ORDER BY`.
 */
function byExpectedThenName<T extends ExpectedForUser>(a: T, b: T): number {
  if (a.expectedSeconds !== b.expectedSeconds) {
    return b.expectedSeconds - a.expectedSeconds;
  }
  if (a.userName === b.userName) return 0;
  if (a.userName === null) return 1;
  if (b.userName === null) return -1;
  return a.userName.localeCompare(b.userName);
}

export function mergeExpectedByUser(
  actual: readonly ActualUserTotals[],
  expected: readonly ExpectedForUser[],
): (ActualUserTotals & { expectedSeconds: number })[] {
  const expectedByUser = new Map(
    expected.map((row) => [row.userId, row.expectedSeconds]),
  );
  const seen = new Set(actual.map((row) => row.userId));

  const merged = actual.map((row) => ({
    ...row,
    // A person who logged time but has no schedule is expected to do zero, not
    // "unknown": the absence of a schedule is a statement that nothing was
    // asked of them on any project. `null` is reserved for "expected is not a
    // meaningful quantity here", which is §9.8.2's task-filter case and is
    // decided one level up, before this function is called at all.
    expectedSeconds: expectedByUser.get(row.userId) ?? 0,
  }));

  const missing = expected
    .filter((row) => !seen.has(row.userId))
    .sort(byExpectedThenName)
    .map((row) => ({
      userId: row.userId,
      userName: row.userName,
      entryCount: 0,
      totalSeconds: 0,
      expectedSeconds: row.expectedSeconds,
    }));

  return [...merged, ...missing];
}

/**
 * The cross-tab's key is the pair, so a person can be short on one project and
 * ahead on another and both rows appear. That is the view's reason to exist —
 * a combined per-person figure hides which project the shortfall is on.
 */
export function mergeExpectedByUserProject(
  actual: readonly ActualUserProjectTotals[],
  expected: readonly ExpectedForUserProject[],
): (ActualUserProjectTotals & { expectedSeconds: number })[] {
  const key = (row: { userId: string; projectId: string }) =>
    `${row.userId}:${row.projectId}`;

  const expectedByPair = new Map(
    expected.map((row) => [key(row), row.expectedSeconds]),
  );
  const seen = new Set(actual.map(key));

  const merged = actual.map((row) => ({
    ...row,
    expectedSeconds: expectedByPair.get(key(row)) ?? 0,
  }));

  const missing = expected
    .filter((row) => !seen.has(key(row)))
    .sort(byExpectedThenName)
    .map((row) => ({
      userId: row.userId,
      userName: row.userName,
      projectId: row.projectId,
      projectName: row.projectName,
      clientId: row.clientId,
      clientName: row.clientName,
      entryCount: 0,
      totalSeconds: 0,
      expectedSeconds: row.expectedSeconds,
    }));

  return [...merged, ...missing];
}

/**
 * Worked minus expected. Negative is behind.
 *
 * Trivial, and named anyway: it is the one place the sign convention is fixed,
 * and every surface that renders a difference reads it from here rather than
 * choosing its own direction. A table showing "-3:44:20" beside a card showing
 * "3:44:20 behind" is the kind of disagreement that makes people distrust both.
 */
export function differenceSeconds(
  totalSeconds: number,
  expectedSeconds: number | null,
): number | null {
  return expectedSeconds === null ? null : totalSeconds - expectedSeconds;
}
