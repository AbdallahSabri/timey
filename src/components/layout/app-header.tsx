import Link from "next/link";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { DesktopNav } from "@/components/layout/desktop-nav";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import type { MemberRole } from "@/lib/validations/members";

/**
 * The authenticated shell's top chrome.
 *
 * The destination list itself lives in `nav.ts`, shared with `MobileTabBar` —
 * see the note there on which destinations an employee sees, and on why
 * hiding one shortens the nav without protecting anything.
 *
 * Below `md` this keeps only identity and the two account-level controls; the
 * destinations move to the tab bar at the bottom of the screen, where a thumb
 * can reach them.
 */
export function AppHeader({ role }: { role: MemberRole | null }) {
  return (
    <header className="border-border bg-background/80 supports-backdrop-filter:bg-background/60 sticky top-0 z-30 border-b backdrop-blur-sm">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-4">
        <div className="flex items-center gap-6">
          <Link
            href="/dashboard"
            className="focus-visible:ring-ring/50 rounded-md text-sm font-semibold tracking-tight outline-none focus-visible:ring-3"
          >
            Timey
          </Link>
          <DesktopNav role={role} />
        </div>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <SignOutButton className="hidden md:inline-flex" />
        </div>
      </div>
    </header>
  );
}
