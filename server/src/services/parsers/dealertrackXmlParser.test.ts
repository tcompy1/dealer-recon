import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

import {
  extractVinsFromText,
  parseDealertrackXml,
} from "./dealertrackXmlParser.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(
  HERE,
  "..",
  "..",
  "..",
  "..",
  "sample-data",
  "synthetic",
  "dealertrack_floorplan_sample.xml",
);

describe("parseDealertrackXml", () => {
  test("extracts rows from the synthetic SpreadsheetML fixture", () => {
    const buffer = readFileSync(FIXTURE_PATH);
    const result = parseDealertrackXml(buffer);
    expect(result.header).not.toBeNull();
    expect(result.rows.length).toBeGreaterThanOrEqual(3);
    expect(result.rows[0][0]).toBe("M10001");
  });

  test("honors ss:Index gaps in cells", () => {
    const buffer = readFileSync(FIXTURE_PATH);
    const result = parseDealertrackXml(buffer);
    const indexedRow = result.rows.find((row) => row[0] === "M10002");
    expect(indexedRow).toBeDefined();
    expect(indexedRow?.[1] ?? "").toBe("");
    expect(indexedRow?.[2]).toBe("9876.50");
  });

  test("flags trailing <Row> with no close as row_truncated", () => {
    const xml = `<?xml version="1.0"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet">
<Worksheet><Table>
<Row><Cell><Data ss:Type="String">stock</Data></Cell><Cell><Data ss:Type="String">amount</Data></Cell></Row>
<Row><Cell><Data ss:Type="String">M99001</Data></Cell><Cell><Data ss:Type="Number">10.00</Data></Cell></Row>
<Row><Cell><Data ss:Type="String">M99002</Data></Cell><Cell><Data ss:Type="Number">20.00</Data></Cell>
</Table></Worksheet></Workbook>`;
    const result = parseDealertrackXml(xml);
    const truncated = result.warnings.find((w) => w.kind === "row_truncated");
    expect(truncated).toBeDefined();
    expect(truncated?.count).toBe(1);
  });

  test("recovers usable rows when a <Row> tag is not properly closed", () => {
    const buffer = readFileSync(FIXTURE_PATH);
    const result = parseDealertrackXml(buffer);
    const stockNumbers = result.rows.map((row) => row[0]);
    expect(stockNumbers).toEqual(
      expect.arrayContaining(["M10001", "M10002", "M10003"]),
    );
    expect(result.rows.length).toBeGreaterThanOrEqual(3);
  });

  test("reports warning counts only, never raw cell contents", () => {
    const buffer = readFileSync(FIXTURE_PATH);
    const result = parseDealertrackXml(buffer);
    for (const warning of result.warnings) {
      expect(warning.message).not.toMatch(/M\d{4,}/);
      expect(warning.message).not.toMatch(/[A-Z0-9]{17}/);
    }
  });

  test("empty input returns an empty_document warning", () => {
    const result = parseDealertrackXml("");
    expect(result.rows).toEqual([]);
    expect(result.warnings.some((w) => w.kind === "empty_document")).toBe(true);
  });

  test("input without any row tags returns empty rows + empty_document warning", () => {
    const result = parseDealertrackXml("<Workbook><Worksheet><Table/></Worksheet></Workbook>");
    expect(result.rows).toEqual([]);
    expect(result.warnings.some((w) => w.kind === "empty_document")).toBe(true);
  });
});

describe("extractVinsFromText", () => {
  test("finds embedded VINs inside free-form description text", () => {
    const description = "FLOORPLAN ADV STK M10001 VIN 1FAKEVN0000A0001X NEW";
    expect(extractVinsFromText(description)).toEqual(["1FAKEVN0000A0001X"]);
  });

  test("deduplicates repeated VIN tokens", () => {
    const description = "1FAKEVN0000A0001X paid; refund 1FAKEVN0000A0001X";
    expect(extractVinsFromText(description)).toEqual(["1FAKEVN0000A0001X"]);
  });

  test("ignores 17-char tokens that contain forbidden characters", () => {
    expect(extractVinsFromText("AAAAAAAAAAAAAAAAA")).toEqual([]);
    expect(extractVinsFromText("11111111111111111")).toEqual([]);
    expect(extractVinsFromText("IOQAAAAAAAAAAAAAA")).toEqual([]);
  });
});
