/**
 * Where an auth form sends the user once it succeeds.
 *
 * `/invite/{token}` (§8.1 Path B) needs the invitee to come back to the accept
 * page rather than the hardcoded `/onboarding` or `/dashboard`, so both auth
 * pages accept a `?next=` destination. That value comes from a URL, which means
 * it is attacker-supplied: `?next=https://evil.example` would turn either form
 * into an open redirect that borrows this app's credibility.
 *
 * This is **not** the security boundary — middleware (§8.3) and RLS still
 * decide what any account may actually reach, and this only picks a
 * client-side navigation target. It is still a bug worth not shipping.
 */
function hasUnsafeCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    // Everything at or below U+0020 (space and the C0 controls) plus U+007F.
    // Tab, newline and carriage return are stripped during URL parsing, so a
    // path containing them passes a naive prefix check and is then navigated
    // to as something else entirely.
    if (code <= 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

/**
 * Accepted: a same-origin absolute path — one leading `/`, then anything.
 * Rejected, each for a specific reason:
 * - no leading `/` — `evil.example/x` is a relative path today and a host the
 *   moment it is concatenated onto an origin.
 * - `//host` — protocol-relative; browsers read it as another origin.
 * - `/\host` — browsers normalise the backslash to `/`, so it is `//host`.
 * - whitespace or control characters — see above.
 */
export function safeNextPath(
  next: string | null | undefined,
  fallback: string,
): string {
  if (typeof next !== "string" || next.length === 0) {
    return fallback;
  }
  if (!next.startsWith("/")) {
    return fallback;
  }
  if (next.startsWith("//") || next.startsWith("/\\")) {
    return fallback;
  }
  if (hasUnsafeCharacters(next)) {
    return fallback;
  }
  return next;
}

/**
 * The `?next=` query string to hang off a link, or `""` when the destination
 * is the default one. Kept here so the invite page and the auth pages agree on
 * the parameter name.
 */
export function nextParam(next: string | null | undefined): string {
  return typeof next === "string" && next.length > 0
    ? `?next=${encodeURIComponent(next)}`
    : "";
}
