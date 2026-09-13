/**
 * `/overview`'s one piece of URL state: which employee's chart is open
 * (`SPEC.md` §9.9.8).
 *
 * Pure: no React, no Supabase, no `next/*`.
 */

/** The query parameter. Named once so the reader and the writer cannot drift. */
export const EMPLOYEE_PARAM = "employee";

/**
 * `/overview` with one employee's panel open.
 *
 * A whole URL rather than a fragment, because the selection is server state:
 * the panel it opens is rendered from a query the server runs, so the browser's
 * back button, a middle-click and a bookmark all have to mean what they look
 * like they mean. `report-view-tabs.tsx` makes the same argument at length for
 * the same kind of control.
 */
export function overviewHref(userId: string): string {
  return `/overview?${new URLSearchParams({ [EMPLOYEE_PARAM]: userId }).toString()}`;
}

/**
 * Which employee's panel to render, given what the URL asked for and who
 * actually exists.
 *
 * **A requested id that is not in `rows` falls back rather than being
 * honoured**, and the reason is not tidiness. `getReportByDay` forwards
 * `p_user_id` to a `SECURITY INVOKER` function, so an id from another company
 * returns zero rows — which would render as a real employee panel full of empty
 * bars, indistinguishable from somebody who logged nothing. RLS makes that
 * harmless; falling back makes it honest. A hand-edited URL therefore shows the
 * default panel, not a blank one attributed to a stranger.
 *
 * **The default is `rows[0]`, and the caller decides what that means.**
 * `/overview` passes rows already ordered by `byShortfall`, so the panel that
 * opens unasked belongs to whoever is furthest behind — the same reading order
 * the cards above it use, and the person an admin most likely came to look at.
 *
 * `raw` is `string | string[] | undefined` because that is what Next hands
 * over: a repeated parameter arrives as an array, and taking the first entry
 * rather than refusing keeps `?employee=a&employee=b` from being an error page.
 */
export function resolveSelectedEmployee(
  raw: string | string[] | undefined,
  rows: readonly { userId: string }[],
): string | null {
  if (rows.length === 0) {
    return null;
  }

  const requested = Array.isArray(raw) ? raw[0] : raw;
  const match = rows.find((row) => row.userId === requested);

  return match ? match.userId : (rows[0]?.userId ?? null);
}
