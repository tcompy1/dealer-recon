import type {
  AccountDetail,
  AccountSummary,
  AuditEvent,
  DealerGroup,
  DealershipStore,
  MonthEndReport,
  MonthEndReportAccount,
  NewDealershipStore,
  NewAuditEvent,
  NewIngestionEvent,
  NewOperationalEvent,
  NewReconciliationArtifact,
  NewSourceFile,
  NewSourceFileUploadContent,
  NewTransaction,
  NewScheduledReconciliationJob,
  IngestionEvent,
  OperationalEvent,
  ReconciliationExceptionReviewUpdate,
  ReconciliationExceptionReviewStatus,
  ReconciliationExceptionStatus,
  ReconciliationArtifact,
  ReconciliationArtifactMetadata,
  PersistReconciliationRunInput,
  ReconciliationRunInputSnapshot,
  ReconciliationExceptionType,
  ReconciliationRunDetail,
  ReconciliationRunDetailFilters,
  ReconciliationRunListFilters,
  ReconciliationRunListItem,
  ReconciliationRun,
  ScheduledReconciliationJob,
  ScheduledReconciliationJobUpdate,
  SourceFile,
  SourceFileUploadContent,
  SourceFileSummary,
  SourceType,
  Transaction,
  TransactionSummary,
} from "../domain/types.js";
import { formatCents } from "../domain/money.js";
import { categorizeRunDetailExceptions } from "../services/exceptionCategorizer.js";
import type { PriorExceptionRecord } from "../services/exceptionCarryForward.js";

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
    uploadContent?: NewSourceFileUploadContent,
  ): Promise<SourceFileImport>;
  replaceSourceFileWithTransactions(
    dealershipId: number,
    sourceFileId: number,
    sourceFile: NewSourceFile,
    transactions: NewTransaction[],
    uploadContent?: NewSourceFileUploadContent,
  ): Promise<SourceFileImport | null>;
  insertMany(transactions: NewTransaction[]): Promise<Transaction[]>;
  getSourceFile(sourceFileId: number): Promise<SourceFile | null>;
  getSourceFileByHash(
    dealershipId: number,
    dealershipStoreId: number | null,
    sourceType: SourceType,
    fileHash: string,
  ): Promise<SourceFile | null>;
  listSourceFiles(
    dealershipId: number,
    sourceType?: SourceType,
    dealershipStoreId?: number,
  ): Promise<SourceFileSummary[]>;
  listDealerGroups(dealershipId: number): Promise<DealerGroup[]>;
  listDealershipStores(dealershipId: number): Promise<DealershipStore[]>;
  createDealershipStore(
    dealershipId: number,
    store: NewDealershipStore,
  ): Promise<DealershipStore>;
  createScheduledReconciliationJob(
    dealershipId: number,
    job: NewScheduledReconciliationJob,
  ): Promise<ScheduledReconciliationJob>;
  listScheduledReconciliationJobs(
    dealershipId: number,
    dealershipStoreId?: number,
  ): Promise<ScheduledReconciliationJob[]>;
  updateScheduledReconciliationJob(
    dealershipId: number,
    jobId: number,
    update: ScheduledReconciliationJobUpdate,
  ): Promise<ScheduledReconciliationJob | null>;
  createIngestionEvent(
    dealershipId: number,
    event: NewIngestionEvent,
  ): Promise<IngestionEvent>;
  listIngestionEvents(
    dealershipId: number,
    dealershipStoreId?: number,
    limit?: number,
  ): Promise<IngestionEvent[]>;
  createOperationalEvent(
    dealershipId: number,
    event: NewOperationalEvent,
  ): Promise<OperationalEvent>;
  listOperationalEvents(
    dealershipId: number,
    dealershipStoreId?: number,
    limit?: number,
  ): Promise<OperationalEvent[]>;
  createAuditEvent(dealershipId: number, event: NewAuditEvent): Promise<AuditEvent>;
  listAuditEvents(dealershipId: number, limit?: number): Promise<AuditEvent[]>;
  listBySource(dealershipId: number, sourceType: SourceType): Promise<Transaction[]>;
  listBySourceFile(dealershipId: number, sourceFileId: number): Promise<Transaction[]>;
  getTransactionById(
    dealershipId: number,
    transactionId: number,
  ): Promise<Transaction | null>;
  updateTransactionVinAndRawData(
    dealershipId: number,
    transactionId: number,
    update: { vin: string; raw_data: Record<string, unknown> },
  ): Promise<Transaction | null>;
  listAccountsSummary(dealershipId: number): Promise<AccountSummary[]>;
  getAccountDetail(dealershipId: number, accountIdentifier: string): Promise<AccountDetail | null>;
  getMonthEndReport(
    dealershipId: number,
    startDate: string,
    endDate: string,
  ): Promise<MonthEndReport>;
  createReconciliationRun(input: PersistReconciliationRunInput): Promise<ReconciliationRun>;
  updateReconciliationRunStatus(
    dealershipId: number,
    reconciliationRunId: number,
    status: string,
  ): Promise<ReconciliationRun | null>;
  getSourceFileUploadContent(
    dealershipId: number,
    sourceFileId: number,
  ): Promise<SourceFileUploadContent | null>;
  createReconciliationArtifact(
    dealershipId: number,
    artifact: NewReconciliationArtifact,
  ): Promise<ReconciliationArtifactMetadata>;
  listReconciliationArtifacts(
    dealershipId: number,
    reconciliationRunId: number,
  ): Promise<ReconciliationArtifactMetadata[]>;
  getReconciliationArtifact(
    dealershipId: number,
    artifactId: number,
  ): Promise<ReconciliationArtifact | null>;
  findReconciliationArtifact(
    dealershipId: number,
    reconciliationRunId: number,
    artifactType: NewReconciliationArtifact["artifact_type"],
  ): Promise<ReconciliationArtifact | null>;
  getReconciliationRunSnapshot(
    dealershipId: number,
    reconciliationRunId: number,
  ): Promise<ReconciliationRunInputSnapshot | null>;
  listReconciliationRuns(
    dealershipId: number,
    filters?: ReconciliationRunListFilters,
  ): Promise<ReconciliationRunListItem[]>;
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
  listPriorUnresolvedExceptions(
    dealershipId: number,
    options: {
      dealershipStoreId: number | null;
      excludeRunId: number;
      createdBefore?: string;
    },
  ): Promise<PriorExceptionRecord[]>;
  clear?(): Promise<void>;
}

