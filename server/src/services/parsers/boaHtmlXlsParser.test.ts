import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

import { parseBoaHtmlXls } from "./boaHtmlXlsParser.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(
  HERE,
  "..",
  "..",
  "..",
  "..",
  "sample-data",
  "synthetic",
  "boa_billing_statement_sample.xls.html",
);

describe("parseBoaHtmlXls", () => {
  test("locates header by fingerprint and skips banner rows", () => {
    const buffer = readFileSync(FIXTURE_PATH);
    const result = parseBoaHtmlXls(buffer);
    expect(result.header).not.toBeNull();
    expect(result.header?.length ?? 0).toBeGreaterThanOrEqual(10);
    const lowered = (result.header ?? []).map((h) => h.toLowerCase());
    expect(lowered.some((cell) => cell.includes("vin"))).toBe(true);
    expect(lowered.some((cell) => cell.includes("stock"))).toBe(true);
    expect(lowered.some((cell) => cell.includes("original amount"))).toBe(true);
  });

  test("extracts data rows from the largest table", () => {
    const buffer = readFileSync(FIXTURE_PATH);
    const result = parseBoaHtmlXls(buffer);
    expect(result.rows.length).toBe(4);
    expect(result.rows[0][0]).toBe("03/01/2026");
    expect(result.rows[0][1]).toBe("INV-1001");
    expect(result.rows[0][2]).toBe("1FAKEVN0000A0001X");
  });

  test("preserves blank cells where stock or VIN is missing", () => {
    const buffer = readFileSync(FIXTURE_PATH);
    const result = parseBoaHtmlXls(buffer);
    const noVin = result.rows.find((row) => row[1] === "INV-1002");
    expect(noVin?.[2]).toBe("");
    const noStock = result.rows.find((row) => row[1] === "INV-1003");
    expect(noStock?.[3]).toBe("");
  });

  test("returns header_not_detected warning when no fingerprint matches", () => {
    const html =
      "<html><body><table><tr><td>aaa</td><td>bbb</td><td>ccc</td></tr><tr><td>1</td><td>2</td><td>3</td></tr></table></body></html>";
    const result = parseBoaHtmlXls(html);
    expect(result.header).toBeNull();
    expect(
      result.warnings.some((w) => w.kind === "header_not_detected"),
    ).toBe(true);
    expect(result.rows.length).toBeGreaterThan(0);
  });

  test("empty input returns empty_document warning", () => {
    const result = parseBoaHtmlXls("");
    expect(result.rows).toEqual([]);
    expect(result.warnings.some((w) => w.kind === "empty_document")).toBe(true);
  });

  test("warnings never include raw cell contents", () => {
    const buffer = readFileSync(FIXTURE_PATH);
    const result = parseBoaHtmlXls(buffer);
    for (const warning of result.warnings) {
      expect(warning.message).not.toMatch(/INV-\d+/);
      expect(warning.message).not.toMatch(/\$\d/);
      expect(warning.message).not.toMatch(/[A-Z0-9]{17}/);
    }
  });
});
