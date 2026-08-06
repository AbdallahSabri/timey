import { z } from "zod";

export const createTodoSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
});

export type CreateTodoInput = z.infer<typeof createTodoSchema>;

export const updateTodoSchema = z.object({
  id: z.uuid(),
  isComplete: z.boolean(),
});

export type UpdateTodoInput = z.infer<typeof updateTodoSchema>;

export const deleteTodoSchema = z.object({
  id: z.uuid(),
});

export type DeleteTodoInput = z.infer<typeof deleteTodoSchema>;
