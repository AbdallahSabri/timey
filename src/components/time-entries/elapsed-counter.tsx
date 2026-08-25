"use client";

import { useEffect, useState } from "react";

import { elapsedSeconds, formatClock } from "@/components/time-entries/elapsed";
import { cn } from "@/lib/utils";

/**
 * The one ticking clock in the app.
 *
 * `initialNow` is the *server's* clock at render time, threaded through as a
 * prop so the first client render produces byte-identical markup to the HTML it
 * hydrates — a `Date.now()` read during render would differ from the server's
 * by whatever the round trip took and warn on every mount. The effect replaces
 * it with the browser's clock immediately, so the prop is a hydration seed and
 * nothing more.
 *
 * Both values are display-only (§5.3): the elapsed number below never leaves
 * this component tree, and the duration that gets stored is computed by
 * Postgres from its own `now()` when `stopTimer` runs.
 */
export function useElapsedSeconds(startedAt: string, initialNow: number) {
  const [now, setNow] = useState(initialNow);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  return elapsedSeconds(startedAt, now);
}

/**
 * `aria-live="off"` on purpose: a counter that announced itself every second
 * would make the page unusable with a screen reader. The label beside it says
 * the timer is running, which is the part that matters; the digits are read on
 * demand.
 */
export function ElapsedCounter({
  seconds,
  className,
}: {
  seconds: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "font-mono text-4xl leading-none font-medium tracking-tight tabular-nums sm:text-5xl",
        className,
      )}
      aria-live="off"
    >
      {formatClock(seconds)}
    </span>
  );
}
