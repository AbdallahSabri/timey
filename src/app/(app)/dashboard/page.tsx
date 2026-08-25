import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getCurrentMember } from "@/lib/actions/companies";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dashboard · Timey",
};

/**
 * One `getCurrentMember()` read rather than a `profiles` query written here
 * (`BLOCKERS.md` N-4): the members page and every later admin-gated view ask
 * the same question, and a copy of the query in each of them drifts.
 * Middleware (§8.3) has already established that a user with a company is the
 * only caller who gets here, and RLS scopes the row regardless.
 */
export default async function DashboardPage() {
  const result = await getCurrentMember();
  const member = result.ok ? result.data : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">
          {member?.company?.name ?? "Your company"}
        </h1>
        <p className="text-muted-foreground text-sm">
          {member
            ? `Signed in as ${member.fullName} · ${member.role}`
            : "Signed in."}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Nothing to track yet</CardTitle>
          <CardDescription>
            Timers, projects, and reports arrive in later phases.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          {member?.company?.timezone ? (
            <p>
              Days and weeks are counted in{" "}
              <span className="text-foreground font-medium">
                {member.company.timezone}
              </span>
              .
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
