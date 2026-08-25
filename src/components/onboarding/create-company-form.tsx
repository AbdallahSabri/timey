"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
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
import { createCompany } from "@/lib/actions/companies";
import { cn } from "@/lib/utils";
import {
  createCompanySchema,
  MAX_TIMER_HOURS,
  MIN_TIMER_HOURS,
  type CreateCompanyInput,
  type CreateCompanyValues,
} from "@/lib/validations/auth";

/** Matches `Input`'s surface so the native select reads as one of the family. */
const selectClassName =
  "border-input focus-visible:border-ring focus-visible:ring-ring/50 disabled:bg-input/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:bg-input/30 dark:aria-invalid:border-destructive/50 h-8 w-full min-w-0 rounded-lg border bg-transparent px-2.5 py-1 text-base transition-colors outline-none focus-visible:ring-3 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-3 md:text-sm";

export function CreateCompanyForm({ timezones }: { timezones: string[] }) {
  const router = useRouter();

  // The schema transforms (`""` -> undefined, string -> number), so the form
  // holds the input shape and `handleSubmit` hands back the parsed one.
  const form = useForm<CreateCompanyInput, unknown, CreateCompanyValues>({
    resolver: zodResolver(createCompanySchema),
    defaultValues: {
      name: "",
      // Empty on the server and on first paint alike — the browser's zone is
      // filled in below, after hydration, so the two renders can't disagree.
      timezone: "",
      weekStartsOn: "",
      maxTimerHours: "",
    },
  });

  const {
    formState: { errors, isSubmitting },
    setValue,
  } = form;

  useEffect(() => {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (detected && timezones.includes(detected)) {
      setValue("timezone", detected);
    }
  }, [setValue, timezones]);

  async function onSubmit(values: CreateCompanyValues) {
    const result = await createCompany(values);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    router.replace("/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FieldGroup>
        <Field data-invalid={errors.name ? true : undefined}>
          <FieldLabel htmlFor="name">Company name</FieldLabel>
          <Input
            id="name"
            autoComplete="organization"
            aria-invalid={errors.name ? true : undefined}
            {...form.register("name")}
          />
          <FieldError errors={errors.name ? [errors.name] : undefined} />
        </Field>

        <Field data-invalid={errors.timezone ? true : undefined}>
          <FieldLabel htmlFor="timezone">Timezone</FieldLabel>
          <select
            id="timezone"
            className={selectClassName}
            aria-invalid={errors.timezone ? true : undefined}
            {...form.register("timezone")}
          >
            <option value="">Select a timezone…</option>
            {timezones.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
          {errors.timezone ? (
            <FieldError errors={[errors.timezone]} />
          ) : (
            <FieldDescription>
              Days, weeks, and report totals are bucketed in this zone.
            </FieldDescription>
          )}
        </Field>

        <details className="group border-border rounded-lg border px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium select-none">
            Company settings
            <span className="text-muted-foreground ml-2 font-normal">
              optional
            </span>
          </summary>

          <FieldGroup className="mt-4 mb-1">
            <Field data-invalid={errors.weekStartsOn ? true : undefined}>
              <FieldLabel htmlFor="weekStartsOn">Week starts on</FieldLabel>
              <select
                id="weekStartsOn"
                className={cn(selectClassName, "max-w-56")}
                aria-invalid={errors.weekStartsOn ? true : undefined}
                {...form.register("weekStartsOn")}
              >
                <option value="">Monday (default)</option>
                <option value="1">Monday</option>
                <option value="0">Sunday</option>
              </select>
              <FieldError
                errors={errors.weekStartsOn ? [errors.weekStartsOn] : undefined}
              />
            </Field>

            <Field data-invalid={errors.maxTimerHours ? true : undefined}>
              <FieldLabel htmlFor="maxTimerHours">
                Timer goes stale after
              </FieldLabel>
              <Input
                id="maxTimerHours"
                type="number"
                inputMode="numeric"
                min={MIN_TIMER_HOURS}
                max={MAX_TIMER_HOURS}
                step={1}
                placeholder="12"
                className="max-w-56"
                aria-invalid={errors.maxTimerHours ? true : undefined}
                {...form.register("maxTimerHours")}
              />
              {errors.maxTimerHours ? (
                <FieldError errors={[errors.maxTimerHours]} />
              ) : (
                <FieldDescription>
                  Hours before a running timer is flagged as left on. Defaults
                  to 12.
                </FieldDescription>
              )}
            </Field>
          </FieldGroup>
        </details>

        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Creating company…" : "Create company"}
        </Button>
      </FieldGroup>
    </form>
  );
}
