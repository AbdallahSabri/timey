import { describe, expect, it } from "vitest";

import {
  csvField,
  formatSecondsHms,
  toCsv,
  CSV_UTF8_BOM,
  type CsvColumn,
} from "@/lib/reports/csv";

/**
 * A stand-in for one row of any §9.3 grouping. `toCsv` never sees a report type
 * — the caller supplies the columns — so the shape here only has to exercise
 * the cell kinds a real report produces: a label, a nullable label (an internal
 * project has no client, §3.4), and an integer second count (§9.5).
 */
type Row = {
  label: string;
  client: string | null;
  seconds: number;
};

const columns: CsvColumn<Row>[] = [
  { header: "Project", value: (row) => row.label },
  { header: "Client", value: (row) => row.client },
  { header: "Duration (seconds)", value: (row) => row.seconds },
  { header: "Duration", value: (row) => formatSecondsHms(row.seconds) },
];

describe("csvField", () => {
  it("leaves an ordinary field unquoted", () => {
    expect(csvField("Acme Redesign")).toBe("Acme Redesign");
  });

  it("quotes a field containing a comma", () => {
    expect(csvField("Acme, Inc.")).toBe('"Acme, Inc."');
  });

  it("quotes a field containing a double quote and doubles the quote", () => {
    expect(csvField('he said "hi"')).toBe('"he said ""hi"""');
  });

  it("quotes a field that is only a quote", () => {
    expect(csvField('"')).toBe('""""');
  });

  it("quotes a field containing a newline and keeps the newline intact", () => {
    expect(csvField("line one\nline two")).toBe('"line one\nline two"');
  });

  it("quotes a field containing a lone carriage return", () => {
    // A bare \r would split the record in importers that treat it as a line
    // ending, which is why it is matched separately from \n.
    expect(csvField("line one\rline two")).toBe('"line one\rline two"');
  });

  it("quotes a field containing CRLF", () => {
    expect(csvField("line one\r\nline two")).toBe('"line one\r\nline two"');
  });

  it("writes null and undefined as empty fields", () => {
    expect(csvField(null)).toBe("");
    expect(csvField(undefined)).toBe("");
  });

  it("writes an empty string as an empty field, unquoted", () => {
    expect(csvField("")).toBe("");
  });

  it("does not quote leading or trailing spaces, and does not trim them", () => {
    expect(csvField("  padded  ")).toBe("  padded  ");
  });

  it("writes an integer without a separator or a decimal point", () => {
    expect(csvField(28_800)).toBe("28800");
  });

  it("writes zero", () => {
    expect(csvField(0)).toBe("0");
  });

  it("writes a negative number", () => {
    expect(csvField(-1)).toBe("-1");
  });

  it("writes the largest safe integer exactly", () => {
    expect(csvField(Number.MAX_SAFE_INTEGER)).toBe("9007199254740991");
  });

  it("writes a very large integer in full rather than in exponent notation", () => {
    // String(1e21) is "1e+21", which a spreadsheet imports as text.
    expect(csvField(1e21)).toBe("1000000000000000000000");
    expect(csvField(-1e21)).toBe("-1000000000000000000000");
  });

  it("writes a non-finite number as an empty field", () => {
    expect(csvField(Number.NaN)).toBe("");
    expect(csvField(Number.POSITIVE_INFINITY)).toBe("");
    expect(csvField(Number.NEGATIVE_INFINITY)).toBe("");
  });

  it("does not quote a non-ASCII field", () => {
    expect(csvField("مشروع")).toBe("مشروع");
  });
});

