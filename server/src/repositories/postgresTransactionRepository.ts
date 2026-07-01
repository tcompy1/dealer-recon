import pg from "pg";

import { formatCents } from "../domain/money.js";
import { categorizeRunDetailExceptions } from "../services/exceptionCategorizer.js";
import type {
  AccountDetail,
  AccountSourceTotal,
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
  PersistReconciliationRunInput,
  ReconciliationExceptionReviewUpdate,
  ReconciliationExceptionReviewStatus,
  ReconciliationExceptionStatus,
  ReconciliationExceptionType,
  ReconciliationArtifact,
  ReconciliationArtifactMetadata,
  ReconciliationArtifactType,
  ReconciliationRunDetail,
  ReconciliationRunDetailFilters,
  ReconciliationRunInputSnapshot,
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
import {
  DuplicateSourceFileError,
  type SourceFileImport,
  type TransactionRepository,
} from "./transactionRepository.js";
import type { PriorExceptionRecord } from "../services/exceptionCarryForward.js";

type SourceFileRow = {
  id: number;
  dealership_id: number;
  dealership_store_id: number | null;
  store_name?: string | null;
  source_type: SourceType;
  original_filename: string;
  stored_filename: string | null;
  file_hash: string;
  row_count: number;
  validation_error_count: number;
  created_at: Date | string;
};

type SourceFileUploadContentRow = {
  source_file_id: number;
  dealership_id: number;
  dealership_store_id: number | null;
  filename: string;
  content_type: string;
  file_size_bytes: string | number;
  content: Buffer;
  created_at: Date | string;
};

type ReconciliationArtifactRow = {
  id: number;
  reconciliation_run_id: number;
  dealership_id: number;
  dealership_store_id: number | null;
  accounting_month: string;
  uploaded_by_user_id: number | null;
  artifact_type: ReconciliationArtifactType;
  filename: string;
  content_type: string;
  file_size_bytes: string | number;
  content: Buffer;
  created_at: Date | string;
};

type TransactionRow = {
  id: number;
  dealership_id: number;
  source_file_id: number | null;
  source_type: SourceType;
  transaction_date: Date | string | null;
  post_date: Date | string | null;
  amount_cents: string;
  reference_number: string | null;
  description: string | null;
  account: string | null;
  account_type: string;
  account_identifier: string;
  stock_number: string | null;
  vin: string | null;
  raw_data: Record<string, unknown>;
};

type ReconciliationRunRow = {
  id: number;
  dealership_id: number;
  dealership_store_id: number | null;
  boa_source_file_id: number;
  dealertrack_source_file_id: number;
  matched_count: number;
  exception_count: number;
  duplicate_count: number;
  status: string;
  created_at: Date | string;
};

type ReconciliationRunListRow = ReconciliationRunRow & {
  boa_filename: string;
  dealertrack_filename: string;
  store_name: string | null;
  dealer_group_id: number | null;
  dealer_group_name: string | null;
};

type DealerGroupRow = {
  id: number;
  dealership_id: number;
  name: string;
  created_at: Date | string;
};

type DealershipStoreRow = {
  id: number;
  dealership_id: number;
  dealer_group_id: number | null;
  name: string;
  created_at: Date | string;
};

type ScheduledReconciliationJobRow = {
  id: number;
  dealership_id: number;
  dealership_store_id: number | null;
  store_name: string | null;
  cadence: ScheduledReconciliationJob["cadence"];
  expected_source_types: SourceType[];
  enabled: boolean;
  auto_run_on_pair: boolean;
  last_run_at: Date | string | null;
  next_run_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type IngestionEventRow = {
  id: number;
  dealership_id: number;
  dealership_store_id: number | null;
  store_name: string | null;
  source_file_id: number | null;
  reconciliation_run_id: number | null;
  source_type: SourceType | null;
  state: IngestionEvent["state"];
  message: string;
  metadata: Record<string, unknown>;
  created_at: Date | string;
};

type OperationalEventRow = {
  id: number;
  dealership_id: number;
  dealership_store_id: number | null;
  store_name: string | null;
  reconciliation_run_id: number | null;
  event_type: OperationalEvent["event_type"];
  severity: OperationalEvent["severity"];
  message: string;
  metadata: Record<string, unknown>;
  created_at: Date | string;
};

type AuditEventRow = {
  id: number;
  dealership_id: number;
  actor_user_id: number | null;
  action_type: string;
  entity_type: string;
  entity_id: string | null;
  previous_state: Record<string, unknown> | null;
  new_state: Record<string, unknown> | null;
  timestamp: Date | string;
};

type MatchGroupRow = {
  id: number;
  match_type: string;
  confidence: string;
  reason: string;
  created_at: Date | string;
};

type MatchGroupTransactionRow = TransactionRow & {
  match_group_id: number;
  side: string;
  linked_source_type: SourceType;
};

type ReconciliationExceptionRow = TransactionRow & {
  exception_id: number;
  exception_source_type: SourceType;
  reason: string;
  status: ReconciliationExceptionStatus;
  note: string;
  review_status: ReconciliationExceptionReviewStatus;
  assigned_to: string | null;
  review_notes: string;
  boa_notes: string | null;
  gl_notes: string | null;
  reviewed_at: Date | string | null;
  reviewed_by: string | null;
  exception_created_at: Date | string;
};

type ReconciliationRunInputRow = {
  id: number;
  reconciliation_run_id: number;
  side: ReconciliationRunInputSnapshot["inputs"][number]["side"];
  source_type: SourceType;
  source_file_id: number;
  parser_version: string;
  parser_metadata: Record<string, unknown>;
  engine_version: string;
  created_at: Date | string;
};

type ReconciliationRunInputTransactionRow = {
  reconciliation_run_input_id: number;
  transaction_data: Transaction;
};

type AccountSourceTotalRow = {
  account_identifier: string;
  account_type: string;
  source_type: SourceType;
  amount_cents: string;
  transaction_count: string;
};

type ReportExceptionCountRow = {
  account_identifier: string;
  account_type: string;
  status: ReconciliationExceptionStatus;
  exception_count: string;
};

export class PostgresTransactionRepository implements TransactionRepository {
  constructor(private readonly pool: pg.Pool) {}

  async createSourceFileWithTransactions(
    dealershipId: number,
    sourceFileInput: NewSourceFile,
    transactions: NewTransaction[],
    uploadContent?: NewSourceFileUploadContent,
  ): Promise<SourceFileImport> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const sourceFile = await insertSourceFile(client, dealershipId, {
        ...sourceFileInput,
        dealership_store_id:
          sourceFileInput.dealership_store_id ?? (await this.getDefaultStoreId(dealershipId)),
      });
      if (uploadContent) {
        await upsertSourceFileUploadContent(client, sourceFile, uploadContent);
      }
      const scopedTransactions = transactions.map((transaction) => ({
        ...transaction,
        dealership_id: dealershipId,
        source_file_id: sourceFile.id,
      }));
      const inserted = await insertTransactions(client, scopedTransactions);
      await client.query("COMMIT");
      return { sourceFile, transactions: inserted };
    } catch (error) {
      await client.query("ROLLBACK");
      if (isDuplicateSourceFileError(error)) {
        throw new DuplicateSourceFileError();
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async replaceSourceFileWithTransactions(
    dealershipId: number,
    sourceFileId: number,
    sourceFileInput: NewSourceFile,
    transactions: NewTransaction[],
    uploadContent?: NewSourceFileUploadContent,
  ): Promise<SourceFileImport | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query<SourceFileRow>(
        "SELECT * FROM source_files WHERE dealership_id = $1 AND id = $2 FOR UPDATE",
        [dealershipId, sourceFileId],
      );
      if (!existing.rows[0]) {
        await client.query("ROLLBACK");
        return null;
      }

      const dealershipStoreId =
        sourceFileInput.dealership_store_id ?? existing.rows[0].dealership_store_id;
      await client.query(
        "DELETE FROM transactions WHERE dealership_id = $1 AND source_file_id = $2",
        [dealershipId, sourceFileId],
      );
      const updated = await client.query<SourceFileRow>(
        `UPDATE source_files
         SET dealership_store_id = $3,
             source_type = $4,
             original_filename = $5,
             stored_filename = $6,
             file_hash = $7,
             row_count = $8,
             validation_error_count = $9
         WHERE dealership_id = $1
           AND id = $2
         RETURNING *`,
        [
          dealershipId,
          sourceFileId,
          dealershipStoreId,
          sourceFileInput.source_type,
          sourceFileInput.original_filename,
          sourceFileInput.stored_filename,
          sourceFileInput.file_hash,
          sourceFileInput.row_count,
          sourceFileInput.validation_error_count,
        ],
      );
      const sourceFile = toSourceFile(updated.rows[0]);
      if (uploadContent) {
        await upsertSourceFileUploadContent(client, sourceFile, uploadContent);
      }
      const scopedTransactions = transactions.map((transaction) => ({
        ...transaction,
        dealership_id: dealershipId,
        source_file_id: sourceFileId,
      }));
      const inserted = await insertTransactions(client, scopedTransactions);
      await client.query("COMMIT");
      return { sourceFile, transactions: inserted };
    } catch (error) {
      await client.query("ROLLBACK");
      if (isDuplicateSourceFileError(error)) {
        throw new DuplicateSourceFileError();
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async insertMany(transactions: NewTransaction[]): Promise<Transaction[]> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await insertTransactions(client, transactions);
      await client.query("COMMIT");
      return inserted;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getSourceFile(sourceFileId: number): Promise<SourceFile | null> {
    const result = await this.pool.query<SourceFileRow>(
      "SELECT sf.*, ds.name AS store_name FROM source_files sf LEFT JOIN dealership_stores ds ON ds.id = sf.dealership_store_id WHERE sf.id = $1",
      [sourceFileId],
    );
    return result.rows[0] ? toSourceFile(result.rows[0]) : null;
  }

  async getSourceFileByHash(
    dealershipId: number,
    dealershipStoreId: number | null,
    sourceType: SourceType,
    fileHash: string,
  ): Promise<SourceFile | null> {
    const result = await this.pool.query<SourceFileRow>(
      "SELECT sf.*, ds.name AS store_name FROM source_files sf LEFT JOIN dealership_stores ds ON ds.id = sf.dealership_store_id WHERE sf.dealership_id = $1 AND sf.dealership_store_id IS NOT DISTINCT FROM $2 AND sf.source_type = $3 AND sf.file_hash = $4",
      [dealershipId, dealershipStoreId, sourceType, fileHash],
    );
    return result.rows[0] ? toSourceFile(result.rows[0]) : null;
  }

  async listSourceFiles(
    dealershipId: number,
    sourceType?: SourceType,
    dealershipStoreId?: number,
  ): Promise<SourceFileSummary[]> {
    const result = await this.pool.query<SourceFileRow>(
      `SELECT sf.*, ds.name AS store_name
       FROM source_files sf
       LEFT JOIN dealership_stores ds ON ds.id = sf.dealership_store_id
       WHERE sf.dealership_id = $1
         AND ($2::text IS NULL OR sf.source_type = $2)
         AND ($3::integer IS NULL OR sf.dealership_store_id = $3)
       ORDER BY sf.created_at DESC, sf.id DESC`,
      [dealershipId, sourceType ?? null, dealershipStoreId ?? null],
    );
    return result.rows.map((row) => toSourceFileSummary(toSourceFile(row)));
  }

  async listDealerGroups(dealershipId: number): Promise<DealerGroup[]> {
    const result = await this.pool.query<DealerGroupRow>(
      "SELECT * FROM dealer_groups WHERE dealership_id = $1 ORDER BY name, id",
      [dealershipId],
    );
    return result.rows.map(toDealerGroup);
  }

  async listDealershipStores(dealershipId: number): Promise<DealershipStore[]> {
    const result = await this.pool.query<DealershipStoreRow>(
      "SELECT * FROM dealership_stores WHERE dealership_id = $1 ORDER BY name, id",
      [dealershipId],
    );
    return result.rows.map(toDealershipStore);
  }

  async createDealershipStore(
    dealershipId: number,
    store: NewDealershipStore,
  ): Promise<DealershipStore> {
    const groupId = store.dealer_group_id ?? (await this.getDefaultDealerGroupId(dealershipId));
    const result = await this.pool.query<DealershipStoreRow>(
      `INSERT INTO dealership_stores (dealership_id, dealer_group_id, name)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [dealershipId, groupId, store.name],
    );
    return toDealershipStore(result.rows[0]);
  }

  async createScheduledReconciliationJob(
    dealershipId: number,
    job: NewScheduledReconciliationJob,
  ): Promise<ScheduledReconciliationJob> {
    const storeId = job.dealership_store_id ?? (await this.getDefaultStoreId(dealershipId));
    const result = await this.pool.query<ScheduledReconciliationJobRow>(
      `INSERT INTO scheduled_reconciliation_jobs (
        dealership_id,
        dealership_store_id,
        cadence,
        expected_source_types,
        enabled,
        auto_run_on_pair,
        next_run_at
      ) VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, next_run_at_for_cadence($3)))
      RETURNING *, NULL::text AS store_name`,
      [
        dealershipId,
        storeId,
        job.cadence,
        job.expected_source_types,
        job.enabled ?? true,
        job.auto_run_on_pair ?? false,
        job.next_run_at ?? null,
      ],
    );
    return this.withJobStoreName(toScheduledReconciliationJob(result.rows[0]));
  }

  async listScheduledReconciliationJobs(
    dealershipId: number,
    dealershipStoreId?: number,
  ): Promise<ScheduledReconciliationJob[]> {
    const result = await this.pool.query<ScheduledReconciliationJobRow>(
      `SELECT srj.*, ds.name AS store_name
       FROM scheduled_reconciliation_jobs srj
       LEFT JOIN dealership_stores ds ON ds.id = srj.dealership_store_id
       WHERE srj.dealership_id = $1
         AND ($2::integer IS NULL OR srj.dealership_store_id = $2)
       ORDER BY srj.id`,
      [dealershipId, dealershipStoreId ?? null],
    );
    return result.rows.map(toScheduledReconciliationJob);
  }

  async updateScheduledReconciliationJob(
    dealershipId: number,
    jobId: number,
    update: ScheduledReconciliationJobUpdate,
  ): Promise<ScheduledReconciliationJob | null> {
    const result = await this.pool.query<ScheduledReconciliationJobRow>(
      `UPDATE scheduled_reconciliation_jobs
       SET
         cadence = COALESCE($3, cadence),
         expected_source_types = COALESCE($4, expected_source_types),
         enabled = COALESCE($5, enabled),
         auto_run_on_pair = COALESCE($6, auto_run_on_pair),
         last_run_at = CASE WHEN $7::boolean THEN $8 ELSE last_run_at END,
         next_run_at = CASE WHEN $9::boolean THEN $10 ELSE next_run_at END,
         updated_at = NOW()
       FROM dealership_stores ds
       WHERE scheduled_reconciliation_jobs.id = $1
         AND scheduled_reconciliation_jobs.dealership_id = $2
         AND ds.id = scheduled_reconciliation_jobs.dealership_store_id
       RETURNING scheduled_reconciliation_jobs.*, ds.name AS store_name`,
      [
        jobId,
        dealershipId,
        update.cadence ?? null,
        update.expected_source_types ?? null,
        update.enabled ?? null,
        update.auto_run_on_pair ?? null,
        update.last_run_at !== undefined,
        update.last_run_at ?? null,
        update.next_run_at !== undefined,
        update.next_run_at ?? null,
      ],
    );
    return result.rows[0] ? toScheduledReconciliationJob(result.rows[0]) : null;
  }

  async createIngestionEvent(
    dealershipId: number,
    event: NewIngestionEvent,
  ): Promise<IngestionEvent> {
    const result = await this.pool.query<IngestionEventRow>(
      `INSERT INTO ingestion_events (
        dealership_id,
        dealership_store_id,
        source_file_id,
        reconciliation_run_id,
        source_type,
        state,
        message,
        metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *, NULL::text AS store_name`,
      [
        dealershipId,
        event.dealership_store_id,
        event.source_file_id,
        event.reconciliation_run_id,
        event.source_type,
        event.state,
        event.message,
        event.metadata,
      ],
    );
    return this.withIngestionStoreName(toIngestionEvent(result.rows[0]));
  }

  async listIngestionEvents(
    dealershipId: number,
    dealershipStoreId?: number,
    limit = 50,
  ): Promise<IngestionEvent[]> {
    const result = await this.pool.query<IngestionEventRow>(
      `SELECT ie.*, ds.name AS store_name
       FROM ingestion_events ie
       LEFT JOIN dealership_stores ds ON ds.id = ie.dealership_store_id
       WHERE ie.dealership_id = $1
         AND ($2::integer IS NULL OR ie.dealership_store_id = $2)
       ORDER BY ie.created_at DESC, ie.id DESC
       LIMIT $3`,
      [dealershipId, dealershipStoreId ?? null, limit],
    );
    return result.rows.map(toIngestionEvent);
  }

  async createOperationalEvent(
    dealershipId: number,
    event: NewOperationalEvent,
  ): Promise<OperationalEvent> {
    const result = await this.pool.query<OperationalEventRow>(
      `INSERT INTO operational_events (
        dealership_id,
        dealership_store_id,
        reconciliation_run_id,
        event_type,
        severity,
        message,
        metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *, NULL::text AS store_name`,
      [
        dealershipId,
        event.dealership_store_id,
        event.reconciliation_run_id,
        event.event_type,
        event.severity,
        event.message,
        event.metadata,
      ],
    );
    return this.withOperationalStoreName(toOperationalEvent(result.rows[0]));
  }

  async listOperationalEvents(
    dealershipId: number,
    dealershipStoreId?: number,
    limit = 50,
  ): Promise<OperationalEvent[]> {
    const result = await this.pool.query<OperationalEventRow>(
      `SELECT oe.*, ds.name AS store_name
       FROM operational_events oe
       LEFT JOIN dealership_stores ds ON ds.id = oe.dealership_store_id
       WHERE oe.dealership_id = $1
         AND ($2::integer IS NULL OR oe.dealership_store_id = $2)
       ORDER BY oe.created_at DESC, oe.id DESC
       LIMIT $3`,
      [dealershipId, dealershipStoreId ?? null, limit],
    );
    return result.rows.map(toOperationalEvent);
  }

  async createAuditEvent(dealershipId: number, event: NewAuditEvent): Promise<AuditEvent> {
    const result = await this.pool.query<AuditEventRow>(
      `INSERT INTO audit_events (
        dealership_id,
        actor_user_id,
        action_type,
        entity_type,
        entity_id,
        previous_state,
        new_state
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
      [
        dealershipId,
        event.actor_user_id,
        event.action_type,
        event.entity_type,
        event.entity_id,
        event.previous_state,
        event.new_state,
      ],
    );
    return toAuditEvent(result.rows[0]);
  }

  async listAuditEvents(dealershipId: number, limit = 100): Promise<AuditEvent[]> {
    const result = await this.pool.query<AuditEventRow>(
      `SELECT *
       FROM audit_events
       WHERE dealership_id = $1
       ORDER BY timestamp DESC, id DESC
       LIMIT $2`,
      [dealershipId, limit],
    );
    return result.rows.map(toAuditEvent);
  }

  async listBySource(dealershipId: number, sourceType: SourceType): Promise<Transaction[]> {
    const result = await this.pool.query<TransactionRow>(
      "SELECT * FROM transactions WHERE dealership_id = $1 AND source_type = $2 ORDER BY id",
      [dealershipId, sourceType],
    );
    return result.rows.map(toTransaction);
  }

  async listBySourceFile(dealershipId: number, sourceFileId: number): Promise<Transaction[]> {
    const result = await this.pool.query<TransactionRow>(
      "SELECT * FROM transactions WHERE dealership_id = $1 AND source_file_id = $2 ORDER BY id",
      [dealershipId, sourceFileId],
    );
    return result.rows.map(toTransaction);
  }

  async getTransactionById(
    dealershipId: number,
    transactionId: number,
  ): Promise<Transaction | null> {
    const result = await this.pool.query<TransactionRow>(
      "SELECT * FROM transactions WHERE dealership_id = $1 AND id = $2",
      [dealershipId, transactionId],
    );
    return result.rows[0] ? toTransaction(result.rows[0]) : null;
  }

  async updateTransactionVinAndRawData(
    dealershipId: number,
    transactionId: number,
    update: { vin: string; raw_data: Record<string, unknown> },
  ): Promise<Transaction | null> {
    const result = await this.pool.query<TransactionRow>(
      `UPDATE transactions
       SET vin = $3, raw_data = $4
       WHERE dealership_id = $1 AND id = $2
       RETURNING *`,
      [dealershipId, transactionId, update.vin, update.raw_data],
    );
    return result.rows[0] ? toTransaction(result.rows[0]) : null;
  }

  async listAccountsSummary(dealershipId: number): Promise<AccountSummary[]> {
    return buildAccountSummaries(
      await this.listAccountSourceTotals(dealershipId),
      await this.listUnresolvedExceptionCountsByAccount(dealershipId),
    );
  }

  async getAccountDetail(
    dealershipId: number,
    accountIdentifier: string,
  ): Promise<AccountDetail | null> {
    const transactionResult = await this.pool.query<TransactionRow>(
      `SELECT *
       FROM transactions
       WHERE dealership_id = $1
         AND account_identifier = $2
       ORDER BY source_type, transaction_date NULLS LAST, id`,
      [dealershipId, accountIdentifier],
    );
    if (transactionResult.rows.length === 0) {
      return null;
    }

    const accountType = transactionResult.rows[0].account_type;
    const summary = buildAccountSummaries(
      await this.listAccountSourceTotals(dealershipId, accountIdentifier),
      await this.listUnresolvedExceptionCountsByAccount(dealershipId, accountIdentifier),
    ).find(
      (account) =>
        account.account_identifier === accountIdentifier && account.account_type === accountType,
    );
    if (!summary) {
      return null;
    }

    const relatedRuns = await this.pool.query<ReconciliationRunListRow>(
      `SELECT DISTINCT
        rr.*,
        boa.original_filename AS boa_filename,
        dealertrack.original_filename AS dealertrack_filename
      FROM reconciliation_runs rr
      JOIN source_files boa ON boa.id = rr.boa_source_file_id
      JOIN source_files dealertrack ON dealertrack.id = rr.dealertrack_source_file_id
      WHERE rr.dealership_id = $1
        AND (
          EXISTS (
            SELECT 1
            FROM transactions t
            WHERE t.dealership_id = $1
              AND t.account_identifier = $2
              AND (t.source_file_id = rr.boa_source_file_id OR t.source_file_id = rr.dealertrack_source_file_id)
          )
          OR EXISTS (
            SELECT 1
            FROM reconciliation_exceptions re
            JOIN transactions t ON t.id = re.transaction_id
            WHERE re.reconciliation_run_id = rr.id
              AND re.dealership_id = $1
              AND t.account_identifier = $2
          )
        )
      ORDER BY rr.created_at DESC, rr.id DESC`,
      [dealershipId, accountIdentifier],
    );
    const unresolvedExceptions = await this.pool.query<ReconciliationExceptionRow>(
      `SELECT
        re.id AS exception_id,
        re.dealership_id,
        re.source_type AS exception_source_type,
        re.reason,
       re.status,
       re.note,
       re.review_status,
       re.assigned_to,
       re.review_notes,
       COALESCE(re.boa_notes, '') AS boa_notes,
       COALESCE(re.gl_notes, '') AS gl_notes,
       re.reviewed_at,
       re.reviewed_by,
       re.created_at AS exception_created_at,
        t.*
      FROM reconciliation_exceptions re
      JOIN transactions t ON t.id = re.transaction_id
      WHERE re.dealership_id = $1
        AND re.status = 'unresolved'
        AND t.account_identifier = $2
      ORDER BY re.id`,
      [dealershipId, accountIdentifier],
    );

    return {
      ...summary,
      transactions_by_source_type: groupTransactionsBySource(
        transactionResult.rows.map(toTransaction),
      ),
      related_reconciliation_runs: relatedRuns.rows.map(toReconciliationRunListItem),
      unresolved_exceptions: unresolvedExceptions.rows.map(toReconciliationExceptionDetail),
    };
  }

  async getMonthEndReport(
    dealershipId: number,
    startDate: string,
    endDate: string,
  ): Promise<MonthEndReport> {
    const [sourceTotals, exceptionCounts, relatedRuns] = await Promise.all([
      this.listReportAccountSourceTotals(dealershipId, startDate, endDate),
      this.listReportExceptionCounts(dealershipId, startDate, endDate),
      this.listReportReconciliationRuns(dealershipId, startDate, endDate),
    ]);

    return {
      reporting_period: { start_date: startDate, end_date: endDate },
      generated_at: new Date().toISOString(),
      account_summaries: buildReportAccountSummaries(sourceTotals, exceptionCounts),
      reconciliation_runs_included: relatedRuns,
    };
  }

  private async listAccountSourceTotals(
    dealershipId: number,
    accountIdentifier?: string,
  ): Promise<AccountSourceTotalRow[]> {
    const result = await this.pool.query<AccountSourceTotalRow>(
      `SELECT
        account_identifier,
        account_type,
        source_type,
        SUM(amount_cents)::text AS amount_cents,
        COUNT(*)::text AS transaction_count
      FROM transactions
      WHERE dealership_id = $1
        AND ($2::text IS NULL OR account_identifier = $2)
      GROUP BY account_identifier, account_type, source_type
      ORDER BY account_identifier, account_type, source_type`,
      [dealershipId, accountIdentifier ?? null],
    );
    return result.rows;
  }

  private async getDefaultDealerGroupId(dealershipId: number): Promise<number | null> {
    const result = await this.pool.query<{ id: number }>(
      "SELECT id FROM dealer_groups WHERE dealership_id = $1 ORDER BY id LIMIT 1",
      [dealershipId],
    );
    return result.rows[0]?.id ?? null;
  }

  private async getDefaultStoreId(dealershipId: number): Promise<number | null> {
    const result = await this.pool.query<{ id: number }>(
      "SELECT id FROM dealership_stores WHERE dealership_id = $1 ORDER BY id LIMIT 1",
      [dealershipId],
    );
    return result.rows[0]?.id ?? null;
  }

  private withJobStoreName(job: ScheduledReconciliationJob): ScheduledReconciliationJob {
    return job;
  }

  private withIngestionStoreName(event: IngestionEvent): IngestionEvent {
    return event;
  }

  private withOperationalStoreName(event: OperationalEvent): OperationalEvent {
    return event;
  }

  private async listUnresolvedExceptionCountsByAccount(
    dealershipId: number,
    accountIdentifier?: string,
  ): Promise<Map<string, number>> {
    const result = await this.pool.query<{
      account_identifier: string;
      account_type: string;
      unresolved_exception_count: string;
    }>(
      `SELECT
        t.account_identifier,
        t.account_type,
        COUNT(re.id)::text AS unresolved_exception_count
      FROM reconciliation_exceptions re
      JOIN transactions t ON t.id = re.transaction_id
      WHERE re.dealership_id = $1
        AND re.status = 'unresolved'
        AND ($2::text IS NULL OR t.account_identifier = $2)
      GROUP BY t.account_identifier, t.account_type`,
      [dealershipId, accountIdentifier ?? null],
    );
    return new Map(
      result.rows.map((row) => [
        accountKey(row.account_identifier, row.account_type),
        Number(row.unresolved_exception_count),
      ]),
    );
  }

  private async listReportAccountSourceTotals(
    dealershipId: number,
    startDate: string,
    endDate: string,
  ): Promise<AccountSourceTotalRow[]> {
    const result = await this.pool.query<AccountSourceTotalRow>(
      `SELECT
        account_identifier,
        account_type,
        source_type,
        SUM(amount_cents)::text AS amount_cents,
        COUNT(*)::text AS transaction_count
      FROM transactions
      WHERE dealership_id = $1
        AND COALESCE(transaction_date, post_date) >= $2::date
        AND COALESCE(transaction_date, post_date) <= $3::date
      GROUP BY account_identifier, account_type, source_type
      ORDER BY account_identifier, account_type, source_type`,
      [dealershipId, startDate, endDate],
    );
    return result.rows;
  }

  private async listReportExceptionCounts(
    dealershipId: number,
    startDate: string,
    endDate: string,
  ): Promise<ReportExceptionCountRow[]> {
    const result = await this.pool.query<ReportExceptionCountRow>(
      `SELECT
        t.account_identifier,
        t.account_type,
        re.status,
        COUNT(re.id)::text AS exception_count
      FROM reconciliation_exceptions re
      JOIN transactions t ON t.id = re.transaction_id
      WHERE re.dealership_id = $1
        AND COALESCE(t.transaction_date, t.post_date) >= $2::date
        AND COALESCE(t.transaction_date, t.post_date) <= $3::date
      GROUP BY t.account_identifier, t.account_type, re.status
      ORDER BY t.account_identifier, t.account_type, re.status`,
      [dealershipId, startDate, endDate],
    );
    return result.rows;
  }

  private async listReportReconciliationRuns(
    dealershipId: number,
    startDate: string,
    endDate: string,
  ): Promise<ReconciliationRunListItem[]> {
    const result = await this.pool.query<ReconciliationRunListRow>(
      `SELECT DISTINCT
        rr.*,
        boa.original_filename AS boa_filename,
        dealertrack.original_filename AS dealertrack_filename
      FROM reconciliation_runs rr
      JOIN source_files boa ON boa.id = rr.boa_source_file_id
      JOIN source_files dealertrack ON dealertrack.id = rr.dealertrack_source_file_id
      WHERE rr.dealership_id = $1
        AND (
          EXISTS (
            SELECT 1
            FROM transactions t
            WHERE t.dealership_id = $1
              AND (t.source_file_id = rr.boa_source_file_id OR t.source_file_id = rr.dealertrack_source_file_id)
              AND COALESCE(t.transaction_date, t.post_date) >= $2::date
              AND COALESCE(t.transaction_date, t.post_date) <= $3::date
          )
          OR EXISTS (
            SELECT 1
            FROM reconciliation_exceptions re
            JOIN transactions t ON t.id = re.transaction_id
            WHERE re.reconciliation_run_id = rr.id
              AND re.dealership_id = $1
              AND COALESCE(t.transaction_date, t.post_date) >= $2::date
              AND COALESCE(t.transaction_date, t.post_date) <= $3::date
          )
        )
      ORDER BY rr.created_at DESC, rr.id DESC`,
      [dealershipId, startDate, endDate],
    );
    return result.rows.map(toReconciliationRunListItem);
  }

  async createReconciliationRun(
    input: PersistReconciliationRunInput,
  ): Promise<ReconciliationRun> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const run = await insertReconciliationRun(client, {
        ...input,
        dealership_store_id: input.dealership_store_id ?? (await this.getDefaultStoreId(input.dealership_id)),
      });

      for (const matchGroup of input.result.match_groups) {
        const groupResult = await client.query<{ id: number }>(
          `INSERT INTO reconciliation_match_groups (
            reconciliation_run_id,
            match_type,
            confidence,
            reason
          ) VALUES ($1, $2, $3, $4)
          RETURNING id`,
          [run.id, matchGroup.match_reason, matchGroup.confidence_score, matchGroup.match_reason],
        );
        const matchGroupId = groupResult.rows[0].id;

        for (const [index, transaction] of matchGroup.transactions.entries()) {
          await client.query(
            `INSERT INTO reconciliation_match_group_transactions (
              match_group_id,
              transaction_id,
              side,
              source_type
            ) VALUES ($1, $2, $3, $4)`,
            [matchGroupId, transaction.id, index === 0 ? "left" : "right", transaction.source_type],
          );
        }
      }

      for (const exception of input.result.exceptions) {
        await client.query(
          `INSERT INTO reconciliation_exceptions (
            dealership_id,
            reconciliation_run_id,
            transaction_id,
            source_type,
            reason
          ) VALUES ($1, $2, $3, $4, $5)`,
          [
            input.dealership_id,
            run.id,
            exception.transaction.id,
            exception.source_type,
            exception.description,
          ],
        );
      }

      if (input.input_snapshot) {
        for (const snapshotInput of input.input_snapshot.inputs) {
          const inputResult = await client.query<{ id: number }>(
            `INSERT INTO reconciliation_run_inputs (
              reconciliation_run_id,
              side,
              source_type,
              source_file_id,
              parser_version,
              parser_metadata,
              engine_version
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING id`,
            [
              run.id,
              snapshotInput.side,
              snapshotInput.source_type,
              snapshotInput.source_file_id,
              snapshotInput.parser_version,
              snapshotInput.parser_metadata,
              input.input_snapshot.engine_version,
            ],
          );
          const snapshotInputId = inputResult.rows[0].id;

          for (const [index, transaction] of snapshotInput.transactions.entries()) {
            await client.query(
              `INSERT INTO reconciliation_run_input_transactions (
                reconciliation_run_input_id,
                original_transaction_id,
                transaction_order,
                transaction_data
              ) VALUES ($1, $2, $3, $4)`,
              [snapshotInputId, transaction.id, index, transaction],
            );
          }
        }
      }

      await client.query("COMMIT");
      return run;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async updateReconciliationRunStatus(
    dealershipId: number,
    reconciliationRunId: number,
    status: string,
  ): Promise<ReconciliationRun | null> {
    const result = await this.pool.query<ReconciliationRunRow>(
      `UPDATE reconciliation_runs
       SET status = $3
       WHERE dealership_id = $1
         AND id = $2
       RETURNING *`,
      [dealershipId, reconciliationRunId, status],
    );
    return result.rows[0] ? toReconciliationRun(result.rows[0]) : null;
  }

  async getSourceFileUploadContent(
    dealershipId: number,
    sourceFileId: number,
  ): Promise<SourceFileUploadContent | null> {
    const result = await this.pool.query<SourceFileUploadContentRow>(
      `SELECT *
       FROM source_file_upload_contents
       WHERE dealership_id = $1
         AND source_file_id = $2`,
      [dealershipId, sourceFileId],
    );
    return result.rows[0] ? toSourceFileUploadContent(result.rows[0]) : null;
  }

  async createReconciliationArtifact(
    dealershipId: number,
    artifact: NewReconciliationArtifact,
  ): Promise<ReconciliationArtifactMetadata> {
    const result = await this.pool.query<ReconciliationArtifactRow>(
      `INSERT INTO reconciliation_artifacts (
        reconciliation_run_id,
        dealership_id,
        dealership_store_id,
        accounting_month,
        uploaded_by_user_id,
        artifact_type,
        filename,
        content_type,
        file_size_bytes,
        content
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (reconciliation_run_id, artifact_type)
      DO UPDATE SET
        dealership_store_id = EXCLUDED.dealership_store_id,
        accounting_month = EXCLUDED.accounting_month,
        uploaded_by_user_id = EXCLUDED.uploaded_by_user_id,
        filename = EXCLUDED.filename,
        content_type = EXCLUDED.content_type,
        file_size_bytes = EXCLUDED.file_size_bytes,
        content = EXCLUDED.content,
        created_at = NOW()
      RETURNING *`,
      [
        artifact.reconciliation_run_id,
        dealershipId,
        artifact.store_id,
        artifact.accounting_month,
        artifact.uploaded_by,
        artifact.artifact_type,
        artifact.filename,
        artifact.content_type,
        artifact.file_size ?? artifact.content.byteLength,
        artifact.content,
      ],
    );
    return toReconciliationArtifactMetadata(result.rows[0]);
  }

  async listReconciliationArtifacts(
    dealershipId: number,
    reconciliationRunId: number,
  ): Promise<ReconciliationArtifactMetadata[]> {
    const result = await this.pool.query<ReconciliationArtifactRow>(
      `SELECT *
       FROM reconciliation_artifacts
       WHERE dealership_id = $1
         AND reconciliation_run_id = $2
       ORDER BY id`,
      [dealershipId, reconciliationRunId],
    );
    return result.rows.map(toReconciliationArtifactMetadata);
  }

  async getReconciliationArtifact(
    dealershipId: number,
    artifactId: number,
  ): Promise<ReconciliationArtifact | null> {
    const result = await this.pool.query<ReconciliationArtifactRow>(
      `SELECT *
       FROM reconciliation_artifacts
       WHERE dealership_id = $1
         AND id = $2`,
      [dealershipId, artifactId],
    );
    return result.rows[0] ? toReconciliationArtifact(result.rows[0]) : null;
  }

  async findReconciliationArtifact(
    dealershipId: number,
    reconciliationRunId: number,
    artifactType: NewReconciliationArtifact["artifact_type"],
  ): Promise<ReconciliationArtifact | null> {
    const result = await this.pool.query<ReconciliationArtifactRow>(
      `SELECT *
       FROM reconciliation_artifacts
       WHERE dealership_id = $1
         AND reconciliation_run_id = $2
         AND artifact_type = $3`,
      [dealershipId, reconciliationRunId, artifactType],
    );
    return result.rows[0] ? toReconciliationArtifact(result.rows[0]) : null;
  }

  async getReconciliationRunSnapshot(
    dealershipId: number,
    reconciliationRunId: number,
  ): Promise<ReconciliationRunInputSnapshot | null> {
    const runResult = await this.pool.query<{ id: number }>(
      "SELECT id FROM reconciliation_runs WHERE id = $1 AND dealership_id = $2",
      [reconciliationRunId, dealershipId],
    );
    if (!runResult.rows[0]) {
      return null;
    }

    const inputResult = await this.pool.query<ReconciliationRunInputRow>(
      `SELECT *
       FROM reconciliation_run_inputs
       WHERE reconciliation_run_id = $1
       ORDER BY CASE side WHEN 'boa' THEN 0 ELSE 1 END, id`,
      [reconciliationRunId],
    );
    if (inputResult.rows.length === 0) {
      return null;
    }

    const transactionResult = await this.pool.query<ReconciliationRunInputTransactionRow>(
      `SELECT reconciliation_run_input_id, transaction_data
       FROM reconciliation_run_input_transactions
       WHERE reconciliation_run_input_id = ANY($1::int[])
       ORDER BY reconciliation_run_input_id, transaction_order`,
      [inputResult.rows.map((row) => row.id)],
    );
    const transactionsByInputId = new Map<number, Transaction[]>();
    for (const row of transactionResult.rows) {
      transactionsByInputId.set(row.reconciliation_run_input_id, [
        ...(transactionsByInputId.get(row.reconciliation_run_input_id) ?? []),
        normalizeSnapshotTransaction(row.transaction_data),
      ]);
    }

    return {
      reconciliation_run_id: reconciliationRunId,
      engine_version: inputResult.rows[0].engine_version,
      inputs: inputResult.rows.map((row) => ({
        side: row.side,
        source_type: row.source_type,
        source_file_id: row.source_file_id,
        parser_version: row.parser_version,
        parser_metadata: row.parser_metadata,
        transactions: transactionsByInputId.get(row.id) ?? [],
      })),
    };
  }

  async listReconciliationRuns(
    dealershipId: number,
    filters: ReconciliationRunListFilters = {},
  ): Promise<ReconciliationRunListItem[]> {
    const result = await this.pool.query<ReconciliationRunListRow>(
      `SELECT
        rr.*,
        boa.original_filename AS boa_filename,
        dealertrack.original_filename AS dealertrack_filename,
        ds.name AS store_name,
        dg.id AS dealer_group_id,
        dg.name AS dealer_group_name
      FROM reconciliation_runs rr
      JOIN source_files boa ON boa.id = rr.boa_source_file_id
      JOIN source_files dealertrack ON dealertrack.id = rr.dealertrack_source_file_id
      LEFT JOIN dealership_stores ds ON ds.id = rr.dealership_store_id
      LEFT JOIN dealer_groups dg ON dg.id = ds.dealer_group_id
      WHERE rr.dealership_id = $1
        AND ($2::integer IS NULL OR rr.dealership_store_id = $2)
      ORDER BY rr.created_at DESC, rr.id DESC`,
      [dealershipId, filters.dealershipStoreId ?? null],
    );
    return result.rows.map(toReconciliationRunListItem);
  }

  async getReconciliationRunDealershipId(reconciliationRunId: number): Promise<number | null> {
    const result = await this.pool.query<{ dealership_id: number }>(
      "SELECT dealership_id FROM reconciliation_runs WHERE id = $1",
      [reconciliationRunId],
    );
    return result.rows[0]?.dealership_id ?? null;
  }

  async getReconciliationRunDetail(
    dealershipId: number,
    reconciliationRunId: number,
    filters: ReconciliationRunDetailFilters = {},
  ): Promise<ReconciliationRunDetail | null> {
    const runResult = await this.pool.query<
      ReconciliationRunListRow & {
        boa_source_type: SourceType;
        boa_original_filename: string;
        boa_stored_filename: string | null;
        boa_row_count: number;
        boa_validation_error_count: number;
        boa_created_at: Date | string;
        dealertrack_source_type: SourceType;
        dealertrack_original_filename: string;
        dealertrack_stored_filename: string | null;
        dealertrack_row_count: number;
        dealertrack_validation_error_count: number;
        dealertrack_created_at: Date | string;
      }
    >(
      `SELECT
        rr.*,
        boa.original_filename AS boa_filename,
        dealertrack.original_filename AS dealertrack_filename,
        ds.name AS store_name,
        dg.id AS dealer_group_id,
        dg.name AS dealer_group_name,
        boa.source_type AS boa_source_type,
        boa.original_filename AS boa_original_filename,
        boa.stored_filename AS boa_stored_filename,
        boa.row_count AS boa_row_count,
        boa.validation_error_count AS boa_validation_error_count,
        boa.created_at AS boa_created_at,
        dealertrack.source_type AS dealertrack_source_type,
        dealertrack.original_filename AS dealertrack_original_filename,
        dealertrack.stored_filename AS dealertrack_stored_filename,
        dealertrack.row_count AS dealertrack_row_count,
        dealertrack.validation_error_count AS dealertrack_validation_error_count,
        dealertrack.created_at AS dealertrack_created_at
      FROM reconciliation_runs rr
      JOIN source_files boa ON boa.id = rr.boa_source_file_id
      JOIN source_files dealertrack ON dealertrack.id = rr.dealertrack_source_file_id
      LEFT JOIN dealership_stores ds ON ds.id = rr.dealership_store_id
      LEFT JOIN dealer_groups dg ON dg.id = ds.dealer_group_id
      WHERE rr.id = $1
        AND rr.dealership_id = $2`,
      [reconciliationRunId, dealershipId],
    );

    const runRow = runResult.rows[0];
    if (!runRow) {
      return null;
    }

    const matchGroupRows = await this.pool.query<MatchGroupRow>(
      `SELECT id, match_type, confidence, reason, created_at
       FROM reconciliation_match_groups
       WHERE reconciliation_run_id = $1
       ORDER BY id`,
      [reconciliationRunId],
    );
    const matchGroupTransactionRows = await this.pool.query<MatchGroupTransactionRow>(
      `SELECT
        mgt.match_group_id,
        mgt.side,
        mgt.source_type AS linked_source_type,
        t.*
      FROM reconciliation_match_group_transactions mgt
      JOIN transactions t ON t.id = mgt.transaction_id
      JOIN reconciliation_match_groups mg ON mg.id = mgt.match_group_id
      WHERE mg.reconciliation_run_id = $1
        AND t.dealership_id = $2
      ORDER BY mgt.match_group_id, CASE WHEN mgt.side = 'left' THEN 0 ELSE 1 END, t.id`,
      [reconciliationRunId, dealershipId],
    );
    const exceptionRows = await this.pool.query<ReconciliationExceptionRow>(
      `SELECT
        re.id AS exception_id,
        re.dealership_id,
        re.source_type AS exception_source_type,
        re.reason,
       re.status,
       re.note,
       re.review_status,
       re.assigned_to,
       re.review_notes,
       COALESCE(re.boa_notes, '') AS boa_notes,
       COALESCE(re.gl_notes, '') AS gl_notes,
       re.reviewed_at,
       re.reviewed_by,
       re.created_at AS exception_created_at,
        t.*
      FROM reconciliation_exceptions re
      JOIN transactions t ON t.id = re.transaction_id
      WHERE re.reconciliation_run_id = $1
        AND re.dealership_id = $2
      ORDER BY re.id`,
      [reconciliationRunId, dealershipId],
    );
    const runTransactionRows = await this.pool.query<TransactionRow>(
      `SELECT *
       FROM transactions
       WHERE dealership_id = $1
         AND source_file_id IN ($2, $3)
       ORDER BY id`,
      [dealershipId, runRow.boa_source_file_id, runRow.dealertrack_source_file_id],
    );

    const matchGroups = matchGroupRows.rows.map((matchGroup) => ({
      match_group_id: matchGroup.id,
      match_type: matchGroup.match_type,
      confidence: Number(matchGroup.confidence),
      reason: matchGroup.reason,
      created_at: toDateTimeString(matchGroup.created_at),
      transactions: matchGroupTransactionRows.rows
        .filter((row) => row.match_group_id === matchGroup.id)
        .map((row) => ({
          side: row.side,
          source_type: row.linked_source_type,
          transaction: toTransactionSummary(toTransaction(row)),
        })),
    }));
    const exceptions = exceptionRows.rows.map((row) => ({
      exception_id: row.exception_id,
      dealership_id: row.dealership_id,
      exception_type: exceptionTypeFromReason(row.reason),
      exception_category: "unclassified" as const,
      status: row.status,
      note: row.note,
      review_status: row.review_status,
      assigned_to: row.assigned_to,
      review_notes: row.review_notes,
      boa_notes: row.boa_notes ?? "",
      gl_notes: row.gl_notes ?? "",
      reviewed_at: row.reviewed_at ? toDateTimeString(row.reviewed_at) : null,
      reviewed_by: row.reviewed_by,
      source_type: row.exception_source_type,
      reason: row.reason,
      created_at: toDateTimeString(row.exception_created_at),
      transaction: toTransactionSummary(toTransaction(row)),
    }));
    const runTransactions = runTransactionRows.rows.map(toTransaction);
    const categorizedExceptions = categorizeRunDetailExceptions(
      { exceptions, match_groups: matchGroups },
      runTransactions.filter((transaction) => transaction.source_file_id === runRow.boa_source_file_id),
      runTransactions.filter(
        (transaction) => transaction.source_file_id === runRow.dealertrack_source_file_id,
      ),
    ).filter((exception) => matchesExceptionFilters(exception, filters));

    return {
      ...toReconciliationRunListItem(runRow),
      boa_source_file: toSourceFileSummary({
        id: runRow.boa_source_file_id,
        dealership_id: runRow.dealership_id,
        dealership_store_id: runRow.dealership_store_id,
        store_name: runRow.store_name,
        source_type: runRow.boa_source_type,
        original_filename: runRow.boa_original_filename,
        stored_filename: runRow.boa_stored_filename,
        file_hash: "",
        row_count: Number(runRow.boa_row_count),
        validation_error_count: Number(runRow.boa_validation_error_count),
        created_at: toDateTimeString(runRow.boa_created_at),
      }),
      dealertrack_source_file: toSourceFileSummary({
        id: runRow.dealertrack_source_file_id,
        dealership_id: runRow.dealership_id,
        dealership_store_id: runRow.dealership_store_id,
        store_name: runRow.store_name,
        source_type: runRow.dealertrack_source_type,
        original_filename: runRow.dealertrack_original_filename,
        stored_filename: runRow.dealertrack_stored_filename,
        file_hash: "",
        row_count: Number(runRow.dealertrack_row_count),
        validation_error_count: Number(runRow.dealertrack_validation_error_count),
        created_at: toDateTimeString(runRow.dealertrack_created_at),
      }),
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
    const current = await this.pool.query<{ id: number }>(
      `SELECT id
       FROM reconciliation_exceptions
       WHERE reconciliation_run_id = $1
         AND id = $2
         AND dealership_id = $3`,
      [reconciliationRunId, exceptionId, dealershipId],
    );
    if (!current.rows[0]) {
      return null;
    }

    const reviewNotesValue = update.review_notes ?? update.note ?? null;
    const result = await this.pool.query<ReconciliationExceptionRow>(
      `UPDATE reconciliation_exceptions
       SET
         review_status = COALESCE($3, review_status),
         status = COALESCE($4, status),
         assigned_to = CASE WHEN $5::boolean THEN $6 ELSE assigned_to END,
         review_notes = COALESCE($7, review_notes),
         note = COALESCE($8, note),
         boa_notes = CASE
           WHEN $12::text IS NOT NULL THEN $12
           WHEN $7::text IS NOT NULL AND reconciliation_exceptions.source_type = 'boa' THEN $7
           ELSE COALESCE(boa_notes, '')
         END,
         gl_notes = CASE
           WHEN $13::text IS NOT NULL THEN $13
           WHEN $7::text IS NOT NULL AND reconciliation_exceptions.source_type IN ('dealertrack', 'dms', 'gl') THEN $7
           ELSE COALESCE(gl_notes, '')
         END,
         reviewed_by = CASE WHEN $9::boolean THEN $10 ELSE reviewed_by END,
         reviewed_at = CASE
           WHEN COALESCE($3, review_status) IN ('resolved', 'ignored')
            AND (reviewed_at IS NULL OR $3 IS NOT NULL OR $10 IS NOT NULL)
           THEN NOW()
           ELSE reviewed_at
         END
       FROM transactions t
       WHERE reconciliation_exceptions.reconciliation_run_id = $1
         AND reconciliation_exceptions.id = $2
         AND reconciliation_exceptions.dealership_id = $11
         AND t.id = reconciliation_exceptions.transaction_id
       RETURNING
         reconciliation_exceptions.id AS exception_id,
         reconciliation_exceptions.source_type AS exception_source_type,
         reconciliation_exceptions.reason,
         reconciliation_exceptions.status,
         reconciliation_exceptions.note,
         reconciliation_exceptions.review_status,
         reconciliation_exceptions.assigned_to,
         reconciliation_exceptions.review_notes,
         COALESCE(reconciliation_exceptions.boa_notes, '') AS boa_notes,
         COALESCE(reconciliation_exceptions.gl_notes, '') AS gl_notes,
         reconciliation_exceptions.reviewed_at,
         reconciliation_exceptions.reviewed_by,
         reconciliation_exceptions.created_at AS exception_created_at,
         t.*`,
      [
        reconciliationRunId,
        exceptionId,
        update.review_status ?? (update.status ? reviewStatusFromLegacyStatus(update.status) : null),
        update.review_status ? legacyStatusFromReviewStatus(update.review_status) : update.status ?? null,
        update.assigned_to !== undefined,
        normalizeNullableText(update.assigned_to ?? null),
        reviewNotesValue,
        reviewNotesValue,
        update.reviewed_by !== undefined,
        normalizeNullableText(update.reviewed_by ?? null),
        dealershipId,
        update.boa_notes ?? null,
        update.gl_notes ?? null,
      ],
    );

    const row = result.rows[0];

    return {
      exception_id: row.exception_id,
      dealership_id: row.dealership_id,
      exception_type: exceptionTypeFromReason(row.reason),
      exception_category: "unclassified",
      status: row.status,
      note: row.note,
      review_status: row.review_status,
      assigned_to: row.assigned_to,
      review_notes: row.review_notes,
      boa_notes: row.boa_notes ?? "",
      gl_notes: row.gl_notes ?? "",
      reviewed_at: row.reviewed_at ? toDateTimeString(row.reviewed_at) : null,
      reviewed_by: row.reviewed_by,
      source_type: row.exception_source_type,
      reason: row.reason,
      created_at: toDateTimeString(row.exception_created_at),
      transaction: toTransactionSummary(toTransaction(row)),
    };
  }

  async listPriorUnresolvedExceptions(
    dealershipId: number,
    options: {
      dealershipStoreId: number | null;
      excludeRunId: number;
      createdBefore?: string;
    },
  ): Promise<PriorExceptionRecord[]> {
    const result = await this.pool.query<{
      exception_id: number;
      reconciliation_run_id: number;
      dealership_store_id: number | null;
      source_type: SourceType;
      amount_cents: string | number;
      vin: string | null;
      stock_number: string | null;
      reference_number: string | null;
      description: string | null;
      boa_notes: string | null;
      gl_notes: string | null;
      review_notes: string | null;
      created_at: Date | string;
    }>(
      `SELECT
         re.id AS exception_id,
         re.reconciliation_run_id,
         rr.dealership_store_id,
         re.source_type,
         t.amount_cents,
         t.vin,
         t.stock_number,
         t.reference_number,
         t.description,
         COALESCE(re.boa_notes, '') AS boa_notes,
         COALESCE(re.gl_notes, '') AS gl_notes,
         COALESCE(re.review_notes, '') AS review_notes,
         rr.created_at
       FROM reconciliation_exceptions re
       JOIN reconciliation_runs rr ON rr.id = re.reconciliation_run_id
       JOIN transactions t ON t.id = re.transaction_id
       WHERE re.dealership_id = $1
         AND rr.dealership_id = $1
         AND re.reconciliation_run_id <> $2
         AND re.status = 'unresolved'
         AND (
           ($3::integer IS NULL AND rr.dealership_store_id IS NULL)
           OR ($3::integer IS NOT NULL AND rr.dealership_store_id = $3)
         )
         AND ($4::timestamptz IS NULL OR rr.created_at < $4)
       ORDER BY rr.created_at, re.id`,
      [
        dealershipId,
        options.excludeRunId,
        options.dealershipStoreId,
        options.createdBefore ?? null,
      ],
    );
    return result.rows.map((row) => ({
      exception_id: row.exception_id,
      reconciliation_run_id: row.reconciliation_run_id,
      dealership_store_id: row.dealership_store_id,
      source_type: row.source_type,
      amount_cents: Number(row.amount_cents),
      vin: row.vin,
      stock_number: row.stock_number,
      reference_number: row.reference_number,
      description: row.description,
      boa_notes: row.boa_notes ?? "",
      gl_notes: row.gl_notes ?? "",
      review_notes: row.review_notes ?? "",
      created_at: toDateTimeString(row.created_at),
    }));
  }

  async getReconciliationExceptionDealershipId(
    reconciliationRunId: number,
    exceptionId: number,
  ): Promise<number | null> {
    const result = await this.pool.query<{ dealership_id: number }>(
      `SELECT dealership_id
       FROM reconciliation_exceptions
       WHERE reconciliation_run_id = $1
         AND id = $2`,
      [reconciliationRunId, exceptionId],
    );
    return result.rows[0]?.dealership_id ?? null;
  }
}

export function createPool(databaseUrl: string): pg.Pool {
  return new pg.Pool({ connectionString: databaseUrl });
}

function buildAccountSummaries(
  rows: AccountSourceTotalRow[],
  unresolvedExceptionCounts: Map<string, number>,
): AccountSummary[] {
  const grouped = new Map<
    string,
    {
      account_identifier: string;
      account_type: string;
      source_totals: AccountSourceTotal[];
      net_difference_amount_cents: number;
    }
  >();

  for (const row of rows) {
    const key = accountKey(row.account_identifier, row.account_type);
    const account =
      grouped.get(key) ??
      {
        account_identifier: row.account_identifier,
        account_type: row.account_type,
        source_totals: [],
        net_difference_amount_cents: 0,
      };
    const amountCents = Number(row.amount_cents);
    account.source_totals.push({
      source_type: row.source_type,
      amount_cents: amountCents,
      amount: formatCents(amountCents),
      transaction_count: Number(row.transaction_count),
    });
    account.net_difference_amount_cents += amountCents;
    grouped.set(key, account);
  }

  return Array.from(grouped.values())
    .map((account) => ({
      ...account,
      source_totals: account.source_totals.sort((left, right) =>
        left.source_type.localeCompare(right.source_type),
      ),
      net_difference_amount: formatCents(account.net_difference_amount_cents),
      unresolved_exception_count:
        unresolvedExceptionCounts.get(accountKey(account.account_identifier, account.account_type)) ??
        0,
    }))
    .sort((left, right) => left.account_identifier.localeCompare(right.account_identifier));
}

function buildReportAccountSummaries(
  rows: AccountSourceTotalRow[],
  exceptionCountRows: ReportExceptionCountRow[],
): MonthEndReportAccount[] {
  const exceptionCounts = new Map<
    string,
    Record<ReconciliationExceptionStatus, number>
  >();
  for (const row of exceptionCountRows) {
    const key = accountKey(row.account_identifier, row.account_type);
    const current =
      exceptionCounts.get(key) ?? { unresolved: 0, resolved: 0, ignored: 0 };
    current[row.status] = Number(row.exception_count);
    exceptionCounts.set(key, current);
  }

  return buildAccountSummaries(
    rows,
    new Map(
      Array.from(exceptionCounts.entries()).map(([key, counts]) => [key, counts.unresolved]),
    ),
  ).map((account) => {
    const counts =
      exceptionCounts.get(accountKey(account.account_identifier, account.account_type)) ??
      { unresolved: 0, resolved: 0, ignored: 0 };
    return {
      ...account,
      unresolved_exception_count: counts.unresolved,
      resolved_exception_count: counts.resolved,
      ignored_exception_count: counts.ignored,
    };
  });
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

function toReconciliationExceptionDetail(
  row: ReconciliationExceptionRow,
): ReconciliationRunDetail["exceptions"][number] {
  return {
    exception_id: row.exception_id,
    dealership_id: row.dealership_id,
    exception_type: exceptionTypeFromReason(row.reason),
    exception_category: "unclassified",
    status: row.status,
    note: row.note,
    review_status: row.review_status,
    assigned_to: row.assigned_to,
    review_notes: row.review_notes,
    boa_notes: row.boa_notes ?? "",
    gl_notes: row.gl_notes ?? "",
    reviewed_at: row.reviewed_at ? toDateTimeString(row.reviewed_at) : null,
    reviewed_by: row.reviewed_by,
    source_type: row.exception_source_type,
    reason: row.reason,
    created_at: toDateTimeString(row.exception_created_at),
    transaction: toTransactionSummary(toTransaction(row)),
  };
}


function accountKey(accountIdentifier: string, accountType: string): string {
  return `${accountIdentifier}\u0000${accountType}`;
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

async function insertSourceFile(
  client: pg.PoolClient,
  dealershipId: number,
  sourceFile: NewSourceFile,
): Promise<SourceFile> {
  const result = await client.query<SourceFileRow>(
    `INSERT INTO source_files (
      dealership_id,
      dealership_store_id,
      source_type,
      original_filename,
      stored_filename,
      file_hash,
      row_count,
      validation_error_count
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *`,
    [
      dealershipId,
      sourceFile.dealership_store_id,
      sourceFile.source_type,
      sourceFile.original_filename,
      sourceFile.stored_filename,
      sourceFile.file_hash,
      sourceFile.row_count,
      sourceFile.validation_error_count,
    ],
  );
  return toSourceFile(result.rows[0]);
}

async function upsertSourceFileUploadContent(
  client: pg.PoolClient,
  sourceFile: SourceFile,
  content: NewSourceFileUploadContent,
): Promise<void> {
  await client.query(
    `INSERT INTO source_file_upload_contents (
      source_file_id,
      dealership_id,
      dealership_store_id,
      filename,
      content_type,
      file_size_bytes,
      content
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (source_file_id)
    DO UPDATE SET
      dealership_id = EXCLUDED.dealership_id,
      dealership_store_id = EXCLUDED.dealership_store_id,
      filename = EXCLUDED.filename,
      content_type = EXCLUDED.content_type,
      file_size_bytes = EXCLUDED.file_size_bytes,
      content = EXCLUDED.content,
      created_at = NOW()`,
    [
      sourceFile.id,
      sourceFile.dealership_id,
      sourceFile.dealership_store_id,
      content.filename,
      content.content_type,
      content.file_size ?? content.content.byteLength,
      content.content,
    ],
  );
}

async function insertTransactions(
  client: pg.PoolClient,
  transactions: NewTransaction[],
): Promise<Transaction[]> {
  const inserted: Transaction[] = [];

  for (const transaction of transactions) {
    const result = await client.query<TransactionRow>(
      `INSERT INTO transactions (
        dealership_id,
        source_file_id,
        source_type,
        transaction_date,
        post_date,
        amount_cents,
        reference_number,
        description,
        account,
        account_type,
        account_identifier,
        stock_number,
        vin,
        raw_data
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *`,
      [
        (transaction as NewTransaction & { dealership_id?: number }).dealership_id ?? 1,
        transaction.source_file_id,
        transaction.source_type,
        transaction.transaction_date,
        transaction.post_date,
        transaction.amount_cents,
        transaction.reference_number,
        transaction.description,
        transaction.account,
        transaction.account_type ?? defaultAccountType(transaction.source_type),
        transaction.account_identifier ??
          transaction.account ??
          defaultAccountIdentifier(transaction.source_type),
        transaction.stock_number,
        transaction.vin,
        transaction.raw_data,
      ],
    );
    inserted.push(toTransaction(result.rows[0]));
  }

  return inserted;
}

async function insertReconciliationRun(
  client: pg.PoolClient,
  input: PersistReconciliationRunInput,
): Promise<ReconciliationRun> {
  const result = await client.query<ReconciliationRunRow>(
      `INSERT INTO reconciliation_runs (
      dealership_id,
      dealership_store_id,
      boa_source_file_id,
      dealertrack_source_file_id,
      matched_count,
      exception_count,
      duplicate_count,
      status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *`,
    [
      input.dealership_id,
      input.dealership_store_id,
      input.boa_source_file_id,
      input.dealertrack_source_file_id,
      input.result.matched_count,
      input.result.exception_count,
      input.result.duplicate_count,
      input.status ?? "completed",
    ],
  );
  return toReconciliationRun(result.rows[0]);
}

function toSourceFile(row: SourceFileRow): SourceFile {
  return {
    id: row.id,
    dealership_id: row.dealership_id,
    dealership_store_id: row.dealership_store_id,
    store_name: row.store_name ?? null,
    source_type: row.source_type,
    original_filename: row.original_filename,
    stored_filename: row.stored_filename,
    file_hash: row.file_hash,
    row_count: Number(row.row_count),
    validation_error_count: Number(row.validation_error_count),
    created_at: toDateTimeString(row.created_at),
  };
}

function toSourceFileUploadContent(row: SourceFileUploadContentRow): SourceFileUploadContent {
  return {
    source_file_id: row.source_file_id,
    dealership_id: row.dealership_id,
    dealership_store_id: row.dealership_store_id,
    filename: row.filename,
    content_type: row.content_type,
    file_size: Number(row.file_size_bytes),
    content: Buffer.from(row.content),
    created_at: toDateTimeString(row.created_at),
  };
}

function toReconciliationArtifactMetadata(
  row: ReconciliationArtifactRow,
): ReconciliationArtifactMetadata {
  return {
    id: row.id,
    reconciliation_run_id: row.reconciliation_run_id,
    dealership_id: row.dealership_id,
    store_id: row.dealership_store_id,
    accounting_month: row.accounting_month,
    uploaded_by: row.uploaded_by_user_id,
    artifact_type: row.artifact_type,
    filename: row.filename,
    file_size: Number(row.file_size_bytes),
    content_type: row.content_type,
    created_at: toDateTimeString(row.created_at),
  };
}

function toReconciliationArtifact(row: ReconciliationArtifactRow): ReconciliationArtifact {
  return {
    ...toReconciliationArtifactMetadata(row),
    content: Buffer.from(row.content),
  };
}

function toSourceFileSummary(sourceFile: SourceFile): SourceFileSummary {
  return {
    source_file_id: sourceFile.id,
    dealership_id: sourceFile.dealership_id,
    dealership_store_id: sourceFile.dealership_store_id,
    store_name: sourceFile.store_name ?? null,
    source_type: sourceFile.source_type,
    filename: sourceFile.original_filename,
    row_count: sourceFile.row_count,
    validation_error_count: sourceFile.validation_error_count,
    created_at: sourceFile.created_at,
  };
}

function toDealerGroup(row: DealerGroupRow): DealerGroup {
  return {
    id: row.id,
    dealership_id: row.dealership_id,
    name: row.name,
    created_at: toDateTimeString(row.created_at),
  };
}

function toDealershipStore(row: DealershipStoreRow): DealershipStore {
  return {
    id: row.id,
    dealership_id: row.dealership_id,
    dealer_group_id: row.dealer_group_id,
    name: row.name,
    created_at: toDateTimeString(row.created_at),
  };
}

function toScheduledReconciliationJob(
  row: ScheduledReconciliationJobRow,
): ScheduledReconciliationJob {
  return {
    id: row.id,
    dealership_id: row.dealership_id,
    dealership_store_id: row.dealership_store_id,
    store_name: row.store_name ?? null,
    cadence: row.cadence,
    expected_source_types: row.expected_source_types,
    enabled: row.enabled,
    auto_run_on_pair: row.auto_run_on_pair,
    last_run_at: row.last_run_at ? toDateTimeString(row.last_run_at) : null,
    next_run_at: row.next_run_at ? toDateTimeString(row.next_run_at) : null,
    created_at: toDateTimeString(row.created_at),
    updated_at: toDateTimeString(row.updated_at),
  };
}

function toIngestionEvent(row: IngestionEventRow): IngestionEvent {
  return {
    id: row.id,
    dealership_id: row.dealership_id,
    dealership_store_id: row.dealership_store_id,
    store_name: row.store_name ?? null,
    source_file_id: row.source_file_id,
    reconciliation_run_id: row.reconciliation_run_id,
    source_type: row.source_type,
    state: row.state,
    message: row.message,
    metadata: row.metadata,
    created_at: toDateTimeString(row.created_at),
  };
}

function toOperationalEvent(row: OperationalEventRow): OperationalEvent {
  return {
    id: row.id,
    dealership_id: row.dealership_id,
    dealership_store_id: row.dealership_store_id,
    store_name: row.store_name ?? null,
    reconciliation_run_id: row.reconciliation_run_id,
    event_type: row.event_type,
    severity: row.severity,
    message: row.message,
    metadata: row.metadata,
    created_at: toDateTimeString(row.created_at),
  };
}

function toAuditEvent(row: AuditEventRow): AuditEvent {
  return {
    id: row.id,
    dealership_id: row.dealership_id,
    actor_user_id: row.actor_user_id,
    action_type: row.action_type,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    previous_state: row.previous_state,
    new_state: row.new_state,
    timestamp: toDateTimeString(row.timestamp),
  };
}

function toReconciliationRun(row: ReconciliationRunRow): ReconciliationRun {
  return {
    id: row.id,
    dealership_id: row.dealership_id,
    dealership_store_id: row.dealership_store_id,
    boa_source_file_id: row.boa_source_file_id,
    dealertrack_source_file_id: row.dealertrack_source_file_id,
    matched_count: Number(row.matched_count),
    exception_count: Number(row.exception_count),
    duplicate_count: Number(row.duplicate_count),
    status: row.status,
    created_at: toDateTimeString(row.created_at),
  };
}

function toReconciliationRunListItem(row: ReconciliationRunListRow): ReconciliationRunListItem {
  return {
    reconciliation_run_id: row.id,
    dealership_id: row.dealership_id,
    dealership_store_id: row.dealership_store_id,
    store_name: row.store_name ?? null,
    dealer_group_id: row.dealer_group_id ?? null,
    dealer_group_name: row.dealer_group_name ?? null,
    boa_source_file_id: row.boa_source_file_id,
    dealertrack_source_file_id: row.dealertrack_source_file_id,
    boa_filename: row.boa_filename,
    dealertrack_filename: row.dealertrack_filename,
    matched_count: Number(row.matched_count),
    exception_count: Number(row.exception_count),
    duplicate_count: Number(row.duplicate_count),
    status: row.status,
    created_at: toDateTimeString(row.created_at),
  };
}

function toTransaction(row: TransactionRow): Transaction {
  return {
    id: row.id,
    dealership_id: row.dealership_id,
    source_file_id: row.source_file_id,
    source_type: row.source_type,
    transaction_date: toDateString(row.transaction_date),
    post_date: toDateString(row.post_date),
    amount_cents: Number(row.amount_cents),
    reference_number: row.reference_number,
    description: row.description,
    account: row.account,
    account_type: row.account_type,
    account_identifier: row.account_identifier,
    stock_number: row.stock_number,
    vin: row.vin,
    raw_data: row.raw_data,
  };
}

function normalizeSnapshotTransaction(transaction: Transaction): Transaction {
  return {
    ...transaction,
    amount_cents: Number(transaction.amount_cents),
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

function toDateTimeString(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value;
}

function toDateString(value: Date | string | null): string | null {
  if (value === null) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return value;
}

function isDuplicateSourceFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505" &&
    "constraint" in error &&
    (error.constraint === "ux_source_files_source_type_file_hash" ||
      error.constraint === "ux_source_files_dealership_source_type_file_hash")
  );
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
