"use client";

import { EllipsisIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { isActivePath, NAV_LINKS } from "@/components/layout/nav";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const PRIMARY = NAV_LINKS.filter((link) => link.primary);
const OVERFLOW = NAV_LINKS.filter((link) => !link.primary);

const TAB_CLASS =
  "flex flex-1 flex-col items-center justify-center gap-0.5 rounded-md px-1 text-[0.6875rem] leading-none transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * Bottom navigation, below `md` only.
 *
 * At the bottom rather than behind a hamburger because of what this app is: the
 * thing people open it to do is start or stop a timer, often one-handed and
 * often while walking away from a desk. A destination a thumb reaches without
 * re-gripping is worth more here than one extra visible label.
 *
 * Four slots plus an overflow menu, so a tab is wide enough to hit. The two
 * links behind "More" are still links, and `nav.ts` explains why that split is
 * about thumb reach and never about who may see what.
 *
 * `z-30` puts this under the `z-50` dialog layer, so a modal covers it rather
 * than leaving a strip of navigation floating over its overlay. The bottom
 * padding is the home-indicator inset, which resolves only because the root
 * layout sets `viewportFit: "cover"`.
 */
export function MobileTabBar() {
  const pathname = usePathname();
  const overflowActive = OVERFLOW.some((link) =>
    isActivePath(pathname, link.href),
  );

  return (
    <nav
      aria-label="Main"
      className="border-border bg-background/95 supports-backdrop-filter:bg-background/80 fixed inset-x-0 bottom-0 z-30 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <div className="flex h-(--mobile-tab-bar-height) items-stretch gap-0.5 px-1">
        {PRIMARY.map((link) => {
          const active = isActivePath(pathname, link.href);
          const Icon = link.icon;

          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                TAB_CLASS,
                active
                  ? "text-primary font-medium"
                  : "text-muted-foreground active:bg-muted",
              )}
            >
              <Icon className="size-5" aria-hidden />
              {link.shortLabel ?? link.label}
            </Link>
          );
        })}

        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(
              TAB_CLASS,
              overflowActive
                ? "text-primary font-medium"
                : "text-muted-foreground active:bg-muted",
            )}
          >
            <EllipsisIcon className="size-5" aria-hidden />
            More
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="mb-1 min-w-44">
            {OVERFLOW.map((link) => {
              const Icon = link.icon;

              return (
                <DropdownMenuItem key={link.href} asChild>
                  <Link href={link.href}>
                    <Icon aria-hidden />
                    {link.label}
                  </Link>
                </DropdownMenuItem>
              );
            })}
            <DropdownMenuSeparator />
            {/* The header's sign-out is `md`-only, so this is the phone's only
                way out of the session — it cannot be dropped from the menu. */}
            <SignOutButton
              variant="ghost"
              size="sm"
              className="w-full justify-start"
            />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </nav>
  );
}
