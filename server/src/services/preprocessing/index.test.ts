import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";

import { preprocessUpload } from "./index.js";

const REPO_ROOT = new URL("../../../../", import.meta.url);

async function loadFixture(relativePath: string): Promise<Buffer> {
  return readFile(new URL(relativePath, REPO_ROOT));
}

describe("preprocessUpload orchestrator", () => {
  test("routes a real BOA HTML-as-XLS fixture through the BOA preprocessor", async () => {
    const buffer = await loadFixture("sample-data/synthetic/boa_billing_statement_sample.xls.html");
    const decision = preprocessUpload(buffer, "boa", "boa_billing_statement_sample.xls");
    expect(decision.kind).toBe("preprocessed");
    if (decision.kind !== "preprocessed") return;
    expect(decision.output.detection.format).toBe("html_table_xls");
    expect(decision.output.route.kind).toBe("boa_html");
    expect(decision.output.transactions.length).toBeGreaterThan(0);
    // zero-balance row INV-1003 (ending balance 0) must be removed
    expect(decision.output.summary.rows_removed_zero_balance).toBeGreaterThanOrEqual(1);
  });

  test("routes a real Dealertrack SpreadsheetML fixture through the DT preprocessor", async () => {
    const buffer = await loadFixture("sample-data/synthetic/dealertrack_floorplan_sample.xml");
    const decision = preprocessUpload(buffer, "dealertrack", "dealertrack_floorplan_sample.xml");
    expect(decision.kind).toBe("preprocessed");
    if (decision.kind !== "preprocessed") return;
    expect(decision.output.detection.format).toBe("xml_spreadsheet");
    expect(decision.output.route.kind).toBe("dealertrack_xml");
    expect(decision.output.transactions.length).toBeGreaterThan(0);
  });

  test("falls back to legacy CSV path for CSV uploads", () => {
    const csv = Buffer.from(
      "transaction_date,amount,description,vin\n2026-04-28,$1.00,test,1FAKEVN0000A0001X\n",
    );
    const decision = preprocessUpload(csv, "boa", "test.csv");
    expect(decision.kind).toBe("fallback_legacy_csv");
  });

  test("rejects Dealertrack file declared as a BOA upload", () => {
    const xml = Buffer.from('<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"></Workbook>');
    const decision = preprocessUpload(xml, "boa", "looks-like-dt.xls");
    expect(decision.kind).toBe("unsupported");
  });
});
