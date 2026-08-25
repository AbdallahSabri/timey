import { describe, expect, it } from "vitest";

import { isActivePath, NAV_LINKS } from "@/components/layout/nav";

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
