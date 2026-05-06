import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";

import cors from "cors";
import express from "express";
import multer, { MulterError } from "multer";

import {
  isReconciliationExceptionStatus,
  isReconciliationExceptionType,
  isSourceType,
  type ReconciliationRequest,
  type ReconciliationExceptionReviewUpdate,
  type ReconciliationRunDetail,
  type ReconciliationRunDetailFilters,
} from "./domain/types.js";
import {
  DuplicateSourceFileError,
  type TransactionRepository,
} from "./repositories/transactionRepository.js";
import { reconcileTransactions } from "./services/reconciliationEngine.js";
import {
  CsvNormalizationError,
  normalizeTransactionsFromCsv,
} from "./services/transactionNormalizer.js";
import { logError, logInfo, serializeError } from "./logger.js";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const allowedCsvMimeTypes = new Set([
  "text/csv",
  "application/csv",
  "application/vnd.ms-excel",
  "text/plain",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: 1,
  },
  fileFilter: (_request, file, callback) => {
    const hasCsvExtension = /\.csv$/i.test(file.originalname);
    const hasCsvMimeType = allowedCsvMimeTypes.has(file.mimetype);
    if (!hasCsvExtension || !hasCsvMimeType) {
      callback(new AppHttpError("Upload must be a CSV file.", 422));
      return;
    }
    callback(null, true);
  },
});

