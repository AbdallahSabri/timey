"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import {
  createTodoSchema,
  deleteTodoSchema,
  updateTodoSchema,
} from "@/lib/validations/todo";
import type { Database } from "@/types/supabase";

export type Todo = Database["public"]["Tables"]["todos"]["Row"];

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

function toErrorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Unexpected error";
}

export async function getTodos(): Promise<ActionResult<Todo[]>> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("todos")
      .select("*")
      .order("inserted_at", { ascending: false });

    if (error) {
      return { ok: false, error: error.message };
    }

    return { ok: true, data: data ?? [] };
  } catch (cause) {
    return { ok: false, error: toErrorMessage(cause) };
  }
}

export async function createTodo(input: unknown): Promise<ActionResult<Todo>> {
  const parsed = createTodoSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("todos")
      .insert({ title: parsed.data.title })
      .select()
      .single();

    if (error || !data) {
      return { ok: false, error: error?.message ?? "Failed to create todo" };
    }

    revalidatePath("/todos");
    return { ok: true, data };
  } catch (cause) {
    return { ok: false, error: toErrorMessage(cause) };
  }
}

export async function updateTodo(input: unknown): Promise<ActionResult<Todo>> {
  const parsed = updateTodoSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("todos")
      .update({ is_complete: parsed.data.isComplete })
      .eq("id", parsed.data.id)
      .select()
      .single();

    if (error || !data) {
      return { ok: false, error: error?.message ?? "Failed to update todo" };
    }

    revalidatePath("/todos");
    return { ok: true, data };
  } catch (cause) {
    return { ok: false, error: toErrorMessage(cause) };
  }
}

export async function deleteTodo(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = deleteTodoSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("todos")
      .delete()
      .eq("id", parsed.data.id);

    if (error) {
      return { ok: false, error: error.message };
    }

    revalidatePath("/todos");
    return { ok: true, data: { id: parsed.data.id } };
  } catch (cause) {
    return { ok: false, error: toErrorMessage(cause) };
  }
}
