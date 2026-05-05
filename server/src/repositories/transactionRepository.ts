import type {
  NewSourceFile,
  NewTransaction,
  ReconciliationExceptionReviewUpdate,
  ReconciliationExceptionStatus,
  PersistReconciliationRunInput,
  ReconciliationExceptionType,
  ReconciliationRunDetail,
  ReconciliationRunDetailFilters,
  ReconciliationRunListItem,
  ReconciliationRun,
  SourceFile,
  SourceFileSummary,
  SourceType,
  Transaction,
  TransactionSummary,
} from "../domain/types.js";
import { formatCents } from "../domain/money.js";

export type SourceFileImport = {
  sourceFile: SourceFile;
  transactions: Transaction[];
};

export class DuplicateSourceFileError extends Error {
  constructor() {
    super("Duplicate upload detected for this source type and file contents.");
  }
}

export interface TransactionRepository {
  createSourceFileWithTransactions(
    sourceFile: NewSourceFile,
    transactions: NewTransaction[],
  ): Promise<SourceFileImport>;
  insertMany(transactions: NewTransaction[]): Promise<Transaction[]>;
  getSourceFile(sourceFileId: number): Promise<SourceFile | null>;
  getSourceFileByHash(sourceType: SourceType, fileHash: string): Promise<SourceFile | null>;
  listSourceFiles(sourceType?: SourceType): Promise<SourceFileSummary[]>;
  listBySource(sourceType: SourceType): Promise<Transaction[]>;
  listBySourceFile(sourceFileId: number): Promise<Transaction[]>;
  createReconciliationRun(input: PersistReconciliationRunInput): Promise<ReconciliationRun>;
  listReconciliationRuns(): Promise<ReconciliationRunListItem[]>;
  getReconciliationRunDetail(
    reconciliationRunId: number,
    filters?: ReconciliationRunDetailFilters,
  ): Promise<ReconciliationRunDetail | null>;
  updateReconciliationExceptionReview(
    reconciliationRunId: number,
    exceptionId: number,
    update: ReconciliationExceptionReviewUpdate,
  ): Promise<ReconciliationRunDetail["exceptions"][number] | null>;
  clear?(): Promise<void>;
}

export class MemoryTransactionRepository implements TransactionRepository {
  private sourceFiles: SourceFile[] = [];
  private transactions: Transaction[] = [];
  private reconciliationRuns: ReconciliationRun[] = [];
  private reconciliationMatchGroups: Array<{
    id: number;
    reconciliation_run_id: number;
    match_type: string;
    confidence: number;
    reason: string;
    created_at: string;
  }> = [];
  private reconciliationMatchGroupTransactions: Array<{
    match_group_id: number;
    transaction_id: number;
    side: string;
    source_type: SourceType;
  }> = [];
  private reconciliationExceptions: Array<{
    id: number;
    reconciliation_run_id: number;
    transaction_id: number;
    source_type: SourceType;
    reason: string;
    status: ReconciliationExceptionStatus;
    note: string;
    created_at: string;
  }> = [];
  private nextSourceFileId = 1;
  private nextId = 1;
  private nextReconciliationRunId = 1;
  private nextReconciliationMatchGroupId = 1;
  private nextReconciliationExceptionId = 1;

  async createSourceFileWithTransactions(
    sourceFileInput: NewSourceFile,
    transactions: NewTransaction[],
  ): Promise<SourceFileImport> {
    const sourceFile: SourceFile = {
      ...sourceFileInput,
      id: this.nextSourceFileId++,
      created_at: new Date().toISOString(),
    };
    this.sourceFiles.push(sourceFile);

    const scopedTransactions = transactions.map((transaction) => ({
      ...transaction,
      source_file_id: sourceFile.id,
    }));
    const inserted = await this.insertMany(scopedTransactions);

    return { sourceFile, transactions: inserted };
  }

  async insertMany(transactions: NewTransaction[]): Promise<Transaction[]> {
    const inserted = transactions.map((transaction) => ({
      ...transaction,
      id: this.nextId++,
    }));
    this.transactions.push(...inserted);
    return inserted;
  }

  async getSourceFile(sourceFileId: number): Promise<SourceFile | null> {
    return this.sourceFiles.find((sourceFile) => sourceFile.id === sourceFileId) ?? null;
  }

  async getSourceFileByHash(sourceType: SourceType, fileHash: string): Promise<SourceFile | null> {
    return (
      this.sourceFiles.find(
        (sourceFile) => sourceFile.source_type === sourceType && sourceFile.file_hash === fileHash,
      ) ?? null
    );
  }

  async listSourceFiles(sourceType?: SourceType): Promise<SourceFileSummary[]> {
    return this.sourceFiles
      .filter((sourceFile) => sourceType === undefined || sourceFile.source_type === sourceType)
      .sort((left, right) => right.id - left.id)
      .map(toSourceFileSummary);
  }

