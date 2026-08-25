"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * Mounts `next-themes` for the whole app.
 *
 * `attribute="class"` because the dark variant in `globals.css` is a class
 * selector (`&:where(.dark, .dark *)`), not a media query — a media-query dark
 * mode could not offer an explicit Light/Dark choice, only "whatever the OS
 * says". `defaultTheme="system"` keeps that OS default for anyone who never
 * touches the toggle.
 *
 * `disableTransitionOnChange` suppresses transitions for the one frame the
 * class flips. Without it every `transition-colors` in the tree animates at
 * once and the switch reads as a slow wash rather than an instant change.
 *
 * `enableColorScheme` (on by default) mirrors the choice onto the `color-scheme`
 * style property, which is what makes native scrollbars and form widgets follow
 * along; `globals.css` also declares it per theme so the pre-hydration paint is
 * already correct.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
