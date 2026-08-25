"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
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
import { signUp } from "@/lib/actions/auth";
import {
  MIN_PASSWORD_LENGTH,
  signUpSchema,
  type SignUpInput,
} from "@/lib/validations/auth";

export function SignUpForm() {
  const router = useRouter();
  const [confirmationEmail, setConfirmationEmail] = useState<string | null>(
    null,
  );

  const form = useForm<SignUpInput, unknown, SignUpInput>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { fullName: "", email: "", password: "" },
  });

  const {
    formState: { errors, isSubmitting },
  } = form;

  async function onSubmit(values: SignUpInput) {
    const result = await signUp(values);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    if (result.data.confirmationRequired) {
      // No session came back, so there is nothing to navigate to yet.
      setConfirmationEmail(values.email);
      return;
    }

    // A brand-new account has no company, so §8.3 puts it in limbo and
    // onboarding is the only route it can reach.
    router.replace("/onboarding");
    router.refresh();
  }

  if (confirmationEmail) {
    return (
      <div className="flex flex-col gap-2" role="status">
        <p className="text-sm font-medium">Check your email</p>
        <p className="text-muted-foreground text-sm">
          We sent a confirmation link to{" "}
          <span className="text-foreground font-medium">
            {confirmationEmail}
          </span>
          . Open it to finish setting up your account, then sign in.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FieldGroup>
        <Field data-invalid={errors.fullName ? true : undefined}>
          <FieldLabel htmlFor="fullName">Full name</FieldLabel>
          <Input
            id="fullName"
            autoComplete="name"
            aria-invalid={errors.fullName ? true : undefined}
            {...form.register("fullName")}
          />
          <FieldError
            errors={errors.fullName ? [errors.fullName] : undefined}
          />
        </Field>

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

        <Field data-invalid={errors.password ? true : undefined}>
          <FieldLabel htmlFor="password">Password</FieldLabel>
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
          {isSubmitting ? "Creating account…" : "Create account"}
        </Button>
      </FieldGroup>
    </form>
  );
}
