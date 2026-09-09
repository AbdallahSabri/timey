"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { updatePassword } from "@/lib/actions/auth";
import {
  MIN_PASSWORD_LENGTH,
  resetPasswordSchema,
  type ResetPasswordInput,
} from "@/lib/validations/auth";

/**
 * §8.5. Sets the new password on the recovery session `/auth/reset` created.
 *
 * **No confirm-password field, deliberately.** `SignUpForm` has none and
 * accepted the same typo risk; here the cost of a mistyped password is one more
 * reset email, not a lost account — the address that received this link can
 * always request another. A second field buys a smaller improvement than it
 * costs in a form the user reaches while already locked out.
 *
 * There is no old-password field either, and cannot be: the emailed token was
 * the proof. `updatePassword` fails with `AuthSessionMissingError` — surfaced
 * as "That reset link has expired." — if the session it needs is gone.
 */
export function ResetPasswordForm() {
  const router = useRouter();

  const form = useForm<ResetPasswordInput, unknown, ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "" },
  });

  const {
    formState: { errors, isSubmitting },
  } = form;

  async function onSubmit(values: ResetPasswordInput) {
    const result = await updatePassword(values);

    if (!result.ok) {
      // Includes the expired-link case, which reads as an instruction to
      // request a new one — so a refusal never navigates, it just says so.
      toast.error(result.error);
      return;
    }

    // Always `/dashboard`, with no special case for a user still in limbo
    // (§8.3): the recovery session is a real session, so middleware carries an
    // invitee who never onboarded on to `/onboarding` from here without this
    // form knowing which kind of user it just served.
    router.replace("/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FieldGroup>
        <Field data-invalid={errors.password ? true : undefined}>
          <FieldLabel htmlFor="password">New password</FieldLabel>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            aria-invalid={errors.password ? true : undefined}
            {...form.register("password")}
          />
          {errors.password ? (
            <FieldError errors={[errors.password]} />
          ) : (
            <FieldDescription>
              At least {MIN_PASSWORD_LENGTH} characters.
            </FieldDescription>
          )}
        </Field>

        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Saving…" : "Set new password"}
        </Button>
      </FieldGroup>
    </form>
  );
}