  async listBySource(sourceType: SourceType): Promise<Transaction[]> {
    return this.transactions
      .filter((transaction) => transaction.source_type === sourceType)
      .sort((left, right) => left.id - right.id);
  }

  async listBySourceFile(sourceFileId: number): Promise<Transaction[]> {
    return this.transactions
      .filter((transaction) => transaction.source_file_id === sourceFileId)
      .sort((left, right) => left.id - right.id);
  }

  async createReconciliationRun(input: PersistReconciliationRunInput): Promise<ReconciliationRun> {
    const createdAt = new Date().toISOString();
    const run: ReconciliationRun = {
      id: this.nextReconciliationRunId++,
      boa_source_file_id: input.boa_source_file_id,
      dealertrack_source_file_id: input.dealertrack_source_file_id,
      matched_count: input.result.matched_count,
      exception_count: input.result.exception_count,
      duplicate_count: input.result.duplicate_count,
      status: input.status ?? "completed",
      created_at: createdAt,
    };
    this.reconciliationRuns.push(run);

    for (const matchGroup of input.result.match_groups) {
      const groupId = this.nextReconciliationMatchGroupId++;
      this.reconciliationMatchGroups.push({
        id: groupId,
        reconciliation_run_id: run.id,
        match_type: matchGroup.match_reason,
        confidence: matchGroup.confidence_score,
        reason: matchGroup.match_reason,
        created_at: createdAt,
      });

      matchGroup.transactions.forEach((transaction, index) => {
        this.reconciliationMatchGroupTransactions.push({
          match_group_id: groupId,
          transaction_id: transaction.id,
          side: index === 0 ? "left" : "right",
          source_type: transaction.source_type,
        });
      });
    }

    for (const exception of input.result.exceptions) {
      this.reconciliationExceptions.push({
        id: this.nextReconciliationExceptionId++,
        reconciliation_run_id: run.id,
        transaction_id: exception.transaction.id,
        source_type: exception.source_type,
        reason: exception.description,
        status: "unresolved",
        note: "",
        created_at: createdAt,
      });
    }

    return run;
  }

  async listReconciliationRuns(): Promise<ReconciliationRunListItem[]> {
    return this.reconciliationRuns
      .slice()
      .sort((left, right) => right.id - left.id)
      .map((run) => this.toReconciliationRunListItem(run))
      .filter((run): run is ReconciliationRunListItem => run !== null);
  }

  async getReconciliationRunDetail(
    reconciliationRunId: number,
    filters: ReconciliationRunDetailFilters = {},
  ): Promise<ReconciliationRunDetail | null> {
    const run = this.reconciliationRuns.find(
      (reconciliationRun) => reconciliationRun.id === reconciliationRunId,
    );
    if (!run) {
      return null;
    }

    const listItem = this.toReconciliationRunListItem(run);
    const boaSourceFile = this.sourceFiles.find(
      (sourceFile) => sourceFile.id === run.boa_source_file_id,
    );
    const dealertrackSourceFile = this.sourceFiles.find(
      (sourceFile) => sourceFile.id === run.dealertrack_source_file_id,
    );
    if (!listItem || !boaSourceFile || !dealertrackSourceFile) {
      return null;
    }

    const matchGroups = this.reconciliationMatchGroups
      .filter((matchGroup) => matchGroup.reconciliation_run_id === run.id)
      .sort((left, right) => left.id - right.id)
      .map((matchGroup) => ({
        match_group_id: matchGroup.id,
        match_type: matchGroup.match_type,
        confidence: matchGroup.confidence,
        reason: matchGroup.reason,
        created_at: matchGroup.created_at,
        transactions: this.reconciliationMatchGroupTransactions
          .filter((link) => link.match_group_id === matchGroup.id)
          .sort((left, right) => sideOrder(left.side) - sideOrder(right.side))
          .map((link) => ({
            side: link.side,
            source_type: link.source_type,
            transaction: toTransactionSummary(
              this.transactions.find((transaction) => transaction.id === link.transaction_id)!,
            ),
          })),
      }));

    const exceptions = this.reconciliationExceptions
      .filter((exception) => exception.reconciliation_run_id === run.id)
      .sort((left, right) => left.id - right.id)
      .map((exception) => this.toRunDetailException(exception))
      .filter((exception) => matchesExceptionFilters(exception, filters));

    return {
      ...listItem,
      boa_source_file: toSourceFileSummary(boaSourceFile),
      dealertrack_source_file: toSourceFileSummary(dealertrackSourceFile),
      match_groups: matchGroups,
      exceptions,
    };
  }

