import { createHash } from "node:crypto";

import cors from "cors";
import express from "express";
import multer, { MulterError } from "multer";

import { isSourceType, type ReconciliationRequest } from "./domain/types.js";
import {
  DuplicateSourceFileError,
  type TransactionRepository,
} from "./repositories/transactionRepository.js";
import { reconcileTransactions } from "./services/reconciliationEngine.js";
import {
  CsvNormalizationError,
  normalizeTransactionsFromCsv,
} from "./services/transactionNormalizer.js";

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

export function createApp(repository: TransactionRepository, corsOrigins: string[] = []) {
  const app = express();

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

  app.get("/source-files", async (request, response, next) => {
    try {
      const sourceType = parseSourceTypeQuery(request.query.source_type);
      if (sourceType === false) {
        response.status(422).json({ detail: "Invalid source_type." });
        return;
      }

      response.json(await repository.listSourceFiles(sourceType));
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
      const duplicateSourceFile = await repository.getSourceFileByHash(sourceType, fileHash);
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
        leftSourceFileId: boaSourceFileId,
        rightSourceFileId: dealertrackSourceFileId,
      });
      const run = await repository.createReconciliationRun({
        boa_source_file_id: boaSourceFileId,
        dealertrack_source_file_id: dealertrackSourceFileId,
        result,
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
      response.json(await repository.listReconciliationRuns());
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

      const detail = await repository.getReconciliationRunDetail(reconciliationRunId);
      if (!detail) {
        response.status(404).json({ detail: "Reconciliation run was not found." });
        return;
      }

      response.json(detail);
    } catch (error) {
      next(error);
    }
  });

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
      console.error(error);
      response.status(500).json({ detail: "Internal server error." });
    },
  );

  return app;
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
