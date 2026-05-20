import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

import { detectFileFormat } from "./fileFormatDetector.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(HERE, "..", "..", "..", "sample-data", "synthetic");

function loadFixture(name: string): Buffer {
  return readFileSync(join(FIXTURES_DIR, name));
}

describe("detectFileFormat", () => {
  test("empty buffer is unknown", () => {
    const result = detectFileFormat(Buffer.alloc(0), "anything.csv");
    expect(result.format).toBe("unknown");
    expect(result.reason).toBe("empty_buffer");
  });

  test("OOXML zip signature is detected as xlsx regardless of extension", () => {
    const buffer = Buffer.from([
      0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00,
    ]);
    const result = detectFileFormat(buffer, "Hurst-FP-Rec-1.xls");
    expect(result.format).toBe("xlsx_ooxml");
    expect(result.confidence).toBe("high");
    expect(result.sniffed_from).toBe("magic_bytes");
  });

  test("SpreadsheetML XML is detected even when filename ends with .XLS", () => {
    const buffer = loadFixture("dealertrack_floorplan_sample.xml");
    const result = detectFileFormat(buffer, "FLOORPLAN-RECON.XLS");
    expect(result.format).toBe("xml_spreadsheet");
    expect(result.confidence).toBe("high");
  });

  test("SpreadsheetML with a UTF-8 BOM is still detected", () => {
    const original = loadFixture("dealertrack_floorplan_sample.xml");
    const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), original]);
    const result = detectFileFormat(withBom, "export.XLS");
    expect(result.format).toBe("xml_spreadsheet");
  });

  test("HTML table disguised as xls is detected as html_table_xls", () => {
    const buffer = loadFixture("boa_billing_statement_sample.xls.html");
    const result = detectFileFormat(buffer, "BillingStatement.xls");
    expect(result.format).toBe("html_table_xls");
    expect(result.confidence).toBe("high");
  });

  test("plain CSV content is detected as csv with a useful confidence", () => {
    const csv = Buffer.from(
      "transaction_date,amount,description\n2026-03-01,100.00,test\n",
    );
    const result = detectFileFormat(csv, "upload.csv");
    expect(result.format).toBe("csv");
    expect(result.confidence === "medium" || result.confidence === "high").toBe(true);
  });

  test("unknown binary returns unknown rather than guessing", () => {
    const noise = Buffer.from([0xa1, 0xb2, 0xc3, 0xd4, 0xe5]);
    const result = detectFileFormat(noise, "random.bin");
    expect(result.format).toBe("unknown");
  });

  test("CSV extension on text-shaped content with no commas still falls back to extension", () => {
    const buffer = Buffer.from("description\nopaque\n");
    const result = detectFileFormat(buffer, "upload.csv");
    expect(result.format).toBe("csv");
  });
});
