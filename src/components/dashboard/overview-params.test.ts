import { describe, expect, it } from "vitest";

import {
  EMPLOYEE_PARAM,
  overviewHref,
  resolveSelectedEmployee,
} from "@/components/dashboard/overview-params";

const rows = [{ userId: "worst" }, { userId: "middling" }, { userId: "best" }];

describe("overviewHref", () => {
  it("puts the selection in the URL, where it can be linked and bookmarked", () => {
    expect(overviewHref("u-7")).toBe("/overview?employee=u-7");
  });

  it("encodes an id that needs it", () => {
    expect(overviewHref("a b&c")).toBe("/overview?employee=a+b%26c");
  });

  it("uses the shared parameter name", () => {
    expect(overviewHref("u-7")).toContain(`${EMPLOYEE_PARAM}=`);
  });
});

describe("resolveSelectedEmployee", () => {
  it("honours a requested employee who exists", () => {
    expect(resolveSelectedEmployee("middling", rows)).toBe("middling");
  });

  it("falls back to the first row when nothing was asked for", () => {
    // The caller orders by shortfall, so the default panel is whoever is
    // furthest behind.
    expect(resolveSelectedEmployee(undefined, rows)).toBe("worst");
  });

  it("falls back rather than honouring an id that is not on the page", () => {
    // A foreign id would return zero rows from a SECURITY INVOKER function and
    // render as a real panel full of empty bars — a blank chart attributed to a
    // stranger. RLS makes it harmless; falling back makes it honest.
    expect(resolveSelectedEmployee("someone-elses-uuid", rows)).toBe("worst");
    expect(resolveSelectedEmployee("", rows)).toBe("worst");
  });

  it("takes the first of a repeated parameter rather than erroring", () => {
    expect(resolveSelectedEmployee(["best", "worst"], rows)).toBe("best");
  });

  it("falls back when a repeated parameter names nobody", () => {
    expect(resolveSelectedEmployee(["ghost"], rows)).toBe("worst");
  });

  it("is null when there is nobody to select", () => {
    expect(resolveSelectedEmployee("anyone", [])).toBe(null);
    expect(resolveSelectedEmployee(undefined, [])).toBe(null);
  });
});
