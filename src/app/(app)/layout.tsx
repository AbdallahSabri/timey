import { AppHeader } from "@/components/layout/app-header";
import { MobileTabBar } from "@/components/layout/mobile-tab-bar";

/**
 * Shell for every authenticated route. A route group keeps the URLs flat
 * (`/dashboard`, not `/app/dashboard`), so the middleware path table in
 * `src/lib/supabase/middleware.ts` is unaffected by anything added here.
 *
 * This layout renders chrome only. The gate on these routes is middleware
 * (§8.3) plus RLS — a layout that "checks" auth would be a second, weaker
 * copy of that rule.
 *
 * Two pieces of chrome, one per pointer: the header carries the destinations on
 * a desktop, the tab bar carries them on a phone. `main` reserves the bar's
 * height plus the home-indicator inset below `md` so the last row of a list is
 * scrollable into view rather than sitting under fixed navigation.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <AppHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-6 pb-[calc(var(--mobile-tab-bar-height)+env(safe-area-inset-bottom)+1.5rem)] md:pt-8 md:pb-8">
        {children}
      </main>
      <MobileTabBar />
    </div>
  );
}
