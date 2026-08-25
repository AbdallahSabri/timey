import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * "Running", in the one colour this app reserves for it.
 *
 * `--live` (amber) marks a timer that is still going and marks nothing else, so
 * that a glance down a list separates the entry that is still accruing from the
 * settled ones without reading a single word. `Badge` is CLI-managed and has no
 * `live` variant to add (`CLAUDE.md`), so the token is applied over the neutral
 * `secondary` variant here — once, rather than at each of the call sites.
 *
 * A *stale* timer is deliberately not this: §5.4 escalates it to `destructive`,
 * because at that point the elapsed figure is probably wrong rather than merely
 * still counting.
 */
export function RunningBadge({ className }: { className?: string }) {
  return (
    <Badge
      variant="secondary"
      className={cn("bg-live/12 text-live gap-1.5", className)}
    >
      <span className="bg-live size-1.5 shrink-0 rounded-full" aria-hidden />
      Running
    </Badge>
  );
}
