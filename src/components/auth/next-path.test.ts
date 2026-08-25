import { describe, expect, it } from "vitest";

import { nextParam, safeNextPath } from "@/components/auth/next-path";

const FALLBACK = "/dashboard";

describe("safeNextPath", () => {
  it("keeps a same-origin absolute path", () => {
    expect(safeNextPath("/invite/abc123", FALLBACK)).toBe("/invite/abc123");
    expect(safeNextPath("/members?tab=pending", FALLBACK)).toBe(
      "/members?tab=pending",
    );
    // A hyphen is ordinary path punctuation and must survive.
    expect(safeNextPath("/sign-in-help", FALLBACK)).toBe("/sign-in-help");
  });

  it("falls back when there is no destination", () => {
    expect(safeNextPath(undefined, FALLBACK)).toBe(FALLBACK);
    expect(safeNextPath(null, FALLBACK)).toBe(FALLBACK);
    expect(safeNextPath("", FALLBACK)).toBe(FALLBACK);
  });

  it("refuses anything that could leave this origin", () => {
    expect(safeNextPath("https://evil.example", FALLBACK)).toBe(FALLBACK);
    expect(safeNextPath("//evil.example", FALLBACK)).toBe(FALLBACK);
    expect(safeNextPath("/\\evil.example", FALLBACK)).toBe(FALLBACK);
    expect(safeNextPath("evil.example/path", FALLBACK)).toBe(FALLBACK);
    expect(safeNextPath("javascript:alert(1)", FALLBACK)).toBe(FALLBACK);
  });

  it("refuses whitespace and control characters browsers would strip", () => {
    expect(safeNextPath("/\t/evil.example", FALLBACK)).toBe(FALLBACK);
    expect(safeNextPath("/\n//evil.example", FALLBACK)).toBe(FALLBACK);
    expect(safeNextPath("/ /evil.example", FALLBACK)).toBe(FALLBACK);
    expect(safeNextPath("\t//evil.example", FALLBACK)).toBe(FALLBACK);
  });
});

describe("nextParam", () => {
  it("encodes the destination", () => {
    expect(nextParam("/invite/abc123")).toBe("?next=%2Finvite%2Fabc123");
  });

  it("is empty when there is nothing to carry", () => {
    expect(nextParam(undefined)).toBe("");
    expect(nextParam("")).toBe("");
  });
});
