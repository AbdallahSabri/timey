import Link from "next/link";

/**
 * §3.11 — archived rows stay readable, they are just not the default view.
 *
 * The toggle is a link rather than a checkbox on purpose: the list is rendered
 * on the server, so flipping it is a navigation, and a URL that says which view
 * you are looking at survives a reload and can be handed to someone else.
 *
 * There is no restore control anywhere in this feature, and that is deliberate:
 * archiving frees the name under the partial unique indexes (§3.3, §3.5), so
 * un-archiving can collide with a name created since. No action offers it.
 */
export function ArchivedToggle({
  showArchived,
  basePath,
  subject,
}: {
  showArchived: boolean;
  basePath: string;
  subject: string;
}) {
  return (
    <Link
      href={showArchived ? basePath : `${basePath}?archived=1`}
      className="text-muted-foreground hover:text-foreground text-sm underline underline-offset-4 transition-colors"
    >
      {showArchived ? `Hide archived ${subject}` : `Show archived ${subject}`}
    </Link>
  );
}
