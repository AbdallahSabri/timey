import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ManualEntryForm } from "@/components/time-entries/manual-entry-form";
import type { Project } from "@/lib/actions/projects";
import type { Task } from "@/lib/actions/tasks";

const listTasks = vi.fn();
const createManualEntry = vi.fn();
const toastError = vi.fn();
const toastSuccess = vi.fn();
const refresh = vi.fn();

vi.mock("@/lib/actions/tasks", () => ({
  listTasks: (projectId: string) => listTasks(projectId),
}));

vi.mock("@/lib/actions/time-entries", () => ({
  createManualEntry: (input: unknown) => createManualEntry(input),
}));

vi.mock("sonner", () => ({
  toast: {
    error: (message: string) => toastError(message),
    success: (message: string) => toastSuccess(message),
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

const PROJECT: Project = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Assigned Project",
  description: null,
  archivedAt: null,
  client: null,
};

const TASK: Task = {
  id: "22222222-2222-4222-8222-222222222222",
  projectId: PROJECT.id,
  name: "General",
  archivedAt: null,
};

async function fillIn(start: string, end: string) {
  const user = userEvent.setup();

  render(<ManualEntryForm projects={[PROJECT]} timezone="Africa/Cairo" />);

  await user.selectOptions(screen.getByLabelText("Project"), PROJECT.id);
  await waitFor(() => expect(screen.getByLabelText("Task")).not.toBeDisabled());

  await user.clear(screen.getByLabelText("Start"));
  await user.type(screen.getByLabelText("Start"), start);
  await user.clear(screen.getByLabelText("End"));
  await user.type(screen.getByLabelText("End"), end);
  await user.click(screen.getByRole("button", { name: "Save entry" }));

  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
  listTasks.mockResolvedValue({ ok: true, data: [TASK] });
});

describe("ManualEntryForm", () => {
  it("sends the datetime-local values untouched — no zone, no conversion", async () => {
    createManualEntry.mockResolvedValue({
      ok: true,
      data: { durationSeconds: 5400 },
    });

    await fillIn("2026-08-25T09:00", "2026-08-25T10:30");

    await waitFor(() => expect(createManualEntry).toHaveBeenCalledTimes(1));

    const sent = createManualEntry.mock.calls[0]?.[0] as {
      startedAt: string;
      endedAt: string;
      projectId: string;
      taskId: string;
    };

    // The wall clock the user picked, second-padded by the schema and nothing
    // else: no `Z`, no offset, no shift into the browser's timezone. The server
    // resolves this against `companies.timezone` (§6.1).
    expect(sent.startedAt).toBe("2026-08-25T09:00:00");
    expect(sent.endedAt).toBe("2026-08-25T10:30:00");
    expect(sent.startedAt).not.toMatch(/Z|[+-]\d{2}:\d{2}$/);
    expect(sent.projectId).toBe(PROJECT.id);
    expect(sent.taskId).toBe(TASK.id);

    expect(refresh).toHaveBeenCalled();
  });

  it("renders the action's refusal verbatim rather than paraphrasing it", async () => {
    createManualEntry.mockResolvedValue({
      ok: false,
      error: "This overlaps an entry from 09:00–10:30.",
    });

    await fillIn("2026-08-25T09:30", "2026-08-25T11:00");

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "This overlaps an entry from 09:00–10:30.",
      ),
    );
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("states the today-only rule before anything is submitted (§7.1)", () => {
    render(<ManualEntryForm projects={[PROJECT]} timezone="Africa/Cairo" />);

    expect(screen.getByText(/only log time for today/i)).toBeInTheDocument();
    expect(screen.getByText(/Africa\/Cairo/)).toBeInTheDocument();
  });

  it("uses native datetime-local inputs, seeded with a wall clock to edit", () => {
    render(<ManualEntryForm projects={[PROJECT]} timezone="Africa/Cairo" />);

    for (const label of ["Start", "End"]) {
      const input = screen.getByLabelText(label);
      expect(input).toHaveAttribute("type", "datetime-local");
      expect(input).toBeInstanceOf(HTMLInputElement);

      // The seed is the browser's own convention for this control and is only
      // a starting point; what matters is that it carries no zone marker.
      if (input instanceof HTMLInputElement) {
        expect(input.value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
      }
    }
  });
});
