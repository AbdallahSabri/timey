import {
  ClockIcon,
  FoldersIcon,
  BuildingIcon,
  UsersIcon,
  FileClockIcon,
  ChartNoAxesColumnIcon,
  type LucideIcon,
} from "lucide-react";

/**
 * The authenticated shell's destinations, in one place because two pieces of
 * chrome now render them — the header row on a desktop and the tab bar on a
 * phone — and a link that exists in one but not the other is a bug.
 *
 * A link is presentation, never a permission: what an account may reach is
 * decided by middleware and RLS, not by what is rendered. `/members` is listed
 * for everyone because everyone may read the member list (§4.2); only the
 * controls on that page are admin-gated, and by the database.
 *
 * `/projects` and `/clients` are listed for everyone for the same reason, and
 * they answer differently per account rather than being hidden: `listProjects()`
 * returns only assigned projects to an employee (§3.6.1) and clients are
 * company-wide readable (§4.2). Omitting a link would not protect either one.
 *
 * `/corrections` is listed for everyone and is genuinely for everyone: an
 * employee's own requests and their outcomes live there (§7.4), and the review
 * queue above them renders only for an admin — because `is_admin()` decides who
 * may approve anything, not because the link was withheld. An employee who
 * types the URL sees their own list, which is what RLS returns them.
 *
 * `/reports` follows the same rule and is the clearest case of it: the route is
 * identical for both roles and the *data* differs, because `time_entries` SELECT
 * gives an admin the company and an employee themselves (§9.2). Withholding the
 * link would hide a page an employee is entitled to and would protect nothing.
 *
 * `primary` splits the phone's four tab slots from the overflow menu behind
 * "More". That is a question of how often a thumb reaches for something, and
 * nothing else — every destination stays one or two taps away in both layouts,
 * because burying a link is not access control either.
 */
export type NavLinkSpec = {
  href: string;
  label: string;
  /** The tab bar's shorter word, where one reads better in a 25%-wide slot. */
  shortLabel?: string;
  icon: LucideIcon;
  primary: boolean;
};

export const NAV_LINKS: NavLinkSpec[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    shortLabel: "Timer",
    icon: ClockIcon,
    primary: true,
  },
  { href: "/projects", label: "Projects", icon: FoldersIcon, primary: true },
  { href: "/clients", label: "Clients", icon: BuildingIcon, primary: false },
  { href: "/members", label: "Team", icon: UsersIcon, primary: false },
  {
    href: "/corrections",
    label: "Corrections",
    shortLabel: "Fixes",
    icon: FileClockIcon,
    primary: true,
  },
  {
    href: "/reports",
    label: "Reports",
    icon: ChartNoAxesColumnIcon,
    primary: true,
  },
];

/**
 * Whether a nav link should read as the current page.
 *
 * Prefix-matched so `/projects/{id}` still lights `/projects`, but only on a
 * segment boundary — a plain `startsWith` would light `/projects` on a future
 * `/projects-archive` too.
 */
export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
