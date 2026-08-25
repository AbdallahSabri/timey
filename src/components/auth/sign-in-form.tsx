"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { safeNextPath } from "@/components/auth/next-path";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { signIn } from "@/lib/actions/auth";
import { signInSchema, type SignInInput } from "@/lib/validations/auth";

/**
 * `next` carries an invitee back to `/invite/{token}` after signing in (§8.1
 * Path B) instead of dropping them on the dashboard of a company they have not
 * joined yet. Absent or unusable, the destination is the previous hardcoded
 * one — see `safeNextPath` for what "unusable" means.
 */
export function SignInForm({ next }: { next?: string }) {
  const router = useRouter();
  const destination = safeNextPath(next, "/dashboard");

  const form = useForm<SignInInput, unknown, SignInInput>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: "", password: "" },
  });

  const {
    formState: { errors, isSubmitting },
  } = form;

  async function onSubmit(values: SignInInput) {
    const result = await signIn(values);

    if (!result.ok) {
      // Wording is the action's (anti-enumeration, §8) — render it verbatim.
      toast.error(result.error);
      return;
    }

    // Middleware owns the destination from here: a user still in limbo (§8.3)
    // is bounced on to /onboarding without this form knowing or asking —
    // except on `/invite/`, which middleware lets through in every auth state.
    router.replace(destination);
    router.refresh();
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

        <Field data-invalid={errors.password ? true : undefined}>
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            aria-invalid={errors.password ? true : undefined}
            {...form.register("password")}
          />
          <FieldError
            errors={errors.password ? [errors.password] : undefined}
          />
        </Field>

        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Signing in…" : "Sign in"}
        </Button>
      </FieldGroup>
    </form>
  );
}
