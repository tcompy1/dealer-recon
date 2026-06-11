import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { STORE_WORKFLOW_CONFIGS, type StoreKey } from "../config/storeWorkflowConfig.js";
import type { ReconciliationRunDetail, SourceType, TransactionSummary } from "../domain/types.js";
import { parseAmountToCents } from "../domain/money.js";
import {
  buildFpRecWorkbookFromMergedFloorplan,
  buildHurstFpRecWorkbook,
  type HurstFpRecClerkRow,
  toHurstFpRecFilename,
  toHurstFpRecXlsHtml,
} from "./hurstFpRec.js";
import {
  buildMergedFloorplanWorkbook,
  type MergedFloorplanWorkbook,
  type MergedFloorplanRow,
} from "./mergedFloorplan.js";

const CLERK_HEADERS = [
  "HURST",
  "Serial No/VIN",
  "VIN6",
  "Ending Balance",
  "2100",
  "VIN6",
  "Description",
  "Control",
];

const goldenCsv = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../../sample-data/golden_dataset.csv"),
  "utf8",
);

type GoldenRow = {
  month: string;
  classification: "matched" | "boa_only" | "dealertrack_only";
  boaDescription: string;
  vin: string;
  vin6: string;
  boaEndingBalanceCents: number | null;
  dt2100AmountCents: number | null;
  dtVin6: string;
  dtDescription: string;
  dtVinExtracted: string;
  controlNumber: string;
};

function buildDetail(overrides: Partial<ReconciliationRunDetail> = {}): ReconciliationRunDetail {
  return {
    reconciliation_run_id: 42,
    dealership_id: 1,
    dealership_store_id: 1,
    store_name: "Hiley Hurst",
    dealer_group_id: null,
    dealer_group_name: null,
    boa_source_file_id: 1,
    dealertrack_source_file_id: 2,
    boa_filename: "boa.csv",
    dealertrack_filename: "dealertrack.csv",
    matched_count: 0,
    exception_count: 0,
    duplicate_count: 0,
    status: "completed",
    created_at: "2026-05-22T00:00:00.000Z",
    boa_source_file: sourceFile(1, "boa"),
    dealertrack_source_file: sourceFile(2, "dealertrack"),
    match_groups: [],
    exceptions: [],
    ...overrides,
  };
}

function sourceFile(source_file_id: number, source_type: SourceType) {
  return {
    source_file_id,
    dealership_id: 1,
    dealership_store_id: 1,
    store_name: "Hiley Hurst",
    source_type,
    filename: `${source_type}.csv`,
    row_count: 0,
    validation_error_count: 0,
    created_at: "2026-05-22T00:00:00.000Z",
  };
}

function transaction(overrides: Partial<TransactionSummary> = {}): TransactionSummary {
  return {
    id: 1,
    dealership_id: 1,
    source_type: "boa",
    transaction_date: "2026-05-01",
    post_date: null,
    amount: "12345.67",
    amount_cents: 1_234_567,
    reference_number: null,
    description: "2024 Ford F150 1FTFW1E80PFA11111",
    account: null,
    account_type: "floorplan",
    account_identifier: "floorplan",
    stock_number: "M12345",
    vin: "1FTFW1E80PFA11111",
    ...overrides,
  };
}

function exception(
  partial: Partial<ReconciliationRunDetail["exceptions"][number]>,
): ReconciliationRunDetail["exceptions"][number] {
  return {
    exception_id: 1,
    dealership_id: 1,
    exception_type: "missing_in_dealertrack",
    exception_category: "missing_in_dealertrack",
    status: "unresolved",
    note: "",
    review_status: "unreviewed",
    assigned_to: null,
    review_notes: "",
    boa_notes: "",
    gl_notes: "",
    reviewed_at: null,
    reviewed_by: null,
    source_type: "boa",
    reason: "BOA-only transaction.",
    created_at: "2026-05-22T00:00:00.000Z",
    transaction: transaction(),
    ...partial,
  };
}

