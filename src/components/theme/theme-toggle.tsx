"use client";

import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const THEMES = [
  { value: "light", label: "Light", Icon: SunIcon },
  { value: "dark", label: "Dark", Icon: MoonIcon },
  { value: "system", label: "System", Icon: MonitorIcon },
] as const;

/**
 * Light / Dark / System, as three explicit choices rather than a two-state flip.
 *
 * "System" has to be selectable in its own right: a toggle that only swaps
 * light and dark silently pins the choice on first click and the app stops
 * following the OS forever after. `resolvedTheme` is what is on screen right
 * now; `theme` is what the user asked for, and only the latter can tell
 * "system, currently dark" apart from "dark".
 *
 * The icon renders from `theme` only after mount. On the server there is no
 * `theme` — the class is written by `next-themes` before React hydrates — so
 * reading it during the first render is the standard hydration mismatch. The
 * placeholder is the same size as the real button, so nothing shifts when it
 * swaps in.
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <Button
        variant="ghost"
        size="icon-sm"
        aria-hidden
        tabIndex={-1}
        className="opacity-0"
      >
        <MonitorIcon />
      </Button>
    );
  }

  const active = THEMES.find((entry) => entry.value === theme) ?? THEMES[2];
  const ActiveIcon = active.Icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm">
          <ActiveIcon />
          <span className="sr-only">
            Change theme — currently {active.label}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-36">
        <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
          {THEMES.map(({ value, label, Icon }) => (
            <DropdownMenuRadioItem key={value} value={value}>
              <Icon />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
