import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parseAmountToCents } from "../domain/money.js";
import type { ReconciliationRunDetail, SourceType, TransactionSummary } from "../domain/types.js";
import {
  buildHurstFpRecWorkbook,
  toHurstFpRecFilename,
  toHurstFpRecXlsHtml,
  type HurstFpRecWorkbook,
} from "../presenters/hurstFpRec.js";

export const GOLDEN_MONTHS = ["FEB26", "MAR26", "APRIL26"] as const;
export type GoldenMonth = (typeof GOLDEN_MONTHS)[number];
export type ExportFormat = "xls" | "html";

export type GoldenFpRecRow = {
  month: string;
  classification: "matched" | "boa_only" | "dealertrack_only";
  boaDescription: string;
  vin: string;
  vin6: string;
  boaEndingBalanceCents: number | null;
  dt2100AmountCents: number | null;
  dtDescription: string;
  dtVinExtracted: string;
  controlNumber: string;
};

export type GeneratedHurstFpRecExport = {
  month: GoldenMonth;
  workbook: HurstFpRecWorkbook;
  html: string;
  counts: {
    matched: number;
    boaOnly: number;
    dealertrackOnly: number;
  };
};

export type WrittenHurstFpRecExport = GeneratedHurstFpRecExport & {
  files: string[];
};

type CliArgs = {
  months: GoldenMonth[];
  goldenCsvPath: string;
  outDir: string;
  formats: ExportFormat[];
};

const DEFAULT_GOLDEN_CSV_PATH = "../sample-data/golden_dataset.csv";
const DEFAULT_OUT_DIR = "tmp/hurst-fp-rec-exports";

export function parseGoldenFpRecRows(csvText: string): GoldenFpRecRow[] {
  const lines = csvText.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const [, ...dataLines] = lines;
  return dataLines.map((line) => {
    const cols = splitCsvLine(line);
    return {
      month: cols[0],
      classification: cols[2] as GoldenFpRecRow["classification"],
      boaDescription: cols[3] ?? "",
      vin: cols[4] ?? "",
      vin6: cols[5] ?? "",
      boaEndingBalanceCents: parseAmountToCents(cols[6]),
      dt2100AmountCents: parseAmountToCents(cols[7]),
      dtDescription: cols[9] ?? "",
      dtVinExtracted: cols[10] ?? "",
      controlNumber: cols[12] ?? "",
    };
  });
}

export function buildHurstFpRecFixtureExport(
  month: GoldenMonth,
  rows: GoldenFpRecRow[],
): GeneratedHurstFpRecExport {
  const monthRows = rows.filter((row) => row.month === month);
  const workbook = buildHurstFpRecWorkbook(buildRunDetail(month, monthRows));
  return {
    month,
    workbook,
    html: toHurstFpRecXlsHtml(workbook),
    counts: countWorkbookRows(workbook),
  };
}

export async function writeHurstFpRecFixtureExports(args: {
  months: GoldenMonth[];
  goldenCsvPath: string;
  outDir: string;
  formats: ExportFormat[];
}): Promise<WrittenHurstFpRecExport[]> {
  const csvText = await readFile(args.goldenCsvPath, "utf8");
  const rows = parseGoldenFpRecRows(csvText);
  await mkdir(args.outDir, { recursive: true });

  const written: WrittenHurstFpRecExport[] = [];
  for (const month of args.months) {
    const exportResult = buildHurstFpRecFixtureExport(month, rows);
    const baseFilename = toHurstFpRecFilename(exportResult.workbook).replace(/\.xls$/i, `-${month.toLowerCase()}`);
    const files: string[] = [];

    for (const format of args.formats) {
      const filePath = resolve(args.outDir, `${baseFilename}.${format}`);
      await writeFile(filePath, exportResult.html, "utf8");
      files.push(filePath);
    }

    written.push({ ...exportResult, files });
  }
  return written;
}

