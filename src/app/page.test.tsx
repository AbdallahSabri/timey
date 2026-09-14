import { beforeEach, describe, expect, it, vi } from "vitest";

import Home from "./page";

/**
 * §8.5's guard rail, and the regression net for `BLOCKERS.md` D-21.
 *
 * The defect was silence: a hosted project on GoTrue's default recovery
 * template sends the user to the Site URL carrying `?code=`, this page ignored
 * its query string, and the reset appeared to succeed into a normal-looking
 * homepage. So what is asserted here is that an auth artifact in the query
 * *leaves* this page, and that an ordinary visit still does not.
 *
 * Mocked the way the route handlers are (`auth/reset/route.test.ts`): the real
 * `redirect()` throws by design, which is also how it stops execution at the
 * call site, so the stub throws too. Only the redirect branch is exercised —
 * rendering the other one would mean rendering an async Server Component, which
 * React Testing Library has no support for and which this file does not need.
 */

const redirect = vi.fn((destination: string) => {
  throw new Error(`NEXT_REDIRECT:${destination}`);
});

vi.mock("next/navigation", () => ({
  redirect: (destination: string) => redirect(destination),
}));

const UNUSABLE = "/forgot-password?error=auth_link_unusable";

function visit(params: Record<string, string | string[] | undefined>) {
  return Home({ searchParams: Promise.resolve(params) });
}

describe("Home", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends a PKCE code landing to the request form instead of rendering", async () => {
    await expect(
      visit({ code: "7b215c4a-66d6-4ab8-ace1-ec155122024b" }),
    ).rejects.toThrow(`NEXT_REDIRECT:${UNUSABLE}`);

    expect(redirect).toHaveBeenCalledWith(UNUSABLE);
  });

  it("treats GoTrue's error_description the same way", async () => {
    await expect(
      visit({ error_description: "Email link is invalid or has expired" }),
    ).rejects.toThrow(`NEXT_REDIRECT:${UNUSABLE}`);

    expect(redirect).toHaveBeenCalledWith(UNUSABLE);
  });

  it("never exchanges the code — it only reports the failure", async () => {
    // The whole design ruling in one assertion: no Supabase client is
    // constructed here, so there is no branch in which a code could be
    // exchanged and a recovery mistaken for a signup confirmation.
    await expect(visit({ code: "anything" })).rejects.toThrow("NEXT_REDIRECT:");

    expect(redirect).toHaveBeenCalledTimes(1);
  });

  it("renders normally for a visitor arriving with no query string", async () => {
    await expect(visit({})).resolves.toBeTruthy();

    expect(redirect).not.toHaveBeenCalled();
  });

  it("ignores an unrelated query string", async () => {
    await expect(visit({ utm_source: "newsletter" })).resolves.toBeTruthy();

    expect(redirect).not.toHaveBeenCalled();
  });
});
