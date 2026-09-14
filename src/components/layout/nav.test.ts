import { describe, expect, it } from "vitest";

import { isActivePath, NAV_LINKS, navLinksFor } from "@/components/layout/nav";

describe("isActivePath", () => {
  it("matches the route itself", () => {
    expect(isActivePath("/projects", "/projects")).toBe(true);
  });

  it("keeps the parent lit on a child route", () => {
    // `/projects/{id}` is the detail page — the nav should still read as
    // "Projects" rather than going blank.
    expect(isActivePath("/projects/abc-123", "/projects")).toBe(true);
  });

  it("only matches on a segment boundary", () => {
    // The reason this is a prefix match on `${href}/` rather than a plain
    // `startsWith`: a future sibling route must not light its neighbour.
    expect(isActivePath("/projects-archive", "/projects")).toBe(false);
    expect(isActivePath("/reports-export", "/reports")).toBe(false);
  });

  it("does not match an unrelated route", () => {
    expect(isActivePath("/dashboard", "/projects")).toBe(false);
  });
});

describe("NAV_LINKS", () => {
  it("fills the tab bar's four slots and leaves the rest to the overflow menu", () => {
    // The bar renders `primary` links in a fixed row and everything else behind
    // "More". If this count drifts, the tabs get too narrow to hit.
    expect(NAV_LINKS.filter((link) => link.primary)).toHaveLength(4);
    expect(NAV_LINKS.filter((link) => !link.primary).length).toBeGreaterThan(0);
  });

  it("routes to distinct destinations", () => {
    const hrefs = NAV_LINKS.map((link) => link.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});

describe("navLinksFor", () => {
  const hrefs = (role: Parameters<typeof navLinksFor>[0]) =>
    navLinksFor(role).map((link) => link.href);

  it("gives an admin every destination", () => {
    expect(hrefs("admin")).toEqual(NAV_LINKS.map((link) => link.href));
  });

  it("gives an employee the three they work in", () => {
    // §4.2.2. Not a permission — `middleware.ts` and each page's own check are
    // what refuse the route, and RLS is what protects the data. This is the
    // nav agreeing with them instead of offering three dead ends.
    expect(hrefs("employee")).toEqual([
      "/dashboard",
      "/corrections",
      "/reports",
    ]);
  });

  it("treats an unknown role as an employee", () => {
    // `getCurrentMember()` reports null for a signed-out or not-yet-provisioned
    // account, and a failed read looks the same. Failing closed here matches
    // the reading `middleware.ts` takes on the same column.
    expect(hrefs(null)).toEqual(hrefs("employee"));
  });

  it("gives an admin the team overview and an employee nothing of it", () => {
    // §9.9. The only flagged route whose data is genuinely admin-only —
    // `time_entries` SELECT is company-wide for an active admin and own-rows
    // for everybody else — so unlike the other three, the link and the boundary
    // agree about something real.
    expect(hrefs("admin")).toContain("/overview");
    expect(hrefs("employee")).not.toContain("/overview");
    expect(hrefs(null)).not.toContain("/overview");
  });

  it("keeps the overview out of the phone's four tab slots", () => {
    // An admin already fills all four. A fifth primary link makes every tab too
    // narrow to hit, so this one belongs behind "More".
    const overview = navLinksFor("admin").find(
      (link) => link.href === "/overview",
    );

    expect(overview?.primary).toBe(false);
  });

  it("leaves an employee no overflow, which is why More holds sign out", () => {
    // All three non-primary destinations are admin-only, so an employee's overflow
    // menu is empty. `MobileTabBar` still renders "More", because the header's
    // sign-out is `md`-only and this is the phone's only way out.
    expect(navLinksFor("employee").filter((link) => !link.primary)).toEqual([]);
  });

  it("never lets a filtered list outgrow the tab bar", () => {
    for (const role of ["admin", "employee"] as const) {
      expect(
        navLinksFor(role).filter((link) => link.primary).length,
      ).toBeLessThanOrEqual(4);
    }
  });
});
