import { describe, expect, test } from "vitest";

import { STORE_WORKFLOW_CONFIGS } from "../config/storeWorkflowConfig.js";
import type { TransactionSummary } from "../domain/types.js";
import {
  buildMergedFloorplanWorkbook,
  toMergedFloorplanFilename,
  toMergedFloorplanXlsHtml,
  type MergedFloorplanWorkbook,
} from "./mergedFloorplan.js";

const HURST_HEADERS = [
  "HURST",
  "Serial No/VIN",
  "VIN6",
  "Ending Balance",
  "2100",
  "VIN6",
  "Description",
  "Control",
];

const ACURA_HEADERS = [
  "ACURA",
  "Serial No/VIN",
  "VIN6",
  "Ending Balance",
  "324",
  "VIN6",
  "Description",
  "Control",
];

function transaction(overrides: Partial<TransactionSummary> = {}): TransactionSummary {
  return {
    id: 1,
    dealership_id: 1,
    source_type: "boa",
    transaction_date: "2026-04-30",
    post_date: null,
    amount: "29855.00",
    amount_cents: 2_985_500,
    reference_number: null,
    description: "2025 Mazda CX5",
    account: null,
    account_type: "floorplan",
    account_identifier: "floorplan",
    stock_number: null,
    vin: "JM3KFBAL0S0764873",
    ...overrides,
  };
}

function boa(
  id: number,
  amountCents: number,
  vin: string,
  description: string,
): TransactionSummary {
  return transaction({
    id,
    source_type: "boa",
    amount: (amountCents / 100).toFixed(2),
    amount_cents: amountCents,
    description,
    vin,
    reference_number: null,
    stock_number: null,
    account: null,
    account_identifier: "floorplan",
  });
}

function dealertrack(
  id: number,
  amountCents: number,
  vin: string,
  description: string,
  control: string,
  accountIdentifier: string,
): TransactionSummary {
  return transaction({
    id,
    source_type: "dealertrack",
    amount: (-Math.abs(amountCents) / 100).toFixed(2),
    amount_cents: -Math.abs(amountCents),
    reference_number: control,
    stock_number: control,
    description: `${description}   4/30/26  ${vin}`,
    account: accountIdentifier,
    account_identifier: accountIdentifier,
    vin,
  });
}

function contractWorkbook(
  storeConfig = STORE_WORKFLOW_CONFIGS.hurst,
): MergedFloorplanWorkbook {
  return buildMergedFloorplanWorkbook({
    storeConfig,
    storeName: storeConfig.displayName,
    periodDate: "04-30-26",
    boaRecords: [
      boa(101, 2_985_500, "JM3KFBAL0S0764873", "MATCHED BOA CX5"),
      boa(102, 3_599_900, "JM3KMCHA6T0126368", "BOA ONLY CX5"),
      boa(103, 3_228_300, "JM1BPBLL0T1870612", "AMOUNT MISMATCH BOA"),
    ],
    dealertrackRecords: [
      dealertrack(
        201,
        2_985_500,
        "JM3KFBAL0S0764873",
        "MATCHED DT CX5",
        "M21276",
        storeConfig.dealertrackAccountColumn,
      ),
      dealertrack(
        202,
        2_625_100,
        "JM1BPABL0T1867950",
        "DT ONLY TRANSFER",
        "M21317",
        storeConfig.dealertrackAccountColumn,
      ),
      dealertrack(
        203,
        3_177_100,
        "JM1BPBLL0T1870612",
        "AMOUNT MISMATCH DT",
        "M21472",
        storeConfig.dealertrackAccountColumn,
      ),
    ],
  });
}

function findRow(
  workbook: MergedFloorplanWorkbook,
  predicate: (row: MergedFloorplanWorkbook["rows"][number]) => boolean,
) {
  return workbook.rows.find(predicate);
}

