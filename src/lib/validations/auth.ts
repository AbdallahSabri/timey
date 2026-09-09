import { z } from "zod";

/**
 * Mirrors `supabase/config.toml` -> `[auth] minimum_password_length = 6`.
 * Supabase rejects anything shorter server-side; validating with a different
 * number here would either surface a raw GoTrue error or refuse a password
 * the platform would have accepted. Keep the two in step.
 */
export const MIN_PASSWORD_LENGTH = 6;

/**
 * bcrypt — which GoTrue uses — silently truncates past 72 bytes. Reject rather
 * than accept a password whose tail does nothing.
 */
export const MAX_PASSWORD_LENGTH = 72;

export const MAX_FULL_NAME_LENGTH = 120;
export const MAX_COMPANY_NAME_LENGTH = 120;

/** `companies_max_timer_hours_range` in `0002_tenancy_core.sql` (§3.1, §5.4). */
export const MIN_TIMER_HOURS = 1;
export const MAX_TIMER_HOURS = 168;

/**
 * Exported because every address the product accepts — sign-in, sign-up, and
 * the invited address in `invitations.email` — must normalise identically.
 * `citext` makes the database case-insensitive; lowercasing here keeps what we
 * *send* stable too, so a delete-then-insert re-invite (§8.4) matches the row
 * it means to replace.
 */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Email is required.")
  .max(254, "That email address is too long.")
  .pipe(z.email("Enter a valid email address."));

const passwordSchema = z
  .string()
  .min(
    MIN_PASSWORD_LENGTH,
    `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
  )
  .max(
    MAX_PASSWORD_LENGTH,
    `Password must be at most ${MAX_PASSWORD_LENGTH} characters.`,
  );

export const signUpSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(1, "Your name is required.")
    .max(MAX_FULL_NAME_LENGTH, "That name is too long."),
  email: emailSchema,
  password: passwordSchema,
});

export const signInSchema = z.object({
  email: emailSchema,
  // No strength rules on sign-in: an existing password predates any rule we
  // add later, and echoing strength requirements at a returning user is noise.
  password: z.string().min(1, "Password is required."),
});

/**
 * §8.5. Only the address — the recovery destination is fixed by the email
 * template (`{{ .SiteURL }}/auth/reset?token_hash=…`), never by the request,
 * because `next` on a token that grants a session is caller-controlled reach.
 */
export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

/**
 * The new password after a recovery link, so it carries the full strength rules
 * `signUpSchema` does — this is the one other place in the product where a
 * password is *chosen* rather than typed back.
 */
export const resetPasswordSchema = z.object({
  password: passwordSchema,
});

/**
 * `Intl` carries the IANA database the runtime already ships — cheaper and
 * more current than any list we could hand-roll. The authoritative check still
 * happens in Postgres (`companies_validate_timezone` against
 * `pg_timezone_names`, §4.2.1); this only keeps an obvious typo out of the RPC.
 */
function isSupportedTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * Both optional company settings accept the string an HTML control actually
 * submits as well as a number, and treat `""` / absent as "not supplied" so
 * the `create_company()` defaults apply.
 *
 * `z.coerce` is deliberately avoided: it turns an untouched `<select>` (`""`)
 * into `0`, which is a *valid* `weekStartsOn` and would silently start the
 * company's week on Sunday.
 *
 * 0 = Sunday, 1 = Monday — `companies_week_starts_on_valid` (§3.1).
 */
const weekStartsOnField = z
  .union(
    [z.literal(0), z.literal(1), z.literal("0"), z.literal("1"), z.literal("")],
    "Week must start on Sunday or Monday.",
  )
  .optional()
  .transform((value) =>
    value === "" || value === undefined ? undefined : (Number(value) as 0 | 1),
  );

const maxTimerHoursField = z
  .union([z.number(), z.string()], "Enter a whole number of hours.")
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed === "" ? undefined : Number(trimmed);
    }
    return value;
  })
  .pipe(
    z
      .int("Enter a whole number of hours.")
      .min(MIN_TIMER_HOURS, `Must be at least ${MIN_TIMER_HOURS} hour.`)
      .max(MAX_TIMER_HOURS, `Must be at most ${MAX_TIMER_HOURS} hours.`)
      .optional(),
  );

/** Field names map 1:1 onto `create_company(p_name, p_timezone, p_week_starts_on, p_max_timer_hours)`. */
export const createCompanySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Company name is required.")
    .max(MAX_COMPANY_NAME_LENGTH, "That company name is too long."),
  timezone: z
    .string()
    .trim()
    .min(1, "Timezone is required.")
    .refine(isSupportedTimeZone, "Pick a valid IANA timezone."),
  weekStartsOn: weekStartsOnField,
  maxTimerHours: maxTimerHoursField,
});

export type SignUpInput = z.infer<typeof signUpSchema>;
export type SignInInput = z.infer<typeof signInSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/** What `createCompany()` accepts — strings from form controls included. */
export type CreateCompanyInput = z.input<typeof createCompanySchema>;

/** What the schema yields after parsing: the shape sent to the RPC. */
export type CreateCompanyValues = z.infer<typeof createCompanySchema>;
