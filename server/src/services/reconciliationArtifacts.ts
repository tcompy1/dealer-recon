import { formatCents } from "../domain/money.js";
import { neutralizeSpreadsheetText } from "../spreadsheetText.js";
import type {
  NewReconciliationArtifact,
  ReconciliationArtifactMetadata,
  ReconciliationArtifactType,
  ReconciliationRun,
  SourceFile,
  Transaction,
} from "../domain/types.js";
import type { TransactionRepository } from "../repositories/transactionRepository.js";
import {
  resolveStoreWorkflowConfigFromStoreName,
} from "../config/storeWorkflowConfig.js";
import { buildMergedFloorplanArtifactFromTransactions } from "./mergedFloorplanExport.js";
import {
  buildFpRecWorkbookFromMergedFloorplan,
  toHurstFpRecFilename,
  toHurstFpRecXlsHtml,
} from "../presenters/hurstFpRec.js";

type CsvScalar = string | number | null;
type CsvCell = CsvScalar | { value: CsvScalar; preservePlainNumericText?: boolean };

export async function persistReconciliationRunArtifacts({
  repository,
  dealershipId,
  run,
  boaSourceFile,
  dealertrackSourceFile,
  boaTransactions,
  dealertrackTransactions,
  uploadedByUserId,
}: {
  repository: TransactionRepository;
  dealershipId: number;
  run: ReconciliationRun;
  boaSourceFile: SourceFile;
  dealertrackSourceFile: SourceFile;
  boaTransactions: Transaction[];
  dealertrackTransactions: Transaction[];
  uploadedByUserId: number | null;
}): Promise<ReconciliationArtifactMetadata[]> {
  const detail = await repository.getReconciliationRunDetail(dealershipId, run.id);
  if (!detail) {
    return [];
  }

  const accountingMonth = resolveAccountingMonth(
    [...boaTransactions, ...dealertrackTransactions],
    run.created_at,
  );
  const base = {
    reconciliation_run_id: run.id,
    store_id: run.dealership_store_id,
    accounting_month: accountingMonth,
    uploaded_by: uploadedByUserId,
  };
  const artifacts: NewReconciliationArtifact[] = [
    ...await rawArtifacts(repository, dealershipId, base, boaSourceFile, dealertrackSourceFile),
    cleanedArtifact(base, "CLEANED_BOA", cleanedFilename(boaSourceFile, accountingMonth), boaTransactions),
    cleanedArtifact(
      base,
      "CLEANED_DEALERTRACK",
      cleanedFilename(dealertrackSourceFile, accountingMonth),
      dealertrackTransactions,
    ),
  ];

  const storeConfig = resolveStoreWorkflowConfigFromStoreName(detail.store_name);
  if (storeConfig) {
    const mergedArtifact = buildMergedFloorplanArtifactFromTransactions(
      detail,
      storeConfig,
      boaTransactions,
      dealertrackTransactions,
    );
    const fpRecWorkbook = buildFpRecWorkbookFromMergedFloorplan(mergedArtifact.workbook);
    const fpRecHtml = toHurstFpRecXlsHtml(fpRecWorkbook);
    artifacts.push(
      {
        ...base,
        artifact_type: "MERGED_FLOORPLAN",
        filename: mergedArtifact.filename,
        content_type: mergedArtifact.contentType,
        content: Buffer.from(mergedArtifact.html, "utf8"),
      },
      {
        ...base,
        artifact_type: "FP_REC",
        filename: toHurstFpRecFilename(fpRecWorkbook),
        content_type: "application/vnd.ms-excel",
        content: Buffer.from(fpRecHtml, "utf8"),
      },
    );
  }

  const created: ReconciliationArtifactMetadata[] = [];
  for (const artifact of artifacts) {
    created.push(await repository.createReconciliationArtifact(dealershipId, artifact));
  }
  return created;
}

