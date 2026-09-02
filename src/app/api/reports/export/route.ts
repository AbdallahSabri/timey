import { NextResponse } from "next/server";

import { exportReportCsv, exportReportEntriesCsv } from "@/lib/actions/reports";
import { CSV_UTF8_BOM } from "@/lib/reports/csv";
import {
  reportEntriesRequestSchema,
  reportRequestSchema,
} from "@/lib/validations/reports";

/**
 * §9.6's download endpoint: `GET /api/reports/export?from=…&to=…&grouping=…`.
 *
 * **Why a route handler and not a server action.** A server action can only
 * return a value to JavaScript running in the page; turning that into a saved
 * file means building a Blob, minting an object URL, clicking a synthetic
 * anchor and revoking the URL — UI plumbing that also throws away the filename
 * and the `Content-Disposition` header, and that cannot be a plain link, a
 * middle-click, or a "save as". A GET route is a URL: build-ui renders an
 * `<a href download>` and the browser does the rest. `exportReportCsv` still
 * exists as an action for any caller that wants the text itself; this is the
 * only path that produces a *download*.
 *
 * **Why GET and not POST.** The request is a pure read with no side effects,
 * every parameter is already visible in the report's own URL, and a GET can be
 * bookmarked and re-run. The filters are not secret — RLS decides what they can
 * reach, not their obscurity — so the usual "don't put it in the query string"
 * argument does not apply.
 *
 * **`force-dynamic` because this reads cookies** to authenticate. Nothing here
 * may be cached: two users hitting the same URL must get two different files,
 * which is also why the response carries `no-store`.
 */
export const dynamic = "force-dynamic";

/**
 * What either branch below produces: a file, or a refusal with the status it
 * deserves.
 *
 * The status travels with the error because the two branches fail for different
 * reasons at different points — a parse failure is always 400, an action failure
 * is not always the same thing — and deciding it inside the branch keeps the
 * single response-writing tail below free of a second `if`.
 */
type ExportOutcome =
  | { ok: true; filename: string; csv: string }
  | { ok: false; status: 400 | 500; error: string };

/**
 * The four §9.2 filters plus the range, read off the query string.
 *
 * `?? ""` on the two required parameters, and *not* on the four optional ones.
 * `searchParams.get` returns null for an absent key, and null hits `z.string()`
 * before any of the schema's own refinements do — which answers a missing `from`
 * with zod's internal "Invalid input: expected string, received null" instead of
 * "Enter a date like 2026-08-25." An empty string reaches the same refinements a
 * typo would and gets the same sentence. The filter ids keep their null:
 * `optionalUuidSchema` is `.nullish()`, and null there means "no filter", which
 * is exactly what an absent key means.
 */
function filterParams(params: URLSearchParams) {
  return {
    from: params.get("from") ?? "",
    to: params.get("to") ?? "",
    userId: params.get("userId"),
    clientId: params.get("clientId"),
    projectId: params.get("projectId"),
    taskId: params.get("taskId"),
  };
}

/** §9.3's aggregate export, unchanged: one grouping's columns, one row per group. */
async function aggregateExport(
  params: URLSearchParams,
): Promise<ExportOutcome> {
  // Validated here *and* inside the action. Not redundant: this parse is what
  // turns a bad parameter into a 400 with the schema's own sentence, while the
  // action's parse is what keeps it safe when called from anywhere else. A
  // route handler that trusted its caller and an action that trusted its
  // caller would between them trust nobody.
  //
  // `grouping` takes the same `?? ""` as the two required dates, for the same
  // reason: null would be answered by zod's own type error rather than by
  // "That isn't a report this app can produce."
  const parsed = reportRequestSchema.safeParse({
    ...filterParams(params),
    grouping: params.get("grouping") ?? "",
  });

  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      error: parsed.error.issues[0]?.message ?? "Invalid report request.",
    };
  }

  const result = await exportReportCsv(parsed.data);

  if (!result.ok) {
    // Middleware (§8.3) has already refused an unauthenticated request with a
    // redirect to /sign-in and a limbo one with a redirect to /onboarding, so
    // this route never runs without a session and a company. With the
    // parameters known good, what is left is a server-side condition — the
    // Supabase env missing, the database refusing the RPC — not something the
    // caller can fix by changing the URL. Hence 500 rather than 400.
    return { ok: false, status: 500, error: result.error };
  }

  return { ok: true, ...result.data };
}

/**
 * §9.7's detail export: one line per entry, over the **whole range** rather than
 * the page on screen (§9.6). `page` is deliberately not read here — the action
 * ignores it, and passing it would suggest otherwise.
 *
 * **The 500 above is not quite the whole story here, so it is restated rather
 * than shared.** This exporter has one failure mode the aggregate one does not:
 * a range holding more than `MAX_EXPORT_ENTRIES` entries is refused, and that is
 * caller-fixable by editing the very URL the 500 comment says cannot help. It
 * still answers 500, and the choice is deliberate. `ActionResult` carries a
 * sentence and no code, so telling that refusal apart from "the database is
 * unreachable" here would mean matching on the error text — a coupling that
 * breaks silently the day someone rewords the sentence, and one this codebase
 * has nowhere else. Given the two ways to be wrong, reporting a genuine outage
 * as a 400 is the worse one: it removes a real server failure from every alert
 * and log filter that watches 5xx, whereas the over-large range still reaches
 * the user as its own sentence in the response body, which is what they act on.
 * If a status ever needs to be right here, the fix is a discriminated failure on
 * `ActionResult`, not a string comparison in this file.
 */
async function detailExport(params: URLSearchParams): Promise<ExportOutcome> {
  const parsed = reportEntriesRequestSchema.safeParse({
    ...filterParams(params),
    // `page` has a `.catch(1)`, so an absent or malformed value is the first
    // page rather than a refusal. It changes nothing about this file — the
    // export reads every page regardless — and is passed only so the parsed
    // request keeps the shape the action's schema declares.
    page: params.get("page") ?? 1,
  });

  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      error: parsed.error.issues[0]?.message ?? "Invalid report request.",
    };
  }

  const result = await exportReportEntriesCsv(parsed.data);

  if (!result.ok) {
    return { ok: false, status: 500, error: result.error };
  }

  return { ok: true, ...result.data };
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  // Read leniently, exactly as `/reports` itself reads it: anything that is not
  // the literal "detail" is the aggregate export. A mistyped `view` on a page
  // that fell back to the summary must not produce a file of a shape the screen
  // never showed, and there is no third view for a stricter parse to protect.
  const result =
    params.get("view") === "detail"
      ? await detailExport(params)
      : await aggregateExport(params);

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: result.status },
    );
  }

  // The BOM belongs to the file, not to the data, which is why `toCsv` does not
  // emit it and this does: Excel on Windows reads a BOM-less UTF-8 file as the
  // system codepage and turns every non-ASCII name into mojibake.
  return new NextResponse(CSV_UTF8_BOM + result.csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      // Both filenames are built from literals and `YYYY-MM-DD` strings that
      // have been through the schema (see `reportCsvFilename` and
      // `reportEntriesCsvFilename`), so neither carries a character that could
      // break out of these quotes.
      "Content-Disposition": `attachment; filename="${result.filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
