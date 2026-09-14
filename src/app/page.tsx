import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * §8.5. Query-string leftovers of an auth link that could not be completed
 * here, and the reason this marketing page reads its query string at all.
 *
 * The Site URL is where GoTrue sends anyone whose link it handled itself
 * instead of handing to `/auth/confirm` or `/auth/reset` — which is what a
 * hosted project on the *default* email template does. It verifies the token
 * on its own `/auth/v1/verify` and redirects here carrying `code` (PKCE, which
 * is what `@supabase/ssr` uses) or `error_description` when even that failed.
 * Neither is something this app can act on.
 *
 * Until this existed, that landed on a homepage that looked entirely normal:
 * the reset silently did nothing, and the only signal was a query parameter no
 * page read. `BLOCKERS.md` D-21 is what that cost to diagnose.
 */
const AUTH_LINK_PARAMS = ["code", "error_description"] as const;

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  // **Reported, never exchanged.** Exchanging the code would mean guessing
  // whether it is a recovery or a signup confirmation — both are live on a
  // project that requires email confirmation, and nothing in the redirect says
  // which. Guessing wrong drops a new user on "Choose a new password", which is
  // the `/auth/confirm`-vs-`/auth/reset` conflation §8.5 carved two routes apart
  // to prevent. So this says the link did not work and offers a new one; it
  // does not try to rescue it.
  if (AUTH_LINK_PARAMS.some((param) => params[param])) {
    redirect("/forgot-password?error=auth_link_unusable");
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle>Timey</CardTitle>
          <CardDescription>
            Timey records how long people work, against what.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Button asChild>
            <Link href="/sign-up">Create an account</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/sign-in">Sign in</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
