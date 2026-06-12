import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";

import cors from "cors";
import express from "express";
import multer from "multer";

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
  type ReconciliationArtifact,
  type ReconciliationRequest,
  type SourceFile,
} from "./domain/types.js";
import { type TransactionRepository } from "./repositories/transactionRepository.js";
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
import { normalizeTransactionsFromCsv } from "./services/transactionNormalizer.js";
import { preprocessUpload } from "./services/preprocessing/index.js";
import type {
  PreprocessingDiagnostic,
  PreprocessingDiagnosticKind,
  PreprocessingSummary,
} from "./services/preprocessing/types.js";
import { toExceptionsCsv, toMonthEndReportCsv } from "./presenters/csv.js";
import {
  buildFpRecWorkbookFromMergedFloorplan,
  toHurstFpRecFilename,
  toHurstFpRecXlsHtml,
} from "./presenters/hurstFpRec.js";
import {
  getStoreWorkflowConfig,
  parseStoreKey,
  resolveStoreWorkflowConfigFromStoreName,
  STORE_KEYS,
  type StoreWorkflowConfig,
} from "./config/storeWorkflowConfig.js";
import { buildMergedFloorplanArtifactFromTransactions } from "./services/mergedFloorplanExport.js";
import { applyCarryForwardToDetail } from "./services/exceptionCarryForward.js";
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
  parseVinEnrichmentRequest,
} from "./validators/requestParsers.js";
import {
  applyManualVinEnrichment,
  type ManualVinEnrichmentInput,
} from "./services/preprocessing/manualVinEnrichment.js";
import {
  readLineage,
  type RawDataLineage,
} from "./services/preprocessing/types.js";
import {
  canAccessStore,
  canWrite,
  filterByStoreAccess,
  filterStoresForUser,
  hasAnyRole,
} from "./access/storeAccess.js";
import { logError, logInfo, serializeError } from "./logger.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { asyncHandler } from "./middleware/asyncHandler.js";
import {
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  ConflictError,
  ServiceUnavailableError,
  BadRequestError,
} from "./errors/HttpError.js";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const allowedUploadMimeTypes = new Set([
  "text/csv",
  "application/csv",
  "application/vnd.ms-excel",
  "application/xml",
  "text/xml",
  "text/html",
  "text/plain",
  "application/octet-stream",
]);
const allowedUploadExtensions = /\.(csv|xls|xml|html?)$/i;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: 1,
  },
  fileFilter: (_request, file, callback) => {
    const hasAllowedExtension = allowedUploadExtensions.test(file.originalname);
    const hasAllowedMimeType = allowedUploadMimeTypes.has(file.mimetype);
    if (!hasAllowedExtension || !hasAllowedMimeType) {
      callback(
        new ValidationError(
          "Upload must be a CSV, BOA .xls billing statement, or Dealertrack SpreadsheetML .xml/.xls export.",
          "INVALID_FILE_TYPE",
        ),
      );
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

  app.get("/ready", asyncHandler(async (_request, response) => {
    try {
      await readinessCheck();
      response.json({ status: "ready" });
    } catch (error) {
      logError("readiness_check_failed", serializeError(error));
      throw new ServiceUnavailableError("Service not ready.");
    }
  }));

  app.post("/login", asyncHandler(async (request, response) => {
    if (!authRepository) {
      throw new ServiceUnavailableError("Authentication is not configured.");
    }

    const credentials = parseLoginRequest(request.body);
    if (!credentials) {
      throw new ValidationError("Email and password are required.", "INVALID_CREDENTIALS");
    }

    const user = await authRepository.findUserByEmail(credentials.email);
    if (!user || !(await verifyPassword(credentials.password, user.password_hash))) {
      throw new UnauthorizedError("Invalid email or password.", "INVALID_CREDENTIALS");
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
  }));

  app.use(asyncHandler(async (request, response, next) => {
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
    throw new UnauthorizedError("Authentication required.", "AUTH_REQUIRED");
  }));

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

  app.get("/audit-events", asyncHandler(async (request, response) => {
    if (!hasAnyRole(getAuthenticatedUser(response), ["platform_admin", "dealer_group_admin", "read_only_auditor"])) {
      throw new ForbiddenError();
    }
    const limit = parseOptionalPositiveInteger(request.query.limit);
    if (limit === false) {
      throw new ValidationError("Invalid audit query.", "INVALID_QUERY");
    }
    response.json(await repository.listAuditEvents(getRequestDealershipId(response), limit));
  }));

  app.get("/dealer-groups", asyncHandler(async (_request, response) => {
    response.json(await repository.listDealerGroups(getRequestDealershipId(response)));
  }));

  app.get("/stores", asyncHandler(async (_request, response) => {
    response.json(
      filterStoresForUser(
        getAuthenticatedUser(response),
        await repository.listDealershipStores(getRequestDealershipId(response)),
      ),
    );
  }));

  app.post("/stores", asyncHandler(async (request, response) => {
    if (!hasAnyRole(getAuthenticatedUser(response), ["platform_admin", "dealer_group_admin"])) {
      throw new ForbiddenError();
    }
    const store = parseStoreCreateRequest(request.body);
    if (store === false) {
      throw new ValidationError("Invalid store request.", "INVALID_STORE_DATA");
    }
    const createdStore = await repository.createDealershipStore(getRequestDealershipId(response), store);
    await audit(response, "store_created", "dealership_store", createdStore.id, null, createdStore);
    response.status(201).json(createdStore);
  }));

  app.get("/dealer-groups/analytics", asyncHandler(async (_request, response) => {
    response.json(await buildDealerGroupAnalytics(repository, getRequestDealershipId(response)));
  }));

  app.get("/automation/scheduled-jobs", asyncHandler(async (request, response) => {
    const storeId = parseOptionalPositiveInteger(request.query.store_id);
    if (storeId === false) {
      throw new ValidationError("Invalid store_id.", "INVALID_STORE_ID");
    }
    if (!(await canAccessStore(repository, getAuthenticatedUser(response), storeId ?? null))) {
      throw new ForbiddenError("Not authorized for this store.", "STORE_ACCESS_DENIED");
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
  }));

  app.post("/automation/scheduled-jobs", asyncHandler(async (request, response) => {
    if (!hasAnyRole(getAuthenticatedUser(response), ["platform_admin", "dealer_group_admin", "store_manager"])) {
      throw new ForbiddenError();
    }
    const job = parseScheduledReconciliationJobRequest(request.body);
    if (job === false) {
      throw new ValidationError("Invalid scheduled job request.", "INVALID_JOB_DATA");
    }
    if (!(await canAccessStore(repository, getAuthenticatedUser(response), job.dealership_store_id ?? null))) {
      throw new ForbiddenError("Not authorized for this store.", "STORE_ACCESS_DENIED");
    }
    const createdJob = await repository.createScheduledReconciliationJob(getRequestDealershipId(response), job);
    await audit(response, "scheduled_job_created", "scheduled_reconciliation_job", createdJob.id, null, createdJob);
    response.status(201).json(createdJob);
  }));

  app.patch("/automation/scheduled-jobs/:id", asyncHandler(async (request, response) => {
    if (!hasAnyRole(getAuthenticatedUser(response), ["platform_admin", "dealer_group_admin", "store_manager"])) {
      throw new ForbiddenError();
    }
    const jobId = parsePositiveInteger(request.params.id);
    const update = parseScheduledReconciliationJobUpdate(request.body);
    if (jobId === null) {
      throw new NotFoundError("Scheduled job");
    }
    if (update === false) {
      throw new ValidationError("Invalid scheduled job update.", "INVALID_JOB_UPDATE");
    }
    const previousJob = (await repository.listScheduledReconciliationJobs(getRequestDealershipId(response))).find(
      (candidate) => candidate.id === jobId,
    );
    if (!previousJob) {
      throw new NotFoundError("Scheduled job");
    }
    if (!(await canAccessStore(repository, getAuthenticatedUser(response), previousJob.dealership_store_id))) {
      throw new ForbiddenError("Not authorized for this store.", "STORE_ACCESS_DENIED");
    }
    const job = await repository.updateScheduledReconciliationJob(
      getRequestDealershipId(response),
      jobId,
      update,
    );
    if (!job) {
      throw new NotFoundError("Scheduled job");
    }
    await audit(response, "scheduled_job_updated", "scheduled_reconciliation_job", job.id, previousJob, job);
    response.json(job);
  }));

  app.post("/automation/run-due-jobs", asyncHandler(async (request, response) => {
    if (!hasAnyRole(getAuthenticatedUser(response), ["platform_admin", "dealer_group_admin", "store_manager"])) {
      throw new ForbiddenError();
    }
    response.json({
      runs: await runDueScheduledJobs(
        repository,
        getRequestDealershipId(response),
        typeof request.body?.now === "string" ? request.body.now : undefined,
      ),
    });
  }));

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

  app.get("/reports/month-end", asyncHandler(async (request, response) => {
    const reportQuery = parseMonthEndReportQuery(request.query);
    if (reportQuery === false) {
      throw new ValidationError("Invalid month-end report query.", "INVALID_QUERY");
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
  }));

  app.post("/upload", upload.single("file"), asyncHandler(async (request, response) => {
    const sourceType = request.body.source_type;
    if (!isSourceType(sourceType)) {
      throw new ValidationError("Invalid source_type.", "INVALID_SOURCE_TYPE");
    }
    if (!request.file) {
      throw new ValidationError("File is required.", "FILE_REQUIRED");
    }

    const fileHash = createFileHash(request.file.buffer);
    const requestDealershipId = getRequestDealershipId(response);
    const uploadedByUserId = getAuthenticatedUser(response).id === 0
      ? null
      : getAuthenticatedUser(response).id;
    const dealershipStoreId = await resolveStoreIdForRequest(
      repository,
      requestDealershipId,
      request.body.store_id,
    );
    if (dealershipStoreId === false) {
      throw new ValidationError("Invalid store_id.", "INVALID_STORE_ID");
    }
    if (!canWrite(getAuthenticatedUser(response))) {
      throw new ForbiddenError("Read-only users cannot upload files.", "READ_ONLY_USER");
    }
    if (!(await canAccessStore(repository, getAuthenticatedUser(response), dealershipStoreId))) {
      throw new ForbiddenError("Not authorized for this store.", "STORE_ACCESS_DENIED");
    }
    const dealershipStores = await repository.listDealershipStores(requestDealershipId);
    const selectedStoreName =
      dealershipStores.find((store) => store.id === dealershipStoreId)?.name ?? null;
    const storeWorkflowConfig = resolveStoreWorkflowConfigFromStoreName(selectedStoreName);
    const duplicateSourceFile = await repository.getSourceFileByHash(
      requestDealershipId,
      dealershipStoreId,
      sourceType,
      fileHash,
    );
    let unhealthyDuplicate:
      | {
          sourceFile: SourceFile;
          health: SourceFileHealth;
        }
      | null = null;
    if (duplicateSourceFile) {
      const reusedTransactions = await repository.listBySourceFile(
        requestDealershipId,
        duplicateSourceFile.id,
      );
      const storeName =
        dealershipStores.find((store) => store.id === duplicateSourceFile.dealership_store_id)
          ?.name ?? null;
      const duplicateHealth = assessSourceFileHealth(
        duplicateSourceFile,
        reusedTransactions.length,
      );
      if (!duplicateHealth.healthy) {
        unhealthyDuplicate = { sourceFile: duplicateSourceFile, health: duplicateHealth };
      } else {
        await repository.createIngestionEvent(requestDealershipId, {
          dealership_store_id: dealershipStoreId,
          source_file_id: duplicateSourceFile.id,
          reconciliation_run_id: null,
          source_type: sourceType,
          state: "uploaded",
          message: "Existing upload reused.",
          metadata: {
            file_hash: fileHash,
            requested_filename: request.file.originalname ?? null,
            existing_source_file_id: duplicateSourceFile.id,
            existing_filename: duplicateSourceFile.original_filename,
          },
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
        const autoRun = await evaluateAutoRunAfterUpload(
          repository,
          requestDealershipId,
          duplicateSourceFile,
          uploadedByUserId,
        );
        response.json({
          source_file_id: duplicateSourceFile.id,
          dealership_store_id: duplicateSourceFile.dealership_store_id,
          store_name: storeName,
          source_type: sourceType,
          filename: duplicateSourceFile.original_filename,
          transaction_count: reusedTransactions.length,
          stored_row_count: duplicateSourceFile.row_count,
          stored_validation_error_count: duplicateSourceFile.validation_error_count,
          validation_errors: [],
          automated_reconciliation_run_id: autoRun?.id ?? null,
          reused_existing_file: true,
          source_file_health: duplicateHealth,
          warnings: warningsForReusedSourceFile(duplicateSourceFile),
          existing_file: {
            source_file_id: duplicateSourceFile.id,
            filename: duplicateSourceFile.original_filename,
            store_name: storeName,
            source_type: duplicateSourceFile.source_type,
            created_at: duplicateSourceFile.created_at,
          },
          preprocessing: null,
        });
        return;
      }

      await repository.createOperationalEvent(requestDealershipId, {
        dealership_store_id: dealershipStoreId,
        reconciliation_run_id: null,
        event_type: "duplicate_upload_warning",
        severity: "warning",
        message: "Duplicate upload matched an unhealthy existing source file; reprocessing with the current parser.",
        metadata: {
          source_type: sourceType,
          source_file_id: duplicateSourceFile.id,
          file_hash: fileHash,
          health: duplicateHealth,
        },
      });
    }

    const preprocessingResult = runUploadPreprocessing(
      request.file.buffer,
      sourceType,
      request.file.originalname ?? null,
      storeWorkflowConfig,
    );
    if (preprocessingResult.kind === "unsupported") {
      await repository.createIngestionEvent(requestDealershipId, {
        dealership_store_id: dealershipStoreId,
        source_file_id: null,
        reconciliation_run_id: null,
        source_type: sourceType,
        state: "failed",
        message: preprocessingResult.detail,
        metadata: {
          file_hash: fileHash,
          filename: request.file.originalname ?? null,
          preprocessing: preprocessingResult.preprocessingMetadata,
        },
      });
      throw new ValidationError(
        preprocessingResult.detail,
        "UNSUPPORTED_FILE_FORMAT",
        { preprocessing: preprocessingResult.preprocessingMetadata }
      );
    }
    const result = {
      transactions: preprocessingResult.transactions,
      validationErrors: preprocessingResult.validationErrors,
    };
    const sourceFileInput = {
      source_type: sourceType,
      dealership_store_id: dealershipStoreId,
      original_filename: request.file.originalname || "upload.csv",
      stored_filename: null,
      file_hash: fileHash,
      row_count: result.transactions.length,
      validation_error_count: result.validationErrors.length,
    };
    const importResult = unhealthyDuplicate
      ? await repository.replaceSourceFileWithTransactions(
          requestDealershipId,
          unhealthyDuplicate.sourceFile.id,
          sourceFileInput,
          result.transactions,
          {
            filename: request.file.originalname || "upload.csv",
            content_type: request.file.mimetype || "application/octet-stream",
            file_size: request.file.size,
            content: request.file.buffer,
          },
        )
      : await repository.createSourceFileWithTransactions(
          requestDealershipId,
          sourceFileInput,
          result.transactions,
          {
            filename: request.file.originalname || "upload.csv",
            content_type: request.file.mimetype || "application/octet-stream",
            file_size: request.file.size,
            content: request.file.buffer,
          },
        );
    if (!importResult) {
      throw new NotFoundError("Source file");
    }
    await repository.createIngestionEvent(requestDealershipId, {
      dealership_store_id: importResult.sourceFile.dealership_store_id,
      source_file_id: importResult.sourceFile.id,
      reconciliation_run_id: null,
      source_type: sourceType,
      state: "uploaded",
      message: unhealthyDuplicate ? "Unhealthy existing upload reprocessed." : "File uploaded.",
      metadata: {
        filename: importResult.sourceFile.original_filename,
        file_hash: fileHash,
        reused_existing_file: false,
        previous_health: unhealthyDuplicate?.health ?? null,
      },
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
        preprocessing: preprocessingResult.preprocessingMetadata,
      },
    });
    const autoRun = await evaluateAutoRunAfterUpload(
      repository,
      requestDealershipId,
      importResult.sourceFile,
      uploadedByUserId,
    );

    response.json({
      source_file_id: importResult.sourceFile.id,
      dealership_store_id: importResult.sourceFile.dealership_store_id,
      store_name: dealershipStores.find(
        (store) => store.id === importResult.sourceFile.dealership_store_id,
      )?.name ?? null,
      source_type: sourceType,
      filename: importResult.sourceFile.original_filename,
      transaction_count: importResult.transactions.length,
      stored_row_count: importResult.sourceFile.row_count,
      stored_validation_error_count: importResult.sourceFile.validation_error_count,
      validation_errors: result.validationErrors,
      automated_reconciliation_run_id: autoRun?.id ?? null,
      reused_existing_file: false,
      source_file_health: assessSourceFileHealth(
        importResult.sourceFile,
        importResult.transactions.length,
        unhealthyDuplicate ? "reprocessed" : undefined,
      ),
      warnings: unhealthyDuplicate
        ? [
            `Existing source file ${unhealthyDuplicate.sourceFile.id} was unhealthy and was reprocessed with the current parser.`,
          ]
        : [],
      preprocessing: preprocessingResult.preprocessingMetadata,
    });
  }));

  app.post("/reconcile", asyncHandler(async (request, response) => {
    const body = (request.body ?? {}) as ReconciliationRequest;
    const boaSourceFileId = parseSourceFileId(body.boa_source_file_id);
    const dealertrackSourceFileId = parseSourceFileId(body.dealertrack_source_file_id);
    const requestedStoreId = parseOptionalPositiveInteger(body.dealership_store_id);

    if (boaSourceFileId === null) {
      throw new ValidationError("boa_source_file_id is required.", "BOA_SOURCE_FILE_ID_REQUIRED");
    }
    if (dealertrackSourceFileId === null) {
      throw new ValidationError("dealertrack_source_file_id is required.", "DEALERTRACK_SOURCE_FILE_ID_REQUIRED");
    }
    if (requestedStoreId === false) {
      throw new ValidationError("Invalid dealership_store_id.", "INVALID_DEALERSHIP_STORE_ID");
    }
    if (!canWrite(getAuthenticatedUser(response))) {
      throw new ForbiddenError("Read-only users cannot run reconciliation.", "READ_ONLY_USER");
    }

    const [boaSourceFile, dealertrackSourceFile] = await Promise.all([
      repository.getSourceFile(boaSourceFileId),
      repository.getSourceFile(dealertrackSourceFileId),
    ]);

    const requestDealershipId = getRequestDealershipId(response);
    if (!boaSourceFile || !dealertrackSourceFile) {
      throw new NotFoundError("Source file");
    }
    if (
      boaSourceFile.dealership_id !== requestDealershipId ||
      dealertrackSourceFile.dealership_id !== requestDealershipId
    ) {
      throw new ForbiddenError("Source file belongs to another dealership.", "DEALERSHIP_MISMATCH");
    }
    const reconciliationStoreId = requestedStoreId ?? boaSourceFile.dealership_store_id;
    if (!(await canAccessStore(repository, getAuthenticatedUser(response), reconciliationStoreId))) {
      throw new ForbiddenError("Not authorized for this store.", "STORE_ACCESS_DENIED");
    }
    if (
      boaSourceFile.dealership_store_id !== dealertrackSourceFile.dealership_store_id ||
      (reconciliationStoreId !== null &&
        (boaSourceFile.dealership_store_id !== reconciliationStoreId ||
          dealertrackSourceFile.dealership_store_id !== reconciliationStoreId))
    ) {
      throw new BadRequestError("BOA and Dealertrack uploads must belong to the selected store.");
    }

    if (
      boaSourceFile.source_type !== "boa" ||
      dealertrackSourceFile.source_type !== "dealertrack"
    ) {
      throw new BadRequestError(
        "boa_source_file_id must reference a BOA upload and dealertrack_source_file_id must reference a Dealertrack upload."
      );
    }

    const { run, result } = await createReconciliationRunFromSourceFiles({
      repository,
      dealershipId: requestDealershipId,
      boaSourceFile,
      dealertrackSourceFile,
      automated: false,
      uploadedByUserId: getAuthenticatedUser(response).id === 0
        ? null
        : getAuthenticatedUser(response).id,
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
  }));

  app.get("/reconciliation-runs", asyncHandler(async (_request, response) => {
    const dealershipStoreId = parseOptionalPositiveInteger(_request.query.store_id);
    if (dealershipStoreId === false) {
      throw new ValidationError("Invalid store_id.", "INVALID_STORE_ID");
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
  }));

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

      const priors = await repository.listPriorUnresolvedExceptions(
        getRequestDealershipId(response),
        {
          dealershipStoreId: detail.dealership_store_id,
          excludeRunId: reconciliationRunId,
          createdBefore: detail.created_at,
        },
      );
      response.json(applyCarryForwardToDetail(detail, priors));
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

  app.get("/reconciliation-runs/:id/snapshot", asyncHandler(async (request, response) => {
    const reconciliationRunId = parsePositiveInteger(request.params.id);
    if (reconciliationRunId === null) {
      throw new NotFoundError("Reconciliation run");
    }

    const runDetail = await repository.getReconciliationRunDetail(
      getRequestDealershipId(response),
      reconciliationRunId,
    );
    if (!runDetail) {
      const ownerDealershipId =
        await repository.getReconciliationRunDealershipId(reconciliationRunId);
      if (ownerDealershipId !== null && ownerDealershipId !== getRequestDealershipId(response)) {
        throw new ForbiddenError("Reconciliation run belongs to another dealership.", "DEALERSHIP_MISMATCH");
      }
      throw new NotFoundError("Reconciliation run");
    }
    if (!(await canAccessStore(repository, getAuthenticatedUser(response), runDetail.dealership_store_id))) {
      throw new ForbiddenError("Not authorized for this store.", "STORE_ACCESS_DENIED");
    }

    const snapshot = await repository.getReconciliationRunSnapshot(
      getRequestDealershipId(response),
      reconciliationRunId,
    );
    if (!snapshot) {
      throw new NotFoundError("Reconciliation snapshot");
    }

    response.json(snapshot);
  }));

  app.get("/reconciliation-runs/:id/replay", asyncHandler(async (request, response) => {
    const reconciliationRunId = parsePositiveInteger(request.params.id);
    if (reconciliationRunId === null) {
      throw new NotFoundError("Reconciliation run");
    }

    const runDetail = await repository.getReconciliationRunDetail(
      getRequestDealershipId(response),
      reconciliationRunId,
    );
    if (!runDetail) {
      const ownerDealershipId =
        await repository.getReconciliationRunDealershipId(reconciliationRunId);
      if (ownerDealershipId !== null && ownerDealershipId !== getRequestDealershipId(response)) {
        throw new ForbiddenError("Reconciliation run belongs to another dealership.", "DEALERSHIP_MISMATCH");
      }
      throw new NotFoundError("Reconciliation run");
    }
    if (!(await canAccessStore(repository, getAuthenticatedUser(response), runDetail.dealership_store_id))) {
      throw new ForbiddenError("Not authorized for this store.", "STORE_ACCESS_DENIED");
    }

    const replay = await buildReconciliationReplay(
      repository,
      getRequestDealershipId(response),
      reconciliationRunId,
    );
    if (!replay) {
      throw new NotFoundError("Reconciliation snapshot");
    }
    await audit(response, "reconciliation_replay", "reconciliation_run", reconciliationRunId, null, {
      results_changed: replay.results_changed,
      matched_count_delta: replay.matched_count_delta,
      exception_count_delta: replay.exception_count_delta,
    });

    response.json(replay);
  }));

  app.get("/reconciliation-runs/:id/artifacts", asyncHandler(async (request, response) => {
    const reconciliationRunId = parsePositiveInteger(request.params.id);
    if (reconciliationRunId === null) {
      throw new NotFoundError("Reconciliation run");
    }

    const detail = await repository.getReconciliationRunDetail(
      getRequestDealershipId(response),
      reconciliationRunId,
    );
    if (!detail) {
      const ownerDealershipId =
        await repository.getReconciliationRunDealershipId(reconciliationRunId);
      if (ownerDealershipId !== null && ownerDealershipId !== getRequestDealershipId(response)) {
        throw new ForbiddenError("Reconciliation run belongs to another dealership.", "DEALERSHIP_MISMATCH");
      }
      throw new NotFoundError("Reconciliation run");
    }
    if (!(await canAccessStore(repository, getAuthenticatedUser(response), detail.dealership_store_id))) {
      throw new ForbiddenError("Not authorized for this store.", "STORE_ACCESS_DENIED");
    }

    response.json(
      await repository.listReconciliationArtifacts(
        getRequestDealershipId(response),
        reconciliationRunId,
      ),
    );
  }));

  app.get("/artifacts/:artifactId/download", asyncHandler(async (request, response) => {
    const artifactId = parsePositiveInteger(request.params.artifactId);
    if (artifactId === null) {
      throw new NotFoundError("Artifact");
    }

    const artifact = await repository.getReconciliationArtifact(
      getRequestDealershipId(response),
      artifactId,
    );
    if (!artifact) {
      throw new NotFoundError("Artifact");
    }
    if (!(await canAccessStore(repository, getAuthenticatedUser(response), artifact.store_id))) {
      throw new ForbiddenError("Not authorized for this store.", "STORE_ACCESS_DENIED");
    }

    sendArtifactDownload(response, artifact);
  }));

  app.get("/reconciliation-runs/:id/exceptions.csv", asyncHandler(async (request, response) => {
    const reconciliationRunId = parsePositiveInteger(request.params.id);
    if (reconciliationRunId === null) {
      throw new NotFoundError("Reconciliation run");
    }

    const filters = parseReconciliationRunDetailFilters(request.query);
    if (filters === false) {
      throw new ValidationError("Invalid reconciliation run filter.", "INVALID_FILTER");
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
        throw new ForbiddenError("Reconciliation run belongs to another dealership.", "DEALERSHIP_MISMATCH");
      }
      throw new NotFoundError("Reconciliation run");
    }
    if (!(await canAccessStore(repository, getAuthenticatedUser(response), detail.dealership_store_id))) {
      throw new ForbiddenError("Not authorized for this store.", "STORE_ACCESS_DENIED");
    }

    response
      .status(200)
      .type("text/csv")
      .setHeader(
        "Content-Disposition",
        `attachment; filename="reconciliation-run-${reconciliationRunId}-exceptions.csv"`,
      )
      .send(toExceptionsCsv(detail));
  }));

  app.get("/reconciliation-runs/:id/merged-floorplan", asyncHandler(async (request, response) => {
    const reconciliationRunId = parsePositiveInteger(request.params.id);
    if (reconciliationRunId === null) {
      throw new NotFoundError("Reconciliation run");
    }

    const detail = await repository.getReconciliationRunDetail(
      getRequestDealershipId(response),
      reconciliationRunId,
    );
    if (!detail) {
      const ownerDealershipId =
        await repository.getReconciliationRunDealershipId(reconciliationRunId);
      if (ownerDealershipId !== null && ownerDealershipId !== getRequestDealershipId(response)) {
        throw new ForbiddenError("Reconciliation run belongs to another dealership.", "DEALERSHIP_MISMATCH");
      }
      throw new NotFoundError("Reconciliation run");
    }
    if (!(await canAccessStore(repository, getAuthenticatedUser(response), detail.dealership_store_id))) {
      throw new ForbiddenError("Not authorized for this store.", "STORE_ACCESS_DENIED");
    }

    const storeKeyOverrideProvided = request.query.store_key !== undefined;
    const storeKey = parseStoreKey(request.query.store_key);
    if (storeKeyOverrideProvided && !storeKey) {
      throw new ValidationError(
        `store_key must be one of: ${STORE_KEYS.join(", ")}.`,
        "INVALID_STORE_KEY",
        { supported_store_keys: [...STORE_KEYS] },
      );
    }
    const storeConfig = storeKey
      ? getStoreWorkflowConfig(storeKey)
      : resolveStoreWorkflowConfigFromStoreName(detail.store_name);
    if (!storeConfig) {
      throw new ValidationError(
        "No store workflow config is configured for this reconciliation run.",
        "STORE_WORKFLOW_CONFIG_NOT_FOUND",
        {
          dealership_store_id: detail.dealership_store_id,
          store_name: detail.store_name,
          supported_store_keys: [...STORE_KEYS],
        },
      );
    }
    const format = typeof request.query.format === "string" ? request.query.format : "xls";
    if (format !== "json" && !storeKeyOverrideProvided) {
      const storedArtifact = await repository.findReconciliationArtifact(
        getRequestDealershipId(response),
        reconciliationRunId,
        "MERGED_FLOORPLAN",
      );
      if (storedArtifact) {
        sendArtifactDownload(response, storedArtifact);
        return;
      }
    }

    const [boaTransactions, dealertrackTransactions] = await Promise.all([
      repository.listBySourceFile(getRequestDealershipId(response), detail.boa_source_file_id),
      repository.listBySourceFile(getRequestDealershipId(response), detail.dealertrack_source_file_id),
    ]);
    const artifact = buildMergedFloorplanArtifactFromTransactions(
      detail,
      storeConfig,
      boaTransactions,
      dealertrackTransactions,
    );
    if (format === "json") {
      response.json(artifact.workbook);
      return;
    }

    response
      .status(200)
      .type(artifact.contentType)
      .setHeader(
        "Content-Disposition",
        `attachment; filename="${artifact.filename}"`,
      )
      .send(artifact.html);
  }));

  const fpRecExportHandler = asyncHandler(async (request, response) => {
    const reconciliationRunId = parsePositiveInteger(request.params.id);
    if (reconciliationRunId === null) {
      throw new NotFoundError("Reconciliation run");
    }

    const detail = await repository.getReconciliationRunDetail(
      getRequestDealershipId(response),
      reconciliationRunId,
    );
    if (!detail) {
      const ownerDealershipId =
        await repository.getReconciliationRunDealershipId(reconciliationRunId);
      if (ownerDealershipId !== null && ownerDealershipId !== getRequestDealershipId(response)) {
        throw new ForbiddenError("Reconciliation run belongs to another dealership.", "DEALERSHIP_MISMATCH");
      }
      throw new NotFoundError("Reconciliation run");
    }
    if (!(await canAccessStore(repository, getAuthenticatedUser(response), detail.dealership_store_id))) {
      throw new ForbiddenError("Not authorized for this store.", "STORE_ACCESS_DENIED");
    }

    const storeKeyOverrideProvided = request.query.store_key !== undefined;
    const storeKey = parseStoreKey(request.query.store_key);
    if (storeKeyOverrideProvided && !storeKey) {
      throw new ValidationError(
        `store_key must be one of: ${STORE_KEYS.join(", ")}.`,
        "INVALID_STORE_KEY",
        { supported_store_keys: [...STORE_KEYS] },
      );
    }
    const storeConfig = storeKey
      ? getStoreWorkflowConfig(storeKey)
      : resolveStoreWorkflowConfigFromStoreName(detail.store_name);
    if (!storeConfig) {
      throw new ValidationError(
        "No store workflow config is configured for this reconciliation run.",
        "STORE_WORKFLOW_CONFIG_NOT_FOUND",
        {
          dealership_store_id: detail.dealership_store_id,
          store_name: detail.store_name,
          supported_store_keys: [...STORE_KEYS],
        },
      );
    }
    const format = typeof request.query.format === "string" ? request.query.format : "xls";
    if (format !== "json" && !storeKeyOverrideProvided) {
      const storedArtifact = await repository.findReconciliationArtifact(
        getRequestDealershipId(response),
        reconciliationRunId,
        "FP_REC",
      );
      if (storedArtifact) {
        sendArtifactDownload(response, storedArtifact);
        return;
      }
    }

    const [boaTransactions, dealertrackTransactions] = await Promise.all([
      repository.listBySourceFile(getRequestDealershipId(response), detail.boa_source_file_id),
      repository.listBySourceFile(getRequestDealershipId(response), detail.dealertrack_source_file_id),
    ]);
    const mergedArtifact = buildMergedFloorplanArtifactFromTransactions(
      detail,
      storeConfig,
      boaTransactions,
      dealertrackTransactions,
    );
    const workbook = buildFpRecWorkbookFromMergedFloorplan(mergedArtifact.workbook);
    if (format === "json") {
      response.json(workbook);
      return;
    }

    response
      .status(200)
      .type("application/vnd.ms-excel")
      .setHeader(
        "Content-Disposition",
        `attachment; filename="${toHurstFpRecFilename(workbook)}"`,
      )
      .send(toHurstFpRecXlsHtml(workbook));
  });

  app.get("/reconciliation-runs/:id/fp-rec", fpRecExportHandler);
  app.get("/reconciliation-runs/:id/hurst-fp-rec", fpRecExportHandler);

  app.patch(
    "/reconciliation-runs/:id/exceptions/:exception_id",
    asyncHandler(async (request, response) => {
      const reconciliationRunId = parsePositiveInteger(request.params.id);
      const exceptionId = parsePositiveInteger(request.params.exception_id);
      if (reconciliationRunId === null || exceptionId === null) {
        throw new NotFoundError("Reconciliation exception");
      }
      if (!canWrite(getAuthenticatedUser(response))) {
        throw new ForbiddenError("Read-only users cannot update review workflow.", "READ_ONLY_USER");
      }

      const update = parseExceptionReviewUpdate(request.body);
      if (update === false) {
        throw new ValidationError("Invalid exception review update.", "INVALID_EXCEPTION_REVIEW_UPDATE");
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
        throw new ForbiddenError("Not authorized for this store.", "STORE_ACCESS_DENIED");
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
          throw new ForbiddenError("Reconciliation exception belongs to another dealership.", "DEALERSHIP_MISMATCH");
        }
        throw new NotFoundError("Reconciliation exception");
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
    }),
  );

  app.get(
    "/source-files/:sourceFileId/transactions",
    asyncHandler(async (request, response) => {
      const sourceFileId = parsePositiveInteger(request.params.sourceFileId);
      if (sourceFileId === null) {
        throw new NotFoundError("Source file");
      }
      const dealershipId = getRequestDealershipId(response);
      const sourceFile = await repository.getSourceFile(sourceFileId);
      if (!sourceFile || sourceFile.dealership_id !== dealershipId) {
        throw new NotFoundError("Source file");
      }
      if (
        !(await canAccessStore(
          repository,
          getAuthenticatedUser(response),
          sourceFile.dealership_store_id,
        ))
      ) {
        throw new ForbiddenError("Not authorized for this store.", "STORE_ACCESS_DENIED");
      }
      const transactions = await repository.listBySourceFile(dealershipId, sourceFileId);
      response.json(
        transactions.map((transaction) => {
          const lineage = readLineage(transaction.raw_data ?? {});
          return {
            id: transaction.id,
            source_type: transaction.source_type,
            source_file_id: transaction.source_file_id,
            stock_number: transaction.stock_number,
            vin: transaction.vin,
            source_row_number: lineage?.source_row_number ?? null,
            vin_provenance: lineage?.vin_provenance ?? null,
          };
        }),
      );
    }),
  );

  app.post(
    "/transactions/:transactionId/vin-enrichment",
    asyncHandler(async (request, response) => {
      const transactionId = parsePositiveInteger(request.params.transactionId);
      if (transactionId === null) {
        throw new NotFoundError("Transaction");
      }
      if (!canWrite(getAuthenticatedUser(response))) {
        throw new ForbiddenError("Read-only users cannot enrich VINs.", "READ_ONLY_USER");
      }

      const parsed = parseVinEnrichmentRequest(request.body);
      if ("error" in parsed) {
        throw new ValidationError(vinEnrichmentErrorMessage(parsed.error), "INVALID_VIN_ENRICHMENT_REQUEST");
      }

      const dealershipId = getRequestDealershipId(response);
      const transaction = await repository.getTransactionById(dealershipId, transactionId);
      if (!transaction) {
        throw new NotFoundError("Transaction");
      }
      if (transaction.source_type !== "dealertrack") {
        throw new ValidationError(
          "Manual VIN enrichment is only supported for Dealertrack transactions.",
          "UNSUPPORTED_SOURCE_TYPE"
        );
      }

      const sourceFile = transaction.source_file_id
        ? await repository.getSourceFile(transaction.source_file_id)
        : null;
      const storeId = sourceFile?.dealership_store_id ?? null;
      if (!(await canAccessStore(repository, getAuthenticatedUser(response), storeId))) {
        throw new ForbiddenError("Not authorized for this store.", "STORE_ACCESS_DENIED");
      }

      const user = getAuthenticatedUser(response);
      const enrichmentInput: ManualVinEnrichmentInput = {
        vin: parsed.vin,
        source: parsed.source,
        enriched_by: user.email || `user:${user.id}`,
        note: parsed.dms_reference
          ? `${parsed.reason} dms_reference=${parsed.dms_reference}`
          : parsed.reason,
      };
      const result = applyManualVinEnrichment(transaction, enrichmentInput);
      if (!result.ok) {
        if (result.reason === "no_change") {
          throw new ConflictError("VIN is already set to the requested value.", "VIN_NO_CHANGE");
        }
        throw new ValidationError("Invalid VIN.", "INVALID_VIN");
      }

      const previousLineage = readLineage(transaction.raw_data ?? {});
      const updated = await repository.updateTransactionVinAndRawData(
        dealershipId,
        transactionId,
        { vin: result.vin, raw_data: result.raw_data },
      );
      if (!updated) {
        throw new NotFoundError("Transaction");
      }

      const auditEvent = await repository.createAuditEvent(dealershipId, {
        actor_user_id: user.id === 0 ? null : user.id,
        action_type: "vin_enrichment_applied",
        entity_type: "transaction",
        entity_id: String(transactionId),
        previous_state: toAuditState({
          vin: transaction.vin,
          lineage_summary: summarizeLineage(previousLineage),
        }),
        new_state: toAuditState({
          transaction_id: transactionId,
          source_file_id: transaction.source_file_id,
          dealership_store_id: storeId,
          vin: result.vin,
          vin6: result.vin6,
          source: parsed.source,
          reason: parsed.reason,
          dms_reference: parsed.dms_reference,
        }),
      });

      response.json({
        transaction: updated,
        enrichment_applied: true,
        vin6: result.vin6,
        source: parsed.source,
        audit_event_id: auditEvent?.id ?? null,
        requires_rerun: true,
      });
    }),
  );

  // Centralized error handling middleware
  app.use(errorHandler);

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

function sendArtifactDownload(
  response: express.Response,
  artifact: ReconciliationArtifact,
): void {
  response
    .status(200)
    .type(artifact.content_type)
    .setHeader("Content-Length", String(artifact.file_size))
    .setHeader(
      "Content-Disposition",
      `attachment; filename="${safeHeaderFilename(artifact.filename)}"`,
    )
    .send(artifact.content);
}

function safeHeaderFilename(filename: string): string {
  return filename.replace(/[\r\n"]/g, "_");
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

type SourceFileHealthStatus = "healthy" | "unhealthy" | "reprocessed";

type SourceFileHealth = {
  status: SourceFileHealthStatus;
  healthy: boolean;
  reasons: string[];
  transaction_count: number;
  row_count: number;
  validation_error_count: number;
};

function assessSourceFileHealth(
  sourceFile: Pick<SourceFile, "row_count" | "validation_error_count">,
  transactionCount: number,
  statusOverride?: SourceFileHealthStatus,
): SourceFileHealth {
  const reasons: string[] = [];
  if (transactionCount <= 0) {
    reasons.push("no_persisted_transactions");
  }
  if (sourceFile.row_count <= 0) {
    reasons.push("stored_row_count_zero");
  }
  const attemptedRows = sourceFile.row_count + sourceFile.validation_error_count;
  if (attemptedRows > 0 && sourceFile.validation_error_count >= attemptedRows) {
    reasons.push("validation_errors_indicate_total_parser_failure");
  }

  const healthy = reasons.length === 0;
  return {
    status: statusOverride ?? (healthy ? "healthy" : "unhealthy"),
    healthy,
    reasons,
    transaction_count: transactionCount,
    row_count: sourceFile.row_count,
    validation_error_count: sourceFile.validation_error_count,
  };
}

function warningsForReusedSourceFile(
  sourceFile: Pick<SourceFile, "validation_error_count">,
): string[] {
  if (sourceFile.validation_error_count <= 0) {
    return [];
  }
  return [
    `Existing upload was reused with ${sourceFile.validation_error_count} stored validation error${
      sourceFile.validation_error_count === 1 ? "" : "s"
    }. Detailed row-level validation errors are not stored for reused uploads.`,
  ];
}

// uploadErrorMessage function removed - now handled in errorHandler middleware

function vinEnrichmentErrorMessage(
  error: "invalid_vin" | "invalid_source" | "missing_reason" | "invalid_body" | "invalid_dms_reference",
): string {
  switch (error) {
    case "invalid_vin":
      return "VIN must be a valid 17-character VIN.";
    case "invalid_source":
      return "source must be one of manual_enrichment, dms_assisted_reconstruction, stock_number_lookup.";
    case "missing_reason":
      return "reason is required.";
    case "invalid_dms_reference":
      return "dms_reference must be a string.";
    case "invalid_body":
    default:
      return "Invalid VIN enrichment request.";
  }
}

function summarizeLineage(lineage: RawDataLineage | null): Record<string, unknown> | null {
  if (!lineage) {
    return null;
  }
  return {
    source_kind: lineage.source_kind,
    source_row_number: lineage.source_row_number,
    retained_reason: lineage.retained_reason,
    vin_provenance: lineage.vin_provenance,
    transformations_count: lineage.transformations.length,
  };
}


/** A single row that was removed during preprocessing — surfaced for audit. */
type RemovedRow = {
  source: "boa" | "dealertrack";
  source_row_number: number | null;
  removal_reason: string;
  key_values: Record<string, string>;
};

const REMOVAL_KINDS = new Set<PreprocessingDiagnosticKind>([
  "banner_row_removed",
  "zero_balance_row_removed",
  "straightline_row_removed",
  "row_skipped_unknown_structure",
  "row_skipped_malformed",
  "missing_amount",
]);

const REMOVAL_REASON_LABELS: Record<string, string> = {
  banner_row_removed: "Banner/header/subtotal row",
  zero_balance_row_removed: "Zero balance — excluded from reconciliation",
  straightline_row_removed: "Straightline row — excluded from reconciliation",
  row_skipped_unknown_structure: "Unrecognized row structure",
  row_skipped_malformed: "Malformed row",
  missing_amount: "No valid amount found",
};

function buildRemovedRows(
  diagnostics: PreprocessingDiagnostic[],
  sourceKind: "boa" | "dealertrack",
): RemovedRow[] {
  return diagnostics
    .filter((d) => REMOVAL_KINDS.has(d.kind as PreprocessingDiagnosticKind))
    .map((d) => ({
      source: sourceKind,
      source_row_number: d.source_row_number,
      removal_reason: REMOVAL_REASON_LABELS[d.kind] ?? d.kind.replace(/_/g, " "),
      key_values: {
        ...(d.stock_number ? { stock: d.stock_number } : {}),
        ...(d.vin6 ? { vin6: d.vin6 } : {}),
        ...(d.details
          ? Object.fromEntries(
              Object.entries(d.details)
                .filter(([, v]) => v !== null && v !== undefined)
                .map(([k, v]) => [k, String(v)]),
            )
          : {}),
        message: d.message,
      },
    }));
}

type UploadPreprocessingMetadata = {
  detected_format: string;
  detection_confidence: string;
  detection_reason: string;
  parser_route: string;
  preprocessing_version: string | null;
  summary: PreprocessingSummary | null;
  diagnostics: PreprocessingDiagnostic[];
  removed_rows: RemovedRow[];
  legacy_csv_path: boolean;
  unsupported_reason: string | null;
};

type UploadPreprocessingResult =
  | {
      kind: "ok";
      transactions: import("./domain/types.js").NewTransaction[];
      validationErrors: import("./domain/types.js").ValidationError[];
      preprocessingMetadata: UploadPreprocessingMetadata;
    }
  | {
      kind: "unsupported";
      statusCode: 422;
      detail: string;
      preprocessingMetadata: UploadPreprocessingMetadata;
    };

function runUploadPreprocessing(
  buffer: Buffer,
  sourceType: import("./domain/types.js").SourceType,
  originalFilename: string | null,
  storeWorkflowConfig?: StoreWorkflowConfig | null,
): UploadPreprocessingResult {
  const decision = preprocessUpload(buffer, sourceType, originalFilename, {
    dealertrack: storeWorkflowConfig
      ? {
          amountColumns: storeWorkflowConfig.dealertrackAmountColumns,
          accountColumn: storeWorkflowConfig.dealertrackAccountColumn,
          accountLabel: storeWorkflowConfig.dealertrackAccountLabel,
          excludedAccountColumns: storeWorkflowConfig.dealertrackExcludedAccountColumns,
        }
      : undefined,
  });
  if (decision.kind === "preprocessed") {
    const { output } = decision;
    return {
      kind: "ok",
      transactions: output.transactions,
      validationErrors: output.validationErrors,
      preprocessingMetadata: {
        detected_format: output.detection.format,
        detection_confidence: output.detection.confidence,
        detection_reason: output.detection.reason,
        parser_route: output.route.kind,
        preprocessing_version: output.summary.preprocessing_version,
        summary: output.summary,
        diagnostics: output.diagnostics,
        removed_rows: buildRemovedRows(
          output.diagnostics,
          output.summary.source_kind,
        ),
        legacy_csv_path: false,
        unsupported_reason: null,
      },
    };
  }
  if (decision.kind === "fallback_legacy_csv") {
    const legacy = normalizeTransactionsFromCsv(buffer, sourceType);
    const csvSourceKind =
      sourceType === "boa" || sourceType === "dealertrack" ? sourceType : "boa";
    return {
      kind: "ok",
      transactions: legacy.transactions,
      validationErrors: legacy.validationErrors,
      preprocessingMetadata: {
        detected_format: decision.detection.format,
        detection_confidence: decision.detection.confidence,
        detection_reason: decision.detection.reason,
        parser_route: decision.route.kind,
        preprocessing_version: null,
        summary: null,
        diagnostics: legacy.diagnostics,
        removed_rows: buildRemovedRows(legacy.diagnostics, csvSourceKind),
        legacy_csv_path: true,
        unsupported_reason: null,
      },
    };
  }
  return {
    kind: "unsupported",
    statusCode: 422,
    detail: decision.reason,
    preprocessingMetadata: {
      detected_format: decision.detection.format,
      detection_confidence: decision.detection.confidence,
      detection_reason: decision.detection.reason,
      parser_route: decision.route.kind,
      preprocessing_version: null,
      summary: null,
      diagnostics: [],
      removed_rows: [],
      legacy_csv_path: false,
      unsupported_reason: decision.reason,
    },
  };
}
