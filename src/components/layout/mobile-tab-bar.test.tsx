import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MobileTabBar } from "@/components/layout/mobile-tab-bar";
import { navLinksFor } from "@/components/layout/nav";
import type { MemberRole } from "@/lib/validations/members";

let pathname = "/dashboard";

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ refresh: () => {}, replace: () => {} }),
}));

vi.mock("@/lib/actions/auth", () => ({
  signOut: async () => ({ ok: true, data: null }),
}));

vi.mock("sonner", () => ({
  toast: { success: () => {}, error: () => {} },
}));

function renderBar(at = "/dashboard", role: MemberRole | null = "admin") {
  pathname = at;
  return render(<MobileTabBar role={role} />);
}

describe("MobileTabBar", () => {
  it("puts every destination within reach", async () => {
    // The whole point of the split is thumb reach, never access control
    // (`nav.ts`). A link that exists in the header but is unreachable on a
    // phone would quietly turn a layout choice into a permission one — so
    // every entry must resolve, as a tab or behind "More".
    renderBar();

    const bar = screen.getByRole("navigation", { name: "Main" });

    for (const link of navLinksFor("admin").filter((entry) => entry.primary)) {
      expect(
        within(bar).getByRole("link", {
          name: new RegExp(link.shortLabel ?? link.label, "i"),
        }),
      ).toHaveAttribute("href", link.href);
    }

    await userEvent.click(within(bar).getByRole("button", { name: /more/i }));

    for (const link of navLinksFor("admin").filter((entry) => !entry.primary)) {
      expect(
        screen.getByRole("menuitem", { name: link.label }),
      ).toHaveAttribute("href", link.href);
    }
  });

  it("keeps sign out reachable, since the header's is desktop-only", async () => {
    renderBar();

    await userEvent.click(screen.getByRole("button", { name: /more/i }));

    expect(
      screen.getByRole("button", { name: "Sign out" }),
    ).toBeInTheDocument();
  });

  it("marks the current destination", () => {
    renderBar("/reports");

    expect(screen.getByRole("link", { name: /reports/i })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("marks a child route's parent", () => {
    // `/projects/{id}` has no tab of its own; the Projects tab stands in.
    // Admin-only since §4.2.2 — an employee has no Projects tab to light.
    renderBar("/projects/abc-123", "admin");

    expect(screen.getByRole("link", { name: /projects/i })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("drops the admin destinations for an employee", () => {
    // §4.2.2. The tab bar and the header row both read `navLinksFor`, so this
    // also guards against the two drifting apart.
    renderBar("/dashboard", "employee");

    const bar = screen.getByRole("navigation", { name: "Main" });

    expect(
      within(bar).queryByRole("link", { name: /projects/i }),
    ).not.toBeInTheDocument();

    for (const label of [/timer/i, /fixes/i, /reports/i]) {
      expect(
        within(bar).getByRole("link", { name: label }),
      ).toBeInTheDocument();
    }
  });

  it("keeps More for an employee even with nothing in the overflow", async () => {
    // An employee's overflow is empty — both non-primary destinations are
    // admin-only. "More" must survive that anyway: it carries the phone's only
    // sign-out, and dropping it would strand them in the session.
    renderBar("/dashboard", "employee");

    await userEvent.click(screen.getByRole("button", { name: /more/i }));

    expect(
      screen.getByRole("button", { name: "Sign out" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
  });
});