export function formatExportSummary(exports: WrittenHurstFpRecExport[]): string {
  return exports
    .flatMap((exportResult) => [
      `${exportResult.month}: matched=${exportResult.counts.matched} boa_only=${exportResult.counts.boaOnly} dealertrack_only=${exportResult.counts.dealertrackOnly} boa_total=${exportResult.workbook.boa_total_amount} dt_2100_total=${exportResult.workbook.dealertrack_total_amount} variance=${exportResult.workbook.variance_amount}`,
      ...exportResult.files.map((file) => `  wrote ${file}`),
    ])
    .join("\n");
}

function buildRunDetail(month: GoldenMonth, rows: GoldenFpRecRow[]): ReconciliationRunDetail {
  let transactionId = 1;
  let matchGroupId = 1;
  let exceptionId = 1;
  const matchGroups: ReconciliationRunDetail["match_groups"] = [];
  const exceptions: ReconciliationRunDetail["exceptions"] = [];

  for (const row of rows) {
    if (row.classification === "matched") {
      matchGroups.push({
        match_group_id: matchGroupId,
        match_type: "vin6_abs_amount",
        confidence: 1,
        reason: "Accepted fixture match by VIN6 and absolute amount.",
        created_at: createdAtForMonth(month),
        transactions: [
          {
            side: "boa",
            source_type: "boa",
            transaction: buildTransaction(transactionId, "boa", row),
          },
          {
            side: "dealertrack",
            source_type: "dealertrack",
            transaction: buildTransaction(transactionId + 1, "dealertrack", row),
          },
        ],
      });
      matchGroupId += 1;
      transactionId += 2;
      continue;
    }

    if (row.classification === "boa_only") {
      exceptions.push(buildException(exceptionId, "missing_in_dealertrack", "boa", buildTransaction(transactionId, "boa", row)));
    } else {
      exceptions.push(buildException(exceptionId, "missing_in_boa", "dealertrack", buildTransaction(transactionId, "dealertrack", row)));
    }
    exceptionId += 1;
    transactionId += 1;
  }

  return {
    reconciliation_run_id: runIdForMonth(month),
    dealership_id: 1,
    dealership_store_id: 1,
    store_name: "Hiley Mazda of Hurst",
    dealer_group_id: null,
    dealer_group_name: null,
    boa_source_file_id: 1,
    dealertrack_source_file_id: 2,
    boa_filename: `${month}-boa-golden.csv`,
    dealertrack_filename: `${month}-dealertrack-golden.csv`,
    matched_count: matchGroups.length,
    exception_count: exceptions.length,
    duplicate_count: 0,
    status: "fixture",
    created_at: createdAtForMonth(month),
    boa_source_file: sourceFile(1, "boa", month),
    dealertrack_source_file: sourceFile(2, "dealertrack", month),
    match_groups: matchGroups,
    exceptions,
  };
}

function buildTransaction(
  id: number,
  sourceType: "boa" | "dealertrack",
  row: GoldenFpRecRow,
): TransactionSummary {
  const amountCents = sourceType === "boa"
    ? requireAmount(row.boaEndingBalanceCents, row, "BOA Ending Balance")
    : requireAmount(row.dt2100AmountCents, row, "Dealertrack 2100");

  return {
    id,
    dealership_id: 1,
    source_type: sourceType,
    transaction_date: null,
    post_date: null,
    amount: (amountCents / 100).toFixed(2),
    amount_cents: amountCents,
    reference_number: sourceType === "dealertrack" ? row.controlNumber || null : null,
    description: sourceType === "boa" ? row.boaDescription || `BOA ${row.vin}` : row.dtDescription || `DT ${row.vin}`,
    account: sourceType === "dealertrack" ? "Floorplan Payable" : "BOA Floorplan",
    account_type: sourceType === "dealertrack" ? "liability" : "floorplan",
    account_identifier: sourceType === "dealertrack" ? "2100" : "floorplan",
    stock_number: sourceType === "dealertrack" ? row.controlNumber || null : null,
    vin: row.vin || row.dtVinExtracted || null,
  };
}

