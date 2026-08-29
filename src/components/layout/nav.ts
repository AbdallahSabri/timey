import {
  ClockIcon,
  FoldersIcon,
  BuildingIcon,
  UsersIcon,
  FileClockIcon,
  ChartNoAxesColumnIcon,
  type LucideIcon,
} from "lucide-react";

import type { MemberRole } from "@/lib/validations/members";

/**
 * The authenticated shell's destinations, in one place because two pieces of
 * chrome render them — the header row on a desktop and the tab bar on a phone —
 * and a link that exists in one but not the other is a bug. Both must go
 * through `navLinksFor()`; neither may filter `NAV_LINKS` itself.
 *
 * **`adminOnly` hides a destination; it does not protect one** (§4.2.2). The
 * data behind all three flagged routes stays company-readable, and on purpose:
 * `clients` supplies the client label on an employee's own projects list
 * (`lib/actions/projects.ts`), `profiles` names people across reports and
 * corrections, and `projects` fills the picker the timer and the manual-entry
 * form both depend on. Narrowing any of those policies to admin would break a
 * screen an employee is entitled to, so none of them was narrowed. What this
 * flag buys is a shorter nav and three fewer admin surfaces on an employee's
 * screen — the enforcement is `middleware.ts` plus each page's own check, and
 * underneath both, RLS.
 *
 * So the earlier reading of this file — that withholding a link protects
 * nothing, therefore every link is shown to everyone — was right about the
 * protection and wrong about the conclusion. A link to a page whose every
 * control refuses you is not neutral; it is an invitation to a dead end.
 *
 * The three that stay unflagged are the three an employee actually works in:
 *
 * `/dashboard` is the timer. `/corrections` is genuinely for everyone — an
 * employee's own requests and their outcomes live there (§7.4), and the review
 * queue above them renders only for an admin, because `is_admin()` decides who
 * may approve anything. `/reports` is the clearest case: the route is identical
 * for both roles and the *data* differs, because `time_entries` SELECT gives an
 * admin the company and an employee themselves (§9.2).
 *
 * `primary` splits the phone's four tab slots from the overflow menu behind
 * "More". That is a question of how often a thumb reaches for something, and
 * nothing else. Note that an employee's overflow comes out empty — both
 * non-primary links are admin-only — but "More" still renders for them,
 * because it also holds the phone's only sign-out.
 */
export type NavLinkSpec = {
  href: string;
  label: string;
  /** Rendered for an admin only. A shorter nav, never a permission — see above. */
  adminOnly?: boolean;
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
  {
    href: "/projects",
    label: "Projects",
    icon: FoldersIcon,
    primary: true,
    adminOnly: true,
  },
  {
    href: "/clients",
    label: "Clients",
    icon: BuildingIcon,
    primary: false,
    adminOnly: true,
  },
  {
    href: "/members",
    label: "Team",
    icon: UsersIcon,
    primary: false,
    adminOnly: true,
  },
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
 * The destinations one role may see. The only sanctioned way to read
 * `NAV_LINKS` from a component.
 *
 * `role` is nullable because the layout reads it from `getCurrentMember()`,
 * which reports null for a signed-out or not-yet-provisioned account. Anything
 * that is not exactly `"admin"` is treated as an employee, so an unreadable
 * role hides the admin links rather than revealing them — the same
 * fail-closed reading `middleware.ts` takes on the same column.
 */
export function navLinksFor(role: MemberRole | null): NavLinkSpec[] {
  if (role === "admin") {
    return NAV_LINKS;
  }
  return NAV_LINKS.filter((link) => !link.adminOnly);
}

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
