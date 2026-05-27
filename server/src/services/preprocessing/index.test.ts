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

  test("routes BOA CSV uploads through the BOA preprocessor (no legacy fallback)", () => {
    // Models real Hiley BOA CSV: 2 banner rows, header row, mix of zero-balance
    // paid-off rows, a Straight Line row, real vehicle rows, and a Total row.
    const lines = [
      "Dealer Billing Statement for: February 2026,,,,,",
      "Hiley Cars Hurst LP,,,,,",
      "Location,Serial No/VIN,Stock/Lease No,Original Amount,Ending Balance,Maturity Date",
      "storeA,1FAKEVN0000A0001X,M0001,\"$31,234.00\",\"$31,234.00\",5/14/2027",
      "storeA,1FAKEVN0000A0002Y,M0002,\"$25,000.00\",\"$0.00\",5/14/2027",
      "storeA,Straight Line,Straight Line,\"$500,000.00\",\"$500,000.00\",4/23/2096",
      "Total: ,,,,$31234.00,",
    ];
    const buffer = Buffer.from(lines.join("\n") + "\n");
    const decision = preprocessUpload(buffer, "boa", "boa.csv");
    expect(decision.kind).toBe("preprocessed");
    if (decision.kind !== "preprocessed") return;
    expect(decision.output.route.kind).toBe("boa_csv");
    expect(decision.output.detection.format).toBe("csv");
    expect(decision.output.transactions.length).toBe(1);
    expect(decision.output.summary.rows_removed_zero_balance).toBe(1);
    expect(decision.output.summary.rows_removed_straightline).toBe(1);
    // Banner rows above the header + the trailing Total row should be removed
    expect(decision.output.summary.rows_removed_banner).toBeGreaterThanOrEqual(3);
    // Maturity date metadata should be preserved on the accepted vehicle row
    const accepted = decision.output.transactions[0];
    const lineage = accepted.raw_data["__lineage" as keyof typeof accepted.raw_data] as {
      maturity_date: string | null;
      source_row_number: number;
    };
    expect(lineage.maturity_date).toBe("5/14/2027");
    expect(typeof lineage.source_row_number).toBe("number");
    expect(
      decision.output.diagnostics.some((d) => d.kind === "header_row_detected"),
    ).toBe(true);
  });

  test("routes Dealertrack CSV uploads through the DT preprocessor and rejects offset rows", () => {
    // Models real Hiley DT CSV including the BOA offset row and Final Totals row.
    const lines = [
      "Control,Description,2100,2110",
      "BOA,BANK OF AMERICA,0,-500000",
      "M20148,BOA FLOORPLAN,-25746,0",
      "M20577,HILEY SERVICE LOANER 8/18/25  JM3KFBBL3S0720171,-31664,0",
      "M20657,BOA FLOORPLAN,-31525,0",
      ",Final Totals:,-9662045,-500000",
    ];
    const buffer = Buffer.from(lines.join("\n") + "\n");
    const decision = preprocessUpload(buffer, "dealertrack", "dt.csv");
    expect(decision.kind).toBe("preprocessed");
    if (decision.kind !== "preprocessed") return;
    expect(decision.output.route.kind).toBe("dealertrack_csv");
    expect(decision.output.detection.format).toBe("csv");
    // Only the three real M-prefix vehicle rows should be accepted; both the
    // "BOA, BANK OF AMERICA, 0, -500000" offset row and the trailing Final
    // Totals row must be filtered out.
    expect(decision.output.transactions.length).toBe(3);
    const stocks = decision.output.transactions.map((t) => t.stock_number);
    expect(stocks).not.toContain("BOA");
    // Each accepted row uses 2100 as canonical amount.
    const amounts = decision.output.transactions
      .map((t) => t.amount_cents)
      .sort((a, b) => a - b);
    expect(amounts).toEqual([-3166400, -3152500, -2574600].sort((a, b) => a - b));
    // Rows missing a VIN should surface as manual_enrichment_required.
    expect(decision.output.summary.rows_requiring_manual_enrichment).toBeGreaterThanOrEqual(1);
    expect(
      decision.output.diagnostics.some((d) => d.kind === "manual_enrichment_required"),
    ).toBe(true);
  });

  test("source-specific CSV routes emit preprocessing diagnostics rather than falling back", () => {
    const dt = Buffer.from("Control,Description,2100\nM10001,FLOORPLAN 1FAKEVN0000A0001X,-25000\n");
    const decision = preprocessUpload(dt, "dealertrack", "dt.csv");
    expect(decision.kind).toBe("preprocessed");
    if (decision.kind !== "preprocessed") return;
    expect(decision.output.route.kind).toBe("dealertrack_csv");
    expect(decision.output.diagnostics.length).toBeGreaterThan(0);
    expect(decision.output.summary.preprocessing_version).toBe("preprocessing-v1");
  });

  test("falls back to legacy CSV path only for non-floorplan source types", () => {
    const csv = Buffer.from(
      "transaction_date,amount,description,vin\n2026-04-28,$1.00,test,1FAKEVN0000A0001X\n",
    );
    const decision = preprocessUpload(csv, "bank", "test.csv");
    expect(decision.kind).toBe("fallback_legacy_csv");
  });

  test("rejects Dealertrack file declared as a BOA upload", () => {
    const xml = Buffer.from('<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"></Workbook>');
    const decision = preprocessUpload(xml, "boa", "looks-like-dt.xls");
    expect(decision.kind).toBe("unsupported");
  });
});
