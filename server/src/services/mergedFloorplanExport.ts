import type { StoreWorkflowConfig } from "../config/storeWorkflowConfig.js";
import { formatCents } from "../domain/money.js";
import type { ReconciliationRunDetail, Transaction, TransactionSummary } from "../domain/types.js";
import {
  buildMergedFloorplanWorkbook,
  buildMergedFloorplanWorkbookFromReconciliationDetail,
  type MergedFloorplanWorkbook,
  toMergedFloorplanFilename,
  toMergedFloorplanXlsHtml,
} from "../presenters/mergedFloorplan.js";

export type MergedFloorplanArtifact = {
  workbook: MergedFloorplanWorkbook;
  filename: string;
  contentType: string;
  html: string;
};

export function buildMergedFloorplanArtifact(
  detail: ReconciliationRunDetail,
  storeConfig: StoreWorkflowConfig,
): MergedFloorplanArtifact {
  const workbook = buildMergedFloorplanWorkbookFromReconciliationDetail(detail, storeConfig);

  return buildArtifactFromWorkbook(workbook);
}

export function buildMergedFloorplanArtifactFromTransactions(
  detail: ReconciliationRunDetail,
  storeConfig: StoreWorkflowConfig,
  boaTransactions: Transaction[],
  dealertrackTransactions: Transaction[],
): MergedFloorplanArtifact {
  const workbook = buildMergedFloorplanWorkbook({
    storeConfig,
    storeName: detail.store_name ?? storeConfig.displayName,
    boaRecords: boaTransactions.map(toTransactionSummary),
    dealertrackRecords: dealertrackTransactions.map(toTransactionSummary),
  });

  return buildArtifactFromWorkbook(workbook);
}

function buildArtifactFromWorkbook(workbook: MergedFloorplanWorkbook): MergedFloorplanArtifact {
  return {
    workbook,
    filename: toMergedFloorplanFilename(workbook),
    contentType: "application/vnd.ms-excel",
    html: toMergedFloorplanXlsHtml(workbook),
  };
}

function toTransactionSummary(transaction: Transaction): TransactionSummary {
  return {
    id: transaction.id,
    dealership_id: transaction.dealership_id,
    source_type: transaction.source_type,
    transaction_date: transaction.transaction_date,
    post_date: transaction.post_date,
    amount: formatCents(transaction.amount_cents),
    amount_cents: transaction.amount_cents,
    reference_number: transaction.reference_number,
    description: transaction.description,
    account: transaction.account,
    account_type: transaction.account_type,
    account_identifier: transaction.account_identifier,
    stock_number: transaction.stock_number,
    vin: transaction.vin,
  };
}