export function createApp(
  repository: TransactionRepository,
  corsOrigins: string[] = [],
  dealershipId = 1,
  readinessCheck: () => Promise<void> = async () => undefined,
) {
  const app = express();

  app.use(requestLogger);
  app.use(express.json());
  app.use(
    cors({
      origin: corsOrigins.length > 0 ? corsOrigins : true,
      credentials: true,
    }),
  );

  app.get("/health", (_request, response) => {
    response.json({ status: "ok" });
  });

  app.get("/ready", async (_request, response) => {
    try {
      await readinessCheck();
      response.json({ status: "ready" });
    } catch (error) {
      logError("readiness_check_failed", serializeError(error));
      response.status(503).json({ status: "not_ready" });
    }
  });

  app.get("/source-files", async (request, response, next) => {
    try {
      const sourceType = parseSourceTypeQuery(request.query.source_type);
      if (sourceType === false) {
        response.status(422).json({ detail: "Invalid source_type." });
        return;
      }

      response.json(await repository.listSourceFiles(dealershipId, sourceType));
    } catch (error) {
      next(error);
    }
  });

  app.get("/accounts/summary", async (_request, response, next) => {
    try {
      response.json(await repository.listAccountsSummary(dealershipId));
    } catch (error) {
      next(error);
    }
  });

  app.get("/accounts/:account_identifier", async (request, response, next) => {
    try {
      const accountIdentifier = request.params.account_identifier?.trim();
      if (!accountIdentifier) {
        response.status(404).json({ detail: "Account was not found." });
        return;
      }

      const detail = await repository.getAccountDetail(dealershipId, accountIdentifier);
      if (!detail) {
        response.status(404).json({ detail: "Account was not found." });
        return;
      }

      response.json(detail);
    } catch (error) {
      next(error);
    }
  });

  app.post("/upload", upload.single("file"), async (request, response, next) => {
    try {
      const sourceType = request.body.source_type;
      if (!isSourceType(sourceType)) {
        response.status(422).json({ detail: "Invalid source_type." });
        return;
      }
      if (!request.file) {
        response.status(422).json({ detail: "File is required." });
        return;
      }

      const fileHash = createFileHash(request.file.buffer);
      const duplicateSourceFile = await repository.getSourceFileByHash(
        dealershipId,
        sourceType,
        fileHash,
      );
      if (duplicateSourceFile) {
        response.status(409).json({
          detail: "Duplicate upload detected for this source type and file contents.",
          source_file_id: duplicateSourceFile.id,
          filename: duplicateSourceFile.original_filename,
        });
        return;
      }

      const result = normalizeTransactionsFromCsv(request.file.buffer, sourceType);
      const importResult = await repository.createSourceFileWithTransactions(
        dealershipId,
        {
          source_type: sourceType,
          original_filename: request.file.originalname || "upload.csv",
          stored_filename: null,
          file_hash: fileHash,
          row_count: result.transactions.length,
          validation_error_count: result.validationErrors.length,
        },
        result.transactions,
      );

      response.json({
        source_file_id: importResult.sourceFile.id,
        source_type: sourceType,
        filename: importResult.sourceFile.original_filename,
        transaction_count: importResult.transactions.length,
        validation_errors: result.validationErrors,
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/reconcile", async (request, response, next) => {
    try {
      const body = (request.body ?? {}) as ReconciliationRequest;
      const boaSourceFileId = parseSourceFileId(body.boa_source_file_id);
      const dealertrackSourceFileId = parseSourceFileId(body.dealertrack_source_file_id);

      if (boaSourceFileId === null) {
        response.status(422).json({ detail: "boa_source_file_id is required." });
        return;
      }
      if (dealertrackSourceFileId === null) {
        response.status(422).json({ detail: "dealertrack_source_file_id is required." });
        return;
      }

      const [boaSourceFile, dealertrackSourceFile] = await Promise.all([
        repository.getSourceFile(boaSourceFileId),
        repository.getSourceFile(dealertrackSourceFileId),
      ]);

      if (!boaSourceFile || !dealertrackSourceFile) {
        response.status(404).json({ detail: "Source file was not found." });
        return;
      }
      if (
        boaSourceFile.dealership_id !== dealershipId ||
        dealertrackSourceFile.dealership_id !== dealershipId
      ) {
        response.status(403).json({ detail: "Source file belongs to another dealership." });
        return;
      }

      if (
        boaSourceFile.source_type !== "boa" ||
        dealertrackSourceFile.source_type !== "dealertrack"
      ) {
        response.status(400).json({
          detail:
            "boa_source_file_id must reference a BOA upload and dealertrack_source_file_id must reference a Dealertrack upload.",
        });
        return;
      }

      const result = await reconcileTransactions(repository, "boa", "dealertrack", {
        dealershipId,
        leftSourceFileId: boaSourceFileId,
        rightSourceFileId: dealertrackSourceFileId,
      });
      const run = await repository.createReconciliationRun({
        dealership_id: dealershipId,
        boa_source_file_id: boaSourceFileId,
        dealertrack_source_file_id: dealertrackSourceFileId,
        result,
      });
      logInfo("reconciliation_run_created", {
        request_id: response.locals.requestId,
        dealership_id: dealershipId,
        reconciliation_run_id: run.id,
        boa_source_file_id: boaSourceFileId,
        dealertrack_source_file_id: dealertrackSourceFileId,
        matched_count: result.matched_count,
        exception_count: result.exception_count,
        duplicate_count: result.duplicate_count,
      });

      response.json({
        ...result,
        reconciliation_run_id: run.id,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/reconciliation-runs", async (_request, response, next) => {
    try {
      response.json(await repository.listReconciliationRuns(dealershipId));
    } catch (error) {
      next(error);
    }
  });

  app.get("/reconciliation-runs/:id", async (request, response, next) => {
    try {
      const reconciliationRunId = parsePositiveInteger(request.params.id);
      if (reconciliationRunId === null) {
        response.status(404).json({ detail: "Reconciliation run was not found." });
        return;
      }

      const filters = parseReconciliationRunDetailFilters(request.query);
      if (filters === false) {
        response.status(422).json({ detail: "Invalid reconciliation run filter." });
        return;
      }

      const detail = await repository.getReconciliationRunDetail(
        dealershipId,
        reconciliationRunId,
        filters,
      );
      if (!detail) {
        const ownerDealershipId =
          await repository.getReconciliationRunDealershipId(reconciliationRunId);
        if (ownerDealershipId !== null && ownerDealershipId !== dealershipId) {
          response.status(403).json({ detail: "Reconciliation run belongs to another dealership." });
          return;
        }
        response.status(404).json({ detail: "Reconciliation run was not found." });
        return;
      }

      response.json(detail);
    } catch (error) {
      next(error);
    }
  });

  app.get("/reconciliation-runs/:id/exceptions.csv", async (request, response, next) => {
    try {
      const reconciliationRunId = parsePositiveInteger(request.params.id);
      if (reconciliationRunId === null) {
        response.status(404).json({ detail: "Reconciliation run was not found." });
        return;
      }

      const filters = parseReconciliationRunDetailFilters(request.query);
      if (filters === false) {
        response.status(422).json({ detail: "Invalid reconciliation run filter." });
        return;
      }

      const detail = await repository.getReconciliationRunDetail(
        dealershipId,
        reconciliationRunId,
        filters,
      );
      if (!detail) {
        const ownerDealershipId =
          await repository.getReconciliationRunDealershipId(reconciliationRunId);
        if (ownerDealershipId !== null && ownerDealershipId !== dealershipId) {
          response.status(403).json({ detail: "Reconciliation run belongs to another dealership." });
          return;
        }
        response.status(404).json({ detail: "Reconciliation run was not found." });
        return;
      }

      response
        .status(200)
        .type("text/csv")
        .setHeader(
          "Content-Disposition",
          `attachment; filename="reconciliation-run-${reconciliationRunId}-exceptions.csv"`,
        )
        .send(toExceptionsCsv(detail));
    } catch (error) {
      next(error);
    }
  });

  app.patch(
    "/reconciliation-runs/:id/exceptions/:exception_id",
    async (request, response, next) => {
      try {
        const reconciliationRunId = parsePositiveInteger(request.params.id);
        const exceptionId = parsePositiveInteger(request.params.exception_id);
        if (reconciliationRunId === null || exceptionId === null) {
          response.status(404).json({ detail: "Reconciliation exception was not found." });
          return;
        }

        const update = parseExceptionReviewUpdate(request.body);
        if (update === false) {
          response.status(422).json({ detail: "Invalid exception review update." });
          return;
        }

        const exception = await repository.updateReconciliationExceptionReview(
          dealershipId,
          reconciliationRunId,
          exceptionId,
          update,
        );
        if (!exception) {
          const owner = await repository.getReconciliationExceptionDealershipId(
            reconciliationRunId,
            exceptionId,
          );
          if (owner !== null && owner !== dealershipId) {
            response
              .status(403)
              .json({ detail: "Reconciliation exception belongs to another dealership." });
            return;
          }
          response.status(404).json({ detail: "Reconciliation exception was not found." });
          return;
        }

        response.json(exception);
      } catch (error) {
        next(error);
      }
    },
  );

  app.use(
    (
      error: unknown,
      _request: express.Request,
      response: express.Response,
      _next: express.NextFunction,
    ) => {
      if (error instanceof MulterError) {
        const statusCode = error.code === "LIMIT_FILE_SIZE" ? 413 : 422;
        response.status(statusCode).json({ detail: uploadErrorMessage(error) });
        return;
      }
      if (error instanceof AppHttpError || error instanceof CsvNormalizationError) {
        response.status(error.statusCode).json({ detail: error.message });
        return;
      }
      if (error instanceof DuplicateSourceFileError) {
        response.status(409).json({ detail: error.message });
        return;
      }
      logError("request_failed", {
        request_id: response.locals.requestId,
        ...serializeError(error),
      });
      response.status(500).json({ detail: "Internal server error." });
    },
  );

  return app;
}

function requestLogger(
  request: express.Request,
  response: express.Response,
  next: express.NextFunction,
) {
  const requestId = getRequestId(request.headers["x-request-id"]);
  const startedAt = process.hrtime.bigint();
  response.locals.requestId = requestId;
  response.setHeader("X-Request-ID", requestId);

  response.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    logInfo("request_completed", {
      request_id: requestId,
      method: request.method,
      path: request.originalUrl,
      status_code: response.statusCode,
      duration_ms: Math.round(durationMs * 100) / 100,
    });
  });

  next();
}

function getRequestId(value: unknown): string {
  if (typeof value === "string" && value.trim()) {
    return value.trim().slice(0, 100);
  }
  if (Array.isArray(value) && typeof value[0] === "string" && value[0].trim()) {
    return value[0].trim().slice(0, 100);
  }
  return randomUUID();
}

function parseSourceFileId(value: unknown): number | null {
  return parsePositiveInteger(value);
}

function parsePositiveInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return Number(value);
  }
  return null;
}

function parseSourceTypeQuery(value: unknown) {
  if (value === undefined) {
    return undefined;
  }
  if (isSourceType(value)) {
    return value;
  }
  return false;
}

function parseReconciliationRunDetailFilters(
  query: express.Request["query"],
): ReconciliationRunDetailFilters | false {
  const exceptionSourceType = parseSourceTypeQuery(query.source_type);
  if (exceptionSourceType === false) {
    return false;
  }

  const exceptionType = parseExceptionTypeQuery(query.exception_type);
  if (exceptionType === false) {
    return false;
  }

  const search = parseSearchQuery(query.search);
  if (search === false) {
    return false;
  }

  const exceptionStatus = parseExceptionStatusQuery(query.status);
  if (exceptionStatus === false) {
    return false;
  }

  return {
    ...(exceptionSourceType ? { exceptionSourceType } : {}),
    ...(exceptionType ? { exceptionType } : {}),
    ...(exceptionStatus ? { exceptionStatus } : {}),
    ...(search ? { search } : {}),
  };
}

function parseExceptionTypeQuery(value: unknown) {
  if (value === undefined) {
    return undefined;
  }
  if (isReconciliationExceptionType(value)) {
    return value;
  }
  return false;
}

function parseSearchQuery(value: unknown): string | undefined | false {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    return false;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseExceptionStatusQuery(value: unknown) {
  if (value === undefined) {
    return undefined;
  }
  if (isReconciliationExceptionStatus(value)) {
    return value;
  }
  return false;
}

function parseExceptionReviewUpdate(value: unknown): ReconciliationExceptionReviewUpdate | false {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const body = value as { status?: unknown; note?: unknown };
  const hasStatus = Object.hasOwn(body, "status");
  const hasNote = Object.hasOwn(body, "note");
  if (!hasStatus && !hasNote) {
    return false;
  }
  if (hasStatus && !isReconciliationExceptionStatus(body.status)) {
    return false;
  }
  if (hasNote && typeof body.note !== "string") {
    return false;
  }
  return {
    ...(hasStatus && isReconciliationExceptionStatus(body.status) ? { status: body.status } : {}),
    ...(hasNote && typeof body.note === "string" ? { note: body.note.trim() } : {}),
  };
}

function toExceptionsCsv(detail: ReconciliationRunDetail): string {
  const headers = [
    "reconciliation_run_id",
    "exception_id",
    "exception_type",
    "status",
    "note",
    "source_type",
    "transaction_id",
    "transaction_date",
    "post_date",
    "amount",
    "amount_cents",
    "reference_number",
    "stock_number",
    "vin",
    "description",
    "reason",
    "created_at",
  ];
  const rows = detail.exceptions.map((exception) => {
    const transaction = exception.transaction;
    return [
      detail.reconciliation_run_id,
      exception.exception_id,
      exception.exception_type,
      exception.status,
      exception.note,
      exception.source_type,
      transaction.id,
      transaction.transaction_date,
      transaction.post_date,
      transaction.amount,
      transaction.amount_cents,
      transaction.reference_number,
      transaction.stock_number,
      transaction.vin,
      transaction.description,
      exception.reason,
      exception.created_at,
    ];
  });

  return [headers, ...rows].map((row) => row.map(toCsvCell).join(",")).join("\n") + "\n";
}

function toCsvCell(value: string | number | null): string {
  if (value === null) {
    return "";
  }
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function createFileHash(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function uploadErrorMessage(error: MulterError): string {
  if (error.code === "LIMIT_FILE_SIZE") {
    return `CSV file exceeds the ${MAX_UPLOAD_BYTES} byte upload limit.`;
  }
  return error.message;
}

class AppHttpError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}
