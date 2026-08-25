import Link from "next/link";

import { SignOutButton } from "@/components/auth/sign-out-button";

/**
 * The authenticated shell's one piece of chrome. Nav links land here as later
 * phases add routes — and a link is presentation, never a permission: what an
 * account may reach is decided by middleware and RLS, not by what is rendered.
 * `/members` is listed for everyone because everyone may read the member list
 * (§4.2); only the controls on that page are admin-gated, and by the database.
 */
const NAV_LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/members", label: "Team" },
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
