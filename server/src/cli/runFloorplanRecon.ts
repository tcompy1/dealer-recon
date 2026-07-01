import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import type {
  ReconciliationException,
  ReconciliationResponse,
  TransactionSummary,
} from "../domain/types.js";
import { MemoryTransactionRepository } from "../repositories/transactionRepository.js";
import { reconcileTransactions } from "../services/reconciliationEngine.js";
import { normalizeTransactionsFromCsv } from "../services/transactionNormalizer.js";

type CliArgs = {
  boaFile: string;
  dealertrackFile: string;
};

export async function runLocalFloorplanRecon(args: CliArgs): Promise<ReconciliationResponse> {
  validateCsvPath(args.boaFile, "BOA");
  validateCsvPath(args.dealertrackFile, "Dealertrack");

  const repository = new MemoryTransactionRepository();
  await loadFile(repository, args.boaFile, "boa");
  await loadFile(repository, args.dealertrackFile, "dealertrack");
  return reconcileTransactions(repository);
}

export function formatReconciliationResult(result: ReconciliationResponse): string {
  const statementNotOnGl = exceptionsByPlacement(result, "statement");
  const scheduleNotOnStatement = exceptionsByPlacement(result, "schedule");
  const manualReview = exceptionsByPlacement(result, "manual_review");
  const lines: string[] = [];

  lines.push(`matched count: ${result.matched_count}`);
  lines.push(`exceptions count: ${result.exception_count}`);
  lines.push(`duplicates count: ${result.duplicate_count}`);
  lines.push("");
  lines.push("matches:");

  if (result.match_groups.length === 0) {
    lines.push("  none");
  } else {
    for (const group of result.match_groups) {
      const boaTransaction = group.transactions[0];
      const dealertrackTransaction = group.transactions[1];
      lines.push(
        `  ${rowLabel(boaTransaction)} <-> ${rowLabel(dealertrackTransaction)} | reason=${group.match_reason} | confidence=${group.confidence_score.toFixed(
          2,
        )}`,
      );
    }
  }

  lines.push("");
  appendExceptionSection(lines, "On statement-not on GL", statementNotOnGl);
  appendExceptionSection(lines, "On schedule-not on statement", scheduleNotOnStatement);
  appendExceptionSection(lines, "Needs manual review", manualReview);
  appendVinPresenceDiagnosticSection(lines, result);

  return lines.join("\n");
}

async function loadFile(
  repository: MemoryTransactionRepository,
  filePath: string,
  sourceType: "boa" | "dealertrack",
) {
  const content = await readFile(filePath);
  const result = normalizeTransactionsFromCsv(content, sourceType);

  if (result.validationErrors.length > 0) {
    const formattedErrors = result.validationErrors
      .map((error) => `row ${error.row}: ${error.message}`)
      .join("; ");
    throw new LocalReconError(`${sourceType} file has validation errors: ${formattedErrors}`);
  }

  await repository.insertMany(result.transactions);
}

function validateCsvPath(filePath: string, label: string): void {
  if (!existsSync(filePath)) {
    throw new LocalReconError(`${label} file does not exist: ${filePath}`);
  }
  if (/\.(xlsx|xls)$/i.test(filePath)) {
    throw new LocalReconError(
      `${label} file is an Excel workbook. Convert it to CSV first; see scripts/convert_xlsx_to_csv.md.`,
    );
  }
  if (!/\.csv$/i.test(filePath)) {
    throw new LocalReconError(`${label} file must be a CSV file: ${filePath}`);
  }
}

function exceptionsByPlacement(
  result: ReconciliationResponse,
  placement: "statement" | "schedule" | "manual_review",
): ReconciliationException[] {
  return result.exceptions.filter((exception) => exceptionPlacement(exception) === placement);
}

