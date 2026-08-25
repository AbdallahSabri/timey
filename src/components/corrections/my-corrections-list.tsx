"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { CorrectionDiff } from "@/components/corrections/correction-diff";
import {
  CorrectionStatusBadge,
  KIND_LABEL,
} from "@/components/corrections/correction-labels";
import { formatStartedAt } from "@/components/time-entries/format-entry";
import { Button } from "@/components/ui/button";
import {
  withdrawCorrection,
  type CorrectionRequestWithContext,
} from "@/lib/actions/corrections";

/**
 * The requester's half of §7.4: what I asked for, what happened to it, and why.
 *
 * Every status is listed rather than just the open ones. A rejected request is
 * terminal and "stays for the audit trail" — from this side that trail is the
 * only answer to "why is my timesheet still wrong", and the `reviewNote` is
 * where it is written. Withdrawn ones stay for the same reason, including the
 * ones §7.4 withdraws automatically when the entry has gone.
 *
 * **Withdraw appears only while pending**, which is the only state the database
 * allows it from: `correction_requests_update_withdraw_own_pending` pins the old
 * status to `pending` and the new one to `withdrawn`, and a refusal there is
 * silent — PostgREST answers `200 []`. `withdrawCorrection` reads the row count
 * and returns "That request isn't pending, or isn't yours." for it, which is
 * rendered verbatim: on a list that has gone stale (an admin decided it a moment
 * ago) that sentence is the truth, and paraphrasing it into "something went
 * wrong" would lose it.
 */
export function MyCorrectionsList({
  requests,
  timezone,
}: {
  requests: CorrectionRequestWithContext[];
  timezone: string | null;
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function withdraw(requestId: string) {
    setPendingId(requestId);
    const result = await withdrawCorrection(requestId);
    setPendingId(null);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    toast.success("Request withdrawn. Nothing was changed.");
    router.refresh();
  }

  if (requests.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        You haven&rsquo;t asked for any corrections. Closed entries carry a menu
        for that on your dashboard.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-4">
      {requests.map((request) => (
        <li
          key={request.id}
          className="border-border flex flex-col gap-3 rounded-lg border p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">
                {KIND_LABEL[request.kind]}
              </span>
              <CorrectionStatusBadge status={request.status} />
            </div>
            <span className="text-muted-foreground text-xs">
              Filed {formatStartedAt(request.createdAt, timezone)}
            </span>
          </div>

          <CorrectionDiff request={request} timezone={timezone} />

          <p className="text-sm">
            <span className="text-muted-foreground">Your reason: </span>
            {request.reason}
          </p>

          {request.reviewNote ? (
            <p className="text-sm">
              <span className="text-muted-foreground">
                {request.status === "rejected"
                  ? "Why it was rejected: "
                  : "Note from the review: "}
              </span>
              {request.reviewNote}
            </p>
          ) : null}

          {request.reviewedAt ? (
            <p className="text-muted-foreground text-xs">
              Reviewed by {request.reviewerName ?? "an admin"} on{" "}
              {formatStartedAt(request.reviewedAt, timezone)}
            </p>
          ) : null}

          {request.status === "pending" ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pendingId === request.id}
                onClick={() => void withdraw(request.id)}
              >
                {pendingId === request.id ? "Withdrawing…" : "Withdraw"}
              </Button>
              <span className="text-muted-foreground text-xs">
                Waiting for an admin. The entry is unchanged until then.
              </span>
            </div>
          ) : null}

          {request.status === "rejected" ? (
            <p className="text-muted-foreground text-xs">
              A rejected request is final. File a new one if the entry still
              needs fixing.
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
