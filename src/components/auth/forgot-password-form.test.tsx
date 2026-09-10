import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

const requestPasswordReset = vi.fn();
const toastError = vi.fn();
const toastSuccess = vi.fn();
const replace = vi.fn();
const refresh = vi.fn();

vi.mock("@/lib/actions/auth", () => ({
  requestPasswordReset: (input: unknown) => requestPasswordReset(input),
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
  render(<ForgotPasswordForm />);
  return userEvent.setup();
}

/**
 * Renders a whole form of its own, submits `email`, and tears down again — so
 * the two calls in the enumeration test cannot see each other's DOM.
 */
async function requestFor(email: string) {
  const { unmount } = render(<ForgotPasswordForm />);
  const user = userEvent.setup();

  await user.type(screen.getByLabelText("Email"), email);
  await user.click(screen.getByRole("button", { name: "Send reset link" }));

  const text = (await screen.findByRole("status")).textContent;
  unmount();

  return text;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ForgotPasswordForm", () => {
  it("says exactly the same thing for an address with an account and one without — the form is not an enumeration oracle (§8.5)", async () => {
    // The action returns `ok: true` for an unknown address, and for a resend
    // GoTrue rate-limited, precisely so this component cannot tell them apart.
    // Two different addresses, one indistinguishable answer.
    requestPasswordReset.mockResolvedValue({ ok: true, data: null });

    const known = await requestFor("has-an-account@example.com");
    const unknown = await requestFor("nobody-here@example.com");

    expect(known).toBe(unknown);
    expect(known).not.toContain("has-an-account@example.com");
    expect(unknown).not.toContain("nobody-here@example.com");

    // And it never claims a mail was actually sent — only that one is coming
    // if there is an account to send it to.
    expect(unknown).toMatch(/if an account exists/i);
  });

  it("renders the action's refusal verbatim and keeps the form mounted", async () => {
    requestPasswordReset.mockResolvedValue({
      ok: false,
      error: "Enter a valid email address.",
    });

    const user = renderForm();

    await user.type(screen.getByLabelText("Email"), "someone@example.com");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Enter a valid email address."),
    );
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it("refuses a malformed address inline, without calling the action", async () => {
    const user = renderForm();

    await user.type(screen.getByLabelText("Email"), "not-an-email");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));

    expect(
      await screen.findByText("Enter a valid email address."),
    ).toBeInTheDocument();
    expect(requestPasswordReset).not.toHaveBeenCalled();
  });

  it("offers a way back to the form, so the neutral state is not a dead end", async () => {
    requestPasswordReset.mockResolvedValue({ ok: true, data: null });

    const user = renderForm();

    await user.type(screen.getByLabelText("Email"), "typo@example.com");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));

    await screen.findByRole("status");
    expect(screen.queryByLabelText("Email")).toBeNull();

    await user.click(
      screen.getByRole("button", { name: "Try a different address" }),
    );

    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