function exceptionPlacement(exception: ReconciliationException): "statement" | "schedule" | "manual_review" {
  if (
    exception.exception_type === "needs_review_vin6_only" ||
    exception.exception_category === "vin6_match_amount_mismatch"
  ) {
    return "manual_review";
  }
  if (exception.exception_type === "missing_in_dealertrack" || exception.source_type === "boa") {
    return "statement";
  }
  return "schedule";
}

function appendExceptionSection(
  lines: string[],
  title: string,
  exceptions: ReconciliationException[],
): void {
  lines.push(`${title}: ${exceptions.length}`);
  if (exceptions.length === 0) {
    lines.push("  none");
    lines.push("");
    return;
  }

  for (const exception of exceptions) {
    lines.push(`  ${rowLabel(exception.transaction)} | ${neutralExceptionPrompt(exception)}`);
  }
  lines.push("");
}

function neutralExceptionPrompt(exception: ReconciliationException): string {
  const placement = exceptionPlacement(exception);
  if (placement === "statement") {
    return "BOA statement row with no matching Dealertrack/GL row";
  }
  if (placement === "schedule") {
    return "Dealertrack/GL row with no matching BOA statement row";
  }
  return "VIN appears on both sides but amount differs; review manually";
}

function appendVinPresenceDiagnosticSection(
  lines: string[],
  result: ReconciliationResponse,
): void {
  const diagnostics = result.vin_presence_diagnostics;
  lines.push("VIN presence diagnostics:");
  lines.push(`  BOA extracted VINs: ${diagnostics.extracted_vin_sets.boa.length}`);
  lines.push(`  Dealertrack extracted VINs: ${diagnostics.extracted_vin_sets.dealertrack.length}`);
  appendVinList(
    lines,
    "  VINs in Dealertrack but not BOA",
    diagnostics.vin_presence_exceptions.dealertrack_not_in_boa,
  );
  appendVinList(
    lines,
    "  VINs in BOA but not Dealertrack",
    diagnostics.vin_presence_exceptions.boa_not_in_dealertrack,
  );
  lines.push(
    `  VINs present in both but transaction-unmatched: ${diagnostics.transaction_unmatched_shared_vins.length}`,
  );
  for (const entry of diagnostics.transaction_unmatched_shared_vins) {
    lines.push(
      `    ${entry.vin} | reason=${entry.likely_reason} | boa_ids=${entry.unmatched_boa_transaction_ids.join(
        "/",
      ) || "none"} | dealertrack_ids=${entry.unmatched_dealertrack_transaction_ids.join("/") || "none"}`,
    );
  }
  lines.push("");
}

function appendVinList(lines: string[], title: string, vins: string[]): void {
  lines.push(`${title}: ${vins.length}`);
  for (const vin of vins) {
    lines.push(`    ${vin}`);
  }
}

function rowLabel(transaction: TransactionSummary): string {
  return `${transaction.source_type.toUpperCase()} id=${transaction.id} stock=${
    transaction.stock_number ?? "n/a"
  } vin=${transaction.vin ?? "n/a"} ref=${transaction.reference_number ?? "n/a"} amount=${
    transaction.amount
  }`;
}

function parseArgs(argv: string[]): CliArgs {
  const args = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    args.set(argv[index], argv[index + 1]);
  }

  const boaFile = args.get("--boa-file");
  const dealertrackFile = args.get("--dealertrack-file");
  if (!boaFile || !dealertrackFile) {
    throw new LocalReconError("Usage: npm run recon -- --boa-file <boa.csv> --dealertrack-file <dealertrack.csv>");
  }

  return {
    boaFile: resolve(boaFile),
    dealertrackFile: resolve(dealertrackFile),
  };
}

class LocalReconError extends Error {}

if (import.meta.url === `file://${process.argv[1]}`) {
  runLocalFloorplanRecon(parseArgs(process.argv.slice(2)))
    .then((result) => {
      console.log(formatReconciliationResult(result));
    })
    .catch((error) => {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    });
}
