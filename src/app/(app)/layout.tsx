import { AppHeader } from "@/components/layout/app-header";
import { MobileTabBar } from "@/components/layout/mobile-tab-bar";
import { getCurrentMember } from "@/lib/actions/companies";

/**
 * Shell for every authenticated route. A route group keeps the URLs flat
 * (`/dashboard`, not `/app/dashboard`), so the middleware path table in
 * `src/lib/supabase/middleware.ts` is unaffected by anything added here.
 *
 * This layout renders chrome only. The gate on these routes is middleware
 * (§8.3) plus RLS — a layout that "checks" auth would be a second, weaker
 * copy of that rule.
 *
 * It does read the caller's role, and that is not a gate: it decides which
 * destinations `navLinksFor()` renders (§4.2.2), nothing more. Read once here
 * rather than in each piece of chrome, so the header row and the tab bar
 * cannot disagree about what is in the nav. A failed read yields null, which
 * `navLinksFor` treats as an employee.
 *
 * Two pieces of chrome, one per pointer: the header carries the destinations on
 * a desktop, the tab bar carries them on a phone. `main` reserves the bar's
 * height plus the home-indicator inset below `md` so the last row of a list is
 * scrollable into view rather than sitting under fixed navigation.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const memberResult = await getCurrentMember();
  const role = memberResult.ok ? (memberResult.data?.role ?? null) : null;

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <AppHeader role={role} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-6 pb-[calc(var(--mobile-tab-bar-height)+env(safe-area-inset-bottom)+1.5rem)] md:pt-8 md:pb-8">
        {children}
      </main>
      <MobileTabBar role={role} />
    </div>
  );
}