describe("toCsv", () => {
  it("writes a header row and one CRLF-terminated row per input row", () => {
    const csv = toCsv(columns, [
      { label: "Acme Redesign", client: "Acme", seconds: 28_800 },
      { label: "Internal", client: null, seconds: 3_661 },
    ]);

    expect(csv).toBe(
      "Project,Client,Duration (seconds),Duration\r\n" +
        "Acme Redesign,Acme,28800,8:00:00\r\n" +
        "Internal,,3661,1:01:01\r\n",
    );
  });

  it("writes a header row and nothing else for an empty result", () => {
    expect(toCsv(columns, [])).toBe(
      "Project,Client,Duration (seconds),Duration\r\n",
    );
  });

  it("terminates the last row too, so two documents concatenate cleanly", () => {
    const csv = toCsv(columns, [{ label: "Only", client: null, seconds: 60 }]);

    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv.split("\r\n")).toHaveLength(3);
  });

  it("escapes header text through the same rules as a cell", () => {
    const csv = toCsv<Row>(
      [{ header: 'Project, "the one"', value: (row) => row.label }],
      [],
    );

    expect(csv).toBe('"Project, ""the one"""\r\n');
  });

  it("escapes a cell whose value contains every troublesome character at once", () => {
    const csv = toCsv(columns, [
      {
        label: 'Acme, "Q3"\r\nphase two',
        client: null,
        seconds: 0,
      },
    ]);

    expect(csv).toBe(
      "Project,Client,Duration (seconds),Duration\r\n" +
        '"Acme, ""Q3""\r\nphase two",,0,0:00:00\r\n',
    );
  });

  it("keeps an embedded newline inside its quoted field rather than splitting the record", () => {
    const csv = toCsv(columns, [
      { label: "two\nlines", client: "Acme", seconds: 60 },
    ]);

    // Three record terminators would mean the note had split the row.
    expect(csv.split("\r\n").filter(Boolean)).toHaveLength(2);
  });

  it("writes no rows and no columns as an empty header line", () => {
    expect(toCsv<Row>([], [])).toBe("\r\n");
  });

  it("emits columns in the order given", () => {
    const reversed = [...columns].reverse();
    const csv = toCsv(reversed, [
      { label: "Acme Redesign", client: "Acme", seconds: 60 },
    ]);

    expect(csv.split("\r\n")[0]).toBe(
      "Duration,Duration (seconds),Client,Project",
    );
  });

  it("exposes the BOM separately rather than prepending it", () => {
    expect(CSV_UTF8_BOM).toBe("\uFEFF");
    expect(toCsv(columns, []).startsWith(CSV_UTF8_BOM)).toBe(false);
  });
});

describe("formatSecondsHms", () => {
  it("formats zero", () => {
    expect(formatSecondsHms(0)).toBe("0:00:00");
  });

  it("pads minutes and seconds but not hours", () => {
    expect(formatSecondsHms(3_661)).toBe("1:01:01");
    expect(formatSecondsHms(59)).toBe("0:00:59");
    expect(formatSecondsHms(600)).toBe("0:10:00");
  });

  it("grows past 24 hours rather than wrapping", () => {
    // A 40-hour week must not read 16:00:00 (§9.5's "totals that don't match
    // their own line items" in its most visible form).
    expect(formatSecondsHms(144_000)).toBe("40:00:00");
    expect(formatSecondsHms(86_400)).toBe("24:00:00");
  });

  it("is exactly additive over integer seconds", () => {
    // The property §9.5 is really about: the formatted total equals the format
    // of the summed integers, with no rounding step in between.
    const parts = [3_661, 1_800, 45, 7_200, 59];
    const total = parts.reduce((sum, value) => sum + value, 0);

    expect(total).toBe(12_765);
    expect(formatSecondsHms(total)).toBe("3:32:45");
  });

  it("clamps a negative value to zero rather than printing a negative clock", () => {
    expect(formatSecondsHms(-1)).toBe("0:00:00");
  });

  it("floors a fractional value instead of rounding it up", () => {
    // Unreachable from a report — duration_seconds is an int — but a fraction
    // must never round a 59.9-second entry up to a full minute.
    expect(formatSecondsHms(59.9)).toBe("0:00:59");
  });

  it("returns a zero clock for a non-finite value", () => {
    expect(formatSecondsHms(Number.NaN)).toBe("0:00:00");
    expect(formatSecondsHms(Number.POSITIVE_INFINITY)).toBe("0:00:00");
  });

  it("formats a year of continuous time without losing precision", () => {
    expect(formatSecondsHms(31_536_000)).toBe("8760:00:00");
  });
});
