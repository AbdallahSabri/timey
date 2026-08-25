import { CorrectionQueue } from "@/components/corrections/correction-queue";
import { MyCorrectionsList } from "@/components/corrections/my-corrections-list";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getCurrentMember } from "@/lib/actions/companies";
import {
  listMyCorrectionRequests,
  listPendingCorrectionRequests,
} from "@/lib/actions/corrections";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Corrections · Timey",
};

/**
 * §7.4's lifecycle, from both ends, on one route.
 *
 * Two sections rather than two pages, and rather than the tabs `PLAN.md`
 * sketched: an admin is also an employee here — they file requests of their own,
 * and cannot approve them (§7.4) — so "the queue" and "mine" are not two modes
 * of one list but two different lists that a single person reads together.
 * Tabs would hide one behind the other and cost a primitive to do it.
 *
 * **The queue is fetched only for an admin, and that is a saved round trip, not
 * a permission.** `listPendingCorrectionRequests()` is not role-gated — an
 * employee calling it gets their own pending requests, because
 * `correction_requests_select_own_or_admin` is what scopes it, and those are
 * already on this page under "Your requests". RLS decides what comes back; this
 * decides whether asking is worth it. Reaching `/corrections` as an employee is
 * neither prevented nor interesting: everything on it is theirs.
 */
export default async function CorrectionsPage() {
  const [memberResult, mineResult] = await Promise.all([
    getCurrentMember(),
    listMyCorrectionRequests(),
  ]);

  const member = memberResult.ok ? memberResult.data : null;
  const timezone = member?.company?.timezone ?? null;
  const isAdmin = member?.role === "admin" && member.status === "active";

  const queueResult = isAdmin ? await listPendingCorrectionRequests() : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Corrections</h1>
        <p className="text-muted-foreground text-sm">
          A closed entry is never edited in place by the person who logged it —
          it is proposed, reviewed, and then applied with its previous values
          kept.
        </p>
      </div>

      {isAdmin ? (
        <Card>
          <CardHeader>
            <CardTitle>Waiting for review</CardTitle>
            <CardDescription>
              Approving applies the change to the entry and records what it
              replaced. Rejecting needs a note and is final
              {timezone ? `. Times are shown in ${timezone}` : ""}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {queueResult?.ok ? (
              <CorrectionQueue
                requests={queueResult.data}
                timezone={timezone}
                currentUserId={member?.id ?? null}
              />
            ) : (
              <p className="text-destructive text-sm">
                {queueResult?.error ?? "Could not load the correction queue."}
              </p>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Your requests</CardTitle>
          <CardDescription>
            Everything you&rsquo;ve asked for, and what came of it. A pending
            one can be withdrawn; a decided one stays here as the record of what
            happened.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {mineResult.ok ? (
            <MyCorrectionsList requests={mineResult.data} timezone={timezone} />
          ) : (
            <p className="text-destructive text-sm">{mineResult.error}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