function extractTableRows(html: string): string[][] {
  return [...html.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map(([rowHtml]) =>
    [...rowHtml.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(([, cellHtml]) =>
      normalizeCellText(cellHtml),
    ),
  );
}

function normalizeCellText(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

describe("merged floorplan presenter", () => {
  test("uses Hurst merged headers from store config", () => {
    const workbook = contractWorkbook(STORE_WORKFLOW_CONFIGS.hurst);
    const html = toMergedFloorplanXlsHtml(workbook);

    expect(workbook.headers).toEqual(HURST_HEADERS);
    expect(html).toContain("<th>HURST</th>");
    expect(html).toContain("<th>2100</th>");
    expect(toMergedFloorplanFilename(workbook)).toBe("hurst-merged-floorplan-04-30-26.xls");
  });

  test("uses Acura merged headers from store config without hardcoded Hurst account labels", () => {
    const workbook = contractWorkbook(STORE_WORKFLOW_CONFIGS.acura);
    const html = toMergedFloorplanXlsHtml(workbook);

    expect(workbook.headers).toEqual(ACURA_HEADERS);
    expect(html).toContain("<th>ACURA</th>");
    expect(html).toContain("<th>324</th>");
    expect(html).not.toContain("<th>HURST</th>");
    expect(html).not.toContain("<th>2100</th>");
    expect(html).not.toContain("2100 total");
  });

  test("builds matched, BOA-only, Dealertrack-only, and amount-mismatch split rows", () => {
    const workbook = contractWorkbook();

    expect(workbook.rows.map((row) => row.classification).sort()).toEqual([
      "boa_only",
      "boa_only",
      "dealertrack_only",
      "dealertrack_only",
      "matched",
    ]);

    const matched = findRow(workbook, (row) => row.classification === "matched");
    expect(matched).toMatchObject({
      store_description: "MATCHED BOA CX5",
      serial_no_vin: "JM3KFBAL0S0764873",
      boa_vin6: "764873",
      ending_balance_cents: 2_985_500,
      dealertrack_account_amount_cents: -2_985_500,
      dealertrack_vin6: "764873",
      dealertrack_control: "M21276",
    });

    const boaOnly = findRow(workbook, (row) => row.store_description === "BOA ONLY CX5");
    expect(boaOnly).toMatchObject({
      classification: "boa_only",
      dealertrack_account_amount_cents: null,
      dealertrack_vin6: "",
      dealertrack_description: "",
      dealertrack_control: "",
    });

    const dealertrackOnly = findRow(workbook, (row) =>
      row.dealertrack_description.startsWith("DT ONLY TRANSFER"),
    );
    expect(dealertrackOnly).toMatchObject({
      classification: "dealertrack_only",
      store_description: "",
      serial_no_vin: "",
      boa_vin6: "",
      ending_balance_cents: null,
      dealertrack_account_amount_cents: -2_625_100,
      dealertrack_vin6: "867950",
      dealertrack_control: "M21317",
    });

    const boaMismatch = findRow(
      workbook,
      (row) => row.store_description === "AMOUNT MISMATCH BOA",
    );
    const dealertrackMismatch = findRow(workbook, (row) =>
      row.dealertrack_description.startsWith("AMOUNT MISMATCH DT"),
    );
    const mergedMismatchRows = workbook.rows.filter(
      (row) =>
        row.boa_vin6 === "870612" &&
        row.dealertrack_vin6 === "870612" &&
        row.ending_balance_cents !== null &&
        row.dealertrack_account_amount_cents !== null,
    );

    expect(boaMismatch).toMatchObject({
      classification: "boa_only",
      ending_balance_cents: 3_228_300,
      dealertrack_account_amount_cents: null,
    });
    expect(dealertrackMismatch).toMatchObject({
      classification: "dealertrack_only",
      ending_balance_cents: null,
      dealertrack_account_amount_cents: -3_177_100,
      dealertrack_vin6: "870612",
    });
    expect(mergedMismatchRows).toHaveLength(0);
  });

  test("renders one totals row using the configured Dealertrack account label", () => {
    const workbook = contractWorkbook(STORE_WORKFLOW_CONFIGS.acura);
    const rows = extractTableRows(toMergedFloorplanXlsHtml(workbook));
    const totalsRow = rows.find((row) => row[0] === "BOA total");

    expect(totalsRow).toBeDefined();
    expect(totalsRow?.[3]).toBe("98,137.00");
    expect(totalsRow?.[4]).toBe("(87,877.00)");
    expect(totalsRow?.[6]).toBe("324 total");
  });

  test("filters Dealertrack rows by the configured account column", () => {
    const workbook = buildMergedFloorplanWorkbook({
      storeConfig: STORE_WORKFLOW_CONFIGS.acura,
      storeName: "Acura",
      periodDate: "04-30-26",
      boaRecords: [boa(101, 2_985_500, "JM3KFBAL0S0764873", "ACURA MATCH")],
      dealertrackRecords: [
        dealertrack(201, 2_985_500, "JM3KFBAL0S0764873", "WRONG ACCOUNT", "A1000", "2100"),
        dealertrack(202, 2_985_500, "JM3KFBAL0S0764873", "RIGHT ACCOUNT", "A1001", "324"),
      ],
    });

    expect(workbook.rows).toHaveLength(1);
    expect(workbook.rows[0]).toMatchObject({
      classification: "matched",
      dealertrack_description: "RIGHT ACCOUNT   4/30/26  JM3KFBAL0S0764873",
      dealertrack_control: "A1001",
    });
  });
});
