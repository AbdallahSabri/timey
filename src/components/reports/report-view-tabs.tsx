import Link from "next/link";

import {
  reportHref,
  type ReportQuery,
} from "@/components/reports/report-params";
import { cn } from "@/lib/utils";
import type { ReportView } from "@/lib/validations/reports";

/** The two §9 shapes, in the order the switcher offers them. */
const REPORT_VIEWS: { value: ReportView; label: string }[] = [
  { value: "summary", label: "Summary" },
  { value: "detail", label: "Detailed" },
];

/**
 * Summary ↔ Detailed — the top-level choice between §9.3's grouped totals and
 * §9.7's entry list.
 *
 * **Links, not Radix Tabs**, for the reason `report-controls.tsx` gives about
 * the grouping row: Radix Tabs owns panels it shows and hides on the client,
 * and each of these is a different query the server answers. The argument is
 * stronger here than it is there. The two views do not share a row shape, a
 * column set, or even a row count — the detail view is paginated and includes a
 * running entry, which no aggregate does — so a Tabs component would be holding
 * one panel of markup that does not exist yet and cannot be fetched without a
 * navigation anyway. Rendering the pair as links means the browser's back
 * button, a middle-click, and a bookmark all mean what they look like they mean.
 *
 * Styled to match the grouping nav below it deliberately: they are the same
 * kind of control — pick one of a closed set, reload — and looking alike is the
 * only thing that says so.
 *
 * Not a client component. It computes hrefs from props and renders anchors;
 * `useRouter` is only in `ReportControls` because the filters there fire on
 * `onChange` and want a transition around the reload.
 */
export function ReportViewTabs({ query }: { query: ReportQuery }) {
  return (
    <nav
      aria-label="Report view"
      className="bg-muted inline-flex flex-wrap gap-0.5 rounded-lg p-0.5"
    >
      {REPORT_VIEWS.map((view) => {
        const active = view.value === query.view;

        return (
          <Link
            key={view.value}
            // `reportHref` drops the page on any override that is not `page`
            // itself, so switching views cannot carry page 7 of the entry list
            // into a summary that has no pages — and coming back starts at the
            // first page rather than wherever the last visit ended.
            href={reportHref(query, { view: view.value })}
            aria-current={active ? "page" : undefined}
            scroll={false}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm transition-colors",
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {view.label}
          </Link>
        );
      })}
    </nav>
  );
}
