import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CorrectionQueue } from "@/components/corrections/correction-queue";
import type { CorrectionRequestWithContext } from "@/lib/actions/corrections";

const approveCorrection = vi.fn();
const rejectCorrection = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();
const toastWarning = vi.fn();
const toastInfo = vi.fn();
const refresh = vi.fn();

vi.mock("@/lib/actions/corrections", () => ({
  approveCorrection: (requestId: string) => approveCorrection(requestId),
  rejectCorrection: (requestId: string, reviewNote: string) =>
    rejectCorrection(requestId, reviewNote),
}));

vi.mock("sonner", () => ({
  toast: {
    success: (message: string) => toastSuccess(message),
    error: (message: string) => toastError(message),
    warning: (message: string) => toastWarning(message),
    info: (message: string) => toastInfo(message),
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

const REQUEST_ID = "33333333-3333-4333-8333-333333333333";
const ENTRY_ID = "44444444-4444-4444-8444-444444444444";
const REQUESTER_ID = "55555555-5555-4555-8555-555555555555";
const ADMIN_ID = "66666666-6666-4666-8666-666666666666";

const BASE: CorrectionRequestWithContext = {
  id: REQUEST_ID,
  kind: "amend",
  status: "pending",
  timeEntryId: ENTRY_ID,
  requestedBy: REQUESTER_ID,
  proposedStartedAt: null,
  proposedEndedAt: "2026-08-20T15:00:00Z",
  proposedProjectId: null,
  proposedTaskId: null,
  proposedNote: null,
  reason: "I stopped at five, not at seven.",
  reviewedBy: null,
  reviewedAt: null,
  reviewNote: null,
  createdAt: "2026-08-21T08:00:00Z",
  requesterName: "Employee One",
  reviewerName: null,
  entry: {
    id: ENTRY_ID,
    startedAt: "2026-08-20T11:00:00Z",
    endedAt: "2026-08-20T17:00:00Z",
    note: "long day",
    project: { id: "p", name: "Project P" },
    task: { id: "t", name: "General" },
  },
  proposedProject: null,
  proposedTask: null,
};

function renderQueue(request: CorrectionRequestWithContext = BASE) {
  render(
    <CorrectionQueue
      requests={[request]}
      timezone="Europe/Berlin"
      currentUserId={ADMIN_ID}
    />,
  );

  return userEvent.setup();
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CorrectionQueue", () => {
  it("shows the entry as it is beside what is proposed", () => {
    renderQueue();

    expect(screen.getByText("Now")).toBeInTheDocument();
    expect(screen.getByText("Proposed")).toBeInTheDocument();
    // 17:00 UTC is 19:00 in Berlin; the proposal is 15:00 UTC → 17:00.
    expect(screen.getByText("20 Aug, 19:00")).toBeInTheDocument();
    expect(screen.getByText("20 Aug, 17:00")).toBeInTheDocument();
    // Fields the request does not touch read "unchanged", never "—" —
    // the proposed_* NULL convention means "leave alone", not "clear".
    expect(screen.getAllByText("unchanged").length).toBeGreaterThan(0);
    expect(screen.getByText(/I stopped at five/)).toBeInTheDocument();
  });

  it("reports an auto-withdrawn approval as withdrawn, never as approved (§7.4)", async () => {
    // The path that makes `ok: true` insufficient: the entry was deleted
    // between filing and review, so `approve_correction()` commits a clean
    // withdrawal and returns it. Nothing was applied to any timesheet.
    approveCorrection.mockResolvedValue({
      ok: true,
      data: {
        ...BASE,
        status: "withdrawn",
        reviewNote: "The time entry this request refers to no longer exists.",
      },
    });

    const user = renderQueue();
    await user.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() =>
      expect(toastWarning).toHaveBeenCalledWith(
        "The entry this request referred to no longer exists, so it was withdrawn automatically.",
      ),
    );
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(screen.getByText("Withdrawn")).toBeInTheDocument();
    expect(screen.queryByText("Approved")).not.toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it("reports a real approval as approved", async () => {
    approveCorrection.mockResolvedValue({
      ok: true,
      data: { ...BASE, status: "approved" },
    });

    const user = renderQueue();
    await user.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(
        "Approved and applied to the entry.",
      ),
    );
    expect(toastWarning).not.toHaveBeenCalled();
    expect(screen.getByText("Approved")).toBeInTheDocument();
  });

  it("renders the action's refusal verbatim and decides nothing", async () => {
    approveCorrection.mockResolvedValue({
      ok: false,
      error: "This overlaps an entry from 09:00–10:30.",
    });

    const user = renderQueue();
    await user.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "This overlaps an entry from 09:00–10:30.",
      ),
    );
    expect(refresh).not.toHaveBeenCalled();
    // Still actionable: a failed approval leaves the request pending (§7.4).
    expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
  });

  it("refuses to offer approval of the reviewer's own request (§7.4)", () => {
    render(
      <CorrectionQueue
        requests={[{ ...BASE, requestedBy: ADMIN_ID }]}
        timezone="Europe/Berlin"
        currentUserId={ADMIN_ID}
      />,
    );

    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    // Rejecting your own is deliberately still allowed — strictly weaker than
    // the withdrawal every requester already has.
    expect(screen.getByRole("button", { name: "Reject…" })).toBeEnabled();
  });

  it("will not send a rejection without a note", async () => {
    const user = renderQueue();
    await user.click(screen.getByRole("button", { name: "Reject…" }));

    const confirm = await screen.findByRole("button", {
      name: "Reject request",
    });
    expect(confirm).toBeDisabled();

    await user.type(screen.getByLabelText("Note (required)"), "   ");
    expect(confirm).toBeDisabled();
    expect(rejectCorrection).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText("Note (required)"));
    await user.type(
      screen.getByLabelText("Note (required)"),
      "Talk to me before changing this.",
    );
    expect(confirm).toBeEnabled();

    rejectCorrection.mockResolvedValue({
      ok: true,
      data: { ...BASE, status: "rejected" },
    });
    await user.click(confirm);

    await waitFor(() =>
      expect(rejectCorrection).toHaveBeenCalledWith(
        REQUEST_ID,
        "Talk to me before changing this.",
      ),
    );
    expect(screen.getByText("Rejected")).toBeInTheDocument();
  });
});
