import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ReportPagination } from "@/components/reports/report-pagination";
import type { ReportQuery } from "@/components/reports/report-params";

function detailQuery(page: number): ReportQuery {
  return {
    from: "2026-08-01",
    to: "2026-08-25",
    view: "detail",
    grouping: "day",
    userId: "",
    clientId: "",
    projectId: "",
    taskId: "",
    page,
  };
}

function renderAt(page: number, totalCount: number, perPage = 50) {
  return render(
    <ReportPagination
      query={detailQuery(page)}
      page={page}
      perPage={perPage}
      totalCount={totalCount}
    />,
  );
}

/** The status line, whitespace-collapsed — it is built from several spans. */
function statusText(): string {
  const status = screen.getByText(/^Showing/);
  return (status.textContent ?? "").replace(/\s+/g, " ").trim();
}

describe("ReportPagination", () => {
  it("renders nothing when everything fits on one page", () => {
    const { container } = renderAt(1, 50);

    expect(container).toBeEmptyDOMElement();
  });

  it("names the range on the first page", () => {
    renderAt(1, 312);

    expect(statusText()).toBe("Showing 1–50 of 312");
  });

  it("names the range in the middle", () => {
    renderAt(2, 312);

    expect(statusText()).toBe("Showing 51–100 of 312");
  });

  it("clamps the upper bound on a short last page", () => {
    // 7 × 50 is 350, which this range does not have. The denominator is the
    // server's count, so the numerator has to stop at it.
    renderAt(7, 312);

    expect(statusText()).toBe("Showing 301–312 of 312");
  });

  it("disables Previous on the first page and links Next", () => {
    renderAt(1, 312);

    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute(
      "href",
      // The view survives the hop, and an explicit page override is the one
      // thing `reportHref` does not reset.
      expect.stringContaining("page=2"),
    );
    expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute(
      "href",
      expect.stringContaining("view=detail"),
    );
  });

  it("disables Next on the last page and links Previous", () => {
    renderAt(7, 312);

    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "Previous" })).toHaveAttribute(
      "href",
      expect.stringContaining("page=6"),
    );
  });

  it("links both directions in the middle", () => {
    renderAt(4, 312);

    expect(screen.getByRole("link", { name: "Previous" })).toHaveAttribute(
      "href",
      expect.stringContaining("page=3"),
    );
    expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute(
      "href",
      expect.stringContaining("page=5"),
    );
    expect(
      screen.queryByRole("button", { name: /previous|next/i }),
    ).not.toBeInTheDocument();
  });
});
