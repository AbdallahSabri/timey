import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DateRangePicker } from "@/components/reports/date-range-picker";

/** A fixed "company today" — the presets are anchored to it, never to the browser's clock. */
const TODAY = "2026-08-25";

function renderPicker(onSelect = vi.fn()) {
  render(
    <DateRangePicker
      from="2026-08-01"
      to="2026-08-25"
      today={TODAY}
      onSelect={onSelect}
    />,
  );

  return onSelect;
}

describe("DateRangePicker", () => {
  it("shows the applied range on the trigger", () => {
    renderPicker();

    expect(
      screen.getByRole("button", { name: /change the report date range/i }),
    ).toHaveTextContent("1 Aug 2026 – 25 Aug 2026");
  });

  it("applies a preset as two company-local day strings", async () => {
    const user = userEvent.setup();
    const onSelect = renderPicker();

    await user.click(
      screen.getByRole("button", { name: /change the report date range/i }),
    );
    await user.click(screen.getByRole("button", { name: "Last 7 days" }));

    // Inclusive (§9.2), so seven days ending on today is today minus six.
    expect(onSelect).toHaveBeenCalledWith({
      from: "2026-08-19",
      to: "2026-08-25",
    });
  });

  it("anchors 'this month' and 'last month' to the company's today", async () => {
    const user = userEvent.setup();
    const onSelect = renderPicker();

    await user.click(
      screen.getByRole("button", { name: /change the report date range/i }),
    );
    await user.click(screen.getByRole("button", { name: "Last month" }));

    expect(onSelect).toHaveBeenCalledWith({
      from: "2026-07-01",
      to: "2026-07-31",
    });
  });

  it("applies a range only once both ends are picked", async () => {
    const user = userEvent.setup();
    const onSelect = renderPicker();

    await user.click(
      screen.getByRole("button", { name: /change the report date range/i }),
    );

    // `resetOnSelect` makes the first click start a new range rather than drag
    // whichever end of the applied one is nearer — so nothing is applied yet.
    await user.click(screen.getByRole("button", { name: /August 5th, 2026/i }));
    expect(onSelect).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: /August 12th, 2026/i }),
    );
    expect(onSelect).toHaveBeenCalledWith({
      from: "2026-08-05",
      to: "2026-08-12",
    });
  });

  it("orders the range regardless of which end is clicked first", async () => {
    const user = userEvent.setup();
    const onSelect = renderPicker();

    await user.click(
      screen.getByRole("button", { name: /change the report date range/i }),
    );
    await user.click(
      screen.getByRole("button", { name: /August 12th, 2026/i }),
    );
    await user.click(screen.getByRole("button", { name: /August 5th, 2026/i }));

    expect(onSelect).toHaveBeenCalledWith({
      from: "2026-08-05",
      to: "2026-08-12",
    });
  });
});
