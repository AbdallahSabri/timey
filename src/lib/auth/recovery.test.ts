import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearRecoveryCookie,
  isRecoveryUnlocked,
  readRecoveryCookie,
  RECOVERY_COOKIE_NAME,
  setRecoveryCookie,
} from "./recovery";

/**
 * §8.5's marker cookie, tested directly — the route and page tests mock this
 * module wholesale, so without this file the binding that stops one person's
 * reset link from handing the form to the next person on the same browser has
 * no coverage at all.
 *
 * `cookies()` needs a request context Next only provides while serving, so the
 * jar is a stub: a `Map` with the three methods this module calls, recording
 * the options it was given. `getUser` is the same shape mock the route tests
 * established (`app/auth/confirm/route.test.ts`), kept to the one call the
 * module makes.
 */

type CookieOptions = Record<string, unknown>;

const jar = new Map<string, { value: string; options: CookieOptions }>();
const deleted: unknown[] = [];

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const entry = jar.get(name);
      return entry ? { name, value: entry.value } : undefined;
    },
    set: (name: string, value: string, options: CookieOptions) => {
      jar.set(name, { value, options });
    },
    delete: (target: { name: string }) => {
      deleted.push(target);
      jar.delete(target.name);
    },
  }),
}));

const getUser = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));

const ALICE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BOB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function signedInAs(id: string) {
  return { data: { user: { id } }, error: null };
}

describe("the recovery marker cookie", () => {
  beforeEach(() => {
    jar.clear();
    deleted.length = 0;
    vi.clearAllMocks();
  });

  it("stores the recovering user's id, not a bare flag", async () => {
    await setRecoveryCookie(ALICE);

    expect(jar.get(RECOVERY_COOKIE_NAME)?.value).toBe(ALICE);
    expect(await readRecoveryCookie()).toBe(ALICE);
  });

  // Not a credential, but a marker a browser must not be able to keep or a
  // script read: the cookie's job is gating a route, and it should survive
  // exactly as long as the flow it accompanies.
  it("is httpOnly, lax, site-wide and short-lived", async () => {
    await setRecoveryCookie(ALICE);

    expect(jar.get(RECOVERY_COOKIE_NAME)?.options).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 15 * 60,
    });
  });

  it("reads as null when nothing was ever set", async () => {
    expect(await readRecoveryCookie()).toBeNull();
  });

  // Deleted with the same path it was written with, or the browser keeps a
  // second copy of the cookie the delete did not match.
  it("clears the marker", async () => {
    await setRecoveryCookie(ALICE);

    await clearRecoveryCookie();

    expect(await readRecoveryCookie()).toBeNull();
    expect(deleted).toEqual([{ name: RECOVERY_COOKIE_NAME, path: "/" }]);
  });

  it("unlocks the form for the user the marker names", async () => {
    await setRecoveryCookie(ALICE);
    getUser.mockResolvedValue(signedInAs(ALICE));

    expect(await isRecoveryUnlocked()).toBe(true);
  });

  /**
   * The shared-machine case, and the reason the value is an id at all. Alice
   * follows her reset link and walks away; Bob signs in on the same browser
   * inside the marker's lifetime. A marker that only said "some recovery
   * happened here" would render Bob a form whose submit changes *Bob's*
   * password on Bob's session — the change-password surface §8.5 says does not
   * exist, with no old password asked for.
   */
  it("refuses a marker belonging to somebody other than the signed-in user", async () => {
    await setRecoveryCookie(ALICE);
    getUser.mockResolvedValue(signedInAs(BOB));

    expect(await isRecoveryUnlocked()).toBe(false);
  });

  it("refuses when there is no marker at all", async () => {
    getUser.mockResolvedValue(signedInAs(ALICE));

    expect(await isRecoveryUnlocked()).toBe(false);
    // Nothing to compare against, so nothing is asked of Supabase.
    expect(getUser).not.toHaveBeenCalled();
  });

  // The stale-marker state: the recovery session died but the cookie survived.
  // Fails closed — the form would have nothing to submit against.
  it("refuses a marker whose session is gone", async () => {
    await setRecoveryCookie(ALICE);
    getUser.mockResolvedValue({
      data: { user: null },
      error: { name: "AuthSessionMissingError", status: 400 },
    });

    expect(await isRecoveryUnlocked()).toBe(false);
  });

  it("refuses when the Supabase client cannot be reached at all", async () => {
    await setRecoveryCookie(ALICE);
    getUser.mockRejectedValue(new Error("not configured"));

    expect(await isRecoveryUnlocked()).toBe(false);
  });
});
