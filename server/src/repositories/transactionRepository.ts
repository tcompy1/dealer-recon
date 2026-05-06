import type {
  AccountDetail,
  AccountSummary,
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
    dealershipId: number,
    sourceFile: NewSourceFile,
    transactions: NewTransaction[],
  ): Promise<SourceFileImport>;
  insertMany(transactions: NewTransaction[]): Promise<Transaction[]>;
  getSourceFile(sourceFileId: number): Promise<SourceFile | null>;
  getSourceFileByHash(
    dealershipId: number,
    sourceType: SourceType,
    fileHash: string,
  ): Promise<SourceFile | null>;
  listSourceFiles(dealershipId: number, sourceType?: SourceType): Promise<SourceFileSummary[]>;
  listBySource(dealershipId: number, sourceType: SourceType): Promise<Transaction[]>;
  listBySourceFile(dealershipId: number, sourceFileId: number): Promise<Transaction[]>;
  listAccountsSummary(dealershipId: number): Promise<AccountSummary[]>;
  getAccountDetail(dealershipId: number, accountIdentifier: string): Promise<AccountDetail | null>;
  createReconciliationRun(input: PersistReconciliationRunInput): Promise<ReconciliationRun>;
  listReconciliationRuns(dealershipId: number): Promise<ReconciliationRunListItem[]>;
  getReconciliationRunDealershipId(reconciliationRunId: number): Promise<number | null>;
  getReconciliationRunDetail(
    dealershipId: number,
    reconciliationRunId: number,
    filters?: ReconciliationRunDetailFilters,
  ): Promise<ReconciliationRunDetail | null>;
  getReconciliationExceptionDealershipId(
    reconciliationRunId: number,
    exceptionId: number,
  ): Promise<number | null>;
  updateReconciliationExceptionReview(
    dealershipId: number,
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
    dealership_id: number;
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
    dealershipId: number,
    sourceFileInput: NewSourceFile,
    transactions: NewTransaction[],
  ): Promise<SourceFileImport> {
    const sourceFile: SourceFile = {
      ...sourceFileInput,
      id: this.nextSourceFileId++,
      dealership_id: dealershipId,
      created_at: new Date().toISOString(),
    };
    this.sourceFiles.push(sourceFile);

    const scopedTransactions = transactions.map((transaction) => ({
      ...transaction,
      dealership_id: dealershipId,
      source_file_id: sourceFile.id,
    }));
    const inserted = await this.insertMany(scopedTransactions);

    return { sourceFile, transactions: inserted };
  }

  async insertMany(transactions: NewTransaction[]): Promise<Transaction[]> {
    const inserted: Transaction[] = transactions.map((transaction) => ({
      ...transaction,
      dealership_id: (transaction as NewTransaction & { dealership_id?: number }).dealership_id ?? 1,
      account_type: transaction.account_type ?? defaultAccountType(transaction.source_type),
      account_identifier:
        transaction.account_identifier ??
        transaction.account ??
        defaultAccountIdentifier(transaction.source_type),
      id: this.nextId++,
    }));
    this.transactions.push(...inserted);
    return inserted;
  }

  async getSourceFile(sourceFileId: number): Promise<SourceFile | null> {
    return this.sourceFiles.find((sourceFile) => sourceFile.id === sourceFileId) ?? null;
  }

  async getSourceFileByHash(
    dealershipId: number,
    sourceType: SourceType,
    fileHash: string,
  ): Promise<SourceFile | null> {
    return (
      this.sourceFiles.find(
        (sourceFile) =>
          sourceFile.dealership_id === dealershipId &&
          sourceFile.source_type === sourceType &&
          sourceFile.file_hash === fileHash,
      ) ?? null
    );
  }

  async listSourceFiles(dealershipId: number, sourceType?: SourceType): Promise<SourceFileSummary[]> {
    return this.sourceFiles
      .filter(
        (sourceFile) =>
          sourceFile.dealership_id === dealershipId &&
          (sourceType === undefined || sourceFile.source_type === sourceType),
      )
      .sort((left, right) => right.id - left.id)
      .map(toSourceFileSummary);
  }

  async listBySource(dealershipId: number, sourceType: SourceType): Promise<Transaction[]> {
    return this.transactions
      .filter(
        (transaction) =>
          transaction.dealership_id === dealershipId && transaction.source_type === sourceType,
      )
      .sort((left, right) => left.id - right.id);
  }

  async listBySourceFile(dealershipId: number, sourceFileId: number): Promise<Transaction[]> {
    return this.transactions
      .filter(
        (transaction) =>
          transaction.dealership_id === dealershipId && transaction.source_file_id === sourceFileId,
      )
      .sort((left, right) => left.id - right.id);
  }

  async listAccountsSummary(dealershipId: number): Promise<AccountSummary[]> {
    return buildAccountSummaries(
      this.transactions.filter((transaction) => transaction.dealership_id === dealershipId),
      this.reconciliationExceptions.filter((exception) => exception.dealership_id === dealershipId),
    );
  }

  async getAccountDetail(
    dealershipId: number,
    accountIdentifier: string,
  ): Promise<AccountDetail | null> {
    const accountTransactions = this.transactions.filter(
      (transaction) =>
        transaction.dealership_id === dealershipId &&
        transaction.account_identifier === accountIdentifier,
    );
    if (accountTransactions.length === 0) {
      return null;
    }

    const [summary] = buildAccountSummaries(
      accountTransactions,
      this.reconciliationExceptions.filter((exception) => exception.dealership_id === dealershipId),
    );
    const transactionIds = new Set(accountTransactions.map((transaction) => transaction.id));
    const relatedRunIds = new Set<number>();

    for (const link of this.reconciliationMatchGroupTransactions) {
      if (!transactionIds.has(link.transaction_id)) {
        continue;
      }
      const matchGroup = this.reconciliationMatchGroups.find(
        (candidate) => candidate.id === link.match_group_id,
      );
      if (matchGroup) {
        relatedRunIds.add(matchGroup.reconciliation_run_id);
      }
    }
    for (const exception of this.reconciliationExceptions) {
      if (
        exception.dealership_id === dealershipId &&
        transactionIds.has(exception.transaction_id)
      ) {
        relatedRunIds.add(exception.reconciliation_run_id);
      }
    }

    return {
      ...summary,
      transactions_by_source_type: groupTransactionsBySource(accountTransactions),
      related_reconciliation_runs: this.reconciliationRuns
        .filter((run) => relatedRunIds.has(run.id) && run.dealership_id === dealershipId)
        .slice()
        .sort((left, right) => right.id - left.id)
        .map((run) => this.toReconciliationRunListItem(run))
        .filter((run): run is ReconciliationRunListItem => run !== null),
      unresolved_exceptions: this.reconciliationExceptions
        .filter(
          (exception) =>
            exception.dealership_id === dealershipId &&
            exception.status === "unresolved" &&
            transactionIds.has(exception.transaction_id),
        )
        .sort((left, right) => left.id - right.id)
        .map((exception) => this.toRunDetailException(exception)),
    };
  }

  async createReconciliationRun(input: PersistReconciliationRunInput): Promise<ReconciliationRun> {
    const createdAt = new Date().toISOString();
    const run: ReconciliationRun = {
      id: this.nextReconciliationRunId++,
      dealership_id: input.dealership_id,
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
        dealership_id: input.dealership_id,
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

  async listReconciliationRuns(dealershipId: number): Promise<ReconciliationRunListItem[]> {
    return this.reconciliationRuns
      .filter((run) => run.dealership_id === dealershipId)
      .slice()
      .sort((left, right) => right.id - left.id)
      .map((run) => this.toReconciliationRunListItem(run))
      .filter((run): run is ReconciliationRunListItem => run !== null);
  }

  async getReconciliationRunDealershipId(reconciliationRunId: number): Promise<number | null> {
    return (
      this.reconciliationRuns.find((run) => run.id === reconciliationRunId)?.dealership_id ?? null
    );
  }

  async getReconciliationRunDetail(
    dealershipId: number,
    reconciliationRunId: number,
    filters: ReconciliationRunDetailFilters = {},
  ): Promise<ReconciliationRunDetail | null> {
    const run = this.reconciliationRuns.find(
      (reconciliationRun) =>
        reconciliationRun.id === reconciliationRunId &&
        reconciliationRun.dealership_id === dealershipId,
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
    dealershipId: number,
    reconciliationRunId: number,
    exceptionId: number,
    update: ReconciliationExceptionReviewUpdate,
  ): Promise<ReconciliationRunDetail["exceptions"][number] | null> {
    const exception = this.reconciliationExceptions.find(
      (candidate) =>
        candidate.dealership_id === dealershipId &&
        candidate.reconciliation_run_id === reconciliationRunId &&
        candidate.id === exceptionId,
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

  async getReconciliationExceptionDealershipId(
    reconciliationRunId: number,
    exceptionId: number,
  ): Promise<number | null> {
    return (
      this.reconciliationExceptions.find(
        (exception) =>
          exception.reconciliation_run_id === reconciliationRunId && exception.id === exceptionId,
      )?.dealership_id ?? null
    );
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
      dealership_id: run.dealership_id,
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
    dealership_id: number;
    source_type: SourceType;
    reason: string;
    status: ReconciliationExceptionStatus;
    note: string;
    created_at: string;
    transaction_id: number;
  }): ReconciliationRunDetail["exceptions"][number] {
    return {
      exception_id: exception.id,
      dealership_id: exception.dealership_id,
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
    dealership_id: sourceFile.dealership_id,
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

function groupTransactionsBySource(
  transactions: Transaction[],
): Partial<Record<SourceType, TransactionSummary[]>> {
  return transactions.reduce<Partial<Record<SourceType, TransactionSummary[]>>>(
    (grouped, transaction) => {
      grouped[transaction.source_type] = grouped[transaction.source_type] ?? [];
      grouped[transaction.source_type]!.push(toTransactionSummary(transaction));
      return grouped;
    },
    {},
  );
}

function buildAccountSummaries(
  transactions: Transaction[],
  exceptions: Array<{ status: ReconciliationExceptionStatus; transaction_id: number }>,
): AccountSummary[] {
  const unresolvedExceptionCounts = new Map<number, number>();
  for (const exception of exceptions) {
    if (exception.status !== "unresolved") {
      continue;
    }
    unresolvedExceptionCounts.set(
      exception.transaction_id,
      (unresolvedExceptionCounts.get(exception.transaction_id) ?? 0) + 1,
    );
  }

  const grouped = new Map<
    string,
    {
      account_identifier: string;
      account_type: string;
      source_totals: Map<SourceType, { amount_cents: number; transaction_count: number }>;
      net_difference_amount_cents: number;
      unresolved_exception_count: number;
    }
  >();

  for (const transaction of transactions) {
    const key = `${transaction.account_identifier}\u0000${transaction.account_type}`;
    const account =
      grouped.get(key) ??
      {
        account_identifier: transaction.account_identifier,
        account_type: transaction.account_type,
        source_totals: new Map(),
        net_difference_amount_cents: 0,
        unresolved_exception_count: 0,
      };
    const sourceTotal =
      account.source_totals.get(transaction.source_type) ??
      { amount_cents: 0, transaction_count: 0 };

    sourceTotal.amount_cents += transaction.amount_cents;
    sourceTotal.transaction_count += 1;
    account.source_totals.set(transaction.source_type, sourceTotal);
    account.net_difference_amount_cents += transaction.amount_cents;
    account.unresolved_exception_count += unresolvedExceptionCounts.get(transaction.id) ?? 0;
    grouped.set(key, account);
  }

  return Array.from(grouped.values())
    .map((account) => ({
      account_identifier: account.account_identifier,
      account_type: account.account_type,
      source_totals: Array.from(account.source_totals.entries())
        .map(([sourceType, total]) => ({
          source_type: sourceType,
          amount_cents: total.amount_cents,
          amount: formatCents(total.amount_cents),
          transaction_count: total.transaction_count,
        }))
        .sort((left, right) => left.source_type.localeCompare(right.source_type)),
      net_difference_amount_cents: account.net_difference_amount_cents,
      net_difference_amount: formatCents(account.net_difference_amount_cents),
      unresolved_exception_count: account.unresolved_exception_count,
    }))
    .sort((left, right) => left.account_identifier.localeCompare(right.account_identifier));
}

function defaultAccountType(sourceType: SourceType): string {
  if (sourceType === "boa" || sourceType === "dealertrack") {
    return "floorplan";
  }
  return sourceType;
}

function defaultAccountIdentifier(sourceType: SourceType): string {
  if (sourceType === "boa" || sourceType === "dealertrack") {
    return "floorplan";
  }
  return "unassigned";
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
