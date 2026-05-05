import pg from "pg";

import { formatCents } from "../domain/money.js";
import type {
  NewSourceFile,
  NewTransaction,
  PersistReconciliationRunInput,
  ReconciliationExceptionReviewUpdate,
  ReconciliationExceptionStatus,
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
import {
  DuplicateSourceFileError,
  type SourceFileImport,
  type TransactionRepository,
} from "./transactionRepository.js";

type SourceFileRow = {
  id: number;
  source_type: SourceType;
  original_filename: string;
  stored_filename: string | null;
  file_hash: string;
  row_count: number;
  validation_error_count: number;
  created_at: Date | string;
};

type TransactionRow = {
  id: number;
  source_file_id: number | null;
  source_type: SourceType;
  transaction_date: Date | string | null;
  post_date: Date | string | null;
  amount_cents: string;
  reference_number: string | null;
  description: string | null;
  account: string | null;
  stock_number: string | null;
  vin: string | null;
  raw_data: Record<string, unknown>;
};

type ReconciliationRunRow = {
  id: number;
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
  exception_created_at: Date | string;
};

export class PostgresTransactionRepository implements TransactionRepository {
  constructor(private readonly pool: pg.Pool) {}

  async createSourceFileWithTransactions(
    sourceFileInput: NewSourceFile,
    transactions: NewTransaction[],
  ): Promise<SourceFileImport> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const sourceFile = await insertSourceFile(client, sourceFileInput);
      const scopedTransactions = transactions.map((transaction) => ({
        ...transaction,
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
    const result = await this.pool.query<SourceFileRow>("SELECT * FROM source_files WHERE id = $1", [
      sourceFileId,
    ]);
    return result.rows[0] ? toSourceFile(result.rows[0]) : null;
  }

  async getSourceFileByHash(sourceType: SourceType, fileHash: string): Promise<SourceFile | null> {
    const result = await this.pool.query<SourceFileRow>(
      "SELECT * FROM source_files WHERE source_type = $1 AND file_hash = $2",
      [sourceType, fileHash],
    );
    return result.rows[0] ? toSourceFile(result.rows[0]) : null;
  }

  async listSourceFiles(sourceType?: SourceType): Promise<SourceFileSummary[]> {
    const result =
      sourceType === undefined
        ? await this.pool.query<SourceFileRow>(
            "SELECT * FROM source_files ORDER BY created_at DESC, id DESC",
          )
        : await this.pool.query<SourceFileRow>(
            "SELECT * FROM source_files WHERE source_type = $1 ORDER BY created_at DESC, id DESC",
            [sourceType],
          );
    return result.rows.map((row) => toSourceFileSummary(toSourceFile(row)));
  }

  async listBySource(sourceType: SourceType): Promise<Transaction[]> {
    const result = await this.pool.query<TransactionRow>(
      "SELECT * FROM transactions WHERE source_type = $1 ORDER BY id",
      [sourceType],
    );
    return result.rows.map(toTransaction);
  }

  async listBySourceFile(sourceFileId: number): Promise<Transaction[]> {
    const result = await this.pool.query<TransactionRow>(
      "SELECT * FROM transactions WHERE source_file_id = $1 ORDER BY id",
      [sourceFileId],
    );
    return result.rows.map(toTransaction);
  }

  async createReconciliationRun(
    input: PersistReconciliationRunInput,
  ): Promise<ReconciliationRun> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const run = await insertReconciliationRun(client, input);

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
            reconciliation_run_id,
            transaction_id,
            source_type,
            reason
          ) VALUES ($1, $2, $3, $4)`,
          [run.id, exception.transaction.id, exception.source_type, exception.description],
        );
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

  async listReconciliationRuns(): Promise<ReconciliationRunListItem[]> {
    const result = await this.pool.query<ReconciliationRunListRow>(
      `SELECT
        rr.*,
        boa.original_filename AS boa_filename,
        dealertrack.original_filename AS dealertrack_filename
      FROM reconciliation_runs rr
      JOIN source_files boa ON boa.id = rr.boa_source_file_id
      JOIN source_files dealertrack ON dealertrack.id = rr.dealertrack_source_file_id
      ORDER BY rr.created_at DESC, rr.id DESC`,
    );
    return result.rows.map(toReconciliationRunListItem);
  }

  async getReconciliationRunDetail(
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
      WHERE rr.id = $1`,
      [reconciliationRunId],
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
      ORDER BY mgt.match_group_id, CASE WHEN mgt.side = 'left' THEN 0 ELSE 1 END, t.id`,
      [reconciliationRunId],
    );
    const exceptionRows = await this.pool.query<ReconciliationExceptionRow>(
      `SELECT
        re.id AS exception_id,
        re.source_type AS exception_source_type,
        re.reason,
        re.status,
        re.note,
        re.created_at AS exception_created_at,
        t.*
      FROM reconciliation_exceptions re
      JOIN transactions t ON t.id = re.transaction_id
      WHERE re.reconciliation_run_id = $1
      ORDER BY re.id`,
      [reconciliationRunId],
    );

    return {
      ...toReconciliationRunListItem(runRow),
      boa_source_file: toSourceFileSummary({
        id: runRow.boa_source_file_id,
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
        source_type: runRow.dealertrack_source_type,
        original_filename: runRow.dealertrack_original_filename,
        stored_filename: runRow.dealertrack_stored_filename,
        file_hash: "",
        row_count: Number(runRow.dealertrack_row_count),
        validation_error_count: Number(runRow.dealertrack_validation_error_count),
        created_at: toDateTimeString(runRow.dealertrack_created_at),
      }),
      match_groups: matchGroupRows.rows.map((matchGroup) => ({
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
      })),
      exceptions: exceptionRows.rows.map((row) => ({
        exception_id: row.exception_id,
        exception_type: exceptionTypeFromReason(row.reason),
        status: row.status,
        note: row.note,
        source_type: row.exception_source_type,
        reason: row.reason,
        created_at: toDateTimeString(row.exception_created_at),
        transaction: toTransactionSummary(toTransaction(row)),
      })).filter((exception) => matchesExceptionFilters(exception, filters)),
    };
  }

  async updateReconciliationExceptionReview(
    reconciliationRunId: number,
    exceptionId: number,
    update: ReconciliationExceptionReviewUpdate,
  ): Promise<ReconciliationRunDetail["exceptions"][number] | null> {
    const current = await this.pool.query<{ id: number }>(
      `SELECT id
       FROM reconciliation_exceptions
       WHERE reconciliation_run_id = $1
         AND id = $2`,
      [reconciliationRunId, exceptionId],
    );
    if (!current.rows[0]) {
      return null;
    }

    const result = await this.pool.query<ReconciliationExceptionRow>(
      `UPDATE reconciliation_exceptions
       SET
         status = COALESCE($3, status),
         note = COALESCE($4, note)
       FROM transactions t
       WHERE reconciliation_exceptions.reconciliation_run_id = $1
         AND reconciliation_exceptions.id = $2
         AND t.id = reconciliation_exceptions.transaction_id
       RETURNING
         reconciliation_exceptions.id AS exception_id,
         reconciliation_exceptions.source_type AS exception_source_type,
         reconciliation_exceptions.reason,
         reconciliation_exceptions.status,
         reconciliation_exceptions.note,
         reconciliation_exceptions.created_at AS exception_created_at,
         t.*`,
      [reconciliationRunId, exceptionId, update.status ?? null, update.note ?? null],
    );

    const row = result.rows[0];

    return {
      exception_id: row.exception_id,
      exception_type: exceptionTypeFromReason(row.reason),
      status: row.status,
      note: row.note,
      source_type: row.exception_source_type,
      reason: row.reason,
      created_at: toDateTimeString(row.exception_created_at),
      transaction: toTransactionSummary(toTransaction(row)),
    };
  }
}

export function createPool(databaseUrl: string): pg.Pool {
  return new pg.Pool({ connectionString: databaseUrl });
}

async function insertSourceFile(
  client: pg.PoolClient,
  sourceFile: NewSourceFile,
): Promise<SourceFile> {
  const result = await client.query<SourceFileRow>(
    `INSERT INTO source_files (
      source_type,
      original_filename,
      stored_filename,
      file_hash,
      row_count,
      validation_error_count
    ) VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *`,
    [
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

async function insertTransactions(
  client: pg.PoolClient,
  transactions: NewTransaction[],
): Promise<Transaction[]> {
  const inserted: Transaction[] = [];

  for (const transaction of transactions) {
    const result = await client.query<TransactionRow>(
      `INSERT INTO transactions (
        source_file_id,
        source_type,
        transaction_date,
        post_date,
        amount_cents,
        reference_number,
        description,
        account,
        stock_number,
        vin,
        raw_data
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
      [
        transaction.source_file_id,
        transaction.source_type,
        transaction.transaction_date,
        transaction.post_date,
        transaction.amount_cents,
        transaction.reference_number,
        transaction.description,
        transaction.account,
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
      boa_source_file_id,
      dealertrack_source_file_id,
      matched_count,
      exception_count,
      duplicate_count,
      status
    ) VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *`,
    [
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
    source_type: row.source_type,
    original_filename: row.original_filename,
    stored_filename: row.stored_filename,
    file_hash: row.file_hash,
    row_count: Number(row.row_count),
    validation_error_count: Number(row.validation_error_count),
    created_at: toDateTimeString(row.created_at),
  };
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

function toReconciliationRun(row: ReconciliationRunRow): ReconciliationRun {
  return {
    id: row.id,
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
    source_file_id: row.source_file_id,
    source_type: row.source_type,
    transaction_date: toDateString(row.transaction_date),
    post_date: toDateString(row.post_date),
    amount_cents: Number(row.amount_cents),
    reference_number: row.reference_number,
    description: row.description,
    account: row.account,
    stock_number: row.stock_number,
    vin: row.vin,
    raw_data: row.raw_data,
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
    error.constraint === "ux_source_files_source_type_file_hash"
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
