"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { DateRangePicker } from "@/components/reports/date-range-picker";
import {
  REPORT_GROUPINGS,
  reportExportHref,
  reportHref,
  type ReportQuery,
} from "@/components/reports/report-params";
import { useFilterTasks } from "@/components/reports/use-filter-tasks";
import { nativeSelectClassName } from "@/components/structure/select-class";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import type { Client } from "@/lib/actions/clients";
import type { CompanyMember } from "@/lib/actions/companies";
import type { Project } from "@/lib/actions/projects";
import { cn } from "@/lib/utils";

type Option = { value: string; label: string };

/**
 * One `<select>`, with the archived-or-unreadable case handled.
 *
 * A filter can outlive its own option: `listClients()` and `listProjects()`
 * exclude archived rows from pickers (§3.11), and an employee can lose SELECT on
 * a project they are unassigned from (§3.6.1) while the URL still names it. The
 * control then has a value that is not among its options, which a browser
 * renders as *nothing selected* — a report visibly filtered by something the
 * form claims is not set. Naming the missing option is the honest rendering.
 */
function FilterSelect({
  id,
  label,
  value,
  placeholder,
  options,
  disabled,
  onChange,
  error,
}: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  options: Option[];
  disabled?: boolean;
  onChange: (value: string) => void;
  error?: string | null;
}) {
  const missing = value !== "" && !options.some((o) => o.value === value);

  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <select
        id={id}
        className={nativeSelectClassName}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{placeholder}</option>
        {missing ? <option value={value}>No longer available</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error ? <FieldError errors={[{ message: error }]} /> : null}
    </Field>
  );
}

/**
 * Date range, grouping, filters and the CSV link — everything that decides which
 * report is on screen.
 *
 * **All of it is URL state** (`report-params.ts` explains why), so this
 * component holds no copy of the answer: it navigates, the server re-runs the
 * query, and the export link is built from the same object the page was
 * rendered from. "Export what I'm looking at" is therefore not a promise this
 * component keeps — it is the same seven parameters pointed at a different
 * route.
 *
 * **The grouping selector is a row of links, not tabs.** Radix Tabs owns panels
 * it shows and hides on the client; here each view is a different query the
 * server answers, so the control that switches them is navigation. Links also
 * survive a middle-click and a bookmark, which is most of the point of putting
 * the state in the URL.
 *
 * **That grouping row is absent on the detail view**, because a grouping *is* a
 * `GROUP BY` and §9.7's entry list aggregates nothing — every row is one
 * `time_entries` row. Offering "by client" there would be a control with no
 * meaning to give it, and picking one would have to either do nothing or
 * silently throw the user back to the summary. Everything below it is shared:
 * the range and the four filters are the same `WHERE` clause in both shapes, so
 * they render identically and a filter set while grouping by project is still
 * set after switching to Detailed.
 *
 * **The person filter renders for an admin only** (§9.2: "admins may filter by
 * any user; employees are hard-scoped to themselves by RLS regardless of what
 * the UI sends"). That is not how the scoping is enforced — `getReport*`
 * replaces an employee's `userId` with their own before the query runs, and the
 * `time_entries` SELECT policy would return them nothing else anyway. It is
 * omitted because for an employee it is a control with exactly one possible
 * outcome, which is worse than no control at all.
 *
 * **The client filter renders for everyone, including employees**, and that is a
 * decision with a cost. `clients` SELECT is company-wide (§4.2), so an employee
 * can pick a client whose projects they are not (or are no longer) assigned to,
 * and get an empty report that reads as "you logged nothing for Acme" when the
 * truth is "you cannot see that any more". Hiding the filter would trade a
 * common, working case — "how much of my month went to Acme" — for an edge case,
 * and would not actually prevent anything, since the parameter still works from
 * the URL. It stays, and the empty state says what the emptiness might mean.
 */