export class MemoryTransactionRepository implements TransactionRepository {
  private dealerGroups: DealerGroup[] = [
    {
      id: 1,
      dealership_id: 1,
      name: "Hiley Mazda Group",
      created_at: new Date(0).toISOString(),
    },
  ];
  private dealershipStores: DealershipStore[] = [
    {
      id: 1,
      dealership_id: 1,
      dealer_group_id: 1,
      name: "Hiley Mazda of Hurst",
      created_at: new Date(0).toISOString(),
    },
    {
      id: 2,
      dealership_id: 1,
      dealer_group_id: 1,
      name: "Hiley Mazda of Arlington",
      created_at: new Date(0).toISOString(),
    },
  ];
  private sourceFiles: SourceFile[] = [];
  private sourceFileUploadContents: SourceFileUploadContent[] = [];
  private transactions: Transaction[] = [];
  private reconciliationRuns: ReconciliationRun[] = [];
  private reconciliationArtifacts: ReconciliationArtifact[] = [];
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
    review_status: ReconciliationExceptionReviewStatus;
    assigned_to: string | null;
    review_notes: string;
    boa_notes: string;
    gl_notes: string;
    reviewed_at: string | null;
    reviewed_by: string | null;
    created_at: string;
  }> = [];
  private reconciliationRunSnapshots: ReconciliationRunInputSnapshot[] = [];
  private scheduledReconciliationJobs: ScheduledReconciliationJob[] = [];
  private ingestionEvents: IngestionEvent[] = [];
  private operationalEvents: OperationalEvent[] = [];
  private auditEvents: AuditEvent[] = [];
  private nextSourceFileId = 1;
  private nextId = 1;
  private nextReconciliationRunId = 1;
  private nextReconciliationMatchGroupId = 1;
  private nextReconciliationExceptionId = 1;
  private nextDealershipStoreId = 3;
  private nextScheduledReconciliationJobId = 1;
  private nextIngestionEventId = 1;
  private nextOperationalEventId = 1;
  private nextAuditEventId = 1;
  private nextReconciliationArtifactId = 1;

  async createSourceFileWithTransactions(
    dealershipId: number,
    sourceFileInput: NewSourceFile,
    transactions: NewTransaction[],
    uploadContent?: NewSourceFileUploadContent,
  ): Promise<SourceFileImport> {
    const sourceFile: SourceFile = {
      ...sourceFileInput,
      id: this.nextSourceFileId++,
      dealership_id: dealershipId,
      dealership_store_id: sourceFileInput.dealership_store_id ?? this.getDefaultStoreId(dealershipId),
      created_at: new Date().toISOString(),
    };
    this.sourceFiles.push(sourceFile);
    if (uploadContent) {
      this.upsertSourceFileUploadContent(sourceFile, uploadContent);
    }

    const scopedTransactions = transactions.map((transaction) => ({
      ...transaction,
      dealership_id: dealershipId,
      source_file_id: sourceFile.id,
    }));
    const inserted = await this.insertMany(scopedTransactions);

    return { sourceFile, transactions: inserted };
  }

  async replaceSourceFileWithTransactions(
    dealershipId: number,
    sourceFileId: number,
    sourceFileInput: NewSourceFile,
    transactions: NewTransaction[],
    uploadContent?: NewSourceFileUploadContent,
  ): Promise<SourceFileImport | null> {
    const sourceFile = this.sourceFiles.find(
      (candidate) => candidate.id === sourceFileId && candidate.dealership_id === dealershipId,
    );
    if (!sourceFile) {
      return null;
    }

    Object.assign(sourceFile, {
      dealership_store_id: sourceFileInput.dealership_store_id ?? sourceFile.dealership_store_id,
      source_type: sourceFileInput.source_type,
      original_filename: sourceFileInput.original_filename,
      stored_filename: sourceFileInput.stored_filename,
      file_hash: sourceFileInput.file_hash,
      row_count: sourceFileInput.row_count,
      validation_error_count: sourceFileInput.validation_error_count,
    });
    if (uploadContent) {
      this.upsertSourceFileUploadContent(sourceFile, uploadContent);
    }

    this.transactions = this.transactions.filter(
      (transaction) =>
        transaction.dealership_id !== dealershipId || transaction.source_file_id !== sourceFileId,
    );
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
    dealershipStoreId: number | null,
    sourceType: SourceType,
    fileHash: string,
  ): Promise<SourceFile | null> {
    return (
      this.sourceFiles.find(
        (sourceFile) =>
          sourceFile.dealership_id === dealershipId &&
          sourceFile.dealership_store_id === dealershipStoreId &&
          sourceFile.source_type === sourceType &&
          sourceFile.file_hash === fileHash,
      ) ?? null
    );
  }

  async listSourceFiles(
    dealershipId: number,
    sourceType?: SourceType,
    dealershipStoreId?: number,
  ): Promise<SourceFileSummary[]> {
    return this.sourceFiles
      .filter(
        (sourceFile) =>
          sourceFile.dealership_id === dealershipId &&
          (dealershipStoreId === undefined || sourceFile.dealership_store_id === dealershipStoreId) &&
          (sourceType === undefined || sourceFile.source_type === sourceType),
      )
      .sort((left, right) => right.id - left.id)
      .map((sourceFile) => this.toSourceFileSummary(sourceFile));
  }

  async listDealerGroups(dealershipId: number): Promise<DealerGroup[]> {
    return this.dealerGroups.filter((group) => group.dealership_id === dealershipId);
  }

  async listDealershipStores(dealershipId: number): Promise<DealershipStore[]> {
    return this.dealershipStores.filter((store) => store.dealership_id === dealershipId);
  }

  async createDealershipStore(
    dealershipId: number,
    storeInput: NewDealershipStore,
  ): Promise<DealershipStore> {
    const store: DealershipStore = {
      id: this.nextDealershipStoreId++,
      dealership_id: dealershipId,
      dealer_group_id: storeInput.dealer_group_id ?? this.getDefaultGroupId(dealershipId),
      name: storeInput.name,
      created_at: new Date().toISOString(),
    };
    this.dealershipStores.push(store);
    return store;
  }

  async createScheduledReconciliationJob(
    dealershipId: number,
    jobInput: NewScheduledReconciliationJob,
  ): Promise<ScheduledReconciliationJob> {
    const createdAt = new Date().toISOString();
    const job: ScheduledReconciliationJob = {
      id: this.nextScheduledReconciliationJobId++,
      dealership_id: dealershipId,
      dealership_store_id: jobInput.dealership_store_id ?? this.getDefaultStoreId(dealershipId),
      store_name: null,
      cadence: jobInput.cadence,
      expected_source_types: jobInput.expected_source_types,
      enabled: jobInput.enabled ?? true,
      auto_run_on_pair: jobInput.auto_run_on_pair ?? false,
      last_run_at: null,
      next_run_at: jobInput.next_run_at ?? nextRunAt(jobInput.cadence, createdAt),
      created_at: createdAt,
      updated_at: createdAt,
    };
    this.scheduledReconciliationJobs.push(job);
    return this.withJobStoreName(job);
  }

  async listScheduledReconciliationJobs(
    dealershipId: number,
    dealershipStoreId?: number,
  ): Promise<ScheduledReconciliationJob[]> {
    return this.scheduledReconciliationJobs
      .filter(
        (job) =>
          job.dealership_id === dealershipId &&
          (dealershipStoreId === undefined || job.dealership_store_id === dealershipStoreId),
      )
      .sort((left, right) => left.id - right.id)
      .map((job) => this.withJobStoreName(job));
  }

  async updateScheduledReconciliationJob(
    dealershipId: number,
    jobId: number,
    update: ScheduledReconciliationJobUpdate,
  ): Promise<ScheduledReconciliationJob | null> {
    const job = this.scheduledReconciliationJobs.find(
      (candidate) => candidate.id === jobId && candidate.dealership_id === dealershipId,
    );
    if (!job) {
      return null;
    }
    Object.assign(job, {
      ...update,
      updated_at: new Date().toISOString(),
    });
    return this.withJobStoreName(job);
  }

  async createIngestionEvent(
    dealershipId: number,
    eventInput: NewIngestionEvent,
  ): Promise<IngestionEvent> {
    const event: IngestionEvent = {
      ...eventInput,
      id: this.nextIngestionEventId++,
      dealership_id: dealershipId,
      store_name: this.getStore(eventInput.dealership_store_id)?.name ?? null,
      created_at: new Date().toISOString(),
    };
    this.ingestionEvents.push(event);
    return event;
  }

  async listIngestionEvents(
    dealershipId: number,
    dealershipStoreId?: number,
    limit = 50,
  ): Promise<IngestionEvent[]> {
    return this.ingestionEvents
      .filter(
        (event) =>
          event.dealership_id === dealershipId &&
          (dealershipStoreId === undefined || event.dealership_store_id === dealershipStoreId),
      )
      .slice()
      .sort((left, right) => right.id - left.id)
      .slice(0, limit);
  }

  async createOperationalEvent(
    dealershipId: number,
    eventInput: NewOperationalEvent,
  ): Promise<OperationalEvent> {
    const event: OperationalEvent = {
      ...eventInput,
      id: this.nextOperationalEventId++,
      dealership_id: dealershipId,
      store_name: this.getStore(eventInput.dealership_store_id)?.name ?? null,
      created_at: new Date().toISOString(),
    };
    this.operationalEvents.push(event);
    return event;
  }

  async listOperationalEvents(
    dealershipId: number,
    dealershipStoreId?: number,
    limit = 50,
  ): Promise<OperationalEvent[]> {
    return this.operationalEvents
      .filter(
        (event) =>
          event.dealership_id === dealershipId &&
          (dealershipStoreId === undefined || event.dealership_store_id === dealershipStoreId),
      )
      .slice()
      .sort((left, right) => right.id - left.id)
      .slice(0, limit);
  }

  async createAuditEvent(dealershipId: number, eventInput: NewAuditEvent): Promise<AuditEvent> {
    const event: AuditEvent = {
      ...eventInput,
      id: this.nextAuditEventId++,
      dealership_id: dealershipId,
      previous_state: cloneJson(eventInput.previous_state),
      new_state: cloneJson(eventInput.new_state),
      timestamp: new Date().toISOString(),
    };
    this.auditEvents.push(event);
    return cloneAuditEvent(event);
  }

  async listAuditEvents(dealershipId: number, limit = 100): Promise<AuditEvent[]> {
    return this.auditEvents
      .filter((event) => event.dealership_id === dealershipId)
      .slice()
      .sort((left, right) => right.id - left.id)
      .slice(0, limit)
      .map(cloneAuditEvent);
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

  async getTransactionById(
    dealershipId: number,
    transactionId: number,
  ): Promise<Transaction | null> {
    const transaction = this.transactions.find(
      (candidate) =>
        candidate.id === transactionId && candidate.dealership_id === dealershipId,
    );
    return transaction ? cloneTransaction(transaction) : null;
  }

  async updateTransactionVinAndRawData(
    dealershipId: number,
    transactionId: number,
    update: { vin: string; raw_data: Record<string, unknown> },
  ): Promise<Transaction | null> {
    const transaction = this.transactions.find(
      (candidate) =>
        candidate.id === transactionId && candidate.dealership_id === dealershipId,
    );
    if (!transaction) {
      return null;
    }
    transaction.vin = update.vin;
    transaction.raw_data = cloneJson(update.raw_data);
    return cloneTransaction(transaction);
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

  async getMonthEndReport(
    dealershipId: number,
    startDate: string,
    endDate: string,
  ): Promise<MonthEndReport> {
    const transactions = this.transactions.filter(
      (transaction) =>
        transaction.dealership_id === dealershipId &&
        isWithinPeriod(effectiveTransactionDate(transaction), startDate, endDate),
    );
    const transactionIds = new Set(transactions.map((transaction) => transaction.id));
    const exceptions = this.reconciliationExceptions.filter(
      (exception) => exception.dealership_id === dealershipId && transactionIds.has(exception.transaction_id),
    );
    const runIds = new Set<number>();
    const sourceFileIds = new Set(transactions.map((transaction) => transaction.source_file_id));

    for (const run of this.reconciliationRuns) {
      if (
        run.dealership_id === dealershipId &&
        (sourceFileIds.has(run.boa_source_file_id) ||
          sourceFileIds.has(run.dealertrack_source_file_id))
      ) {
        runIds.add(run.id);
      }
    }
    for (const exception of exceptions) {
      runIds.add(exception.reconciliation_run_id);
    }

    return {
      reporting_period: { start_date: startDate, end_date: endDate },
      generated_at: new Date().toISOString(),
      account_summaries: buildReportAccountSummaries(transactions, exceptions),
      reconciliation_runs_included: this.reconciliationRuns
        .filter((run) => runIds.has(run.id) && run.dealership_id === dealershipId)
        .slice()
        .sort((left, right) => right.id - left.id)
        .map((run) => this.toReconciliationRunListItem(run))
        .filter((run): run is ReconciliationRunListItem => run !== null),
    };
  }

  async createReconciliationRun(input: PersistReconciliationRunInput): Promise<ReconciliationRun> {
    const createdAt = new Date().toISOString();
    const run: ReconciliationRun = {
      id: this.nextReconciliationRunId++,
      dealership_id: input.dealership_id,
      dealership_store_id: input.dealership_store_id ?? this.getDefaultStoreId(input.dealership_id),
      boa_source_file_id: input.boa_source_file_id,
      dealertrack_source_file_id: input.dealertrack_source_file_id,
      matched_count: input.result.matched_count,
      exception_count: input.result.exception_count,
      duplicate_count: input.result.duplicate_count,
      status: input.status ?? "completed",
      created_at: createdAt,
    };
    this.reconciliationRuns.push(run);
    if (input.input_snapshot) {
      this.reconciliationRunSnapshots.push({
        reconciliation_run_id: run.id,
        engine_version: input.input_snapshot.engine_version,
        inputs: input.input_snapshot.inputs.map((snapshotInput) => ({
          ...snapshotInput,
          parser_metadata: cloneJson(snapshotInput.parser_metadata),
          transactions: snapshotInput.transactions.map(cloneTransaction),
        })),
      });
    }

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
        review_status: "unreviewed",
        assigned_to: null,
        review_notes: "",
        boa_notes: "",
        gl_notes: "",
        reviewed_at: null,
        reviewed_by: null,
        created_at: createdAt,
      });
    }

    return run;
  }

  async updateReconciliationRunStatus(
    dealershipId: number,
    reconciliationRunId: number,
    status: string,
  ): Promise<ReconciliationRun | null> {
    const run = this.reconciliationRuns.find(
      (candidate) => candidate.dealership_id === dealershipId && candidate.id === reconciliationRunId,
    );
    if (!run) {
      return null;
    }
    run.status = status;
    return { ...run };
  }

  async getSourceFileUploadContent(
    dealershipId: number,
    sourceFileId: number,
  ): Promise<SourceFileUploadContent | null> {
    const content = this.sourceFileUploadContents.find(
      (candidate) =>
        candidate.dealership_id === dealershipId &&
        candidate.source_file_id === sourceFileId,
    );
    return content ? cloneSourceFileUploadContent(content) : null;
  }

  async createReconciliationArtifact(
    dealershipId: number,
    artifactInput: NewReconciliationArtifact,
  ): Promise<ReconciliationArtifactMetadata> {
    const artifact: ReconciliationArtifact = {
      ...artifactInput,
      id: this.nextReconciliationArtifactId++,
      dealership_id: dealershipId,
      file_size: artifactInput.file_size ?? artifactInput.content.byteLength,
      content: Buffer.from(artifactInput.content),
      created_at: new Date().toISOString(),
    };
    this.reconciliationArtifacts = this.reconciliationArtifacts.filter(
      (candidate) =>
        candidate.reconciliation_run_id !== artifact.reconciliation_run_id ||
        candidate.artifact_type !== artifact.artifact_type,
    );
    this.reconciliationArtifacts.push(artifact);
    return toArtifactMetadata(artifact);
  }

  async listReconciliationArtifacts(
    dealershipId: number,
    reconciliationRunId: number,
  ): Promise<ReconciliationArtifactMetadata[]> {
    return this.reconciliationArtifacts
      .filter(
        (artifact) =>
          artifact.dealership_id === dealershipId &&
          artifact.reconciliation_run_id === reconciliationRunId,
      )
      .slice()
      .sort((left, right) => left.id - right.id)
      .map(toArtifactMetadata);
  }

  async getReconciliationArtifact(
    dealershipId: number,
    artifactId: number,
  ): Promise<ReconciliationArtifact | null> {
    const artifact = this.reconciliationArtifacts.find(
      (candidate) => candidate.dealership_id === dealershipId && candidate.id === artifactId,
    );
    return artifact ? cloneArtifact(artifact) : null;
  }

  async findReconciliationArtifact(
    dealershipId: number,
    reconciliationRunId: number,
    artifactType: NewReconciliationArtifact["artifact_type"],
  ): Promise<ReconciliationArtifact | null> {
    const artifact = this.reconciliationArtifacts.find(
      (candidate) =>
        candidate.dealership_id === dealershipId &&
        candidate.reconciliation_run_id === reconciliationRunId &&
        candidate.artifact_type === artifactType,
    );
    return artifact ? cloneArtifact(artifact) : null;
  }

  async getReconciliationRunSnapshot(
    dealershipId: number,
    reconciliationRunId: number,
  ): Promise<ReconciliationRunInputSnapshot | null> {
    const run = this.reconciliationRuns.find(
      (candidate) => candidate.id === reconciliationRunId && candidate.dealership_id === dealershipId,
    );
    if (!run) {
      return null;
    }
    const snapshot = this.reconciliationRunSnapshots.find(
      (candidate) => candidate.reconciliation_run_id === reconciliationRunId,
    );
    if (!snapshot) {
      return null;
    }
    return {
      reconciliation_run_id: snapshot.reconciliation_run_id,
      engine_version: snapshot.engine_version,
      inputs: snapshot.inputs.map((snapshotInput) => ({
        ...snapshotInput,
        parser_metadata: cloneJson(snapshotInput.parser_metadata),
        transactions: snapshotInput.transactions.map(cloneTransaction),
      })),
    };
  }

  async listReconciliationRuns(
    dealershipId: number,
    filters: ReconciliationRunListFilters = {},
  ): Promise<ReconciliationRunListItem[]> {
    return this.reconciliationRuns
      .filter(
        (run) =>
          run.dealership_id === dealershipId &&
          (filters.dealershipStoreId === undefined ||
            run.dealership_store_id === filters.dealershipStoreId),
      )
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
      .map((exception) => this.toRunDetailException(exception));
    const boaTransactions = this.transactions.filter(
      (transaction) =>
        transaction.dealership_id === dealershipId &&
        transaction.source_file_id === run.boa_source_file_id,
    );
    const dealertrackTransactions = this.transactions.filter(
      (transaction) =>
        transaction.dealership_id === dealershipId &&
        transaction.source_file_id === run.dealertrack_source_file_id,
    );
    const categorizedExceptions = categorizeRunDetailExceptions(
      { exceptions, match_groups: matchGroups },
      boaTransactions,
      dealertrackTransactions,
    ).filter((exception) => matchesExceptionFilters(exception, filters));

    return {
      ...listItem,
      boa_source_file: this.toSourceFileSummary(boaSourceFile),
      dealertrack_source_file: this.toSourceFileSummary(dealertrackSourceFile),
      match_groups: matchGroups,
      exceptions: categorizedExceptions,
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
      exception.review_status = reviewStatusFromLegacyStatus(update.status);
      if (exception.review_status === "resolved" || exception.review_status === "ignored") {
        exception.reviewed_at = new Date().toISOString();
      }
    }
    if (update.note !== undefined) {
      exception.note = update.note;
      exception.review_notes = update.note;
      assignSideNotes(exception, update.note);
    }
    if (update.review_status !== undefined) {
      exception.review_status = update.review_status;
      exception.status = legacyStatusFromReviewStatus(update.review_status);
      if (update.review_status === "resolved" || update.review_status === "ignored") {
        exception.reviewed_at = new Date().toISOString();
      }
    }
    if (update.assigned_to !== undefined) {
      exception.assigned_to = normalizeNullableText(update.assigned_to);
    }
    if (update.review_notes !== undefined) {
      exception.review_notes = update.review_notes;
      exception.note = update.review_notes;
      assignSideNotes(exception, update.review_notes);
    }
    if (update.boa_notes !== undefined) {
      exception.boa_notes = update.boa_notes;
    }
    if (update.gl_notes !== undefined) {
      exception.gl_notes = update.gl_notes;
    }
    if (update.reviewed_by !== undefined) {
      exception.reviewed_by = normalizeNullableText(update.reviewed_by);
      if (exception.reviewed_by && (exception.review_status === "resolved" || exception.review_status === "ignored")) {
        exception.reviewed_at = exception.reviewed_at ?? new Date().toISOString();
      }
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

  async listPriorUnresolvedExceptions(
    dealershipId: number,
    options: {
      dealershipStoreId: number | null;
      excludeRunId: number;
      createdBefore?: string;
    },
  ): Promise<PriorExceptionRecord[]> {
    const records: PriorExceptionRecord[] = [];
    for (const exception of this.reconciliationExceptions) {
      if (exception.dealership_id !== dealershipId) {
        continue;
      }
      if (exception.reconciliation_run_id === options.excludeRunId) {
        continue;
      }
      if (exception.status !== "unresolved") {
        continue;
      }
      const run = this.reconciliationRuns.find((candidate) => candidate.id === exception.reconciliation_run_id);
      if (!run) {
        continue;
      }
      if ((run.dealership_store_id ?? null) !== options.dealershipStoreId) {
        continue;
      }
      if (options.createdBefore && run.created_at >= options.createdBefore) {
        continue;
      }
      const transaction = this.transactions.find((candidate) => candidate.id === exception.transaction_id);
      if (!transaction) {
        continue;
      }
      records.push({
        exception_id: exception.id,
        reconciliation_run_id: exception.reconciliation_run_id,
        dealership_store_id: run.dealership_store_id ?? null,
        source_type: exception.source_type,
        amount_cents: transaction.amount_cents,
        vin: transaction.vin,
        stock_number: transaction.stock_number,
        reference_number: transaction.reference_number,
        description: transaction.description,
        boa_notes: exception.boa_notes ?? "",
        gl_notes: exception.gl_notes ?? "",
        review_notes: exception.review_notes ?? "",
        created_at: run.created_at,
      });
    }
    return records;
  }

  async clear(): Promise<void> {
    this.sourceFiles = [];
    this.sourceFileUploadContents = [];
    this.transactions = [];
    this.reconciliationRuns = [];
    this.reconciliationArtifacts = [];
    this.reconciliationMatchGroups = [];
    this.reconciliationMatchGroupTransactions = [];
    this.reconciliationExceptions = [];
    this.reconciliationRunSnapshots = [];
    this.scheduledReconciliationJobs = [];
    this.ingestionEvents = [];
    this.operationalEvents = [];
    this.auditEvents = [];
    this.nextSourceFileId = 1;
    this.nextId = 1;
    this.nextReconciliationRunId = 1;
    this.nextReconciliationMatchGroupId = 1;
    this.nextReconciliationExceptionId = 1;
    this.nextDealershipStoreId = 3;
    this.nextScheduledReconciliationJobId = 1;
    this.nextIngestionEventId = 1;
    this.nextOperationalEventId = 1;
    this.nextAuditEventId = 1;
    this.nextReconciliationArtifactId = 1;
  }

  private upsertSourceFileUploadContent(
    sourceFile: SourceFile,
    contentInput: NewSourceFileUploadContent,
  ): void {
    const content: SourceFileUploadContent = {
      ...contentInput,
      source_file_id: sourceFile.id,
      dealership_id: sourceFile.dealership_id,
      dealership_store_id: sourceFile.dealership_store_id,
      file_size: contentInput.file_size ?? contentInput.content.byteLength,
      content: Buffer.from(contentInput.content),
      created_at: new Date().toISOString(),
    };
    this.sourceFileUploadContents = this.sourceFileUploadContents.filter(
      (candidate) => candidate.source_file_id !== sourceFile.id,
    );
    this.sourceFileUploadContents.push(content);
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
      dealership_store_id: run.dealership_store_id,
      store_name: this.getStore(run.dealership_store_id)?.name ?? null,
      dealer_group_id: this.getStore(run.dealership_store_id)?.dealer_group_id ?? null,
      dealer_group_name:
        this.getGroup(this.getStore(run.dealership_store_id)?.dealer_group_id ?? null)?.name ?? null,
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

  private toSourceFileSummary(sourceFile: SourceFile): SourceFileSummary {
    return {
      source_file_id: sourceFile.id,
      dealership_id: sourceFile.dealership_id,
      dealership_store_id: sourceFile.dealership_store_id,
      store_name: this.getStore(sourceFile.dealership_store_id)?.name ?? null,
      source_type: sourceFile.source_type,
      filename: sourceFile.original_filename,
      row_count: sourceFile.row_count,
      validation_error_count: sourceFile.validation_error_count,
      created_at: sourceFile.created_at,
    };
  }

  private getDefaultGroupId(dealershipId: number): number | null {
    return this.dealerGroups.find((group) => group.dealership_id === dealershipId)?.id ?? null;
  }

  private getDefaultStoreId(dealershipId: number): number | null {
    return this.dealershipStores.find((store) => store.dealership_id === dealershipId)?.id ?? null;
  }

  private getStore(storeId: number | null): DealershipStore | null {
    return this.dealershipStores.find((store) => store.id === storeId) ?? null;
  }

  private getGroup(groupId: number | null): DealerGroup | null {
    return this.dealerGroups.find((group) => group.id === groupId) ?? null;
  }

  private withJobStoreName(job: ScheduledReconciliationJob): ScheduledReconciliationJob {
    return {
      ...job,
      store_name: this.getStore(job.dealership_store_id)?.name ?? null,
      expected_source_types: [...job.expected_source_types],
    };
  }

  private toRunDetailException(exception: {
    id: number;
    dealership_id: number;
    source_type: SourceType;
    reason: string;
    status: ReconciliationExceptionStatus;
    note: string;
    review_status: ReconciliationExceptionReviewStatus;
    assigned_to: string | null;
    review_notes: string;
    boa_notes: string;
    gl_notes: string;
    reviewed_at: string | null;
    reviewed_by: string | null;
    created_at: string;
    transaction_id: number;
  }): ReconciliationRunDetail["exceptions"][number] {
    return {
      exception_id: exception.id,
      dealership_id: exception.dealership_id,
      exception_type: exceptionTypeFromReason(exception.reason),
      exception_category: "unclassified",
      status: exception.status,
      note: exception.note,
      review_status: exception.review_status,
      assigned_to: exception.assigned_to,
      review_notes: exception.review_notes,
      boa_notes: exception.boa_notes ?? "",
      gl_notes: exception.gl_notes ?? "",
      reviewed_at: exception.reviewed_at,
      reviewed_by: exception.reviewed_by,
      source_type: exception.source_type,
      reason: exception.reason,
      created_at: exception.created_at,
      transaction: toTransactionSummary(
        this.transactions.find((transaction) => transaction.id === exception.transaction_id)!,
      ),
    };
  }
}

function assignSideNotes(
  exception: { source_type: SourceType; boa_notes: string; gl_notes: string },
  value: string,
): void {
  if (exception.source_type === "boa") {
    exception.boa_notes = value;
  } else if (
    exception.source_type === "dealertrack" ||
    exception.source_type === "dms" ||
    exception.source_type === "gl"
  ) {
    exception.gl_notes = value;
  }
}

function _toSourceFileSummary(sourceFile: SourceFile): SourceFileSummary {
  return {
    source_file_id: sourceFile.id,
    dealership_id: sourceFile.dealership_id,
    dealership_store_id: sourceFile.dealership_store_id,
    store_name: null,
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

function buildReportAccountSummaries(
  transactions: Transaction[],
  exceptions: Array<{ status: ReconciliationExceptionStatus; transaction_id: number }>,
): MonthEndReportAccount[] {
  const statusCountsByTransaction = new Map<
    number,
    Record<ReconciliationExceptionStatus, number>
  >();
  for (const exception of exceptions) {
    const current =
      statusCountsByTransaction.get(exception.transaction_id) ??
      { unresolved: 0, resolved: 0, ignored: 0 };
    current[exception.status] += 1;
    statusCountsByTransaction.set(exception.transaction_id, current);
  }

  const grouped = new Map<
    string,
    {
      account_identifier: string;
      account_type: string;
      source_totals: Map<SourceType, { amount_cents: number; transaction_count: number }>;
      net_difference_amount_cents: number;
      unresolved_exception_count: number;
      resolved_exception_count: number;
      ignored_exception_count: number;
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
        resolved_exception_count: 0,
        ignored_exception_count: 0,
      };
    const sourceTotal =
      account.source_totals.get(transaction.source_type) ??
      { amount_cents: 0, transaction_count: 0 };
    const statusCounts =
      statusCountsByTransaction.get(transaction.id) ?? { unresolved: 0, resolved: 0, ignored: 0 };

    sourceTotal.amount_cents += transaction.amount_cents;
    sourceTotal.transaction_count += 1;
    account.source_totals.set(transaction.source_type, sourceTotal);
    account.net_difference_amount_cents += transaction.amount_cents;
    account.unresolved_exception_count += statusCounts.unresolved;
    account.resolved_exception_count += statusCounts.resolved;
    account.ignored_exception_count += statusCounts.ignored;
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
      resolved_exception_count: account.resolved_exception_count,
      ignored_exception_count: account.ignored_exception_count,
    }))
    .sort((left, right) => left.account_identifier.localeCompare(right.account_identifier));
}

function effectiveTransactionDate(transaction: Transaction): string | null {
  return transaction.transaction_date ?? transaction.post_date;
}

function isWithinPeriod(value: string | null, startDate: string, endDate: string): boolean {
  return value !== null && value >= startDate && value <= endDate;
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
  if (
    filters.exceptionReviewStatus !== undefined &&
    exception.review_status !== filters.exceptionReviewStatus
  ) {
    return false;
  }
  if (filters.assignedTo !== undefined) {
    const assignedTo = exception.assigned_to?.toLowerCase() ?? "";
    if (!assignedTo.includes(filters.assignedTo.toLowerCase())) {
      return false;
    }
  }
  if (filters.search !== undefined) {
    const search = filters.search.toLowerCase();
    const transaction = exception.transaction;
    const searchable = [
      exception.reason,
      exception.exception_type,
      exception.exception_category,
      exception.status,
      exception.note,
      exception.review_status,
      exception.assigned_to,
      exception.review_notes,
      exception.reviewed_by,
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

function legacyStatusFromReviewStatus(
  reviewStatus: ReconciliationExceptionReviewStatus,
): ReconciliationExceptionStatus {
  if (reviewStatus === "resolved" || reviewStatus === "ignored") {
    return reviewStatus;
  }
  return "unresolved";
}

function reviewStatusFromLegacyStatus(
  status: ReconciliationExceptionStatus,
): ReconciliationExceptionReviewStatus {
  if (status === "resolved" || status === "ignored") {
    return status;
  }
  return "unreviewed";
}

function normalizeNullableText(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function nextRunAt(cadence: ScheduledReconciliationJob["cadence"], fromIso: string): string {
  const next = new Date(fromIso);
  if (cadence === "daily") {
    next.setUTCDate(next.getUTCDate() + 1);
  } else if (cadence === "weekly") {
    next.setUTCDate(next.getUTCDate() + 7);
  } else {
    next.setUTCMonth(next.getUTCMonth() + 1);
  }
  return next.toISOString();
}

function cloneTransaction(transaction: Transaction): Transaction {
  return {
    ...transaction,
    raw_data: cloneJson(transaction.raw_data),
  };
}

function toArtifactMetadata(
  artifact: ReconciliationArtifact,
): ReconciliationArtifactMetadata {
  const { content: _content, ...metadata } = artifact;
  return metadata;
}

function cloneArtifact(artifact: ReconciliationArtifact): ReconciliationArtifact {
  return {
    ...artifact,
    content: Buffer.from(artifact.content),
  };
}

function cloneSourceFileUploadContent(
  content: SourceFileUploadContent,
): SourceFileUploadContent {
  return {
    ...content,
    content: Buffer.from(content.content),
  };
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function cloneAuditEvent(event: AuditEvent): AuditEvent {
  return {
    ...event,
    previous_state: cloneJson(event.previous_state),
    new_state: cloneJson(event.new_state),
  };
}
