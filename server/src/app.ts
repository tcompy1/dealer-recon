import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";

import cors from "cors";
import express from "express";
import multer, { MulterError } from "multer";

import {
  type AuthRepository,
  type AuthUser,
  createSessionToken,
  parseCookies,
  sessionCookieName,
  verifyPassword,
  verifySessionToken,
} from "./auth.js";
import {
  isReconciliationExceptionStatus,
  isReconciliationExceptionReviewStatus,
  isReconciliationExceptionType,
  isSourceType,
  type ReconciliationRequest,
  type ReconciliationExceptionReviewUpdate,
  type MonthEndReport,
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
  authOptions: {
    authRepository?: AuthRepository;
    sessionSecret?: string;
    nodeEnv?: string;
    allowDevDealershipFallback?: boolean;
  } = {},
) {
  const app = express();
  const authRepository = authOptions.authRepository;
  const sessionSecret =
    authOptions.sessionSecret ?? "local-dev-session-secret-change-before-production";
  const isProduction = authOptions.nodeEnv === "production";
  const allowDevDealershipFallback =
    authOptions.allowDevDealershipFallback ?? authRepository === undefined;

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

  app.post("/login", async (request, response, next) => {
    try {
      if (!authRepository) {
        response.status(503).json({ detail: "Authentication is not configured." });
        return;
      }

      const credentials = parseLoginRequest(request.body);
      if (!credentials) {
        response.status(422).json({ detail: "Email and password are required." });
        return;
      }

      const user = await authRepository.findUserByEmail(credentials.email);
      if (!user || !(await verifyPassword(credentials.password, user.password_hash))) {
        response.status(401).json({ detail: "Invalid email or password." });
        return;
      }

      const publicUser = toPublicUser(user);
      response.cookie(sessionCookieName, createSessionToken(publicUser, sessionSecret), {
        httpOnly: true,
        sameSite: "lax",
        secure: isProduction,
        maxAge: 8 * 60 * 60 * 1000,
        path: "/",
      });
      response.json({ user: publicUser });
    } catch (error) {
      next(error);
    }
  });

  app.use(async (request, response, next) => {
    try {
      const user = await resolveRequestUser(request, authRepository, sessionSecret);
      if (user) {
        response.locals.user = user;
        next();
        return;
      }
      if (allowDevDealershipFallback) {
        response.locals.user = {
          id: 0,
          email: "local-dev-fallback@dealer-recon.local",
          dealership_id: dealershipId,
        } satisfies AuthUser;
        next();
        return;
      }
      response.status(401).json({ detail: "Authentication required." });
    } catch (error) {
      next(error);
    }
  });

  app.post("/logout", (_request, response) => {
    response.clearCookie(sessionCookieName, {
      httpOnly: true,
      sameSite: "lax",
      secure: isProduction,
      path: "/",
    });
    response.json({ status: "ok" });
  });

  app.get("/me", (request, response) => {
    response.json({ user: getAuthenticatedUser(response) });
  });

  app.get("/source-files", async (request, response, next) => {
    try {
      const requestDealershipId = getRequestDealershipId(response);
      const sourceType = parseSourceTypeQuery(request.query.source_type);
      if (sourceType === false) {
        response.status(422).json({ detail: "Invalid source_type." });
        return;
      }

      response.json(await repository.listSourceFiles(requestDealershipId, sourceType));
    } catch (error) {
      next(error);
    }
  });

  app.get("/accounts/summary", async (_request, response, next) => {
    try {
      response.json(await repository.listAccountsSummary(getRequestDealershipId(response)));
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

      const detail = await repository.getAccountDetail(
        getRequestDealershipId(response),
        accountIdentifier,
      );
      if (!detail) {
        response.status(404).json({ detail: "Account was not found." });
        return;
      }

      response.json(detail);
    } catch (error) {
      next(error);
    }
  });

  app.get("/reports/month-end", async (request, response, next) => {
    try {
      const reportQuery = parseMonthEndReportQuery(request.query);
      if (reportQuery === false) {
        response.status(422).json({ detail: "Invalid month-end report query." });
        return;
      }

      const report = await repository.getMonthEndReport(
        getRequestDealershipId(response),
        reportQuery.startDate,
        reportQuery.endDate,
      );
      if (reportQuery.format === "csv") {
        response
          .status(200)
          .type("text/csv")
          .setHeader(
            "Content-Disposition",
            `attachment; filename="month-end-${reportQuery.startDate}-to-${reportQuery.endDate}.csv"`,
          )
          .send(toMonthEndReportCsv(report));
        return;
      }

      response.json(report);
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
      const requestDealershipId = getRequestDealershipId(response);
      const duplicateSourceFile = await repository.getSourceFileByHash(
        requestDealershipId,
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
        requestDealershipId,
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

      const requestDealershipId = getRequestDealershipId(response);
      if (!boaSourceFile || !dealertrackSourceFile) {
        response.status(404).json({ detail: "Source file was not found." });
        return;
      }
      if (
        boaSourceFile.dealership_id !== requestDealershipId ||
        dealertrackSourceFile.dealership_id !== requestDealershipId
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
        dealershipId: requestDealershipId,
        leftSourceFileId: boaSourceFileId,
        rightSourceFileId: dealertrackSourceFileId,
      });
      const run = await repository.createReconciliationRun({
        dealership_id: requestDealershipId,
        boa_source_file_id: boaSourceFileId,
        dealertrack_source_file_id: dealertrackSourceFileId,
        result,
      });
      logInfo("reconciliation_run_created", {
        request_id: response.locals.requestId,
        dealership_id: requestDealershipId,
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
      response.json(await repository.listReconciliationRuns(getRequestDealershipId(response)));
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
        getRequestDealershipId(response),
        reconciliationRunId,
        filters,
      );
      if (!detail) {
        const ownerDealershipId =
          await repository.getReconciliationRunDealershipId(reconciliationRunId);
        if (ownerDealershipId !== null && ownerDealershipId !== getRequestDealershipId(response)) {
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
        getRequestDealershipId(response),
        reconciliationRunId,
        filters,
      );
      if (!detail) {
        const ownerDealershipId =
          await repository.getReconciliationRunDealershipId(reconciliationRunId);
        if (ownerDealershipId !== null && ownerDealershipId !== getRequestDealershipId(response)) {
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
          getRequestDealershipId(response),
          reconciliationRunId,
          exceptionId,
          update,
        );
        if (!exception) {
          const owner = await repository.getReconciliationExceptionDealershipId(
            reconciliationRunId,
            exceptionId,
          );
          if (owner !== null && owner !== getRequestDealershipId(response)) {
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

async function resolveRequestUser(
  request: express.Request,
  authRepository: AuthRepository | undefined,
  sessionSecret: string,
): Promise<AuthUser | null> {
  if (!authRepository) {
    return null;
  }
  const cookies = parseCookies(request.headers.cookie);
  const token = cookies[sessionCookieName] ?? getBearerToken(request.headers.authorization);
  if (!token) {
    return null;
  }
  const session = verifySessionToken(token, sessionSecret);
  if (!session) {
    return null;
  }
  const user = await authRepository.findUserById(session.userId);
  if (!user || user.dealership_id !== session.dealershipId) {
    return null;
  }
  return user;
}

function getBearerToken(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const [scheme, token] = value.split(" ");
  return scheme?.toLowerCase() === "bearer" && token ? token : null;
}

function parseLoginRequest(value: unknown): { email: string; password: string } | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const body = value as { email?: unknown; password?: unknown };
  if (typeof body.email !== "string" || typeof body.password !== "string") {
    return null;
  }
  const email = body.email.trim().toLowerCase();
  if (!email || !body.password) {
    return null;
  }
  return { email, password: body.password };
}

function getAuthenticatedUser(response: express.Response): AuthUser {
  return response.locals.user as AuthUser;
}

function getRequestDealershipId(response: express.Response): number {
  return getAuthenticatedUser(response).dealership_id;
}

function toPublicUser(user: AuthUser): AuthUser {
  return {
    id: user.id,
    email: user.email,
    dealership_id: user.dealership_id,
  };
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
  const exceptionReviewStatus = parseExceptionReviewStatusQuery(query.review_status);
  if (exceptionReviewStatus === false) {
    return false;
  }
  const assignedTo = parseSearchQuery(query.assigned_to);
  if (assignedTo === false) {
    return false;
  }

  return {
    ...(exceptionSourceType ? { exceptionSourceType } : {}),
    ...(exceptionType ? { exceptionType } : {}),
    ...(exceptionStatus ? { exceptionStatus } : {}),
    ...(exceptionReviewStatus ? { exceptionReviewStatus } : {}),
    ...(assignedTo ? { assignedTo } : {}),
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

function parseExceptionReviewStatusQuery(value: unknown) {
  if (value === undefined) {
    return undefined;
  }
  if (isReconciliationExceptionReviewStatus(value)) {
    return value;
  }
  return false;
}

function parseExceptionReviewUpdate(value: unknown): ReconciliationExceptionReviewUpdate | false {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const body = value as {
    status?: unknown;
    note?: unknown;
    review_status?: unknown;
    assigned_to?: unknown;
    review_notes?: unknown;
    reviewed_by?: unknown;
  };
  const hasStatus = Object.hasOwn(body, "status");
  const hasNote = Object.hasOwn(body, "note");
  const hasReviewStatus = Object.hasOwn(body, "review_status");
  const hasAssignedTo = Object.hasOwn(body, "assigned_to");
  const hasReviewNotes = Object.hasOwn(body, "review_notes");
  const hasReviewedBy = Object.hasOwn(body, "reviewed_by");
  if (!hasStatus && !hasNote && !hasReviewStatus && !hasAssignedTo && !hasReviewNotes && !hasReviewedBy) {
    return false;
  }
  if (hasStatus && !isReconciliationExceptionStatus(body.status)) {
    return false;
  }
  if (hasNote && typeof body.note !== "string") {
    return false;
  }
  if (hasReviewStatus && !isReconciliationExceptionReviewStatus(body.review_status)) {
    return false;
  }
  if (hasAssignedTo && body.assigned_to !== null && typeof body.assigned_to !== "string") {
    return false;
  }
  if (hasReviewNotes && typeof body.review_notes !== "string") {
    return false;
  }
  if (hasReviewedBy && body.reviewed_by !== null && typeof body.reviewed_by !== "string") {
    return false;
  }
  return {
    ...(hasStatus && isReconciliationExceptionStatus(body.status) ? { status: body.status } : {}),
    ...(hasNote && typeof body.note === "string" ? { note: body.note.trim() } : {}),
    ...(hasReviewStatus && isReconciliationExceptionReviewStatus(body.review_status)
      ? { review_status: body.review_status }
      : {}),
    ...(hasAssignedTo
      ? { assigned_to: typeof body.assigned_to === "string" ? body.assigned_to.trim() || null : null }
      : {}),
    ...(hasReviewNotes && typeof body.review_notes === "string"
      ? { review_notes: body.review_notes.trim() }
      : {}),
    ...(hasReviewedBy
      ? { reviewed_by: typeof body.reviewed_by === "string" ? body.reviewed_by.trim() || null : null }
      : {}),
  };
}

function parseMonthEndReportQuery(
  query: express.Request["query"],
): { startDate: string; endDate: string; format: "json" | "csv" } | false {
  if (!isIsoDate(query.start_date) || !isIsoDate(query.end_date)) {
    return false;
  }
  if (query.start_date > query.end_date) {
    return false;
  }
  const format = query.format ?? "json";
  if (format !== "json" && format !== "csv") {
    return false;
  }
  return {
    startDate: query.start_date,
    endDate: query.end_date,
    format,
  };
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function toExceptionsCsv(detail: ReconciliationRunDetail): string {
  const headers = [
    "reconciliation_run_id",
    "exception_id",
    "exception_type",
    "exception_category",
    "status",
    "note",
    "review_status",
    "assigned_to",
    "review_notes",
    "reviewed_at",
    "reviewed_by",
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
      exception.exception_category,
      exception.status,
      exception.note,
      exception.review_status,
      exception.assigned_to,
      exception.review_notes,
      exception.reviewed_at,
      exception.reviewed_by,
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

function toMonthEndReportCsv(report: MonthEndReport): string {
  const headers = [
    "account_identifier",
    "account_type",
    "boa_total",
    "dealertrack_total",
    "net_difference",
    "unresolved_exception_count",
    "resolved_exception_count",
    "ignored_exception_count",
  ];
  const rows = report.account_summaries.map((account) => [
    account.account_identifier,
    account.account_type,
    sourceTotalAmount(account.source_totals, "boa"),
    sourceTotalAmount(account.source_totals, "dealertrack"),
    account.net_difference_amount,
    account.unresolved_exception_count,
    account.resolved_exception_count,
    account.ignored_exception_count,
  ]);

  return [headers, ...rows].map((row) => row.map(toCsvCell).join(",")).join("\n") + "\n";
}

function sourceTotalAmount(
  sourceTotals: MonthEndReport["account_summaries"][number]["source_totals"],
  sourceType: "boa" | "dealertrack",
): string {
  return sourceTotals.find((total) => total.source_type === sourceType)?.amount ?? "0.00";
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
