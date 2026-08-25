import { afterEach, describe, expect, it, vi } from "vitest";

import { escapeHtml, sendEmail } from "@/lib/email/resend";

describe("sendEmail", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reports not-configured rather than throwing when RESEND_API_KEY is unset", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("EMAIL_FROM", "invites@example.com");

    const result = await sendEmail({
      to: "a@example.com",
      subject: "Test",
      html: "<p>hi</p>",
    });

    expect(result).toEqual({
      ok: false,
      error: "Email delivery is not configured.",
    });
  });

  it("reports not-configured rather than throwing when EMAIL_FROM is unset", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("EMAIL_FROM", "");

    const result = await sendEmail({
      to: "a@example.com",
      subject: "Test",
      html: "<p>hi</p>",
    });

    expect(result).toEqual({
      ok: false,
      error: "Email delivery is not configured.",
    });
  });
});

describe("escapeHtml", () => {
  it("escapes the five HTML-significant characters", () => {
    expect(escapeHtml(`R&D <script>"quote" 'single'</script>`)).toBe(
      "R&amp;D &lt;script&gt;&quot;quote&quot; &#39;single&#39;&lt;/script&gt;",
    );
  });

  it("leaves ordinary text untouched", () => {
    expect(escapeHtml("Acme Corp")).toBe("Acme Corp");
  });
});
