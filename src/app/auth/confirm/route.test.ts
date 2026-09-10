import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

/**
 * The regression net for the `pending_next` defect (`BLOCKERS.md` D-18): this
 * route used to take its OTP type from the query string, so a *recovery* token
 * verified here picked up an invitee's stale `pending_next` and landed them in
 * the app with a live session and an unchanged password. Hardcoding
 * `type: "signup"` is the fix, and nothing but these tests keeps it hardcoded.
 *
 * **First Supabase client mock in the repo** (`health/route.test.ts` stubs
 * `fetch`, `resend.test.ts` stubs env vars). Kept to the shape the route
 * actually touches — `{ auth: { verifyOtp } }` — so it cannot quietly drift
 * from the real client by growing conveniences the real one does not have.
 */

const verifyOtp = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { verifyOtp } }),
}));

/**
 * The real `redirect()` throws — that is how Next signals navigation out of a
 * Route Handler — so the mock throws too. A quietly-returning stub would let
 * execution fall through to the failure redirect at the bottom of the route
 * and record two destinations for one request.
 */
const redirect = vi.fn((destination: string) => {
  throw new Error(`NEXT_REDIRECT:${destination}`);
});

vi.mock("next/navigation", () => ({
  redirect: (destination: string) => redirect(destination),
}));

function verified(userMetadata: Record<string, unknown> = {}) {
  return { data: { user: { user_metadata: userMetadata } }, error: null };
}

function refused() {
  return { data: { user: null }, error: { code: "otp_expired", status: 403 } };
}

async function destinationFor(url: string): Promise<string> {
  await expect(GET(new NextRequest(url))).rejects.toThrow(/NEXT_REDIRECT/);
  expect(redirect).toHaveBeenCalledTimes(1);
  return redirect.mock.calls[0]![0];
}

describe("GET /auth/confirm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("verifies as a signup even when the URL asks for another type", async () => {
    verifyOtp.mockResolvedValue(verified());

    await destinationFor(
      "https://timey.test/auth/confirm?token_hash=abc&type=recovery",
    );

    expect(verifyOtp).toHaveBeenCalledWith({
      type: "signup",
      token_hash: "abc",
    });
  });

  it("verifies as a signup when the URL names no type at all", async () => {
    verifyOtp.mockResolvedValue(verified());

    const destination = await destinationFor(
      "https://timey.test/auth/confirm?token_hash=abc",
    );

    expect(verifyOtp).toHaveBeenCalledWith({
      type: "signup",
      token_hash: "abc",
    });
    expect(destination).toBe("/dashboard");
  });

  // §8.1 Path B: the stashed destination was chosen at signup with the
  // invitation in hand, so it outranks the query's generic default.
  it("lets pending_next override ?next= for a signup confirmation", async () => {
    verifyOtp.mockResolvedValue(verified({ pending_next: "/invite/xyz" }));

    const destination = await destinationFor(
      "https://timey.test/auth/confirm?token_hash=abc&next=/dashboard",
    );

    expect(destination).toBe("/invite/xyz");
  });

  it("re-validates pending_next rather than trusting it", async () => {
    // `user_metadata` is writable by its own user, so an off-origin value is
    // as reachable here as it is through `?next=`.
    verifyOtp.mockResolvedValue(verified({ pending_next: "//evil.example" }));

    const destination = await destinationFor(
      "https://timey.test/auth/confirm?token_hash=abc",
    );

    expect(destination).toBe("/dashboard");
  });

  it("refuses a bad or expired token", async () => {
    verifyOtp.mockResolvedValue(refused());

    const destination = await destinationFor(
      "https://timey.test/auth/confirm?token_hash=stale",
    );

    expect(destination).toBe("/sign-in?error=confirmation_failed");
  });

  it("refuses without calling Supabase when there is no token", async () => {
    const destination = await destinationFor(
      "https://timey.test/auth/confirm?type=signup",
    );

    expect(verifyOtp).not.toHaveBeenCalled();
    expect(destination).toBe("/sign-in?error=confirmation_failed");
  });

  // An unconfigured project throws out of `createClient`; the route must
  // refuse rather than 500, and the throw must not swallow the redirect.
  it("refuses when the Supabase call throws", async () => {
    verifyOtp.mockRejectedValue(new Error("not configured"));

    const destination = await destinationFor(
      "https://timey.test/auth/confirm?token_hash=abc",
    );

    expect(destination).toBe("/sign-in?error=confirmation_failed");
  });
});
