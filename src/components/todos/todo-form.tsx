"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import {
  Field,
  FieldContent,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { createTodoSchema, type CreateTodoInput } from "@/lib/validations/todo";

interface TodoFormProps {
  onSubmit: (input: CreateTodoInput) => Promise<void>;
}

export function TodoForm({ onSubmit }: TodoFormProps) {
  const form = useForm<CreateTodoInput>({
    resolver: zodResolver(createTodoSchema),
    defaultValues: { title: "" },
  });

  const handleSubmit = form.handleSubmit(async (values) => {
    await onSubmit(values);
    form.reset();
  });

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <Field data-invalid={!!form.formState.errors.title}>
        <FieldLabel htmlFor="title">Title</FieldLabel>
        <FieldContent>
          <Input
            id="title"
            placeholder="Write the demo doc"
            autoComplete="off"
            {...form.register("title")}
          />
          <FieldError errors={[form.formState.errors.title]} />
        </FieldContent>
      </Field>
      <Button type="submit" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting ? "Adding…" : "Add todo"}
      </Button>
    </form>
  );
}
