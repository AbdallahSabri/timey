import { cn } from "@/lib/utils";

/**
 * The phone-shaped form of a list row.
 *
 * Every list in this app is a table, and a table is the right shape for a
 * pointer: it aligns columns so a value can be compared down a page. On a phone
 * none of that survives — a seven-column row becomes a horizontal scrub, and a
 * value you have to scroll sideways to reach may as well not be rendered. So
 * below `md` a row is restated as a card: the thing it is about on top, its
 * fields labelled underneath.
 *
 * This lives in the feature layer, not `components/ui`, because it is a
 * composition of primitives rather than a primitive — and it is shared so that
 * seven lists do not each invent their own answer to the same problem.
 *
 * Values render through `dd`/`dt`, so the label is programmatically tied to the
 * value it labels rather than merely sitting next to it.
 */
export type DataCardField = {
  label: string;
  value: React.ReactNode;
  /** Sets the value in the mono/tabular face — durations, times, counts. */
  numeric?: boolean;
};

export function DataCardList({
  children,
  className,
  ...props
}: React.ComponentProps<"ul">) {
  return (
    <ul className={cn("flex flex-col gap-2", className)} {...props}>
      {children}
    </ul>
  );
}

export function DataCard({
  title,
  meta,
  action,
  fields,
  muted = false,
  className,
}: {
  /** What the row is about — the name, the person, the project. */
  title: React.ReactNode;
  /** Badges or a secondary line under the title. */
  meta?: React.ReactNode;
  /** The row's menu or button, pinned top-right. */
  action?: React.ReactNode;
  fields: DataCardField[];
  /** Archived, deactivated, or otherwise no longer live. */
  muted?: boolean;
  className?: string;
}) {
  return (
    <li
      className={cn(
        "bg-card text-card-foreground ring-foreground/10 flex flex-col gap-3 rounded-xl p-3 text-sm ring-1",
        muted && "text-muted-foreground",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <span
            className={cn("font-medium break-words", muted && "font-normal")}
          >
            {title}
          </span>
          {meta ? (
            <span className="flex flex-wrap items-center gap-1.5">{meta}</span>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>

      {fields.length > 0 ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
          {fields.map((field) => (
            <div key={field.label} className="contents">
              <dt className="text-muted-foreground text-xs">{field.label}</dt>
              <dd
                className={cn(
                  "text-right break-words",
                  field.numeric && "font-mono tabular-nums",
                )}
              >
                {field.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </li>
  );
}
