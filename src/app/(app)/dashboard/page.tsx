import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dashboard · Timey",
};

/**
 * Read-only display data for the signed-in member. Middleware (§8.3) has
 * already established that a user with a company is the only caller who gets
 * here, and RLS scopes the rows regardless of what this query asks for.
 */
async function getMember() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const { data } = await supabase
    .from("profiles")
    .select("full_name, role, companies (name, timezone)")
    .eq("id", user.id)
    .maybeSingle();

  return data;
}

export default async function DashboardPage() {
  const member = await getMember();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">
          {member?.companies?.name ?? "Your company"}
        </h1>
        <p className="text-muted-foreground text-sm">
          {member
            ? `Signed in as ${member.full_name} · ${member.role}`
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
          {member?.companies?.timezone ? (
            <p>
              Days and weeks are counted in{" "}
              <span className="text-foreground font-medium">
                {member.companies.timezone}
              </span>
              .
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
