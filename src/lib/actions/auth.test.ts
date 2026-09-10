import { AuthApiError, AuthSessionMissingError } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { requestPasswordReset, updatePassword } from "./auth";

/**
 * §8.5's two actions, and specifically the three decisions the recovery flow
 * rests on that nothing else in the suite would notice being reversed: the
 * rate-limit code reported as success, the SDK shape of
 * `AuthSessionMissingError`, and when the marker cookie is cleared.
 *
 * The Supabase client mock follows the shape the route tests established
 * (`app/auth/confirm/route.test.ts`) — only the calls these actions make, so it
 * cannot drift from the real client by growing conveniences it does not have.
 * Errors are real `AuthError` subclasses rather than object literals, because
 * `isAuthSessionMissingError` is a `__isAuthError` brand check: a literal with
 * the right fields would be classified differently from the thing GoTrue
 * actually returns, and the test would prove nothing about production.
 */

const resetPasswordForEmail = vi.fn();
const updateUser = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { resetPasswordForEmail, updateUser },
  }),
}));

const revalidatePath = vi.fn();

vi.mock("next/cache", () => ({
  revalidatePath: (path: string, type?: string) => revalidatePath(path, type),
}));

const clearRecoveryCookie = vi.fn<() => Promise<void>>(async () => {});
/**
 * Defaults to unlocked, so every other test here describes a live recovery.
 * `lib/auth/recovery.test.ts` covers what the real one decides; these tests
 * cover what `updatePassword` does with the answer.
 */
const isRecoveryUnlocked = vi.fn<() => Promise<boolean>>(async () => true);

vi.mock("@/lib/auth/recovery", () => ({
  clearRecoveryCookie: () => clearRecoveryCookie(),
  isRecoveryUnlocked: () => isRecoveryUnlocked(),
}));

/** GoTrue's own shape: an API error carrying a status and a code. */
function apiError(code: string, status = 400) {
  return new AuthApiError(`gotrue says ${code}`, status, code);
}

const NEUTRAL_COPY_HOLDS = { ok: true, data: null };

describe("requestPasswordReset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
  });

  /**
   * **Do not "fix" this by routing the code through
   * `requestPasswordResetErrorMessage`.** A distinct rate-limit message here is
   * an account-enumeration oracle, and it is the oracle the neutral copy exists
   * to close: GoTrue enforces `max_frequency` against the *user row*, so an
   * address with no account asked twice returns 200/200 while an address with
   * one returns 200 then 429. Reporting the second as an error tells any
   * visitor, in two clicks, which addresses have accounts (§8.5).
   *
   * Reporting it as success is not a lie either — the code means a mail was
   * recently sent to that address, which is exactly what the neutral copy
   * claims happened.
   */
  it("reports over_email_send_rate_limit as success, because a rate-limit message would be an enumeration oracle", async () => {
    resetPasswordForEmail.mockResolvedValue({
      data: null,
      error: apiError("over_email_send_rate_limit", 429),
    });

    const result = await requestPasswordReset({ email: "known@example.com" });

    expect(result).toEqual(NEUTRAL_COPY_HOLDS);
  });

  // The other half of the same rule: GoTrue is silent about an unknown address,
  // and the action must not become chattier than GoTrue.
  it("says the same thing for an address with no account", async () => {
    const unknown = await requestPasswordReset({
      email: "nobody@example.com",
    });
    resetPasswordForEmail.mockResolvedValue({
      data: null,
      error: apiError("over_email_send_rate_limit", 429),
    });
    const known = await requestPasswordReset({ email: "known@example.com" });

    expect(unknown).toEqual(NEUTRAL_COPY_HOLDS);
    expect(known).toEqual(unknown);
  });

  // Anything unrecognised is about the account, not the input — including codes
  // that do not exist yet. Silence is the default.
  it("stays neutral for any other error GoTrue returns", async () => {
    resetPasswordForEmail.mockResolvedValue({
      data: null,
      error: apiError("user_banned", 400),
    });

    expect(await requestPasswordReset({ email: "banned@example.com" })).toEqual(
      NEUTRAL_COPY_HOLDS,
    );
  });

  // The only refusals allowed: facts about the input itself, which say nothing
  // about who has an account.
  it.each(["email_address_invalid", "validation_failed"])(
    "refuses %s, the one class of error that is about the input",
    async (code) => {
      resetPasswordForEmail.mockResolvedValue({
        data: null,
        error: apiError(code),
      });

      expect(await requestPasswordReset({ email: "user@example.com" })).toEqual(
        { ok: false, error: "Enter a valid email address." },
      );
    },
  );

  it("surfaces an unconfigured project rather than throwing", async () => {
    resetPasswordForEmail.mockRejectedValue(new Error("no env vars"));

    const result = await requestPasswordReset({ email: "user@example.com" });

    expect(result.ok).toBe(false);
  });

  /**
   * No route-cache purge from here, and this test is the reason it stays that
   * way: the action creates no session and changes nothing a Server Component
   * renders, while the endpoint is reachable by an anonymous visitor — so a
   * `revalidatePath("/", "layout")` added for symmetry with `signIn` would put
   * a whole-app cache purge one unauthenticated submit away, in a loop.
   */
  it("never purges the route cache from an unauthenticated endpoint", async () => {
    await requestPasswordReset({ email: "user@example.com" });

    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("refuses a malformed address without asking GoTrue", async () => {
    const result = await requestPasswordReset({ email: "not-an-address" });

    expect(result).toEqual({
      ok: false,
      error: "Enter a valid email address.",
    });
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
  });
});