function matchGroup(boaCents: number, dealertrackCents: number): ReconciliationRunDetail["match_groups"][number] {
  return {
    match_group_id: 1,
    match_type: "vin_amount",
    confidence: 1,
    reason: "Matched by VIN and amount.",
    created_at: "2026-05-22T00:00:00.000Z",
    transactions: [
      {
        side: "boa",
        source_type: "boa",
        transaction: transaction({
          id: 101,
          source_type: "boa",
          amount: String(boaCents / 100),
          amount_cents: boaCents,
          stock_number: "M10000",
          vin: "1FTFW1E80PFA10000",
        }),
      },
      {
        side: "dealertrack",
        source_type: "dealertrack",
        transaction: transaction({
          id: 102,
          source_type: "dealertrack",
          amount: String(-Math.abs(dealertrackCents) / 100),
          amount_cents: -Math.abs(dealertrackCents),
          stock_number: "M10000",
          vin: "1FTFW1E80PFA10000",
        }),
      },
    ],
  };
}

function clerkMatchGroup(): ReconciliationRunDetail["match_groups"][number] {
  return {
    match_group_id: 10,
    match_type: "vin6_abs_amount",
    confidence: 1,
    reason: "Matched by VIN6 and absolute amount.",
    created_at: "2026-05-22T00:00:00.000Z",
    transactions: [
      {
        side: "boa",
        source_type: "boa",
        transaction: transaction({
          id: 201,
          source_type: "boa",
          amount: "29855.00",
          amount_cents: 2_985_500,
          description: "2025 Mazda CX5",
          stock_number: null,
          vin: "JM3KFBAL0S0764873",
        }),
      },
      {
        side: "dealertrack",
        source_type: "dealertrack",
        transaction: transaction({
          id: 202,
          source_type: "dealertrack",
          amount: "-29855.00",
          amount_cents: -2_985_500,
          description: "2025 MAZDA CX-5         1/09/26  JM3KFBAL0S0764873",
          reference_number: "M21276",
          stock_number: "M21276",
          vin: "JM3KFBAL0S0764873",
        }),
      },
    ],
  };
}

function clerkContractDetail(): ReconciliationRunDetail {
  return buildDetail({
    match_groups: [clerkMatchGroup()],
    exceptions: [
      exception({
        exception_id: 301,
        exception_type: "missing_in_dealertrack",
        exception_category: "missing_in_dealertrack",
        source_type: "boa",
        transaction: transaction({
          id: 301,
          source_type: "boa",
          amount: "35999.00",
          amount_cents: 3_599_900,
          description: "BOA ONLY CX5 PF XA",
          stock_number: null,
          vin: "JM3KMCHA6T0126368",
        }),
      }),
      exception({
        exception_id: 302,
        exception_type: "missing_in_boa",
        exception_category: "missing_in_boa",
        source_type: "dealertrack",
        transaction: transaction({
          id: 302,
          source_type: "dealertrack",
          amount: "-26251.00",
          amount_cents: -2_625_100,
          description: "TRANSFER JM3KFBAL0S0764873   2/27/26  JM1BPABL0T1867950",
          reference_number: "M21317",
          stock_number: "M21317",
          vin: "JM1BPABL0T1867950",
        }),
      }),
      exception({
        exception_id: 303,
        exception_type: "needs_review_vin6_only",
        exception_category: "vin6_match_amount_mismatch",
        source_type: "boa",
        reason: "Needs review: VIN6 870612 matches dealertrack transaction 304 but amount differs.",
        transaction: transaction({
          id: 303,
          source_type: "boa",
          amount: "32283.00",
          amount_cents: 3_228_300,
          description: "AMOUNT MISMATCH BOA",
          stock_number: null,
          vin: "JM1BPBLL0T1870612",
        }),
      }),
      exception({
        exception_id: 304,
        exception_type: "needs_review_vin6_only",
        exception_category: "vin6_match_amount_mismatch",
        source_type: "dealertrack",
        reason: "Needs review: VIN6 870612 matches boa transaction 303 but amount differs.",
        transaction: transaction({
          id: 304,
          source_type: "dealertrack",
          amount: "-31771.00",
          amount_cents: -3_177_100,
          description: "AMOUNT MISMATCH DT   4/01/26  JM1BPBLL0T1870612",
          reference_number: "M21472",
          stock_number: "M21472",
          vin: "JM1BPBLL0T1870612",
        }),
      }),
    ],
  });
}

