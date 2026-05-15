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
  isSourceType,
  type ReconciliationRequest,
} from "./domain/types.js";
import {
  DuplicateSourceFileError,
  type TransactionRepository,
} from "./repositories/transactionRepository.js";
import {
  createReconciliationRunFromSourceFiles,
  evaluateAutoRunAfterUpload,
  buildOperationalMetrics,
  buildStoreAutomationStatuses,
  generateStaleStoreEvents,
  runDueScheduledJobs,
} from "./services/reconciliationAutomation.js";
import { buildReconciliationReplay } from "./services/reconciliationReplay.js";
import {
  buildDealerGroupAnalytics,
  buildReconciliationRunComparison,
} from "./services/runComparisonAnalytics.js";
import {
  CsvNormalizationError,
  normalizeTransactionsFromCsv,
} from "./services/transactionNormalizer.js";
import { toExceptionsCsv, toMonthEndReportCsv } from "./presenters/csv.js";
import {
  parseExceptionReviewUpdate,
  parseLoginRequest,
  parseMonthEndReportQuery,
  parseOptionalPositiveInteger,
  parsePositiveInteger,
  parseReconciliationRunDetailFilters,
  parseScheduledReconciliationJobRequest,
  parseScheduledReconciliationJobUpdate,
  parseSourceFileId,
  parseSourceTypeQuery,
  parseStoreCreateRequest,
} from "./validators/requestParsers.js";
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
  const nodeEnv = authOptions.nodeEnv ?? "development";
  const isProduction = nodeEnv === "production";
  const isLocalEnv = nodeEnv === "development" || nodeEnv === "test";
  const allowDevDealershipFallback =
    authOptions.allowDevDealershipFallback ?? authRepository === undefined;

  app.use(requestLogger);
  app.use((_request, response, next) => {
    response.locals.repository = repository;
    next();
  });
  app.use(express.json());
  if (corsOrigins.length === 0 && !isLocalEnv) {
    throw new Error(
      `CORS allowed origins must be configured explicitly when NODE_ENV=${nodeEnv}.`,
    );
  }
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
      await repository.createAuditEvent(user.dealership_id, {
        actor_user_id: user.id,
        action_type: "login",
        entity_type: "user",
        entity_id: String(user.id),
        previous_state: null,
        new_state: { email: user.email, role: user.role },
      });
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
          role: "platform_admin",
          dealer_group_id: null,
          store_ids: [],
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

  app.get("/audit-events", async (request, response, next) => {
    try {
      if (!hasAnyRole(getAuthenticatedUser(response), ["platform_admin", "dealer_group_admin", "read_only_auditor"])) {
        response.status(403).json({ detail: "Not authorized." });
        return;
      }
      const limit = parseOptionalPositiveInteger(request.query.limit);
      if (limit === false) {
        response.status(422).json({ detail: "Invalid audit query." });
        return;
      }
      response.json(await repository.listAuditEvents(getRequestDealershipId(response), limit));
    } catch (error) {
      next(error);
    }
  });

  app.get("/dealer-groups", async (_request, response, next) => {
    try {
      response.json(await repository.listDealerGroups(getRequestDealershipId(response)));
    } catch (error) {
      next(error);
    }
  });

  app.get("/stores", async (_request, response, next) => {
    try {
      response.json(
        filterStoresForUser(
          getAuthenticatedUser(response),
          await repository.listDealershipStores(getRequestDealershipId(response)),
        ),
      );
    } catch (error) {
      next(error);
    }
  });

  app.post("/stores", async (request, response, next) => {
    try {
      if (!hasAnyRole(getAuthenticatedUser(response), ["platform_admin", "dealer_group_admin"])) {
        response.status(403).json({ detail: "Not authorized." });
        return;
      }
      const store = parseStoreCreateRequest(request.body);
      if (store === false) {
        response.status(422).json({ detail: "Invalid store request." });
        return;
      }
      const createdStore = await repository.createDealershipStore(getRequestDealershipId(response), store);
      await audit(response, "store_created", "dealership_store", createdStore.id, null, createdStore);
      response.status(201).json(createdStore);
    } catch (error) {
      next(error);
    }
  });

  app.get("/dealer-groups/analytics", async (_request, response, next) => {
    try {
      response.json(await buildDealerGroupAnalytics(repository, getRequestDealershipId(response)));
    } catch (error) {
      next(error);
    }
  });

  app.get("/automation/scheduled-jobs", async (request, response, next) => {
    try {
      const storeId = parseOptionalPositiveInteger(request.query.store_id);
      if (storeId === false) {
        response.status(422).json({ detail: "Invalid store_id." });
        return;
      }
      if (!(await canAccessStore(repository, getAuthenticatedUser(response), storeId ?? null))) {
        response.status(403).json({ detail: "Not authorized for this store." });
        return;
      }
      response.json(
        await filterByStoreAccess(
          repository,
          getAuthenticatedUser(response),
          await repository.listScheduledReconciliationJobs(
            getRequestDealershipId(response),
            storeId,
          ),
          (job) => job.dealership_store_id,
        ),
      );
    } catch (error) {
      next(error);
    }
  });

  app.post("/automation/scheduled-jobs", async (request, response, next) => {
    try {
      if (!hasAnyRole(getAuthenticatedUser(response), ["platform_admin", "dealer_group_admin", "store_manager"])) {
        response.status(403).json({ detail: "Not authorized." });
        return;
      }
      const job = parseScheduledReconciliationJobRequest(request.body);
      if (job === false) {
        response.status(422).json({ detail: "Invalid scheduled job request." });
        return;
      }
      if (!(await canAccessStore(repository, getAuthenticatedUser(response), job.dealership_store_id ?? null))) {
        response.status(403).json({ detail: "Not authorized for this store." });
        return;
      }
      const createdJob = await repository.createScheduledReconciliationJob(getRequestDealershipId(response), job);
      await audit(response, "scheduled_job_created", "scheduled_reconciliation_job", createdJob.id, null, createdJob);
      response.status(201).json(createdJob);
    } catch (error) {
      next(error);
    }
  });

  app.patch("/automation/scheduled-jobs/:id", async (request, response, next) => {
    try {
      if (!hasAnyRole(getAuthenticatedUser(response), ["platform_admin", "dealer_group_admin", "store_manager"])) {
        response.status(403).json({ detail: "Not authorized." });
        return;
      }
      const jobId = parsePositiveInteger(request.params.id);
      const update = parseScheduledReconciliationJobUpdate(request.body);
      if (jobId === null) {
        response.status(404).json({ detail: "Scheduled job was not found." });
        return;
      }
      if (update === false) {
        response.status(422).json({ detail: "Invalid scheduled job update." });
        return;
      }
      const previousJob = (await repository.listScheduledReconciliationJobs(getRequestDealershipId(response))).find(
        (candidate) => candidate.id === jobId,
      );
      if (!previousJob) {
        response.status(404).json({ detail: "Scheduled job was not found." });
        return;
      }
      if (!(await canAccessStore(repository, getAuthenticatedUser(response), previousJob.dealership_store_id))) {
        response.status(403).json({ detail: "Not authorized for this store." });
        return;
      }
      const job = await repository.updateScheduledReconciliationJob(
        getRequestDealershipId(response),
        jobId,
        update,
      );
      if (!job) {
        response.status(404).json({ detail: "Scheduled job was not found." });
        return;
      }
      await audit(response, "scheduled_job_updated", "scheduled_reconciliation_job", job.id, previousJob, job);
      response.json(job);
    } catch (error) {
      next(error);
    }
  });

  app.post("/automation/run-due-jobs", async (request, response, next) => {
    try {
      if (!hasAnyRole(getAuthenticatedUser(response), ["platform_admin", "dealer_group_admin", "store_manager"])) {
        response.status(403).json({ detail: "Not authorized." });
        return;
      }
      response.json({
        runs: await runDueScheduledJobs(
          repository,
          getRequestDealershipId(response),
          typeof request.body?.now === "string" ? request.body.now : undefined,
        ),
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/automation/ingestion-events", async (request, response, next) => {
    try {
      const storeId = parseOptionalPositiveInteger(request.query.store_id);
      const limit = parseOptionalPositiveInteger(request.query.limit);
      if (storeId === false || limit === false) {
        response.status(422).json({ detail: "Invalid ingestion event query." });
        return;
      }
      if (!(await canAccessStore(repository, getAuthenticatedUser(response), storeId ?? null))) {
        response.status(403).json({ detail: "Not authorized for this store." });
        return;
      }
      response.json(
        await repository.listIngestionEvents(
          getRequestDealershipId(response),
          storeId,
          limit,
        ),
      );
    } catch (error) {
      next(error);
    }
  });

  app.get("/automation/events", async (request, response, next) => {
    try {
      const storeId = parseOptionalPositiveInteger(request.query.store_id);
      const limit = parseOptionalPositiveInteger(request.query.limit);
      if (storeId === false || limit === false) {
        response.status(422).json({ detail: "Invalid operational event query." });
        return;
      }
      if (!(await canAccessStore(repository, getAuthenticatedUser(response), storeId ?? null))) {
        response.status(403).json({ detail: "Not authorized for this store." });
        return;
      }
      response.json(
        await repository.listOperationalEvents(
          getRequestDealershipId(response),
          storeId,
          limit,
        ),
      );
    } catch (error) {
      next(error);
    }
  });

  app.get("/automation/status", async (_request, response, next) => {
    try {
      const dealershipId = getRequestDealershipId(response);
      await generateStaleStoreEvents(repository, dealershipId);
      response.json(
        await filterByStoreAccess(
          repository,
          getAuthenticatedUser(response),
          await buildStoreAutomationStatuses(repository, dealershipId),
          (status) => status.dealership_store_id,
        ),
      );
    } catch (error) {
      next(error);
    }
  });

  app.get("/automation/metrics", async (_request, response, next) => {
    try {
      response.json(await buildOperationalMetrics(repository, getRequestDealershipId(response)));
    } catch (error) {
      next(error);
    }
  });

  app.get("/source-files", async (request, response, next) => {
    try {
      const requestDealershipId = getRequestDealershipId(response);
      const sourceType = parseSourceTypeQuery(request.query.source_type);
      if (sourceType === false) {
        response.status(422).json({ detail: "Invalid source_type." });
        return;
      }
      const dealershipStoreId = parseOptionalPositiveInteger(request.query.store_id);
      if (dealershipStoreId === false) {
        response.status(422).json({ detail: "Invalid store_id." });
        return;
      }
      if (!(await canAccessStore(repository, getAuthenticatedUser(response), dealershipStoreId ?? null))) {
        response.status(403).json({ detail: "Not authorized for this store." });
        return;
      }

      const files = await repository.listSourceFiles(requestDealershipId, sourceType, dealershipStoreId);
      response.json(
        await filterByStoreAccess(
          repository,
          getAuthenticatedUser(response),
          files,
          (file) => file.dealership_store_id,
        ),
      );
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
      const dealershipStoreId = await resolveStoreIdForRequest(
        repository,
        requestDealershipId,
        request.body.store_id,
      );
      if (dealershipStoreId === false) {
        response.status(422).json({ detail: "Invalid store_id." });
        return;
      }
      if (!canWrite(getAuthenticatedUser(response))) {
        response.status(403).json({ detail: "Read-only users cannot upload files." });
        return;
      }
      if (!(await canAccessStore(repository, getAuthenticatedUser(response), dealershipStoreId))) {
        response.status(403).json({ detail: "Not authorized for this store." });
        return;
      }
      const duplicateSourceFile = await repository.getSourceFileByHash(
        requestDealershipId,
        dealershipStoreId,
        sourceType,
        fileHash,
      );
      if (duplicateSourceFile) {
        await repository.createIngestionEvent(requestDealershipId, {
          dealership_store_id: dealershipStoreId,
          source_file_id: duplicateSourceFile.id,
          reconciliation_run_id: null,
          source_type: sourceType,
          state: "failed",
          message: "Duplicate upload detected.",
          metadata: { file_hash: fileHash, filename: duplicateSourceFile.original_filename },
        });
        await repository.createOperationalEvent(requestDealershipId, {
          dealership_store_id: dealershipStoreId,
          reconciliation_run_id: null,
          event_type: "duplicate_upload_warning",
          severity: "warning",
          message: "Duplicate upload detected for this store and source type.",
          metadata: {
            source_type: sourceType,
            source_file_id: duplicateSourceFile.id,
            file_hash: fileHash,
          },
        });
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
          dealership_store_id: dealershipStoreId,
          original_filename: request.file.originalname || "upload.csv",
          stored_filename: null,
          file_hash: fileHash,
          row_count: result.transactions.length,
          validation_error_count: result.validationErrors.length,
        },
        result.transactions,
      );
      await repository.createIngestionEvent(requestDealershipId, {
        dealership_store_id: importResult.sourceFile.dealership_store_id,
        source_file_id: importResult.sourceFile.id,
        reconciliation_run_id: null,
        source_type: sourceType,
        state: "uploaded",
        message: "File uploaded.",
        metadata: { filename: importResult.sourceFile.original_filename, file_hash: fileHash },
      });
      await repository.createIngestionEvent(requestDealershipId, {
        dealership_store_id: importResult.sourceFile.dealership_store_id,
        source_file_id: importResult.sourceFile.id,
        reconciliation_run_id: null,
        source_type: sourceType,
        state: result.validationErrors.length > 0 ? "validated" : "normalized",
        message:
          result.validationErrors.length > 0
            ? "File validated with warnings."
            : "File normalized successfully.",
        metadata: {
          transaction_count: result.transactions.length,
          validation_error_count: result.validationErrors.length,
        },
      });
      const autoRun = await evaluateAutoRunAfterUpload(
        repository,
        requestDealershipId,
        importResult.sourceFile,
      );

      response.json({
        source_file_id: importResult.sourceFile.id,
        dealership_store_id: importResult.sourceFile.dealership_store_id,
        store_name: (await repository.listDealershipStores(requestDealershipId)).find(
          (store) => store.id === importResult.sourceFile.dealership_store_id,
        )?.name ?? null,
        source_type: sourceType,
        filename: importResult.sourceFile.original_filename,
        transaction_count: importResult.transactions.length,
        validation_errors: result.validationErrors,
        automated_reconciliation_run_id: autoRun?.id ?? null,
      });
    } catch (error) {
      const requestDealershipId = getRequestDealershipId(response);
      const sourceType = isSourceType(request.body?.source_type) ? request.body.source_type : null;
      await repository.createIngestionEvent(requestDealershipId, {
        dealership_store_id: null,
        source_file_id: null,
        reconciliation_run_id: null,
        source_type: sourceType,
        state: "failed",
        message: error instanceof Error ? error.message : "Upload failed.",
        metadata: {},
      });
      next(error);
    }
  });

  app.post("/reconcile", async (request, response, next) => {
    try {
      const body = (request.body ?? {}) as ReconciliationRequest;
      const boaSourceFileId = parseSourceFileId(body.boa_source_file_id);
      const dealertrackSourceFileId = parseSourceFileId(body.dealertrack_source_file_id);
      const requestedStoreId = parseOptionalPositiveInteger(body.dealership_store_id);

      if (boaSourceFileId === null) {
        response.status(422).json({ detail: "boa_source_file_id is required." });
        return;
      }
      if (dealertrackSourceFileId === null) {
        response.status(422).json({ detail: "dealertrack_source_file_id is required." });
        return;
      }
      if (requestedStoreId === false) {
        response.status(422).json({ detail: "Invalid dealership_store_id." });
        return;
      }
      if (!canWrite(getAuthenticatedUser(response))) {
        response.status(403).json({ detail: "Read-only users cannot run reconciliation." });
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
      const reconciliationStoreId = requestedStoreId ?? boaSourceFile.dealership_store_id;
      if (!(await canAccessStore(repository, getAuthenticatedUser(response), reconciliationStoreId))) {
        response.status(403).json({ detail: "Not authorized for this store." });
        return;
      }
      if (
        boaSourceFile.dealership_store_id !== dealertrackSourceFile.dealership_store_id ||
        (reconciliationStoreId !== null &&
          (boaSourceFile.dealership_store_id !== reconciliationStoreId ||
            dealertrackSourceFile.dealership_store_id !== reconciliationStoreId))
      ) {
        response.status(400).json({
          detail: "BOA and Dealertrack uploads must belong to the selected store.",
        });
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

      const { run, result } = await createReconciliationRunFromSourceFiles({
        repository,
        dealershipId: requestDealershipId,
        boaSourceFile,
        dealertrackSourceFile,
        automated: false,
      });
      logInfo("reconciliation_run_created", {
        request_id: response.locals.requestId,
        dealership_id: requestDealershipId,
        reconciliation_run_id: run.id,
        boa_source_file_id: boaSourceFileId,
        dealertrack_source_file_id: dealertrackSourceFileId,
        matched_count: run.matched_count,
        exception_count: run.exception_count,
        duplicate_count: run.duplicate_count,
      });
      await audit(response, "reconciliation_run_created", "reconciliation_run", run.id, null, {
        boa_source_file_id: boaSourceFileId,
        dealertrack_source_file_id: dealertrackSourceFileId,
        matched_count: run.matched_count,
        exception_count: run.exception_count,
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
      const dealershipStoreId = parseOptionalPositiveInteger(_request.query.store_id);
      if (dealershipStoreId === false) {
        response.status(422).json({ detail: "Invalid store_id." });
        return;
      }
      const runs = await repository.listReconciliationRuns(getRequestDealershipId(response), {
          ...(dealershipStoreId ? { dealershipStoreId } : {}),
        });
      response.json(
        await filterByStoreAccess(
          repository,
          getAuthenticatedUser(response),
          runs,
          (run) => run.dealership_store_id,
        ),
      );
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
      if (!(await canAccessStore(repository, getAuthenticatedUser(response), detail.dealership_store_id))) {
        response.status(403).json({ detail: "Not authorized for this store." });
        return;
      }

      response.json(detail);
    } catch (error) {
      next(error);
    }
  });

  app.get("/reconciliation-runs/:id/analytics", async (request, response, next) => {
    try {
      const reconciliationRunId = parsePositiveInteger(request.params.id);
      if (reconciliationRunId === null) {
        response.status(404).json({ detail: "Reconciliation run was not found." });
        return;
      }

      const runDetail = await repository.getReconciliationRunDetail(
        getRequestDealershipId(response),
        reconciliationRunId,
      );
      if (!runDetail) {
        const ownerDealershipId =
          await repository.getReconciliationRunDealershipId(reconciliationRunId);
        if (ownerDealershipId !== null && ownerDealershipId !== getRequestDealershipId(response)) {
          response.status(403).json({ detail: "Reconciliation run belongs to another dealership." });
          return;
        }
        response.status(404).json({ detail: "Reconciliation run was not found." });
        return;
      }
      if (!(await canAccessStore(repository, getAuthenticatedUser(response), runDetail.dealership_store_id))) {
        response.status(403).json({ detail: "Not authorized for this store." });
        return;
      }

      const comparison = await buildReconciliationRunComparison(
        repository,
        getRequestDealershipId(response),
        reconciliationRunId,
      );
      if (!comparison) {
        response.status(404).json({ detail: "Reconciliation run was not found." });
        return;
      }

      response.json(comparison);
    } catch (error) {
      next(error);
    }
  });

  app.get("/reconciliation-runs/:id/snapshot", async (request, response, next) => {
    try {
      const reconciliationRunId = parsePositiveInteger(request.params.id);
      if (reconciliationRunId === null) {
        response.status(404).json({ detail: "Reconciliation run was not found." });
        return;
      }

      const runDetail = await repository.getReconciliationRunDetail(
        getRequestDealershipId(response),
        reconciliationRunId,
      );
      if (!runDetail) {
        const ownerDealershipId =
          await repository.getReconciliationRunDealershipId(reconciliationRunId);
        if (ownerDealershipId !== null && ownerDealershipId !== getRequestDealershipId(response)) {
          response.status(403).json({ detail: "Reconciliation run belongs to another dealership." });
          return;
        }
        response.status(404).json({ detail: "Reconciliation run was not found." });
        return;
      }
      if (!(await canAccessStore(repository, getAuthenticatedUser(response), runDetail.dealership_store_id))) {
        response.status(403).json({ detail: "Not authorized for this store." });
        return;
      }

      const snapshot = await repository.getReconciliationRunSnapshot(
        getRequestDealershipId(response),
        reconciliationRunId,
      );
      if (!snapshot) {
        response.status(404).json({ detail: "Reconciliation snapshot was not found." });
        return;
      }

      response.json(snapshot);
    } catch (error) {
      next(error);
    }
  });

  app.get("/reconciliation-runs/:id/replay", async (request, response, next) => {
    try {
      const reconciliationRunId = parsePositiveInteger(request.params.id);
      if (reconciliationRunId === null) {
        response.status(404).json({ detail: "Reconciliation run was not found." });
        return;
      }

      const runDetail = await repository.getReconciliationRunDetail(
        getRequestDealershipId(response),
        reconciliationRunId,
      );
      if (!runDetail) {
        const ownerDealershipId =
          await repository.getReconciliationRunDealershipId(reconciliationRunId);
        if (ownerDealershipId !== null && ownerDealershipId !== getRequestDealershipId(response)) {
          response.status(403).json({ detail: "Reconciliation run belongs to another dealership." });
          return;
        }
        response.status(404).json({ detail: "Reconciliation run was not found." });
        return;
      }
      if (!(await canAccessStore(repository, getAuthenticatedUser(response), runDetail.dealership_store_id))) {
        response.status(403).json({ detail: "Not authorized for this store." });
        return;
      }

      const replay = await buildReconciliationReplay(
        repository,
        getRequestDealershipId(response),
        reconciliationRunId,
      );
      if (!replay) {
        response.status(404).json({ detail: "Reconciliation snapshot was not found." });
        return;
      }
      await audit(response, "reconciliation_replay", "reconciliation_run", reconciliationRunId, null, {
        results_changed: replay.results_changed,
        matched_count_delta: replay.matched_count_delta,
        exception_count_delta: replay.exception_count_delta,
      });

      response.json(replay);
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
      if (!(await canAccessStore(repository, getAuthenticatedUser(response), detail.dealership_store_id))) {
        response.status(403).json({ detail: "Not authorized for this store." });
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
        if (!canWrite(getAuthenticatedUser(response))) {
          response.status(403).json({ detail: "Read-only users cannot update review workflow." });
          return;
        }

        const update = parseExceptionReviewUpdate(request.body);
        if (update === false) {
          response.status(422).json({ detail: "Invalid exception review update." });
          return;
        }

        const previousDetail = await repository.getReconciliationRunDetail(
          getRequestDealershipId(response),
          reconciliationRunId,
        );
        const previousException = previousDetail?.exceptions.find(
          (candidate) => candidate.exception_id === exceptionId,
        ) ?? null;
        if (
          previousDetail &&
          !(await canAccessStore(repository, getAuthenticatedUser(response), previousDetail.dealership_store_id))
        ) {
          response.status(403).json({ detail: "Not authorized for this store." });
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

        await audit(
          response,
          "review_workflow_updated",
          "reconciliation_exception",
          exception.exception_id,
          previousException,
          exception,
        );
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
    role: user.role,
    dealer_group_id: user.dealer_group_id,
    store_ids: [...user.store_ids],
  };
}

function hasAnyRole(user: AuthUser, roles: AuthUser["role"][]): boolean {
  return roles.includes(user.role);
}

function canWrite(user: AuthUser): boolean {
  return user.role !== "read_only_auditor";
}

async function canAccessStore(
  repository: TransactionRepository,
  user: AuthUser,
  storeId: number | null,
): Promise<boolean> {
  if (user.role === "platform_admin") {
    return true;
  }
  if (storeId === null) {
    return true;
  }
  if (user.role === "dealer_group_admin") {
    const store = (await repository.listDealershipStores(user.dealership_id)).find(
      (candidate) => candidate.id === storeId,
    );
    return Boolean(store && store.dealer_group_id === user.dealer_group_id);
  }
  return user.store_ids.includes(storeId);
}

async function filterByStoreAccess<T>(
  repository: TransactionRepository,
  user: AuthUser,
  items: T[],
  getStoreId: (item: T) => number | null,
): Promise<T[]> {
  const visibleItems: T[] = [];
  for (const item of items) {
    if (await canAccessStore(repository, user, getStoreId(item))) {
      visibleItems.push(item);
    }
  }
  return visibleItems;
}

function filterStoresForUser<T extends { id: number; dealer_group_id: number | null }>(
  user: AuthUser,
  stores: T[],
): T[] {
  if (user.role === "platform_admin") {
    return stores;
  }
  if (user.role === "dealer_group_admin") {
    return stores.filter((store) => store.dealer_group_id === user.dealer_group_id);
  }
  return stores.filter((store) => user.store_ids.includes(store.id));
}

async function audit(
  response: express.Response,
  actionType: string,
  entityType: string,
  entityId: string | number | null,
  previousState: unknown,
  newState: unknown,
): Promise<void> {
  const repository = response.locals.repository as TransactionRepository;
  const user = getAuthenticatedUser(response);
  await repository.createAuditEvent(user.dealership_id, {
    actor_user_id: user.id === 0 ? null : user.id,
    action_type: actionType,
    entity_type: entityType,
    entity_id: entityId === null ? null : String(entityId),
    previous_state: toAuditState(previousState),
    new_state: toAuditState(newState),
  });
}

function toAuditState(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) {
    return null;
  }
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

async function resolveStoreIdForRequest(
  repository: TransactionRepository,
  dealershipId: number,
  value: unknown,
): Promise<number | null | false> {
  const parsed = parseOptionalPositiveInteger(value);
  if (parsed === false) {
    return false;
  }
  const stores = await repository.listDealershipStores(dealershipId);
  if (parsed !== undefined) {
    return stores.some((store) => store.id === parsed) ? parsed : false;
  }
  return stores[0]?.id ?? null;
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
