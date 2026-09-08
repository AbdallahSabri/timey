import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ScheduleForm } from "@/components/project-members/schedule-form";
import { projectMemberScheduleSchema } from "@/lib/validations/project-members";

const updateProjectMemberSchedule = vi.fn();
const toastError = vi.fn();
const toastSuccess = vi.fn();
const refresh = vi.fn();

vi.mock("@/lib/actions/project-members", () => ({
  updateProjectMemberSchedule: (
    projectId: string,
    userId: string,
    input: unknown,
  ) => updateProjectMemberSchedule(projectId, userId, input),
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

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";

function renderForm(
  props: Partial<React.ComponentProps<typeof ScheduleForm>> = {},
) {
  const onSaved = vi.fn();
  const onCancel = vi.fn();

  render(
    <ScheduleForm
      projectId={PROJECT_ID}
      userId={USER_ID}
      memberName="Dana Reyes"
      expectedDailySeconds={14_400}
      workingDays={[1, 2, 3, 4, 5]}
      weekStartsOn={1}
      onSaved={onSaved}
      onCancel={onCancel}
      {...props}
    />,
  );

  return { onSaved, onCancel };
}

/** What the action would do with the payload the form sends it. */
function asStored(input: unknown) {
  const parsed = projectMemberScheduleSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

describe("ScheduleForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateProjectMemberSchedule.mockResolvedValue({ ok: true, data: null });
  });

  it("opens on the assignment's stored seconds, shown as hours", () => {
    renderForm();

    // 14400 seconds is 4h/day. The admin types hours; the column stores
    // seconds (§9.5), and this is the display half of that round trip.
    expect(screen.getByLabelText(/hours per day/i)).toHaveValue(4);
  });

  it("sends hours that reach the action as integer seconds", async () => {
    const user = userEvent.setup();
    renderForm();

    const hours = screen.getByLabelText(/hours per day/i);
    await user.clear(hours);
    await user.type(hours, "3.5");
    await user.click(screen.getByRole("button", { name: /save schedule/i }));

    await waitFor(() => {
      expect(updateProjectMemberSchedule).toHaveBeenCalledTimes(1);
    });

    const [projectId, userId, input] =
      updateProjectMemberSchedule.mock.calls[0] ?? [];
    expect(projectId).toBe(PROJECT_ID);
    expect(userId).toBe(USER_ID);

    // The action re-runs the schema server-side rather than trusting the
    // client, so what matters is that the payload the form sends *parses* to
    // the right integer — 3.5h is 12600s, never a float and never hours.
    expect(asStored(input)).toStrictEqual({
      expectedDailySeconds: 12_600,
      workingDays: [1, 2, 3, 4, 5],
    });
  });

  it("carries a day the admin unticked through to the stored array", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole("checkbox", { name: "Wednesday" }));
    await user.click(screen.getByRole("button", { name: /save schedule/i }));

    await waitFor(() => {
      expect(updateProjectMemberSchedule).toHaveBeenCalledTimes(1);
    });

    const input = updateProjectMemberSchedule.mock.calls[0]?.[2];
    // 0 = Sunday … 6 = Saturday (Postgres `extract(dow)`), so Wednesday is 3.
    expect(asStored(input)?.workingDays).toStrictEqual([1, 2, 4, 5]);
  });

  it("orders the day picker by the company's week, not by dow", () => {
    renderForm({ weekStartsOn: 0 });

    const days = screen
      .getAllByRole("checkbox")
      .map((box) => box.getAttribute("aria-label"));

    // A Sunday-start company reads S M T W T F S. The stored numbering does
    // not move with it — only this order does (§3.6.3).
    expect(days[0]).toBe("Sunday");
    expect(days[1]).toBe("Monday");
    expect(days[6]).toBe("Saturday");
  });

  it("surfaces the action's own refusal rather than wording its own", async () => {
    const user = userEvent.setup();
    updateProjectMemberSchedule.mockResolvedValue({
      ok: false,
      error:
        "That person isn't assigned to this project, or you don't have permission to change it.",
    });
    const { onSaved } = renderForm();

    await user.click(screen.getByRole("button", { name: /save schedule/i }));

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith(
        "That person isn't assigned to this project, or you don't have permission to change it.",
      );
    });
    // A `USING` clause that filters rather than raises makes an unauthorised
    // edit look like success; the form must not report one.
    expect(onSaved).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("refuses more hours than a day has, without calling the action", async () => {
    const user = userEvent.setup();
    renderForm();

    const hours = screen.getByLabelText(/hours per day/i);
    await user.clear(hours);
    await user.type(hours, "30");
    await user.click(screen.getByRole("button", { name: /save schedule/i }));

    await waitFor(() => {
      expect(screen.getByText(/cannot exceed 24/i)).toBeInTheDocument();
    });
    expect(updateProjectMemberSchedule).not.toHaveBeenCalled();
  });
});