function clerkHtmlRows(detail: ReconciliationRunDetail = clerkContractDetail()): string[][] {
  return extractClerkDetailRows(toHurstFpRecXlsHtml(buildHurstFpRecWorkbook(detail)));
}

function splitCsvLine(line: string): string[] {
  const cols: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      cols.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cols.push(current);
  return cols;
}

function parseGoldenRows(): GoldenRow[] {
  const lines = goldenCsv.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const [, ...dataLines] = lines;
  return dataLines.map((line) => {
    const cols = splitCsvLine(line);
    return {
      month: cols[0],
      classification: cols[2] as GoldenRow["classification"],
      boaDescription: cols[3] ?? "",
      vin: cols[4] ?? "",
      vin6: cols[5] ?? "",
      boaEndingBalanceCents: parseAmountToCents(cols[6]),
      dt2100AmountCents: parseAmountToCents(cols[7]),
      dtVin6: cols[8] ?? "",
      dtDescription: cols[9] ?? "",
      dtVinExtracted: cols[10] ?? "",
      controlNumber: cols[12] ?? "",
    };
  });
}

function goldenDetailForMonth(month: string): ReconciliationRunDetail {
  const rows = parseGoldenRows().filter((row) => row.month === month);
  let transactionId = 10_000;
  let matchGroupId = 1;
  let exceptionId = 1;
  const match_groups: ReconciliationRunDetail["match_groups"] = [];
  const exceptions: ReconciliationRunDetail["exceptions"] = [];

  for (const row of rows) {
    if (row.classification === "matched") {
      match_groups.push({
        match_group_id: matchGroupId++,
        match_type: "vin6_abs_amount",
        confidence: 1,
        reason: "Matched by VIN6 and absolute amount.",
        created_at: "2026-05-22T00:00:00.000Z",
        transactions: [
          {
            side: "boa",
            source_type: "boa",
            transaction: goldenTransaction(transactionId++, "boa", row),
          },
          {
            side: "dealertrack",
            source_type: "dealertrack",
            transaction: goldenTransaction(transactionId++, "dealertrack", row),
          },
        ],
      });
      continue;
    }

    if (row.classification === "boa_only") {
      exceptions.push(
        exception({
          exception_id: exceptionId++,
          exception_type: "missing_in_dealertrack",
          exception_category: "missing_in_dealertrack",
          source_type: "boa",
          transaction: goldenTransaction(transactionId++, "boa", row),
        }),
      );
      continue;
    }

    exceptions.push(
      exception({
        exception_id: exceptionId++,
        exception_type: "missing_in_boa",
        exception_category: "missing_in_boa",
        source_type: "dealertrack",
        transaction: goldenTransaction(transactionId++, "dealertrack", row),
      }),
    );
  }

  return buildDetail({
    matched_count: match_groups.length,
    exception_count: exceptions.length,
    match_groups,
    exceptions,
  });
}

function goldenTransaction(
  id: number,
  source: "boa" | "dealertrack",
  row: GoldenRow,
): TransactionSummary {
  const amountCents = source === "boa"
    ? requireAmount(row.boaEndingBalanceCents, row, "BOA Ending Balance")
    : requireAmount(row.dt2100AmountCents, row, "Dealertrack 2100");

  return transaction({
    id,
    source_type: source,
    transaction_date: null,
    amount: (amountCents / 100).toFixed(2),
    amount_cents: amountCents,
    reference_number: source === "dealertrack" ? row.controlNumber || null : null,
    description: source === "boa" ? row.boaDescription : row.dtDescription,
    account_identifier: source === "dealertrack" ? "2100" : "floorplan",
    stock_number: source === "dealertrack" ? row.controlNumber || null : null,
    vin: row.vin || row.dtVinExtracted || null,
  });
}

