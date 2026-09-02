import Link from "next/link";

import {
  reportHref,
  type ReportQuery,
} from "@/components/reports/report-params";
import { Button } from "@/components/ui/button";

/**
 * Previous / next through §9.7's entry list, with the range being shown.
 *
 * **Hand-written rather than a shadcn primitive**, because the primitive would
 * be the wrong shape here. This is not a numbered pager: a range can hold
 * thousands of entries, so a strip of page numbers would either be truncated
 * into ellipses nobody clicks or be a row of forty links, and neither answers
 * the question the control exists for — "is there more, and how much of it have
 * I seen". Two links and a count do, in three elements.
 *
 * **The page lives in the URL like every other report parameter**
 * (`report-params.ts` explains why), so this holds no state and fires no
 * events: it renders two hrefs the server will answer. That is also why the
 * ends are `disabled` buttons and not links — an anchor cannot be disabled, and
 * a link to page 0 is a URL that would silently be read as page 1, offering to
 * do nothing while looking like it does something. The Export CSV button uses
 * the same substitution for the same reason.
 *
 * The totals come from the action, not from counting rows on screen: the last
 * page is short by definition, and `Showing 301–312 of 312` is only true if the
 * denominator is the server's `COUNT`.
 */
export function ReportPagination({
  query,
  page,
  perPage,
  totalCount,
}: {
  query: ReportQuery;
  page: number;
  perPage: number;
  /** The whole matching set, not this page — the server's count over the range. */
  totalCount: number;
}) {
  // One page is not a pagination, and rendering "Showing 1–12 of 12" beside two
  // dead buttons is noise on every report short enough to read in one screen.
  if (totalCount <= perPage) {
    return null;
  }

  const lastPage = Math.ceil(totalCount / perPage);
  const first = (page - 1) * perPage + 1;
  // Clamped because the final page is short: 312 items at 50 a page ends at
  // 312, not at the 350 the arithmetic alone would claim.
  const last = Math.min(page * perPage, totalCount);

  return (
    <nav
      aria-label="Report pages"
      className="flex flex-wrap items-center justify-between gap-3"
    >
      {/* Announced on navigation: the buttons keep their labels, so without a
          live region the only thing that changed for a screen reader user is
          content they have to go hunting for. */}
      <p className="text-muted-foreground text-sm" aria-live="polite">
        Showing{" "}
        <span className="font-mono tabular-nums">
          {first}–{last}
        </span>{" "}
        of <span className="font-mono tabular-nums">{totalCount}</span>
      </p>

      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Button asChild variant="outline" size="sm">
            <Link href={reportHref(query, { page: page - 1 })} scroll={false}>
              Previous
            </Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            Previous
          </Button>
        )}

        {page < lastPage ? (
          <Button asChild variant="outline" size="sm">
            <Link href={reportHref(query, { page: page + 1 })} scroll={false}>
              Next
            </Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            Next
          </Button>
        )}
      </div>
    </nav>
  );
}
