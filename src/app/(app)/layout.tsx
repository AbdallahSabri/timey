import { AppHeader } from "@/components/layout/app-header";

/**
 * Shell for every authenticated route. A route group keeps the URLs flat
 * (`/dashboard`, not `/app/dashboard`), so the middleware path table in
 * `src/lib/supabase/middleware.ts` is unaffected by anything added here.
 *
 * This layout renders chrome only. The gate on these routes is middleware
 * (§8.3) plus RLS — a layout that "checks" auth would be a second, weaker
 * copy of that rule.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <AppHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        {children}
      </main>
    </div>
  );
}
