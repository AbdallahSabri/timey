"use client";

import { useEffect, useState } from "react";

import { listTasks, type Task } from "@/lib/actions/tasks";

export type FilterTaskState = {
  tasks: Task[];
  error: string | null;
  loading: boolean;
};

/**
 * The task filter's options, loaded when a project is chosen.
 *
 * **Deliberately not `useProjectTasks`**, which the timer and manual-entry forms
 * share. That hook pre-selects a preferred task ("General", or the only one) the
 * moment a project resolves, because an entry cannot be logged without one
 * (§3.5.2). Here the same behaviour would be a bug: it would silently narrow the
 * report to one task nobody asked for, and the number on screen would answer a
 * different question than the filters claim. A filter's empty value is a value.
 *
 * `listTasks` is scoped by the same policy as the project list, so a project the
 * caller cannot read returns nothing rather than erroring.
 */
export function useFilterTasks(projectId: string): FilterTaskState {
  const [state, setState] = useState<FilterTaskState>({
    tasks: [],
    error: null,
    loading: false,
  });

  useEffect(() => {
    if (!projectId) {
      setState({ tasks: [], error: null, loading: false });
      return;
    }

    // Clicking through projects faster than the network answers would otherwise
    // leave whichever response landed last on screen, which is not necessarily
    // the project now selected.
    let cancelled = false;
    setState({ tasks: [], error: null, loading: true });

    void listTasks(projectId).then((result) => {
      if (cancelled) {
        return;
      }

      setState(
        result.ok
          ? { tasks: result.data, error: null, loading: false }
          : { tasks: [], error: result.error, loading: false },
      );
    });

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return state;
}
