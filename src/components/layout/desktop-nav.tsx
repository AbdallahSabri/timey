"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { isActivePath, NAV_LINKS } from "@/components/layout/nav";
import { cn } from "@/lib/utils";

/**
 * The inline nav row, `md` and up. Hidden below that, where `MobileTabBar`
 * takes over — the six links do not fit a phone's header at any font size worth
 * reading.
 *
 * A client component only because the current page is a client-side fact:
 * `usePathname()` is what marks the active link, and until now nothing in the
 * app told you where you were. `AppHeader` stays a server component around it.
 */
export function DesktopNav() {
  const pathname = usePathname();

  return (
    <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
      {NAV_LINKS.map((link) => {
        const active = isActivePath(pathname, link.href);

        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "focus-visible:ring-ring/50 rounded-md px-2.5 py-1.5 text-sm transition-colors outline-none focus-visible:ring-3",
              active
                ? "bg-accent text-accent-foreground font-medium"
                : "text-muted-foreground hover:text-foreground hover:bg-muted",
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
