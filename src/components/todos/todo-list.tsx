"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { TodoForm } from "@/components/todos/todo-form";
import { TodoItem } from "@/components/todos/todo-item";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createTodo, deleteTodo, updateTodo } from "@/lib/actions/todos";
import type { Todo } from "@/lib/actions/todos";
import type { CreateTodoInput } from "@/lib/validations/todo";

interface TodoListProps {
  initialTodos: Todo[];
}

export function TodoList({ initialTodos }: TodoListProps) {
  const [todos, setTodos] = useState(initialTodos);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [, startTransition] = useTransition();

  function handleCreate(input: CreateTodoInput) {
    return new Promise<void>((resolve) => {
      startTransition(async () => {
        const result = await createTodo(input);
        if (!result.ok) {
          toast.error(result.error);
        } else {
          setTodos((current) => [result.data, ...current]);
          toast.success("Todo added");
          setIsDialogOpen(false);
        }
        resolve();
      });
    });
  }

  function handleToggle(todo: Todo) {
    setPendingId(todo.id);
    startTransition(async () => {
      const result = await updateTodo({
        id: todo.id,
        isComplete: !todo.is_complete,
      });
      if (!result.ok) {
        toast.error(result.error);
      } else {
        setTodos((current) =>
          current.map((t) => (t.id === result.data.id ? result.data : t)),
        );
      }
      setPendingId(null);
    });
  }

  function handleDelete(todo: Todo) {
    setPendingId(todo.id);
    startTransition(async () => {
      const result = await deleteTodo({ id: todo.id });
      if (!result.ok) {
        toast.error(result.error);
      } else {
        setTodos((current) => current.filter((t) => t.id !== todo.id));
        toast.success("Todo deleted");
      }
      setPendingId(null);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Todos</CardTitle>
        <CardDescription>
          Demo CRUD flow backed by Supabase — proves the build-ui ↔
          implement-logic handoff.
        </CardDescription>
        <CardAction>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button>New todo</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add a todo</DialogTitle>
              </DialogHeader>
              <TodoForm onSubmit={handleCreate} />
            </DialogContent>
          </Dialog>
        </CardAction>
      </CardHeader>
      <CardContent>
        {todos.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No todos yet — add one to get started.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {todos.map((todo) => (
                <TodoItem
                  key={todo.id}
                  todo={todo}
                  pending={pendingId === todo.id}
                  onToggle={handleToggle}
                  onDelete={handleDelete}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
