import { Badge } from "@/components/ui/badge";
import type {
  CorrectionKind,
  CorrectionStatus,
} from "@/lib/validations/corrections";

import type { ComponentProps } from "react";

type BadgeVariant = ComponentProps<typeof Badge>["variant"];

/**
 * §7.4's lifecycle, one pill per state — and four visually distinct ones,
 * because "pending" and "rejected" mean opposite things to the person reading
 * their own list and a shared neutral grey for both would hide the difference
 * at a glance.
 *
 * `withdrawn` is deliberately the quietest of the four: nothing happened to the
 * entry, by the requester's own choice (or §7.4's auto-withdraw), so it should
 * read as closed rather than as a refusal.
 */
const STATUS_BADGE: Record<
  CorrectionStatus,
  { label: string; variant: BadgeVariant }
> = {
  pending: { label: "Pending", variant: "secondary" },
  approved: { label: "Approved", variant: "default" },
  rejected: { label: "Rejected", variant: "destructive" },
  withdrawn: { label: "Withdrawn", variant: "outline" },
};

export function CorrectionStatusBadge({
  status,
}: {
  status: CorrectionStatus;
}) {
  const { label, variant } = STATUS_BADGE[status];

  return <Badge variant={variant}>{label}</Badge>;
}

/**
 * `correction_kind` in the words a person would use. "Change" rather than
 * "amend" because the queue is read by whoever happens to be the second admin,
 * not by someone who has read §3.9.
 */
export const KIND_LABEL: Record<CorrectionKind, string> = {
  create: "New entry",
  amend: "Change",
  delete: "Deletion",
};

/** One sentence saying what approving this request would actually do. */
export const KIND_EFFECT: Record<CorrectionKind, string> = {
  create: "Approving adds this entry to the requester's timesheet.",
  amend: "Approving applies these values to the entry.",
  delete: "Approving deletes the entry. It cannot be undone.",
};