export function ReportControls({
  query,
  today,
  isAdmin,
  members,
  clients,
  projects,
  canExport,
}: {
  query: ReportQuery;
  today: string;
  isAdmin: boolean;
  /** Empty for a non-admin: the person filter is not rendered for them. */
  members: CompanyMember[];
  clients: Client[];
  projects: Project[];
  /** False when the report failed or is empty — a CSV of nothing helps nobody. */
  canExport: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const taskState = useFilterTasks(query.projectId);

  function navigate(overrides: Partial<ReportQuery>) {
    // `replace`, not `push`: adjusting a filter is refining one question, and a
    // dozen history entries between two pages is not an undo anybody wants.
    startTransition(() => {
      router.replace(reportHref(query, overrides), { scroll: false });
    });
  }

  // Narrowing the project list to the chosen client keeps the two filters from
  // contradicting each other on screen. The server applies both independently,
  // so a mismatched pair is a legal query that returns nothing — this makes it
  // harder to build by accident.
  const visibleProjects = query.clientId
    ? projects.filter((project) => project.client?.id === query.clientId)
    : projects;

  const hasFilters = Boolean(
    query.userId || query.clientId || query.projectId || query.taskId,
  );

  return (
    <div className="flex flex-col gap-4" aria-busy={pending}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {query.view === "summary" ? (
          <nav
            aria-label="Group the report by"
            className="bg-muted inline-flex flex-wrap gap-0.5 rounded-lg p-0.5"
          >
            {REPORT_GROUPINGS.map((grouping) => {
              const active = grouping.value === query.grouping;

              return (
                <Link
                  key={grouping.value}
                  href={reportHref(query, { grouping: grouping.value })}
                  aria-current={active ? "page" : undefined}
                  scroll={false}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm transition-colors",
                    active
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {grouping.label}
                </Link>
              );
            })}
          </nav>
        ) : null}

        {/* `ml-auto` rather than relying on `justify-between`, which has nothing
            to push against once the grouping row is gone and would leave the
            date range hard against the left edge under the view switcher. */}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <DateRangePicker
            from={query.from}
            to={query.to}
            today={today}
            onSelect={(range) => navigate(range)}
          />
          {canExport ? (
            <Button asChild variant="outline">
              {/* A plain link: the route sets `Content-Disposition` with a real
                  filename, so the browser saves the file. Fetching it into a
                  Blob would throw that away and break middle-click. */}
              <a href={reportExportHref(query)} download>
                Export CSV
              </a>
            </Button>
          ) : (
            <Button variant="outline" disabled>
              Export CSV
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {isAdmin ? (
          <FilterSelect
            id="report-user"
            label="Person"
            value={query.userId}
            placeholder="Everyone"
            options={members.map((member) => ({
              value: member.id,
              // Deactivated members keep their recorded time (§2.3), so they
              // are legitimate subjects of a report over a past range — listed,
              // and marked so nobody wonders why they are here.
              label:
                member.status === "inactive"
                  ? `${member.fullName} (inactive)`
                  : member.fullName,
            }))}
            onChange={(value) => navigate({ userId: value })}
          />
        ) : null}

        <FilterSelect
          id="report-client"
          label="Client"
          value={query.clientId}
          placeholder="All clients"
          options={clients.map((client) => ({
            value: client.id,
            label: client.name,
          }))}
          onChange={(value) =>
            // A client change invalidates the project below it, and a project
            // change invalidates the task: keeping a stale child would filter by
            // a pair that cannot both be true.
            navigate({ clientId: value, projectId: "", taskId: "" })
          }
        />

        <FilterSelect
          id="report-project"
          label="Project"
          value={query.projectId}
          placeholder="All projects"
          options={visibleProjects.map((project) => ({
            value: project.id,
            label: project.client
              ? `${project.client.name} — ${project.name}`
              : project.name,
          }))}
          onChange={(value) => navigate({ projectId: value, taskId: "" })}
        />

        <FilterSelect
          id="report-task"
          label="Task"
          value={query.taskId}
          placeholder={
            query.projectId
              ? taskState.loading
                ? "Loading tasks…"
                : "All tasks"
              : "Pick a project first"
          }
          options={taskState.tasks.map((task) => ({
            value: task.id,
            label: task.name,
          }))}
          disabled={!query.projectId || taskState.loading}
          onChange={(value) => navigate({ taskId: value })}
          error={taskState.error}
        />
      </div>

      {hasFilters ? (
        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() =>
              navigate({
                userId: "",
                clientId: "",
                projectId: "",
                taskId: "",
              })
            }
          >
            Clear filters
          </Button>
        </div>
      ) : null}
    </div>
  );
}
