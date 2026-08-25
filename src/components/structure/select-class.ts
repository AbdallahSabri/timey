/**
 * Matches `Input`'s surface so a native `<select>` reads as one of the family.
 *
 * §12.3 lists a combobox as the primitive for the client → project → task
 * cascade, and it is still not installed. The only picker this phase needs is
 * "which client owns this project" over a v1 company's client list, which is a
 * short list and a plain `<select>` — the same technique `create-company-form`
 * uses for the timezone picker. A combobox becomes the right answer when a list
 * is long enough to need type-ahead; that is a deliberate dependency to add,
 * not something to reach for one dropdown early.
 */
export const nativeSelectClassName =
  "border-input focus-visible:border-ring focus-visible:ring-ring/50 disabled:bg-input/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:bg-input/30 dark:aria-invalid:border-destructive/50 h-8 w-full min-w-0 rounded-lg border bg-transparent px-2.5 py-1 text-base transition-colors outline-none focus-visible:ring-3 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-3 md:text-sm";