async function rawArtifacts(
  repository: TransactionRepository,
  dealershipId: number,
  base: ArtifactBase,
  boaSourceFile: SourceFile,
  dealertrackSourceFile: SourceFile,
): Promise<NewReconciliationArtifact[]> {
  const [boaUpload, dealertrackUpload] = await Promise.all([
    repository.getSourceFileUploadContent(dealershipId, boaSourceFile.id),
    repository.getSourceFileUploadContent(dealershipId, dealertrackSourceFile.id),
  ]);
  const artifacts: NewReconciliationArtifact[] = [];
  if (boaUpload) {
    artifacts.push({
      ...base,
      artifact_type: "RAW_BOA",
      filename: boaUpload.filename,
      content_type: boaUpload.content_type,
      file_size: boaUpload.file_size,
      content: boaUpload.content,
    });
  }
  if (dealertrackUpload) {
    artifacts.push({
      ...base,
      artifact_type: "RAW_DEALERTRACK",
      filename: dealertrackUpload.filename,
      content_type: dealertrackUpload.content_type,
      file_size: dealertrackUpload.file_size,
      content: dealertrackUpload.content,
    });
  }
  return artifacts;
}

type ArtifactBase = Pick<
  NewReconciliationArtifact,
  "reconciliation_run_id" | "store_id" | "accounting_month" | "uploaded_by"
>;

function cleanedArtifact(
  base: ArtifactBase,
  artifactType: Extract<ReconciliationArtifactType, "CLEANED_BOA" | "CLEANED_DEALERTRACK">,
  filename: string,
  transactions: Transaction[],
): NewReconciliationArtifact {
  const csv = toCleanedTransactionsCsv(transactions);
  return {
    ...base,
    artifact_type: artifactType,
    filename,
    content_type: "text/csv; charset=utf-8",
    content: Buffer.from(csv, "utf8"),
  };
}

function cleanedFilename(sourceFile: SourceFile, accountingMonth: string): string {
  const source = sourceFile.source_type === "dealertrack" ? "dealertrack" : sourceFile.source_type;
  const stem = sourceFile.original_filename
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${stem || source}-cleaned-${accountingMonth}.csv`;
}

function toCleanedTransactionsCsv(transactions: Transaction[]): string {
  const headers = [
    "transaction_id",
    "source_file_id",
    "source_type",
    "transaction_date",
    "post_date",
    "amount",
    "amount_cents",
    "reference_number",
    "description",
    "account",
    "account_type",
    "account_identifier",
    "stock_number",
    "vin",
  ];
  const rows = transactions.map((transaction) => [
    transaction.id,
    transaction.source_file_id,
    transaction.source_type,
    transaction.transaction_date,
    transaction.post_date,
    { value: formatCents(transaction.amount_cents), preservePlainNumericText: true },
    transaction.amount_cents,
    transaction.reference_number,
    transaction.description,
    transaction.account,
    transaction.account_type,
    transaction.account_identifier,
    transaction.stock_number,
    transaction.vin,
  ]);
  return [headers, ...rows].map((row) => row.map(toCsvCell).join(",")).join("\n") + "\n";
}

function resolveAccountingMonth(transactions: Transaction[], fallbackIso: string): string {
  const dates = transactions
    .map((transaction) => transaction.transaction_date ?? transaction.post_date)
    .filter((value): value is string => typeof value === "string" && /^\d{4}-\d{2}/.test(value))
    .sort();
  return (dates.at(-1) ?? fallbackIso).slice(0, 7);
}

function toCsvCell(cell: CsvCell): string {
  const value = isCsvCellOptions(cell) ? cell.value : cell;
  const preservePlainNumericText = isCsvCellOptions(cell)
    ? cell.preservePlainNumericText
    : false;
  if (value === null) {
    return "";
  }
  const text = typeof value === "number"
    ? String(value)
    : neutralizeSpreadsheetText(value, { preservePlainNumericText });
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function isCsvCellOptions(cell: CsvCell): cell is { value: CsvScalar; preservePlainNumericText?: boolean } {
  return typeof cell === "object" && cell !== null && "value" in cell;
}
