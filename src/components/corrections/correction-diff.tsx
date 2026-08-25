import { formatStartedAt } from "@/components/time-entries/format-entry";
import type { CorrectionRequestWithContext } from "@/lib/actions/corrections";
import { cn } from "@/lib/utils";

/**
 * What the entry is now, beside what the request proposes it should be.
 *
 * This is the review UI's actual content: §7.4 has an admin decide whether to
 * apply a change, and a decision needs both halves. A list of proposed values
 * alone reads as a form somebody filled in; the pair reads as a change.
 *
 * **"unchanged" and "—" are different answers and are kept apart.** A blank
 * proposed column means the request does not touch that field (the `proposed_*`
 * NULL convention — "leave this alone, never set it to NULL"), while "—" means
 * the value is genuinely absent or unreadable: an employee removed from a
 * project keeps their entries but loses SELECT on the project row (§2.3), so a
 * name legitimately arrives null.
 *
 * The "now" column is empty for `kind='create'` — there is no entry yet — and
 * for a request whose entry has since been deleted, which is §7.4's
 * auto-withdraw case rather than an error. The caller is told which of the two
 * it is looking at by the sentence below the grid.
 */
type DiffRow = {
  label: string;
  before: string | null;
  after: string | null;
};

const UNREADABLE = "—";

function diffRows(
  request: CorrectionRequestWithContext,
  timezone: string | null,
): DiffRow[] {
  const entry = request.entry;

  const instant = (value: string | null): string | null =>
    value ? formatStartedAt(value, timezone) : null;

  const rows: DiffRow[] = [
    {
      label: "Start",
      before: entry ? formatStartedAt(entry.startedAt, timezone) : null,
      after: instant(request.proposedStartedAt),
    },
    {
      label: "End",
      before: entry
        ? // §5.1: a null `ended_at` *is* the running state, and an amend
          // proposing only an end time is §5.4's stale-timer remedy — the one
          // case where a correction touches a row still being measured.
          (instant(entry.endedAt) ?? "Still running")
        : null,
      after: instant(request.proposedEndedAt),
    },
    {
      label: "Project",
      before: entry ? (entry.project?.name ?? UNREADABLE) : null,
      after: request.proposedProjectId
        ? (request.proposedProject?.name ?? UNREADABLE)
        : null,
    },
    {
      label: "Task",
      before: entry ? (entry.task?.name ?? UNREADABLE) : null,
      after: request.proposedTaskId
        ? (request.proposedTask?.name ?? UNREADABLE)
        : null,
    },
    {
      label: "Note",
      before: entry ? (entry.note ?? UNREADABLE) : null,
      after: request.proposedNote,
    },
  ];

  return rows.filter((row) => row.before !== null || row.after !== null);
}

export function CorrectionDiff({
  request,
  timezone,
}: {
  request: CorrectionRequestWithContext;
  timezone: string | null;
}) {
  const rows = diffRows(request, timezone);
  const showsBefore = request.kind !== "create" && request.entry !== null;
  const showsAfter = request.kind !== "delete";

  return (
    <div className="flex flex-col gap-2">
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Nothing left to show — the entry this request refers to is gone.
        </p>
      ) : (
        <div className="border-border overflow-hidden rounded-md border">
          <div className="divide-border divide-y">
            {/* Column headings only mean anything once there are columns, so
                they are held back until `sm`. Below that the pair is read
                inline as `now → proposed` instead — two timestamps squeezed
                into ~100px each are damage, not a comparison, and an arrow says
                which way the change runs without repeating either heading. */}
            {showsBefore && showsAfter ? (
              <div className="text-muted-foreground bg-muted/50 hidden gap-2 px-3 py-1.5 text-xs font-medium sm:grid sm:grid-cols-[6rem_1fr_1fr]">
                <span>
                  <span className="sr-only">Field</span>
                </span>
                <span>Now</span>
                <span>Proposed</span>
              </div>
            ) : null}

            {rows.map((row) => (
              <div
                key={row.label}
                className={cn(
                  "grid gap-x-2 gap-y-0.5 px-3 py-1.5 text-sm sm:items-baseline sm:gap-2",
                  showsBefore && showsAfter
                    ? "sm:grid-cols-[6rem_1fr_1fr]"
                    : "grid-cols-[6rem_1fr] items-baseline",
                )}
              >
                <span className="text-muted-foreground text-xs">
                  {row.label}
                </span>
                {/* `sm:contents` dissolves this wrapper at the breakpoint, so
                    the two values become grid cells again and land back under
                    their own headings. */}
                <div className="flex flex-wrap items-baseline gap-x-1.5 sm:contents">
                  {showsBefore ? (
                    <span className="break-words">
                      {row.before ?? UNREADABLE}
                    </span>
                  ) : null}
                  {showsBefore && showsAfter ? (
                    <span
                      className="text-muted-foreground sm:hidden"
                      aria-hidden
                    >
                      →
                    </span>
                  ) : null}
                  {showsAfter ? (
                    <span
                      className={cn(
                        "break-words",
                        row.after === null
                          ? "text-muted-foreground"
                          : "font-medium",
                      )}
                    >
                      {row.after === null ? "unchanged" : row.after}
                    </span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {request.kind !== "create" && request.entry === null ? (
        <p className="text-muted-foreground text-sm">
          The entry this request refers to no longer exists.
        </p>
      ) : null}
    </div>
  );
}