  async updateReconciliationExceptionReview(
    reconciliationRunId: number,
    exceptionId: number,
    update: ReconciliationExceptionReviewUpdate,
  ): Promise<ReconciliationRunDetail["exceptions"][number] | null> {
    const exception = this.reconciliationExceptions.find(
      (candidate) =>
        candidate.reconciliation_run_id === reconciliationRunId && candidate.id === exceptionId,
    );
    if (!exception) {
      return null;
    }

    if (update.status !== undefined) {
      exception.status = update.status;
    }
    if (update.note !== undefined) {
      exception.note = update.note;
    }

    return this.toRunDetailException(exception);
  }

  async clear(): Promise<void> {
    this.sourceFiles = [];
    this.transactions = [];
    this.reconciliationRuns = [];
    this.reconciliationMatchGroups = [];
    this.reconciliationMatchGroupTransactions = [];
    this.reconciliationExceptions = [];
    this.nextSourceFileId = 1;
    this.nextId = 1;
    this.nextReconciliationRunId = 1;
    this.nextReconciliationMatchGroupId = 1;
    this.nextReconciliationExceptionId = 1;
  }

  private toReconciliationRunListItem(run: ReconciliationRun): ReconciliationRunListItem | null {
    const boaSourceFile = this.sourceFiles.find(
      (sourceFile) => sourceFile.id === run.boa_source_file_id,
    );
    const dealertrackSourceFile = this.sourceFiles.find(
      (sourceFile) => sourceFile.id === run.dealertrack_source_file_id,
    );
    if (!boaSourceFile || !dealertrackSourceFile) {
      return null;
    }

    return {
      reconciliation_run_id: run.id,
      boa_source_file_id: run.boa_source_file_id,
      dealertrack_source_file_id: run.dealertrack_source_file_id,
      boa_filename: boaSourceFile.original_filename,
      dealertrack_filename: dealertrackSourceFile.original_filename,
      matched_count: run.matched_count,
      exception_count: run.exception_count,
      duplicate_count: run.duplicate_count,
      status: run.status,
      created_at: run.created_at,
    };
  }

  private toRunDetailException(exception: {
    id: number;
    source_type: SourceType;
    reason: string;
    status: ReconciliationExceptionStatus;
    note: string;
    created_at: string;
    transaction_id: number;
  }): ReconciliationRunDetail["exceptions"][number] {
    return {
      exception_id: exception.id,
      exception_type: exceptionTypeFromReason(exception.reason),
      status: exception.status,
      note: exception.note,
      source_type: exception.source_type,
      reason: exception.reason,
      created_at: exception.created_at,
      transaction: toTransactionSummary(
        this.transactions.find((transaction) => transaction.id === exception.transaction_id)!,
      ),
    };
  }
}

function toSourceFileSummary(sourceFile: SourceFile): SourceFileSummary {
  return {
    source_file_id: sourceFile.id,
    source_type: sourceFile.source_type,
    filename: sourceFile.original_filename,
    row_count: sourceFile.row_count,
    validation_error_count: sourceFile.validation_error_count,
    created_at: sourceFile.created_at,
  };
}

function toTransactionSummary(transaction: Transaction): TransactionSummary {
  return {
    id: transaction.id,
    source_type: transaction.source_type,
    transaction_date: transaction.transaction_date,
    post_date: transaction.post_date,
    amount: formatCents(transaction.amount_cents),
    amount_cents: transaction.amount_cents,
    reference_number: transaction.reference_number,
    description: transaction.description,
    account: transaction.account,
    stock_number: transaction.stock_number,
    vin: transaction.vin,
  };
}

function sideOrder(side: string): number {
  return side === "left" ? 0 : 1;
}

function exceptionTypeFromReason(reason: string): ReconciliationExceptionType {
  const normalized = reason.toLowerCase();
  if (normalized.includes("duplicate")) {
    return "duplicate_transaction";
  }
  if (normalized.includes("no matching boa")) {
    return "missing_in_boa";
  }
  return "missing_in_dealertrack";
}

function matchesExceptionFilters(
  exception: ReconciliationRunDetail["exceptions"][number],
  filters: ReconciliationRunDetailFilters,
): boolean {
  if (
    filters.exceptionSourceType !== undefined &&
    exception.source_type !== filters.exceptionSourceType
  ) {
    return false;
  }
  if (filters.exceptionType !== undefined && exception.exception_type !== filters.exceptionType) {
    return false;
  }
  if (filters.exceptionStatus !== undefined && exception.status !== filters.exceptionStatus) {
    return false;
  }
  if (filters.search !== undefined) {
    const search = filters.search.toLowerCase();
    const transaction = exception.transaction;
    const searchable = [
      exception.reason,
      exception.exception_type,
      exception.status,
      exception.note,
      exception.source_type,
      transaction.reference_number,
      transaction.description,
      transaction.account,
      transaction.stock_number,
      transaction.vin,
      transaction.amount,
      String(transaction.amount_cents),
    ]
      .filter((value): value is string => typeof value === "string")
      .join(" ")
      .toLowerCase();
    return searchable.includes(search);
  }
  return true;
}