function requireAmount(
  amountCents: number | null,
  row: GoldenRow,
  field: string,
): number {
  if (amountCents === null) {
    throw new Error(`${field} missing for ${row.month} ${row.classification} ${row.vin6}`);
  }
  return amountCents;
}

function extractHeaderRows(html: string): string[][] {
  return extractTableRows(html).flatMap((rows) =>
    rows.filter((row) => row.headerCellCount > 0).map((row) => row.cells),
  );
}

function extractClerkDetailRows(html: string): string[][] {
  for (const rows of extractTableRows(html)) {
    const headerIndex = rows.findIndex((row) => arraysEqual(row.cells, CLERK_HEADERS));
    if (headerIndex !== -1) {
      return rows
        .slice(headerIndex + 1)
        .map((row) => row.cells)
        .filter((row) => row.length === CLERK_HEADERS.length && row.some(hasText));
    }
  }
  return [];
}

function extractTableRows(html: string): Array<Array<{ cells: string[]; headerCellCount: number }>> {
  return [...html.matchAll(/<table[\s\S]*?<\/table>/gi)].map(([tableHtml]) =>
    [...tableHtml.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map(([rowHtml]) => {
      const cellMatches = [...rowHtml.matchAll(/<t([dh])\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)];
      return {
        cells: cellMatches.map(([, , cellHtml]) => normalizeCellText(cellHtml)),
        headerCellCount: cellMatches.filter(([, tag]) => tag.toLowerCase() === "h").length,
      };
    }),
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

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function hasText(value: string): boolean {
  return value.trim().length > 0;
}

function findRow(rows: string[][], predicate: (row: string[]) => boolean): string[] | undefined {
  return rows.find(predicate);
}

function expectBoaOnlyShape(row: string[] | undefined): void {
  expect(row).toBeDefined();
  expect(row?.slice(0, 4).every(hasText)).toBe(true);
  expect(row?.slice(4, 8)).toEqual(["", "", "", ""]);
}

function expectDealertrackOnlyShape(row: string[] | undefined): void {
  expect(row).toBeDefined();
  expect(row?.slice(0, 4)).toEqual(["", "", "", ""]);
  expect(row?.slice(4, 8).every(hasText)).toBe(true);
}

function countClerkRows(rows: string[][]): {
  matched: number;
  boaOnly: number;
  dealertrackOnly: number;
} {
  const dataRows = rows.filter((row) => row.length === CLERK_HEADERS.length);
  return {
    matched: dataRows.filter((row) => row.slice(0, 4).every(hasText) && row.slice(4, 8).every(hasText)).length,
    boaOnly: dataRows.filter((row) => row.slice(0, 4).every(hasText) && row.slice(4, 8).every((cell) => !hasText(cell))).length,
    dealertrackOnly: dataRows.filter((row) => row.slice(0, 4).every((cell) => !hasText(cell)) && row.slice(4, 8).every(hasText)).length,
  };
}

function countMergedRows(rows: Array<MergedFloorplanRow | HurstFpRecClerkRow>): {
  matched: number;
  boaOnly: number;
  dealertrackOnly: number;
} {
  return {
    matched: rows.filter((row) => row.classification === "matched").length,
    boaOnly: rows.filter((row) => row.classification === "boa_only").length,
    dealertrackOnly: rows.filter((row) => row.classification === "dealertrack_only").length,
  };
}

function mergedWorkbookForStore(storeKey: StoreKey): MergedFloorplanWorkbook {
  const config = STORE_WORKFLOW_CONFIGS[storeKey];
  const matchedVin = "1FTFW1E80PFA11111";
  const boaOnlyVin = "5NPE24AF7KH700001";
  const dealertrackOnlyVin = "3FA6P0H75HR200002";

  return buildMergedFloorplanWorkbook({
    storeConfig: config,
    storeName: config.displayName,
    periodDate: "02-28-26",
    boaRecords: [
      transaction({
        id: 1,
        source_type: "boa",
        amount: "15000.00",
        amount_cents: 1_500_000,
        description: `${config.mergedSheetLabel} matched unit`,
        stock_number: "MATCH1",
        vin: matchedVin,
      }),
      transaction({
        id: 2,
        source_type: "boa",
        amount: "20000.00",
        amount_cents: 2_000_000,
        description: `${config.mergedSheetLabel} BOA-only unit`,
        stock_number: "BOAONLY",
        vin: boaOnlyVin,
      }),
    ],
    dealertrackRecords: [
      transaction({
        id: 10,
        source_type: "dealertrack",
        amount: "-15000.00",
        amount_cents: -1_500_000,
        description: `${config.displayName} DT matched ${matchedVin}`,
        account: config.dealertrackAccountLabel,
        account_identifier: "floorplan",
        stock_number: "MATCH1",
        vin: matchedVin,
      }),
      transaction({
        id: 11,
        source_type: "dealertrack",
        amount: "-25000.00",
        amount_cents: -2_500_000,
        description: `${config.displayName} DT-only ${dealertrackOnlyVin}`,
        account: config.dealertrackAccountLabel,
        account_identifier: "floorplan",
        stock_number: "DTONLY",
        vin: dealertrackOnlyVin,
      }),
    ],
  });
}

describe("Hurst FP Rec clerk A-H export contract", () => {
  test("exports the accepted visible columns A-H in order", () => {
    const html = toHurstFpRecXlsHtml(buildHurstFpRecWorkbook(clerkContractDetail()));

    expect(extractHeaderRows(html)).toContainEqual(CLERK_HEADERS);
  });

  test("exports matched rows with BOA A-D and Dealertrack E-H on the same row", () => {
    const rows = clerkHtmlRows();
    const matchedRow = findRow(rows, (row) => row[0] === "2025 Mazda CX5");

    expect(matchedRow).toBeDefined();
    expect(matchedRow?.[1]).toBe("JM3KFBAL0S0764873");
    expect(matchedRow?.[2]).toBe("764873");
    expect(matchedRow?.[5]).toBe("764873");
    expect(matchedRow?.[6]).toBe("2025 MAZDA CX-5 1/09/26 JM3KFBAL0S0764873");
    expect(matchedRow?.[7]).toBe("M21276");
    expect(matchedRow?.slice(0, 8).every(hasText)).toBe(true);
  });

  test("exports BOA-only rows with values only in A-D", () => {
    const rows = clerkHtmlRows();
    const boaOnlyRow = findRow(rows, (row) => row[0] === "BOA ONLY CX5 PF XA");

    expectBoaOnlyShape(boaOnlyRow);
    expect(boaOnlyRow?.[1]).toBe("JM3KMCHA6T0126368");
    expect(boaOnlyRow?.[2]).toBe("126368");
  });

  test("exports Dealertrack-only rows with values only in E-H", () => {
    const rows = clerkHtmlRows();
    const dealertrackOnlyRow = findRow(
      rows,
      (row) => row[6] === "TRANSFER JM3KFBAL0S0764873 2/27/26 JM1BPABL0T1867950",
    );

    expectDealertrackOnlyShape(dealertrackOnlyRow);
    expect(dealertrackOnlyRow?.[5]).toBe("867950");
    expect(dealertrackOnlyRow?.[7]).toBe("M21317");
  });

  test("exports VIN6 amount mismatches as separate BOA-only and Dealertrack-only rows", () => {
    const rows = clerkHtmlRows();
    const boaMismatchRow = findRow(rows, (row) => row[0] === "AMOUNT MISMATCH BOA");
    const dealertrackMismatchRow = findRow(
      rows,
      (row) => row[6] === "AMOUNT MISMATCH DT 4/01/26 JM1BPBLL0T1870612",
    );
    const mergedMismatchRows = rows.filter(
      (row) => row[2] === "870612" && row[5] === "870612" && hasText(row[3]) && hasText(row[4]),
    );

    expectBoaOnlyShape(boaMismatchRow);
    expectDealertrackOnlyShape(dealertrackMismatchRow);
    expect(mergedMismatchRows).toHaveLength(0);
  });

  test.each([
    ["FEB26", { matched: 238, boaOnly: 0, dealertrackOnly: 16 }],
    ["MAR26", { matched: 217, boaOnly: 10, dealertrackOnly: 6 }],
    ["APRIL26", { matched: 199, boaOnly: 4, dealertrackOnly: 2 }],
  ])("exports %s golden row counts from sample-data/golden_dataset.csv", (month, expected) => {
    const rows = clerkHtmlRows(goldenDetailForMonth(month));

    expect(countClerkRows(rows)).toEqual(expected);
  });
});

describe("buildHurstFpRecWorkbook", () => {
  test("builds side-aware clerk rows from matches and exceptions", () => {
    const workbook = buildHurstFpRecWorkbook(clerkContractDetail());

    expect(workbook.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          classification: "matched",
          hurst_description: "2025 Mazda CX5",
          boa_vin: "JM3KFBAL0S0764873",
          boa_vin6: "764873",
          ending_balance_cents: 2_985_500,
          dt_2100_cents: -2_985_500,
          dt_vin6: "764873",
          dt_description: "2025 MAZDA CX-5         1/09/26  JM3KFBAL0S0764873",
          dt_control: "M21276",
        }),
        expect.objectContaining({
          classification: "boa_only",
          hurst_description: "BOA ONLY CX5 PF XA",
          ending_balance_cents: 3_599_900,
          dt_2100_cents: null,
        }),
        expect.objectContaining({
          classification: "dealertrack_only",
          hurst_description: "",
          ending_balance_cents: null,
          dt_2100_cents: -2_625_100,
          dt_vin6: "867950",
          dt_control: "M21317",
        }),
      ]),
    );
  });

  test("sorts BOA-valued rows by Ending Balance before blank-D Dealertrack-only rows", () => {
    const workbook = buildHurstFpRecWorkbook(clerkContractDetail());

    expect(workbook.rows.map((row) => row.classification)).toEqual([
      "matched",
      "boa_only",
      "boa_only",
      "dealertrack_only",
      "dealertrack_only",
    ]);
    expect(workbook.rows.map((row) => row.ending_balance_cents)).toEqual([
      2_985_500,
      3_228_300,
      3_599_900,
      null,
      null,
    ]);
  });

  test("computes BOA total, DT 2100 total, and non-zero variance from visible columns", () => {
    const workbook = buildHurstFpRecWorkbook(
      buildDetail({
        match_groups: [matchGroup(1_000_000, 1_000_000)],
        exceptions: [
          exception({
            exception_id: 1,
            exception_type: "missing_in_boa",
            exception_category: "missing_in_boa",
            source_type: "dealertrack",
            transaction: transaction({
              id: 1,
              source_type: "dealertrack",
              amount: "-100.00",
              amount_cents: -10_000,
              stock_number: "M1",
              vin: null,
            }),
          }),
          exception({
            exception_id: 2,
            exception_type: "missing_in_dealertrack",
            exception_category: "missing_in_dealertrack",
            source_type: "boa",
            transaction: transaction({
              id: 2,
              source_type: "boa",
              amount: "250.00",
              amount_cents: 25_000,
              stock_number: "M2",
              vin: "1FTFW1E80PFA22222",
            }),
          }),
        ],
      }),
    );

    expect(workbook.boa_total_amount_cents).toBe(1_025_000);
    expect(workbook.dealertrack_total_amount_cents).toBe(-1_010_000);
    expect(workbook.summary.outstanding_per_stmt_amount_cents).toBe(1_025_000);
    expect(workbook.summary.gl_2100_amount_cents).toBe(-1_010_000);
    expect(workbook.summary.difference_amount_cents).toBe(15_000);
    expect(workbook.net_adjustments_amount_cents).toBe(15_000);
    expect(workbook.variance_amount_cents).toBe(15_000);
  });

  test("renders one clerk grid and omits old report sections", () => {
    const html = toHurstFpRecXlsHtml(buildHurstFpRecWorkbook(clerkContractDetail()));

    expect(html).toContain("Floorplan Reconciliation - Hiley Hurst");
    expect(html).toContain("Period date");
    expect(html).toContain("(29,855.00)");
    expect(html).toContain("Variance");
    expect(html).not.toContain("On schedule-not on statement");
    expect(html).not.toContain("On statement-not on GL");
    expect(html).not.toContain("Unit / stock / VIN6 reference");
    expect(html).not.toContain("Needs Review");
    expect(html).not.toContain("Sign-off");
    expect(html).not.toContain("Prepared by");
    expect(html).not.toContain("Reviewed by");
  });

  test("uses a store and period filename without run id", () => {
    const workbook = buildHurstFpRecWorkbook(buildDetail({ exceptions: [exception({})] }));
    expect(toHurstFpRecFilename(workbook)).toBe("floorplan-reconciliation-hiley-hurst-05-01-26.xls");
  });
});