function buildException(
  exceptionId: number,
  exceptionType: "missing_in_boa" | "missing_in_dealertrack",
  sourceType: "boa" | "dealertrack",
  transaction: TransactionSummary,
): ReconciliationRunDetail["exceptions"][number] {
  return {
    exception_id: exceptionId,
    dealership_id: 1,
    exception_type: exceptionType,
    exception_category: exceptionType,
    status: "unresolved",
    note: "",
    review_status: "unreviewed",
    assigned_to: null,
    review_notes: "",
    boa_notes: "",
    gl_notes: "",
    reviewed_at: null,
    reviewed_by: null,
    source_type: sourceType,
    reason: "Accepted fixture side-specific exception.",
    created_at: "2026-06-10T00:00:00.000Z",
    transaction,
  };
}

function sourceFile(sourceFileId: number, sourceType: SourceType, month: GoldenMonth): ReconciliationRunDetail["boa_source_file"] {
  return {
    source_file_id: sourceFileId,
    dealership_id: 1,
    dealership_store_id: 1,
    store_name: "Hiley Mazda of Hurst",
    source_type: sourceType,
    filename: `${month}-${sourceType}-golden.csv`,
    row_count: 0,
    validation_error_count: 0,
    created_at: createdAtForMonth(month),
  };
}

function countWorkbookRows(workbook: HurstFpRecWorkbook): GeneratedHurstFpRecExport["counts"] {
  return {
    matched: workbook.rows.filter((row) => row.classification === "matched").length,
    boaOnly: workbook.rows.filter((row) => row.classification === "boa_only").length,
    dealertrackOnly: workbook.rows.filter((row) => row.classification === "dealertrack_only").length,
  };
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

function requireAmount(
  amountCents: number | null,
  row: GoldenFpRecRow,
  field: string,
): number {
  if (amountCents === null) {
    throw new Error(`${field} missing for ${row.month} ${row.classification} ${row.vin6}`);
  }
  return amountCents;
}

function runIdForMonth(month: GoldenMonth): number {
  return GOLDEN_MONTHS.indexOf(month) + 1;
}

function createdAtForMonth(month: GoldenMonth): string {
  const monthEnd: Record<GoldenMonth, string> = {
    FEB26: "2026-02-28T00:00:00.000Z",
    MAR26: "2026-03-31T00:00:00.000Z",
    APRIL26: "2026-04-30T00:00:00.000Z",
  };
  return monthEnd[month];
}

function parseArgs(argv: string[]): CliArgs {
  const args = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const next = argv[index + 1];
    if (key.startsWith("--")) {
      args.set(key, next && !next.startsWith("--") ? next : "true");
      if (next && !next.startsWith("--")) {
        index += 1;
      }
    }
  }

  return {
    months: parseMonths(args.get("--month") ?? "all"),
    goldenCsvPath: resolve(args.get("--golden-csv") ?? DEFAULT_GOLDEN_CSV_PATH),
    outDir: resolve(args.get("--out-dir") ?? DEFAULT_OUT_DIR),
    formats: parseFormats(args.get("--format") ?? "xls,html"),
  };
}

function parseMonths(value: string): GoldenMonth[] {
  if (value.toLowerCase() === "all") {
    return [...GOLDEN_MONTHS];
  }
  return value.split(",").map((raw) => {
    const normalized = raw.trim().toUpperCase();
    const month = normalized === "APR26" ? "APRIL26" : normalized;
    if (!GOLDEN_MONTHS.includes(month as GoldenMonth)) {
      throw new Error(`Unknown month "${raw}". Use FEB26, MAR26, APRIL26, or all.`);
    }
    return month as GoldenMonth;
  });
}

function parseFormats(value: string): ExportFormat[] {
  return value.split(",").map((raw) => {
    const format = raw.trim().toLowerCase();
    if (format !== "xls" && format !== "html") {
      throw new Error(`Unknown format "${raw}". Use xls, html, or xls,html.`);
    }
    return format;
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  writeHurstFpRecFixtureExports(parseArgs(process.argv.slice(2)))
    .then((exports) => {
      console.log(formatExportSummary(exports));
    })
    .catch((error) => {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    });
}
