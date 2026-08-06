"use client";

import { MoreHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TableCell, TableRow } from "@/components/ui/table";
import type { Todo } from "@/lib/actions/todos";
import { cn } from "@/lib/utils";

interface TodoItemProps {
  todo: Todo;
  pending?: boolean;
  onToggle: (todo: Todo) => void;
  onDelete: (todo: Todo) => void;
}

export function TodoItem({ todo, pending, onToggle, onDelete }: TodoItemProps) {
  return (
    <TableRow className={cn(pending && "opacity-50")}>
      <TableCell
        className={cn(todo.is_complete && "text-muted-foreground line-through")}
      >
        {todo.title}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {todo.is_complete ? "Done" : "Open"}
      </TableCell>
      <TableCell className="text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" disabled={pending}>
              <MoreHorizontal className="size-4" />
              <span className="sr-only">Open actions</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onToggle(todo)}>
              {todo.is_complete ? "Mark as open" : "Mark as done"}
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => onDelete(todo)}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}
