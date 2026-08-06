import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TodoItem } from "@/components/todos/todo-item";
import type { Todo } from "@/lib/actions/todos";

const todo: Todo = {
  id: "11111111-1111-1111-1111-111111111111",
  title: "Write the docs",
  is_complete: false,
  inserted_at: new Date().toISOString(),
};

describe("TodoItem", () => {
  it("renders the todo title and open status", () => {
    render(<TodoItem todo={todo} onToggle={vi.fn()} onDelete={vi.fn()} />);

    expect(screen.getByText("Write the docs")).toBeInTheDocument();
    expect(screen.getByText("Open")).toBeInTheDocument();
  });

  it("calls onToggle with the todo when 'Mark as done' is selected", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();

    render(<TodoItem todo={todo} onToggle={onToggle} onDelete={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Open actions" }));
    await user.click(await screen.findByText("Mark as done"));

    expect(onToggle).toHaveBeenCalledWith(todo);
  });
});