describe("updatePassword", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    // `clearAllMocks` clears calls, not implementations, so the default is
    // restored here rather than leaking a refusal into the next test.
    isRecoveryUnlocked.mockResolvedValue(true);
  });

  /**
   * The assumption the whole expired-link message rests on, and nothing else
   * verifies it: with no session, `updateUser` returns an error whose `code` is
   * **`undefined`** and whose `status` is **400**. A mapper shaped like
   * `signInErrorMessage` — `switch (error.code)` with a `status === 400`
   * default — would report "Could not update your password. Please try again."
   * to a user whose real problem is a dead recovery session and whose real
   * answer is "request a new link".
   */
  it("assumes the SDK shape it detects on", () => {
    const error = new AuthSessionMissingError();

    expect(error.code).toBeUndefined();
    expect(error.status).toBe(400);
    expect(error.name).toBe("AuthSessionMissingError");
  });

  it("maps a missing session to the expired-link message, not to the generic default", async () => {
    updateUser.mockResolvedValue({
      data: { user: null },
      error: new AuthSessionMissingError(),
    });

    const result = await updatePassword({ password: "correct horse" });

    expect(result).toEqual({
      ok: false,
      error: "That reset link has expired. Request a new one.",
    });
  });

  it.each(["session_not_found", "bad_jwt", "session_expired"])(
    "maps %s to the expired-link message too",
    async (code) => {
      updateUser.mockResolvedValue({
        data: { user: null },
        error: apiError(code, 401),
      });

      expect(await updatePassword({ password: "correct horse" })).toEqual({
        ok: false,
        error: "That reset link has expired. Request a new one.",
      });
    },
  );

  it("keeps the generic default for an error that is not about the session", async () => {
    updateUser.mockResolvedValue({
      data: { user: null },
      error: apiError("unexpected_failure", 500),
    });

    expect(await updatePassword({ password: "correct horse" })).toEqual({
      ok: false,
      error: "Could not update your password. Please try again.",
    });
  });

  it("clears the recovery marker once the password is actually changed", async () => {
    const result = await updatePassword({ password: "correct horse" });

    expect(result).toEqual({ ok: true, data: null });
    expect(clearRecoveryCookie).toHaveBeenCalledTimes(1);
  });

  // The marker still gates a form the user may legitimately need: a refusal
  // that leaves the recovery session intact must leave them able to retry.
  it("keeps the marker when the refusal is about the password", async () => {
    updateUser.mockResolvedValue({
      data: { user: null },
      error: apiError("same_password"),
    });

    await updatePassword({ password: "correct horse" });

    expect(clearRecoveryCookie).not.toHaveBeenCalled();
  });

  /**
   * The dead end otherwise: the session died, the marker did not, so
   * `/reset-password` renders a form that can only ever be refused and nothing
   * ever clears the cookie. Clearing it here means the next visit lands on
   * `/forgot-password` and a new link (§4.2.2).
   */
  it("clears the marker when the session it belonged to is gone", async () => {
    updateUser.mockResolvedValue({
      data: { user: null },
      error: new AuthSessionMissingError(),
    });

    await updatePassword({ password: "correct horse" });

    expect(clearRecoveryCookie).toHaveBeenCalledTimes(1);
  });

  /**
   * A cookie delete is bookkeeping after the password has already changed. If a
   * throw from it were reported, the user would be told their successful change
   * failed, would not navigate, would retry — and would be told "That is
   * already your password." about the password they just set.
   */
  it("still reports success when clearing the marker fails", async () => {
    clearRecoveryCookie.mockRejectedValueOnce(new Error("cookie jar closed"));

    expect(await updatePassword({ password: "correct horse" })).toEqual({
      ok: true,
      data: null,
    });
  });

  /**
   * The property the whole gate claims, asserted where it is enforced rather
   * than where it is displayed. `/reset-password` refusing to render is a
   * convenience: this action is a network-reachable endpoint, so a signed-in
   * user who crafts the POST bypasses the page entirely — and would otherwise
   * change their own password with no old password asked for, which is the
   * change-password surface §8.5 says the product does not offer. §4.2.2 and
   * §8.1.1 both settle this shape the same way: the function, not the page, is
   * the enforcement.
   *
   * `updateUser` must never be reached, or the refusal is cosmetic.
   */
  it("refuses a caller the recovery marker does not name, without ever calling updateUser", async () => {
    isRecoveryUnlocked.mockResolvedValue(false);

    const result = await updatePassword({ password: "correct horse" });

    expect(result).toEqual({
      ok: false,
      error: "That reset link has expired. Request a new one.",
    });
    expect(updateUser).not.toHaveBeenCalled();
  });

  // Both states the gate collapses into one answer: no marker at all (a
  // signed-in user typing their way in) and a marker naming somebody else (the
  // shared browser whose previous visitor followed a reset link). Same refusal,
  // same remedy — request a new link.
  it("drops the stale marker when it refuses, so the retry is not the same refusal", async () => {
    isRecoveryUnlocked.mockResolvedValue(false);

    await updatePassword({ password: "correct horse" });

    expect(clearRecoveryCookie).toHaveBeenCalledTimes(1);
  });

  // The gate must not swallow the case it is named after: a marker that agrees
  // with the session goes through, and GoTrue stays the authority on whether
  // that session is still alive.
  it("lets a live recovery through to GoTrue", async () => {
    await updatePassword({ password: "correct horse" });

    expect(isRecoveryUnlocked).toHaveBeenCalledTimes(1);
    expect(updateUser).toHaveBeenCalledWith({ password: "correct horse" });
  });

  it("refuses a too-short password without asking GoTrue", async () => {
    const result = await updatePassword({ password: "short" });

    expect(result.ok).toBe(false);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("surfaces an unconfigured project rather than throwing", async () => {
    updateUser.mockRejectedValue(new Error("no env vars"));

    const result = await updatePassword({ password: "correct horse" });

    expect(result.ok).toBe(false);
    expect(clearRecoveryCookie).not.toHaveBeenCalled();
  });
});
