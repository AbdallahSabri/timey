"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { requestPasswordReset } from "@/lib/actions/auth";
import {
  forgotPasswordSchema,
  type ForgotPasswordInput,
} from "@/lib/validations/auth";

/**
 * §8.5. Asks for a recovery link, and never says whether the address has an
 * account.
 *
 * **The copy below is the security property, not decoration.** The action
 * returns `ok: true` for an address with no account *and* for a resend GoTrue
 * refused with `over_email_send_rate_limit` — both deliberately, because a
 * distinct answer to either is an account-enumeration oracle (the same rule
 * that makes sign-in say "Incorrect email or password."). So the terminal state
 * must claim only that a link is on its way *if* an account exists; anything
 * that asserts an email was actually sent turns `ok: true` back into the
 * confirmation this flow spent that effort not giving. Do not "improve" it into
 * one.
 *
 * For the same reason the terminal copy does not echo the submitted address:
 * the rendered string is byte-identical for a known and an unknown address, and
 * `forgot-password-form.test.tsx` asserts exactly that.
 */
export function ForgotPasswordForm() {
  const [requested, setRequested] = useState(false);

  const form = useForm<ForgotPasswordInput, unknown, ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  const {
    formState: { errors, isSubmitting },
  } = form;

  async function onSubmit(values: ForgotPasswordInput) {
    const result = await requestPasswordReset(values);

    if (!result.ok) {
      // Only a fact about the input (a malformed address) or an unconfigured
      // project reaches here — never a fact about the account. Wording is the
      // action's; render it verbatim.
      toast.error(result.error);
      return;
    }

    setRequested(true);
  }

  if (requested) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2" role="status">
          <p className="text-sm font-medium">Check your email</p>
          <p className="text-muted-foreground text-sm">
            If an account exists for that address, a reset link is on its way.
            Open it to choose a new password. Check your spam folder if nothing
            arrives.
          </p>
        </div>
        {/* Without this the neutral state is a dead end for the one user it
            reads wrong for: someone who mistyped their own address and has no
            way back to the field (§4.2.2). The typed value is kept so a typo
            can be corrected rather than retyped. */}
        <Button
          type="button"
          variant="outline"
          className="self-start"
          onClick={() => setRequested(false)}
        >
          Try a different address
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FieldGroup>
        <Field data-invalid={errors.email ? true : undefined}>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            aria-invalid={errors.email ? true : undefined}
            {...form.register("email")}
          />
          <FieldError errors={errors.email ? [errors.email] : undefined} />
        </Field>

        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Sending link…" : "Send reset link"}
        </Button>
      </FieldGroup>
    </form>
  );
}
