"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { CorrectionDiff } from "@/components/corrections/correction-diff";
import {
  CorrectionStatusBadge,
  KIND_EFFECT,
  KIND_LABEL,
} from "@/components/corrections/correction-labels";
import { RejectCorrectionDialog } from "@/components/corrections/reject-correction-dialog";
import { formatStartedAt } from "@/components/time-entries/format-entry";
import { Button } from "@/components/ui/button";
import {
  approveCorrection,
  rejectCorrection,
  type CorrectionRequestWithContext,
} from "@/lib/actions/corrections";
import type { CorrectionStatus } from "@/lib/validations/corrections";

/**
 * §7.4's review queue: pending requests, each shown with the entry as it stands
 * beside what is being proposed, and the two decisions an admin can make.
 *
 * **`ok: true` from `approveCorrection` does not mean "approved", and this
 * component is where that matters.** §7.4 rules that a request naming an entry
 * deleted since it was filed is "auto-marked `withdrawn` at approval time rather
 * than erroring" — so that path commits, succeeds, and comes back with
 * `status: 'withdrawn'`. Reporting "approved" on the boolean would tell an admin
 * a timesheet had been changed when nothing was. Every decision below reads
 * `data.status` and renders whatever actually happened; `ok` only says the round
 * trip completed.
 *
 * A request the signed-in admin filed themselves keeps its Reject button and
 * loses its Approve one — §7.4 forbids exactly one thing, approving your own,
 * and `approve_correction()` raises `42501/self_approval` for it. The database
 * is the boundary; hiding the button only spares the admin an error they can do
 * nothing about. Self-*rejection* is deliberately allowed (it is strictly weaker
 * than the withdrawal every requester already has, and leaves a better record),
 * so it stays.
 */
const OUTCOME: Record<CorrectionStatus, string> = {
  approved: "Approved and applied to the entry.",
  rejected: "Rejected. The requester can read your note.",
  withdrawn:
    "The entry this request referred to no longer exists, so it was withdrawn automatically.",
  pending: "Still pending — nothing was decided.",
};

export function CorrectionQueue({
  requests,
  timezone,
  currentUserId,
}: {
  requests: CorrectionRequestWithContext[];
  timezone: string | null;
  currentUserId: string | null;
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [decided, setDecided] = useState<Record<string, CorrectionStatus>>({});

  /**
   * One settle path for both decisions, so neither can grow its own idea of
   * what the returned status means. The row is left on screen showing its real
   * outcome until `router.refresh()` drops it from the server-rendered queue —
   * an admin who approved five in a row should be able to see which of them the
   * database actually applied.
   */
  function settle(requestId: string, status: CorrectionStatus) {
    setDecided((previous) => ({ ...previous, [requestId]: status }));

    if (status === "approved") {
      toast.success(OUTCOME.approved);
    } else if (status === "withdrawn") {
      toast.warning(OUTCOME.withdrawn);
    } else if (status === "rejected") {
      toast.success(OUTCOME.rejected);
    } else {
      toast.info(OUTCOME.pending);
    }

    router.refresh();
  }

  async function approve(requestId: string) {
    setPendingId(requestId);
    const result = await approveCorrection(requestId);
    setPendingId(null);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    settle(requestId, result.data.status);
  }

  async function reject(requestId: string, reviewNote: string) {
    setPendingId(requestId);
    const result = await rejectCorrection(requestId, reviewNote);
    setPendingId(null);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    setRejectingId(null);
    settle(requestId, result.data.status);
  }

  if (requests.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Nothing waiting. Requests appear here the moment somebody files one.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-4">
      {requests.map((request) => {
        const outcome = decided[request.id];
        const isSelf = request.requestedBy === currentUserId;
        const busy = pendingId === request.id;
        const entryGone = request.kind !== "create" && request.entry === null;

        return (
          <li
            key={request.id}
            className="border-border flex flex-col gap-3 rounded-lg border p-4"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">
                  {request.requesterName ?? "Someone"}
                </span>
                <span className="text-muted-foreground text-sm">
                  · {KIND_LABEL[request.kind]}
                </span>
                {isSelf ? (
                  <span className="text-muted-foreground text-xs">
                    your request
                  </span>
                ) : null}
              </div>
              <span className="text-muted-foreground text-xs">
                Filed {formatStartedAt(request.createdAt, timezone)}
              </span>
            </div>

            <p className="text-sm">
              <span className="text-muted-foreground">Reason: </span>
              {request.reason}
            </p>

            <CorrectionDiff request={request} timezone={timezone} />

            <p className="text-muted-foreground text-xs">
              {entryGone
                ? "Approving this can't apply anything — it will be withdrawn automatically instead."
                : KIND_EFFECT[request.kind]}
            </p>

            {outcome ? (
              <div className="flex flex-wrap items-center gap-2">
                <CorrectionStatusBadge status={outcome} />
                <span className="text-muted-foreground text-sm">
                  {OUTCOME[outcome]}
                </span>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={busy || isSelf}
                  onClick={() => void approve(request.id)}
                >
                  {busy ? "Working…" : "Approve"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setRejectingId(request.id)}
                >
                  Reject…
                </Button>
                {isSelf ? (
                  <span className="text-muted-foreground text-xs">
                    You can&rsquo;t approve your own request — another admin
                    reviews it. You can still withdraw it from your own list.
                  </span>
                ) : null}
              </div>
            )}

            <RejectCorrectionDialog
              requesterName={request.requesterName}
              pending={busy}
              open={rejectingId === request.id}
              onOpenChange={(open) => setRejectingId(open ? request.id : null)}
              onReject={(reviewNote) => reject(request.id, reviewNote)}
            />
          </li>
        );
      })}
    </ul>
  );
}
