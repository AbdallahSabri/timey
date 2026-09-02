import { describe, expect, it } from "vitest";

import {
  reportExportHref,
  reportHref,
  resolveReportQuery,
  type ReportQuery,
} from "@/components/reports/report-params";

const DEFAULTS = { from: "2026-08-01", to: "2026-08-25" };

/** The state the page starts in: default range, first page, nothing narrowed. */
function baseQuery(overrides: Partial<ReportQuery> = {}): ReportQuery {
  return {
    from: DEFAULTS.from,
    to: DEFAULTS.to,
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

/** The query string of a built href, parsed so assertions read by key. */
function paramsOf(href: string): URLSearchParams {
  return new URLSearchParams(href.slice(href.indexOf("?") + 1));
}

describe("resolveReportQuery", () => {
  it("defaults to the summary view on its first page", () => {
    const query = resolveReportQuery({}, DEFAULTS);

    expect(query.view).toBe("summary");
    expect(query.page).toBe(1);
  });

  it("reads a view and a page from the URL", () => {
    const query = resolveReportQuery({ view: "detail", page: "3" }, DEFAULTS);

    expect(query.view).toBe("detail");
    expect(query.page).toBe(3);
  });

  it("falls back to the summary view for a name it cannot serve", () => {
    // Only reachable by hand-editing the URL, and the honest answer is the
    // default report rather than an error about a parameter nobody typed.
    expect(resolveReportQuery({ view: "nonsense" }, DEFAULTS).view).toBe(
      "summary",
    );
    expect(resolveReportQuery({ view: "" }, DEFAULTS).view).toBe("summary");
  });

  it("falls back to the first page for anything that is not one", () => {
    // Zero and negatives are off the front of the list, and a word is not an
    // offset at all: every one of them has the same obviously correct reading.
    expect(resolveReportQuery({ page: "0" }, DEFAULTS).page).toBe(1);
    expect(resolveReportQuery({ page: "abc" }, DEFAULTS).page).toBe(1);
    expect(resolveReportQuery({ page: "-2" }, DEFAULTS).page).toBe(1);
    expect(resolveReportQuery({ page: "" }, DEFAULTS).page).toBe(1);
  });
});

describe("reportHref", () => {
  it("leaves out the defaults, so a plain report has a plain URL", () => {
    const params = paramsOf(reportHref(baseQuery()));

    expect(params.has("view")).toBe(false);
    expect(params.has("page")).toBe(false);
    // The grouping is written down even at its default, which is what lets a
    // trip through the detail view and back restore it.
    expect(params.get("grouping")).toBe("day");
  });

  it("writes down a non-default view and page", () => {
    // The page arrives as an override rather than in the query, because a bare
    // `reportHref` deliberately returns to the first one — see below.
    const params = paramsOf(
      reportHref(baseQuery({ view: "detail", grouping: "project" }), {
        page: 2,
      }),
    );

    expect(params.get("view")).toBe("detail");
    expect(params.get("page")).toBe("2");
    expect(params.get("grouping")).toBe("project");
  });

  it("resets to the first page when anything else changes", () => {
    const query = baseQuery({ view: "detail", page: 4 });

    // Page 4 of the unfiltered list has no counterpart in the filtered one, and
    // landing on an empty page reads as "this client has no time".
    expect(paramsOf(reportHref(query, { clientId: "c1" })).has("page")).toBe(
      false,
    );
    expect(
      paramsOf(reportHref(query, { from: "2026-07-01" })).has("page"),
    ).toBe(false);
    expect(paramsOf(reportHref(query, { view: "summary" })).has("page")).toBe(
      false,
    );
  });

  it("keeps the page when the page is what is being overridden", () => {
    // "Same question, different page" — the one intent the reset must not eat,
    // and the only thing the pagination control ever asks for.
    const params = paramsOf(
      reportHref(baseQuery({ view: "detail", page: 4 }), { page: 3 }),
    );

    expect(params.get("page")).toBe("3");
    expect(params.get("view")).toBe("detail");
  });
});

describe("reportExportHref", () => {
  it("carries the view so the handler exports the shape on screen", () => {
    const href = reportExportHref(baseQuery({ view: "detail" }));

    expect(href.startsWith("/api/reports/export?")).toBe(true);
    expect(paramsOf(href).get("view")).toBe("detail");
  });

  it("never carries a page — the detail CSV is the whole range", () => {
    const params = paramsOf(
      reportExportHref(baseQuery({ view: "detail", page: 5 })),
    );

    expect(params.has("page")).toBe(false);
    expect(params.get("from")).toBe(DEFAULTS.from);
    expect(params.get("to")).toBe(DEFAULTS.to);
  });
});
