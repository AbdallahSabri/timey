import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ResetPasswordForm } from "@/components/auth/reset-password-form";

const updatePassword = vi.fn();
const toastError = vi.fn();
const toastSuccess = vi.fn();
const replace = vi.fn();
const refresh = vi.fn();

vi.mock("@/lib/actions/auth", () => ({
  updatePassword: (input: unknown) => updatePassword(input),
}));

vi.mock("sonner", () => ({
  toast: {
    error: (message: string) => toastError(message),
    success: (message: string) => toastSuccess(message),
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh }),
}));

function renderForm() {
  render(<ResetPasswordForm />);
  return userEvent.setup();
}

async function submit(
  user: ReturnType<typeof userEvent.setup>,
  password: string,
) {
  await user.type(screen.getByLabelText("New password"), password);
  await user.click(screen.getByRole("button", { name: "Set new password" }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ResetPasswordForm", () => {
  it("refuses a too-short password inline, without spending the recovery session on it", async () => {
    const user = renderForm();

    await submit(user, "12345");

    expect(
      await screen.findByText("Password must be at least 6 characters."),
    ).toBeInTheDocument();
    expect(updatePassword).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("hands the app back to middleware on success", async () => {
    updatePassword.mockResolvedValue({ ok: true, data: null });

    const user = renderForm();

    await submit(user, "a-decent-password");

    await waitFor(() =>
      expect(updatePassword).toHaveBeenCalledWith({
        password: "a-decent-password",
      }),
    );

    // Always `/dashboard` — middleware carries a limbo invitee on to
    // `/onboarding` from there, so this form never special-cases them.
    expect(replace).toHaveBeenCalledWith("/dashboard");
    expect(refresh).toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("renders the action's refusal verbatim and navigates nowhere", async () => {
    updatePassword.mockResolvedValue({
      ok: false,
      error: "That reset link has expired. Request a new one.",
    });

    const user = renderForm();

    await submit(user, "a-decent-password");

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "That reset link has expired. Request a new one.",
      ),
    );
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("states the minimum length until there is an error to state instead", async () => {
    const user = renderForm();

    expect(screen.getByText("At least 6 characters.")).toBeInTheDocument();

    await submit(user, "123");

    expect(
      await screen.findByText("Password must be at least 6 characters."),
    ).toBeInTheDocument();
    expect(screen.queryByText("At least 6 characters.")).toBeNull();
  });
});
