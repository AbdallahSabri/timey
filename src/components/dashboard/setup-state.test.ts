import { describe, expect, it } from "vitest";

import { unassignedMemberCount } from "@/components/dashboard/setup-state";

const members = [{ id: "a" }, { id: "b" }, { id: "c" }];

describe("unassignedMemberCount", () => {
  it("counts the members who are on no project", () => {
    expect(unassignedMemberCount(members, [{ userId: "a" }])).toBe(2);
  });

  it("counts somebody on several projects once", () => {
    expect(
      unassignedMemberCount(members, [
        { userId: "a" },
        { userId: "a" },
        { userId: "a" },
      ]),
    ).toBe(2);
  });

  it("is zero when everybody is assigned", () => {
    expect(
      unassignedMemberCount(members, [
        { userId: "a" },
        { userId: "b" },
        { userId: "c" },
      ]),
    ).toBe(0);
  });

  it("is everybody when there are no memberships at all", () => {
    // The first-run state, and the one the setup card exists for.
    expect(unassignedMemberCount(members, [])).toBe(3);
  });

  it("never goes negative on a membership for somebody not in the list", () => {
    // A read that raced a deactivation, or a stale row. The memberships side
    // must not be able to push the count below zero or above the roster.
    expect(
      unassignedMemberCount(members, [
        { userId: "a" },
        { userId: "b" },
        { userId: "c" },
        { userId: "ghost" },
      ]),
    ).toBe(0);
  });

  it("is zero for an empty company", () => {
    expect(unassignedMemberCount([], [])).toBe(0);
  });
});