describe("store-configured FP Rec from merged floorplan workbook", () => {
  test.each([
    ["hurst", ["HURST", "2100"]],
    ["acura", ["ACURA", "324"]],
    ["fw", ["FW", "2100"]],
  ] as Array<[StoreKey, [string, string]]>)(
    "preserves %s merged row semantics and configured FP REC labels",
    (storeKey, [storeLabel, accountLabel]) => {
      const mergedWorkbook = mergedWorkbookForStore(storeKey);
      const fpRecWorkbook = buildFpRecWorkbookFromMergedFloorplan(mergedWorkbook);

      expect(fpRecWorkbook.store_config.storeKey).toBe(storeKey);
      expect(fpRecWorkbook.headers).toEqual([
        storeLabel,
        "Serial No/VIN",
        "VIN6",
        "Ending Balance",
        accountLabel,
        "VIN6",
        "Description",
        "Control",
      ]);
      expect(countMergedRows(fpRecWorkbook.rows)).toEqual(countMergedRows(mergedWorkbook.rows));
      expect(fpRecWorkbook.boa_total_amount_cents).toBe(mergedWorkbook.boa_total_amount_cents);
      expect(fpRecWorkbook.dealertrack_total_amount_cents).toBe(
        mergedWorkbook.dealertrack_total_amount_cents,
      );
      expect(fpRecWorkbook.rows.map((row) => row.classification)).toEqual(
        mergedWorkbook.rows.map((row) => row.classification),
      );
    },
  );

  test("renders Acura FP REC with ACURA and 324 instead of Hurst-only labels", () => {
    const fpRecWorkbook = buildFpRecWorkbookFromMergedFloorplan(mergedWorkbookForStore("acura"));
    const html = toHurstFpRecXlsHtml(fpRecWorkbook);

    expect(html).toContain("<th>ACURA</th>");
    expect(html).toContain("<th>324</th>");
    expect(html).not.toContain("<th>HURST</th>");
    expect(html).not.toContain("<th>2100</th>");
  });

  test("renders FW FP REC with 2100 display label from aggregated merged amount semantics", () => {
    const mergedWorkbook = mergedWorkbookForStore("fw");
    const fpRecWorkbook = buildFpRecWorkbookFromMergedFloorplan(mergedWorkbook);
    const matchedRow = fpRecWorkbook.rows.find((row) => row.classification === "matched");

    expect(mergedWorkbook.store_config.dealertrackAmountColumns).toEqual(["2100", "2101", "2101S"]);
    expect(mergedWorkbook.store_config.dealertrackExcludedAccountColumns).toEqual(["2110"]);
    expect(fpRecWorkbook.headers[0]).toBe("FW");
    expect(fpRecWorkbook.headers[4]).toBe("2100");
    expect(matchedRow?.dt_2100_cents).toBe(-1_500_000);
    expect(fpRecWorkbook.dealertrack_total_amount_cents).toBe(
      mergedWorkbook.dealertrack_total_amount_cents,
    );
  });
});
