import Link from "next/link";

import { SignOutButton } from "@/components/auth/sign-out-button";

/**
 * The authenticated shell's one piece of chrome. Nav links land here as later
 * phases add routes — and a link is presentation, never a permission: what an
 * account may reach is decided by middleware and RLS, not by what is rendered.
 * `/members` is listed for everyone because everyone may read the member list
 * (§4.2); only the controls on that page are admin-gated, and by the database.
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
 */
const NAV_LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/projects", label: "Projects" },
  { href: "/clients", label: "Clients" },
  { href: "/members", label: "Team" },
  { href: "/corrections", label: "Corrections" },
  { href: "/reports", label: "Reports" },
];

export function AppHeader() {
  return (
    <header className="border-border bg-background sticky top-0 z-10 border-b">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-4">
        <div className="flex items-center gap-6">
          <Link href="/dashboard" className="text-sm font-semibold">
            Timey
          </Link>
          <nav className="flex items-center gap-4" aria-label="Main">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-muted-foreground hover:text-foreground text-sm transition-colors"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
        <SignOutButton />
      </div>
    </header>
  );
}
