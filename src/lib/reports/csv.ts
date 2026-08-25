/**
 * CSV encoding for §9.6's "CSV export of any report view" — RFC 4180, by hand.
 *
 * **Why no dependency.** The whole format is three rules (quote a field
 * containing a delimiter, quote or newline; double an embedded quote; terminate
 * records with CRLF), and every serious CSV library is a *parser* first, with
 * the writer as a fraction of its surface. The cost of getting this wrong is a
 * broken column in a spreadsheet, which the tests below cover directly.
 *
 * **Why it is generic over columns rather than typed to a report shape.** The
 * §9.3 groupings each return a different row (by day has a date, the user ×
 * project cross-tab has four labels), and a formatter per grouping would be six
 * near-identical functions differing only in which strings they concatenate —
 * six places for the escaping to be subtly wrong instead of one. The caller
 * supplies the column list; this file owns quoting and nothing else.
 *
 * **Nothing here talks to Supabase, `next/*`, or the request context**, for the
 * same reason `lib/time/company-time.ts` does not: a `'use server'` module can
 * only export async functions, so a helper placed in the actions file could not
 * be shared or unit-tested without also publishing it as an endpoint.
 */

/**
 * What may appear in a cell. `null` and `undefined` are both written as an
 * empty field — a report row legitimately has neither ("no client" on an
 * internal project, §3.4; a project label the caller cannot read, which
 * `TimeEntryWithLabels` already renders as "—"), and inventing a placeholder
 * string here would put the word "null" into a payroll spreadsheet.
 */
export type CsvCell = string | number | null | undefined;

export type CsvColumn<Row> = {
  /** The header text, written verbatim through the same escaping as a cell. */
  header: string;
  value: (row: Row) => CsvCell;
};

const DELIMITER = ",";

/**
 * CRLF, per RFC 4180, not `\n`.
 *
 * Excel reads both, but a bare `\n` inside a file that also quotes multi-line
 * fields makes the record boundary and the in-field newline indistinguishable
 * to some older importers. Using CRLF between records and leaving any `\n` in
 * the data alone keeps the two unambiguous.
 */
const ROW_TERMINATOR = "\r\n";

/**
 * A field must be quoted if it contains the delimiter, a quote, or either
 * newline character. `\r` is listed separately from `\n` on purpose: a lone
 * carriage return pasted into a note would otherwise split a record.
 */
const MUST_QUOTE = /["\r\n,]/;

/**
 * The UTF-8 byte-order mark, for whoever builds the download response.
 *
 * **Not prepended by `toCsv`** — it belongs to the file, not to the data, and a
 * BOM in the middle of a concatenation is a stray character. Excel on Windows
 * reads a BOM-less UTF-8 file as the system codepage, which turns every
 * non-ASCII name (Arabic, for a `Africa/Cairo` company; any accented surname)
 * into mojibake, so the route handler that serves the file should write this
 * first.
 */
export const CSV_UTF8_BOM = "\uFEFF";

/**
 * Non-finite numbers become empty fields rather than the strings `NaN` or
 * `Infinity`, which no spreadsheet reads as a number. This should be
 * unreachable from a report — every duration is an integer second count summed
 * in Postgres (§9.5) — and exists so that a bug upstream produces a blank cell
 * instead of a cell that looks like data.
 *
 * The `1e21` branch is what keeps a very large integer out of exponent
 * notation: JavaScript renders `1e21` as `"1e+21"`, which a spreadsheet imports
 * as text or as a rounded float. Also unreachable in practice (that is 31
 * trillion years of recorded time) but cheap to be right about.
 */
function csvNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return "";
  }

  if (Number.isInteger(value) && Math.abs(value) >= 1e21) {
    return BigInt(value).toString();
  }

  return String(value);
}

/**
 * One field, escaped. Exported because the header row and every data row go
 * through it, and because it is the unit worth testing directly.
 */
export function csvField(value: CsvCell): string {
  if (value === null || value === undefined) {
    return "";
  }

  const text = typeof value === "number" ? csvNumber(value) : value;

  if (!MUST_QUOTE.test(text)) {
    return text;
  }

  // The escape for a quote inside a quoted field is a second quote, not a
  // backslash — `he said "hi"` becomes `"he said ""hi"""`.
  return `"${text.replaceAll('"', '""')}"`;
}

/**
 * A complete CSV document: one header row, then one row per input row.
 *
 * **An empty result is a header row and nothing else**, never an empty string.
 * A zero-byte download reads as a failed export; a file with column names and
 * no rows says "this range has no time in it", which is a real and common
 * answer.
 *
 * Every record is terminated, including the last. RFC 4180 permits either, and
 * a trailing terminator is what makes two documents safe to concatenate.
 */
export function toCsv<Row>(
  columns: readonly CsvColumn<Row>[],
  rows: readonly Row[],
): string {
  const header = columns.map((column) => csvField(column.header));

  const body = rows.map((row) =>
    columns.map((column) => csvField(column.value(row))),
  );

  return [header, ...body]
    .map((cells) => cells.join(DELIMITER) + ROW_TERMINATOR)
    .join("");
}

const SECONDS_PER_HOUR = 3600;

/**
 * Integer seconds → `H:MM:SS`, for the human-readable duration column.
 *
 * **This is the "format at the edge" of §9.5 and the only place a duration
 * stops being an integer.** Every arithmetic step below is integer division and
 * modulo; there is no division by 3600.0 anywhere in this file, in the actions,
 * or in the SQL, because summing rounded hours is what makes a total disagree
 * with its own line items.
 *
 * Hours grow past 24 rather than wrapping, matching `formatClock` in
 * `components/time-entries/elapsed.ts` — a 40-hour week must read `40:00:00`,
 * not `16:00:00`. That module is not imported (it belongs to the UI layer, and
 * `lib/` does not depend on `components/`); the shared thing is the convention,
 * the same arrangement `formatConflictRange` describes in
 * `lib/time/company-time.ts`.
 *
 * The export carries this *alongside* the raw second count rather than instead
 * of it: `H:MM:SS` is what an admin reconciles against the screen, and the
 * integer is what anyone re-importing the file should sum. A decimal-hours
 * column is deliberately absent — it exists only to be summed, and summing it
 * is the drift §9.5 forbids.
 */
export function formatSecondsHms(seconds: number): string {
  if (!Number.isFinite(seconds)) {
    return "0:00:00";
  }

  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / SECONDS_PER_HOUR);
  const minutes = Math.floor((total % SECONDS_PER_HOUR) / 60);
  const remainder = total % 60;

  return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}
