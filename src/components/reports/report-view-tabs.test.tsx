import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ReportQuery } from "@/components/reports/report-params";
import { ReportViewTabs } from "@/components/reports/report-view-tabs";

/** A fixed range: these tests are about the view, the page and the grouping. */
const RANGE = { from: "2026-08-01", to: "2026-08-25" };

function query(overrides: Partial<ReportQuery> = {}): ReportQuery {
  return {
    ...RANGE,
    view: "summary",
    grouping: "day",
    userId: "",
    clientId: "",
    projectId: "",
    taskId: "",
    page: 1,
    ...overrides,
  };
}

function tab(name: "Summary" | "Detailed") {
  return screen.getByRole("link", { name });
}

/** The query string of a tab's href, parsed so assertions read by key. */
function paramsOf(name: "Summary" | "Detailed"): URLSearchParams {
  const href = tab(name).getAttribute("href") ?? "";

  return new URLSearchParams(href.slice(href.indexOf("?") + 1));
}

describe("ReportViewTabs", () => {
  it("offers both views by name", () => {
    render(<ReportViewTabs query={query()} />);

    const nav = screen.getByRole("navigation", { name: "Report view" });

    expect(nav).toBeInTheDocument();
    expect(tab("Summary")).toBeInTheDocument();
    expect(tab("Detailed")).toBeInTheDocument();
  });

  it("marks the summary view as the one on screen", () => {
    render(<ReportViewTabs query={query({ view: "summary" })} />);

    expect(tab("Summary")).toHaveAttribute("aria-current", "page");
    expect(tab("Detailed")).not.toHaveAttribute("aria-current");
  });

  it("marks the detail view as the one on screen", () => {
    render(<ReportViewTabs query={query({ view: "detail" })} />);

    expect(tab("Detailed")).toHaveAttribute("aria-current", "page");
    expect(tab("Summary")).not.toHaveAttribute("aria-current");
  });

  it("names the detail view in the link that leads to it", () => {
    render(<ReportViewTabs query={query({ view: "summary" })} />);

    expect(paramsOf("Detailed").get("view")).toBe("detail");
    expect(paramsOf("Detailed").get("from")).toBe(RANGE.from);
  });

  it("leaves the view out of the link back to the summary", () => {
    render(<ReportViewTabs query={query({ view: "detail" })} />);

    // Summary is the default, and a default is never written into the URL —
    // `?view=summary` would be a parameter that changes nothing.
    expect(paramsOf("Summary").has("view")).toBe(false);
    expect(paramsOf("Summary").get("to")).toBe(RANGE.to);
  });

  it("drops the page when switching view", () => {
    render(<ReportViewTabs query={query({ view: "detail", page: 7 })} />);

    // Asserted rather than merely implied: page 7 of §9.7's entry list has no
    // counterpart in a summary that has no pages, and coming back has to start
    // at the first page rather than wherever the last visit ended. This is the
    // one behaviour `reportHref`'s page reset exists for.
    expect(paramsOf("Summary").has("page")).toBe(false);
    expect(paramsOf("Detailed").has("page")).toBe(false);
  });

  it("carries the grouping through the detail view and back", () => {
    render(
      <ReportViewTabs query={query({ view: "detail", grouping: "task" })} />,
    );

    // Orthogonal to the view: leaving a by-task summary and returning lands on
    // the by-task summary, not on the default one.
    expect(paramsOf("Summary").get("grouping")).toBe("task");
    expect(paramsOf("Detailed").get("grouping")).toBe("task");
  });
});
