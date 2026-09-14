import Link from "next/link";

import type { AttendanceRow } from "@/components/dashboard/attendance-rows";
import { overviewHref } from "@/components/dashboard/overview-params";
import { UNKNOWN_PERSON } from "@/components/reports/report-rows";
import { cn } from "@/lib/utils";

/**
 * One employee's shape of week, picked from a row of tabs (`SPEC.md` §9.9.8).
 *
 * The cards above answer "who is behind"; this answers "behind *how*" — five
 * short days or one missing week produce the same month figure and the same
 * percentage, and only the daily shape tells them apart. The company-wide chart
 * further down cannot, because eleven people's days sum into one bar.
 *
 * **Links, not Radix Tabs, and the precedent is explicit.**
 * `report-view-tabs.tsx` argues the case for the same kind of control: each tab
 * here is a different query the server answers, so a Tabs component would own
 * panels whose contents do not exist until they are fetched. Rendering them as
 * links means the browser's back button, a middle-click and a bookmark all mean
 * what they look like they mean, and the panel is server-rendered like every
 * other card on the page. It also keeps `tabs` off the dependency
 * list — and this is the **third** control to arrive there. `ReportViewTabs`
 * declined it for §9's two views, and `/corrections` declined it for the very
 * need §12.3's table lists `tabs` against ("Admin queue vs. own corrections"),
 * on reasoning of its own. A primitive that three separate surfaces have each
 * decided against is one the product does not need.
 *
 * That choice is why there is no `role="tab"` or `role="tabpanel"` here and must
 * not be added: those roles promise a widget that swaps panels in place without
 * navigating, and a screen-reader user who activated one would find the page had
 * moved instead. A labelled `nav` of links with `aria-current` describes what
 * actually happens, and is what `ReportViewTabs` does.
 *
 * The row scrolls rather than wrapping or truncating. A company with forty
 * people gets forty tabs, which is unwieldy but complete — and the same choice
 * the employee grid above makes, for the same reason: this page shows everyone.
 */
export function EmployeeDayTabs({
  rows,
  selectedUserId,
  children,
}: {
  /** Already ordered — `/overview` passes them furthest-behind-first. */
  rows: AttendanceRow[];
  /** `null` only when there is nobody to select. */
  selectedUserId: string | null;
  /** The selected employee's panel. The page owns the chart; this owns the frame. */
  children: React.ReactNode;
}) {
  const selected = rows.find((row) => row.userId === selectedUserId);

  // **Nothing at all when the selection is not one of these rows.** The prop
  // type permits an id from anywhere, and the alternative render is a tab row
  // with nothing marked current above a panel headed "Unknown person" — which
  // is the string a *legitimately* unreadable name produces, so the two causes
  // would be indistinguishable, and one of them is a stranger's panel by
  // another name (§9.9.8). `/overview` cannot reach this, because
  // `resolveSelectedEmployee` only ever returns an id from `rows`; the guard is
  // what keeps that a property of this component rather than of its caller.
  if (rows.length === 0 || selectedUserId === null || !selected) {
    return null;
  }

  const selectedName = selected.userName ?? UNKNOWN_PERSON;

  return (
    <div className="flex flex-col gap-4">
      <nav
        aria-label="Employee"
        className="bg-muted inline-flex max-w-full gap-0.5 overflow-x-auto rounded-lg p-0.5"
      >
        {rows.map((row) => {
          const active = row.userId === selectedUserId;
          const name = row.userName ?? UNKNOWN_PERSON;

          return (
            <Link
              key={row.userId}
              href={overviewHref(row.userId)}
              aria-current={active ? "page" : undefined}
              // The tab row sits far down the page; jumping to the top on every
              // click would lose the reader's place for a control whose whole
              // job is to swap one card in front of them.
              scroll={false}
              // Each of these re-renders the whole page, and a large company
              // puts dozens in the viewport at once. Prefetching them all on
              // scroll would cost a page render per employee to save a click
              // nobody has made.
              prefetch={false}
              className={cn(
                "shrink-0 rounded-md px-3 py-1.5 text-sm whitespace-nowrap transition-colors",
                active
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
                row.userName === null && "italic",
              )}
            >
              {name}
            </Link>
          );
        })}
      </nav>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">{selectedName}</h3>
        {children}
      </div>
    </div>
  );
}
