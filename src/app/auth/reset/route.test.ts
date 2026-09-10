import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

/**
 * §8.5's callback, and the other half of the `pending_next` regression net
 * (see `../confirm/route.test.ts` for the mock's rationale). The defect this
 * route was carved out to avoid is asserted directly below: a recovery
 * verification must land on the reset form even when the user's metadata still
 * points at a stale invite.
 */

const verifyOtp = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { verifyOtp } }),
}));

/**
 * The real one writes through `cookies()` from `next/headers`, which has no
 * request context here. Mocked to observe *that* it is set, with what, and
 * when; `recovery.test.ts` covers the real implementation and its user
 * binding directly, so nothing about the module is only ever seen as this stub.
 */
const setRecoveryCookie = vi.fn<(userId: string) => Promise<void>>(
  async () => {},
);

vi.mock("@/lib/auth/recovery", () => ({
  setRecoveryCookie: (userId: string) => setRecoveryCookie(userId),
}));

const redirect = vi.fn((destination: string) => {
  throw new Error(`NEXT_REDIRECT:${destination}`);
});

vi.mock("next/navigation", () => ({
  redirect: (destination: string) => redirect(destination),
}));

const INVALID = "/forgot-password?error=reset_link_invalid";
const USER_ID = "11111111-1111-4111-8111-111111111111";

function verified(userMetadata: Record<string, unknown> = {}) {
  return {
    data: { user: { id: USER_ID, user_metadata: userMetadata } },
    error: null,
  };
}

async function destinationFor(url: string): Promise<string> {
  await expect(GET(new NextRequest(url))).rejects.toThrow(/NEXT_REDIRECT/);
  expect(redirect).toHaveBeenCalledTimes(1);
  return redirect.mock.calls[0]![0];
}

describe("GET /auth/reset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exchanges the token as a recovery OTP", async () => {
    verifyOtp.mockResolvedValue(verified());

    await destinationFor("https://timey.test/auth/reset?token_hash=abc");

    expect(verifyOtp).toHaveBeenCalledWith({
      type: "recovery",
      token_hash: "abc",
    });
  });

  it("sets the marker cookie and sends the user to the form", async () => {
    verifyOtp.mockResolvedValue(verified());

    const destination = await destinationFor(
      "https://timey.test/auth/reset?token_hash=abc",
    );

    expect(setRecoveryCookie).toHaveBeenCalledTimes(1);
    expect(destination).toBe("/reset-password");
  });

  // The marker names the user `verifyOtp` just verified, and takes it from the
  // response rather than from anything in the request — that binding is what
  // stops the next person on a shared browser inheriting the form.
  it("binds the marker to the user the token verified", async () => {
    verifyOtp.mockResolvedValue(verified());

    await destinationFor("https://timey.test/auth/reset?token_hash=abc");

    expect(setRecoveryCookie).toHaveBeenCalledWith(USER_ID);
  });

  // A verified token means GoTrue's session cookies are already written, so a
  // later failure must not be reported as a failed verification: sending a
  // signed-in user to `/forgot-password` lets middleware carry them into the
  // app with the password they came to change still in place. The cookie write
  // therefore sits outside the try, and a throw from it fails loudly rather
  // than becoming a silent no-op reset.
  it("never turns a verified token into a refusal when the cookie write fails", async () => {
    verifyOtp.mockResolvedValue(verified());
    setRecoveryCookie.mockRejectedValueOnce(new Error("cookie jar closed"));

    await expect(
      GET(new NextRequest("https://timey.test/auth/reset?token_hash=abc")),
    ).rejects.toThrow("cookie jar closed");

    expect(redirect).not.toHaveBeenCalled();
  });

  // Nothing GoTrue returns looks like this, and it is refused rather than
  // guessed at: with no id there is no user to bind the marker to.
  it("refuses a verification that carries no user", async () => {
    verifyOtp.mockResolvedValue({ data: { user: null }, error: null });

    const destination = await destinationFor(
      "https://timey.test/auth/reset?token_hash=abc",
    );

    expect(setRecoveryCookie).not.toHaveBeenCalled();
    expect(destination).toBe(INVALID);
  });

  // The regression test for the defect. An invitee who signed up through
  // `/sign-up?next=/invite/xyz` carries `pending_next` forever — this route
  // must not read it, or a reset would drop them into the app with a live
  // session and the password they came to change still in place.
  it("ignores pending_next entirely", async () => {
    verifyOtp.mockResolvedValue(verified({ pending_next: "/invite/xyz" }));

    const destination = await destinationFor(
      "https://timey.test/auth/reset?token_hash=abc",
    );

    expect(destination).toBe("/reset-password");
    expect(redirect).not.toHaveBeenCalledWith("/invite/xyz");
  });

  // Neither the type nor the destination is the caller's to choose on a token
  // that grants a session.
  it("ignores type and next in the query string", async () => {
    verifyOtp.mockResolvedValue(verified());

    const destination = await destinationFor(
      "https://timey.test/auth/reset?token_hash=abc&type=signup&next=/invite/xyz",
    );

    expect(verifyOtp).toHaveBeenCalledWith({
      type: "recovery",
      token_hash: "abc",
    });
    expect(destination).toBe("/reset-password");
  });

  it("refuses a used or expired link without marking recovery", async () => {
    verifyOtp.mockResolvedValue({
      data: { user: null },
      error: { code: "otp_expired", status: 403 },
    });

    const destination = await destinationFor(
      "https://timey.test/auth/reset?token_hash=stale",
    );

    expect(setRecoveryCookie).not.toHaveBeenCalled();
    expect(destination).toBe(INVALID);
  });

  it("refuses without calling Supabase when there is no token", async () => {
    const destination = await destinationFor("https://timey.test/auth/reset");

    expect(verifyOtp).not.toHaveBeenCalled();
    expect(setRecoveryCookie).not.toHaveBeenCalled();
    expect(destination).toBe(INVALID);
  });

  it("refuses when the Supabase call throws", async () => {
    verifyOtp.mockRejectedValue(new Error("not configured"));

    const destination = await destinationFor(
      "https://timey.test/auth/reset?token_hash=abc",
    );

    expect(setRecoveryCookie).not.toHaveBeenCalled();
    expect(destination).toBe(INVALID);
  });
});
