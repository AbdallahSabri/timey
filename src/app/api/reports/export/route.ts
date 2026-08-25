import { NextResponse } from "next/server";

import { exportReportCsv } from "@/lib/actions/reports";
import { CSV_UTF8_BOM } from "@/lib/reports/csv";
import { reportRequestSchema } from "@/lib/validations/reports";

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

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  // Validated here *and* inside the action. Not redundant: this parse is what
  // turns a bad parameter into a 400 with the schema's own sentence, while the
  // action's parse is what keeps it safe when called from anywhere else. A
  // route handler that trusted its caller and an action that trusted its
  // caller would between them trust nobody.
  //
  // `?? ""` on the three required parameters, and *not* on the four optional
  // ones. `searchParams.get` returns null for an absent key, and null hits
  // `z.string()` before any of the schema's own refinements do — which answers
  // a missing `from` with zod's internal "Invalid input: expected string,
  // received null" instead of "Enter a date like 2026-08-25." An empty string
  // reaches the same refinements a typo would and gets the same sentence.
  // The filter ids keep their null: `optionalUuidSchema` is `.nullish()`, and
  // null there means "no filter", which is exactly what an absent key means.
  const parsed = reportRequestSchema.safeParse({
    from: params.get("from") ?? "",
    to: params.get("to") ?? "",
    grouping: params.get("grouping") ?? "",
    userId: params.get("userId"),
    clientId: params.get("clientId"),
    projectId: params.get("projectId"),
    taskId: params.get("taskId"),
  });

  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Invalid report request.",
      },
      { status: 400 },
    );
  }

  const result = await exportReportCsv(parsed.data);

  if (!result.ok) {
    // Middleware (§8.3) has already refused an unauthenticated request with a
    // redirect to /sign-in and a limbo one with a redirect to /onboarding, so
    // this route never runs without a session and a company. With the
    // parameters known good, what is left is a server-side condition — the
    // Supabase env missing, the database refusing the RPC — not something the
    // caller can fix by changing the URL. Hence 500 rather than 400.
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: 500 },
    );
  }

  // The BOM belongs to the file, not to the data, which is why `toCsv` does not
  // emit it and this does: Excel on Windows reads a BOM-less UTF-8 file as the
  // system codepage and turns every non-ASCII name into mojibake.
  return new NextResponse(CSV_UTF8_BOM + result.data.csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      // The filename is built from a closed enum and two `YYYY-MM-DD` strings
      // (see `reportCsvFilename`), so it carries no character that could break
      // out of these quotes.
      "Content-Disposition": `attachment; filename="${result.data.filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
