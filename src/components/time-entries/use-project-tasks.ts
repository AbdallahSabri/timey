"use client";

import { useEffect, useState } from "react";

import type { Task } from "@/lib/actions/tasks";
import { listTasks } from "@/lib/actions/tasks";

export type TaskState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; tasks: Task[] }
  | { status: "error"; message: string };

/**
 * §3.5.2 gives every project a "General" task, so a project is never
 * un-loggable — but "first alphabetically" is not the same as "the obvious
 * one", and silently pre-selecting whichever task sorts first would attribute
 * time to something nobody chose. So: General when it exists, the only task
 * when there is only one, and otherwise an explicit pick.
 */
export function preferredTaskId(tasks: Task[]): string {
  const general = tasks.find((task) => task.name.toLowerCase() === "general");
  if (general) {
    return general.id;
  }

  return tasks.length === 1 ? (tasks[0]?.id ?? "") : "";
}

/**
 * The project → task cascade, extracted from `StartTimerForm` in Phase 6 so the
 * manual-entry form asks the same question the same way. Two forms that fetch
 * tasks with two slightly different race guards is how one of them ends up
 * showing another project's tasks.
 *
 * Tasks are fetched per project rather than shipped for every project up front:
 * `listTasks` is scoped by the same policy as the project list, so asking for
 * one project's tasks is one round trip and asking for all of them is N.
 *
 * `setTaskId` must be stable across renders — both effects depend on it, and an
 * inline arrow would re-run the fetch on every keystroke elsewhere in the form.
 * Callers wrap `setValue` in `useCallback`; `setValue` is itself stable, so the
 * wrapper is too.
 */
export function useProjectTasks(
  projectId: string,
  setTaskId: (taskId: string) => void,
): TaskState {
  const [taskState, setTaskState] = useState<TaskState>({ status: "idle" });

  useEffect(() => {
    if (!projectId) {
      setTaskState({ status: "idle" });
      setTaskId("");
      return;
    }

    // A user clicking through the project list faster than the network answers
    // would otherwise get whichever response landed last, which is not
    // necessarily the project now selected.
    let cancelled = false;
    setTaskState({ status: "loading" });
    setTaskId("");

    void listTasks(projectId).then((result) => {
      if (cancelled) {
        return;
      }
      if (!result.ok) {
        setTaskState({ status: "error", message: result.error });
        return;
      }

      setTaskState({ status: "ready", tasks: result.data });
    });

    return () => {
      cancelled = true;
    };
  }, [projectId, setTaskId]);

  /**
   * Applied in a second effect rather than beside `setTaskState` above, and the
   * ordering is load-bearing: `setValue` on a registered `<select>` writes
   * straight to the DOM node, and at the moment the fetch resolves that node
   * still holds only the placeholder — React has not rendered the new
   * `<option>`s yet, so the assignment silently does nothing and the field
   * stays empty. Running after the commit means the option exists to select.
   */
  useEffect(() => {
    if (taskState.status !== "ready") {
      return;
    }

    setTaskId(preferredTaskId(taskState.tasks));
  }, [taskState, setTaskId]);

  return taskState;
}
