import { TodoList } from "@/components/todos/todo-list";
import { getTodos } from "@/lib/actions/todos";

export default async function TodosPage() {
  const result = await getTodos();

  if (!result.ok) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-12">
        <p className="text-destructive text-sm">
          Couldn&apos;t load todos: {result.error}
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <TodoList initialTodos={result.data} />
    </main>
  );
}
