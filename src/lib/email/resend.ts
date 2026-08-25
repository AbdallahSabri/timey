import { Resend } from "resend";

/**
 * Transactional email delivery (`BLOCKERS.md` N-6), shared across
 * `lib/actions/**` the way `lib/time/**` shares wall-clock resolution — one
 * place to hold the provider decision so a `'use server'` module never talks
 * to Resend directly.
 *
 * **Absence is not an error.** `RESEND_API_KEY` / `EMAIL_FROM` are unset on a
 * freshly forked template, same as the Supabase env vars `CLAUDE.md`
 * describes — the app, and specifically invitation creation, must keep
 * working with email delivery simply not attempted. Callers get
 * `{ ok: false }` either way and choose what that means for them; this module
 * never throws.
 */

export type SendEmailResult = { ok: true } | { ok: false; error: string };

export async function sendEmail(input: {
  to: string;
  subject: string;
  html: string;
}): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    return { ok: false, error: "Email delivery is not configured." };
  }

  try {
    const { error } = await new Resend(apiKey).emails.send({
      from,
      to: input.to,
      subject: input.subject,
      html: input.html,
    });

    if (error) {
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not reach the email provider." };
  }
}

/**
 * The only escaping this module needs: company names and email addresses
 * dropped into an HTML body. Not a security boundary (email clients are not
 * a script-execution context the way a browser is) — just correct rendering,
 * so a company named "R&D" doesn't become "R" followed by a dangling
 * ampersand.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
