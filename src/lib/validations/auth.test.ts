import { describe, expect, test } from "vitest";

import {
  emailSchema,
  forgotPasswordSchema,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  resetPasswordSchema,
} from "./auth";

/**
 * Everything here is pure — no Supabase, no clock. These are about the
 * boundary agreeing with what the platform behind it enforces: `citext` and
 * `invitations.email` for normalisation, `[auth] minimum_password_length` and
 * bcrypt's 72-byte truncation for the length bounds. A disagreement surfaces to
 * the user as a raw GoTrue error, or as a re-invite that silently fails to
 * match the row it meant to replace.
 *
 * Exact message strings are asserted, not just `success`, because these strings
 * are what `firstIssue()` hands to the form.
 */

describe("emailSchema", () => {
  test("trims and lowercases, so every surface normalises identically", () => {
    // Sign-in, sign-up and `invitations.email` must all produce this same
    // string for the same human address, or a delete-then-insert re-invite
    // (§8.4) stops matching the row it means to replace.
    expect(emailSchema.parse("  Ada@Example.COM  ")).toBe("ada@example.com");
  });

  test("a blank address says so rather than failing the format check", () => {
    const result = emailSchema.safeParse("   ");

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Email is required.");
  });

  test("refuses an address past 254 characters", () => {
    const local = "a".repeat(255 - "@example.com".length);
    const tooLong = `${local}@example.com`;
    expect(tooLong).toHaveLength(255);

    const refused = emailSchema.safeParse(tooLong);
    expect(refused.success).toBe(false);
    expect(refused.error?.issues[0]?.message).toBe(
      "That email address is too long.",
    );

    // The bound itself is inclusive — 254 is still accepted.
    const atTheLimit = `${"a".repeat(254 - "@example.com".length)}@example.com`;
    expect(atTheLimit).toHaveLength(254);
    expect(emailSchema.safeParse(atTheLimit).success).toBe(true);
  });
});

describe("forgotPasswordSchema", () => {
  test("surfaces a readable message for a malformed address", () => {
    const result = forgotPasswordSchema.safeParse({ email: "not-an-address" });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      "Enter a valid email address.",
    );
  });

  test("accepts and normalises the address it will mail", () => {
    const result = forgotPasswordSchema.safeParse({
      email: " Ada@Example.com ",
    });

    expect(result.success).toBe(true);
    expect(result.data?.email).toBe("ada@example.com");
  });
});

describe("resetPasswordSchema", () => {
  test("refuses one character short of the platform minimum", () => {
    const result = resetPasswordSchema.safeParse({
      password: "a".repeat(MIN_PASSWORD_LENGTH - 1),
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    );
  });

  test("accepts exactly the platform minimum", () => {
    expect(
      resetPasswordSchema.safeParse({
        password: "a".repeat(MIN_PASSWORD_LENGTH),
      }).success,
    ).toBe(true);
  });

  test("refuses one character past bcrypt's truncation point", () => {
    const result = resetPasswordSchema.safeParse({
      password: "a".repeat(MAX_PASSWORD_LENGTH + 1),
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      `Password must be at most ${MAX_PASSWORD_LENGTH} characters.`,
    );
  });

  test("accepts exactly 72, the last length bcrypt keeps whole", () => {
    expect(
      resetPasswordSchema.safeParse({
        password: "a".repeat(MAX_PASSWORD_LENGTH),
      }).success,
    ).toBe(true);
  });
});
