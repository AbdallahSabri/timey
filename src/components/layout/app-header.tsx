import Link from "next/link";

import { SignOutButton } from "@/components/auth/sign-out-button";

/**
 * The authenticated shell's one piece of chrome. Nav links land here as later
 * phases add routes — and a link is presentation, never a permission: what an
 * account may reach is decided by middleware and RLS, not by what is rendered.
 */
export function AppHeader() {
  return (
    <header className="border-border bg-background sticky top-0 z-10 border-b">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-4">
        <Link href="/dashboard" className="text-sm font-semibold">
          Timey
        </Link>
        <SignOutButton />
      </div>
    </header>
  );
}
