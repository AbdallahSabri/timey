import { Geist, Geist_Mono } from "next/font/google";

import { ThemeProvider } from "@/components/theme/theme-provider";
import { Toaster } from "@/components/ui/sonner";

import type { Metadata, Viewport } from "next";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Timey",
  description: "Timey records how long people work, against what.",
};

/**
 * `themeColor` is matched to `--background` in each theme so the browser chrome
 * on a phone continues the page rather than framing it.
 *
 * `viewportFit: "cover"` is the part that does real work: without it
 * `env(safe-area-inset-bottom)` resolves to `0px`, and the mobile tab bar would
 * sit underneath the home indicator on a notched device.
 */
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfaf8" },
    { media: "(prefers-color-scheme: dark)", color: "#12120f" },
  ],
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // `suppressHydrationWarning` is required, not defensive: `next-themes`
    // writes the theme class onto this element before React hydrates, so the
    // server's markup and the client's first read of it never match.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        {/* The Toaster is inside the provider, not beside it — it reads
            `useTheme()` to pick its own surface (`ui/sonner.tsx`), and outside
            the provider it would fall back to "system" while the rest of the
            app followed an explicit choice. */}
        <ThemeProvider>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
