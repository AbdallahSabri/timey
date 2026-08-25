import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AmendCorrectionForm } from "@/components/corrections/amend-correction-form";
import type { Project } from "@/lib/actions/projects";
import type { TimeEntryWithLabels } from "@/lib/actions/time-entries";

const submitCorrection = vi.fn();
const listTasks = vi.fn();
const toastError = vi.fn();
const toastSuccess = vi.fn();
const refresh = vi.fn();

vi.mock("@/lib/actions/corrections", () => ({
  submitCorrection: (input: unknown) => submitCorrection(input),
}));

vi.mock("@/lib/actions/tasks", () => ({
  listTasks: (projectId: string) => listTasks(projectId),
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
  name: "Project P",
  description: null,
  archivedAt: null,
  client: null,
};

const ENTRY: TimeEntryWithLabels = {
  id: "99999999-9999-4999-8999-999999999999",
  projectId: PROJECT.id,
  taskId: "22222222-2222-4222-8222-222222222222",
  // 11:00 UTC is 13:00 in Berlin; 17:00 UTC is 19:00.
  startedAt: "2026-08-20T11:00:00Z",
  endedAt: "2026-08-20T17:00:00Z",
  durationSeconds: 21600,
  source: "timer",
  note: "long day",
  project: { id: PROJECT.id, name: "Project P" },
  task: { id: "22222222-2222-4222-8222-222222222222", name: "General" },
};

function renderForm() {
  render(
    <AmendCorrectionForm
      entry={ENTRY}
      projects={[PROJECT]}
      timezone="Europe/Berlin"
    />,
  );

  return userEvent.setup();
}

beforeEach(() => {
  vi.clearAllMocks();
  listTasks.mockResolvedValue({ ok: true, data: [] });
});

describe("AmendCorrectionForm", () => {
  it("seeds the times in the company's timezone, not the browser's", () => {
    renderForm();

    expect(screen.getByLabelText("Start")).toHaveValue("2026-08-20T13:00");
    expect(screen.getByLabelText("End")).toHaveValue("2026-08-20T19:00");
  });

  it("sends a wall clock with no zone, tagged as an amend of this entry", async () => {
    submitCorrection.mockResolvedValue({
      ok: true,
      data: { id: "r", status: "pending" },
    });

    const user = renderForm();

    await user.clear(screen.getByLabelText("End"));
    await user.type(screen.getByLabelText("End"), "2026-08-20T17:30");
    await user.type(
      screen.getByLabelText("Reason (required)"),
      "I stopped at half five.",
    );
    await user.click(
      screen.getByRole("button", { name: "Request correction" }),
    );

    await waitFor(() => expect(submitCorrection).toHaveBeenCalledTimes(1));

    const sent = submitCorrection.mock.calls[0]?.[0] as {
      kind: string;
      timeEntryId: string;
      proposedEndedAt: string | null;
      proposedProjectId: string | null;
      proposedTaskId: string | null;
      proposedNote: string | null;
      reason: string;
    };

    expect(sent.kind).toBe("amend");
    expect(sent.timeEntryId).toBe(ENTRY.id);
    expect(sent.proposedEndedAt).toBe("2026-08-20T17:30:00");
    expect(sent.proposedEndedAt).not.toMatch(/Z|[+-]\d{2}:\d{2}$/);
    expect(sent.reason).toBe("I stopped at half five.");

    // Untouched fields propose nothing at all: a blank one means "leave this
    // alone", never "clear it".
    expect(sent.proposedProjectId).toBeNull();
    expect(sent.proposedTaskId).toBeNull();
    expect(sent.proposedNote).toBeNull();

    expect(refresh).toHaveBeenCalled();
  });

  it("refuses to file a request with no reason (§3.9)", async () => {
    const user = renderForm();

    await user.click(
      screen.getByRole("button", { name: "Request correction" }),
    );

    expect(
      await screen.findByText(
        "Tell us why — a reason is required for a correction request.",
      ),
    ).toBeInTheDocument();
    expect(submitCorrection).not.toHaveBeenCalled();
  });

  it("renders the action's refusal verbatim", async () => {
    submitCorrection.mockResolvedValue({
      ok: false,
      error:
        "This entry's timer is still running — its project and start time can't be changed until it's stopped. You can still correct its end time.",
    });

    const user = renderForm();

    await user.type(screen.getByLabelText("Reason (required)"), "fix it");
    await user.click(
      screen.getByRole("button", { name: "Request correction" }),
    );

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "This entry's timer is still running — its project and start time can't be changed until it's stopped. You can still correct its end time.",
      ),
    );
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("says that any day may be proposed — §7.1's today-only rule is not this form's", () => {
    renderForm();

    expect(
      screen.getByText(/propose a time from any day/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/only log time for today/i)).toBeNull();
  });

  it("offers project and task as 'leave unchanged', never as a required pick", () => {
    renderForm();

    // Both selects, both sitting on the empty option: on a correction, blank
    // is a value ("leave this alone"), not an unanswered question.
    expect(screen.getByLabelText("Project")).toHaveValue("");
    expect(screen.getByLabelText("Task")).toHaveValue("");
    expect(
      screen.getAllByRole("option", { name: "Leave unchanged" }),
    ).toHaveLength(2);
  });
});
