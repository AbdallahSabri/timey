"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
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
import { createClient } from "@/lib/actions/clients";
import { clientSchema, type ClientInput } from "@/lib/validations/structure";

import type { z } from "zod";

type ClientValues = z.output<typeof clientSchema>;

/**
 * §3.3. A duplicate name is refused by `clients (company_id, lower(name))
 * WHERE archived_at IS NULL` and the action words that refusal — nothing here
 * pre-checks the existing list, because a check against a list rendered a
 * moment ago answers a different question than the index does.
 */
export function CreateClientForm() {
  const router = useRouter();

  const form = useForm<ClientInput, unknown, ClientValues>({
    resolver: zodResolver(clientSchema),
    defaultValues: { name: "" },
  });

  const {
    formState: { errors, isSubmitting },
  } = form;

  async function onSubmit(values: ClientValues) {
    const result = await createClient(values);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    toast.success(`${result.data.name} has been added.`);
    form.reset({ name: "" });
    // The list is a Server Component; without this the new client only appears
    // on the next full navigation.
    router.refresh();
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FieldGroup>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <Field
            className="flex-1"
            data-invalid={errors.name ? true : undefined}
          >
            <FieldLabel htmlFor="client-name">Client name</FieldLabel>
            <Input
              id="client-name"
              autoComplete="off"
              placeholder="Acme Corp"
              aria-invalid={errors.name ? true : undefined}
              {...form.register("name")}
            />
            <FieldError errors={errors.name ? [errors.name] : undefined} />
          </Field>

          <Button type="submit" className="sm:mt-6" disabled={isSubmitting}>
            {isSubmitting ? "Adding client…" : "Add client"}
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}
