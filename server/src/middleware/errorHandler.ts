import type express from "express";
import { MulterError } from "multer";

import { HttpError } from "../errors/HttpError.js";
import { CsvNormalizationError } from "../services/transactionNormalizer.js";
import { DuplicateSourceFileError } from "../repositories/transactionRepository.js";
import { logError, serializeError } from "../logger.js";

/**
 * Standard error response format
 */
interface ErrorResponse {
  error: {
    message: string;
    code?: string;
    details?: Record<string, unknown>;
    request_id?: string;
  };
}

/**
 * Centralized error handling middleware
 * Converts all errors to consistent JSON responses
 */
export function errorHandler(
  error: unknown,
  _request: express.Request,
  response: express.Response,
  _next: express.NextFunction,
): void {
  const requestId = response.locals.requestId as string | undefined;

  // Handle Multer file upload errors
  if (error instanceof MulterError) {
    const statusCode = error.code === "LIMIT_FILE_SIZE" ? 413 : 422;
    const message = getMulterErrorMessage(error);
    response.status(statusCode).json({
      error: {
        message,
        code: error.code,
        ...(requestId ? { request_id: requestId } : {}),
      },
    } satisfies ErrorResponse);
    return;
  }

  // Handle custom HTTP errors
  if (error instanceof HttpError) {
    response.status(error.statusCode).json({
      error: {
        message: error.message,
        ...(error.code ? { code: error.code } : {}),
        ...(error.details ? { details: error.details } : {}),
        ...(requestId ? { request_id: requestId } : {}),
      },
    } satisfies ErrorResponse);
    return;
  }

  // Handle legacy CSV normalization errors
  if (error instanceof CsvNormalizationError) {
    response.status(error.statusCode).json({
      error: {
        message: error.message,
        code: "CSV_NORMALIZATION_ERROR",
        ...(requestId ? { request_id: requestId } : {}),
      },
    } satisfies ErrorResponse);
    return;
  }

  // Handle duplicate source file errors
  if (error instanceof DuplicateSourceFileError) {
    response.status(409).json({
      error: {
        message: error.message,
        code: "DUPLICATE_SOURCE_FILE",
        ...(requestId ? { request_id: requestId } : {}),
      },
    } satisfies ErrorResponse);
    return;
  }

  // Log unexpected errors
  logError("request_failed", {
    request_id: requestId,
    ...serializeError(error),
  });

  // Return generic 500 error
  response.status(500).json({
    error: {
      message: "Internal server error.",
      code: "INTERNAL_SERVER_ERROR",
      ...(requestId ? { request_id: requestId } : {}),
    },
  } satisfies ErrorResponse);
}

/**
 * Convert Multer error codes to user-friendly messages
 */
function getMulterErrorMessage(error: MulterError): string {
  switch (error.code) {
    case "LIMIT_FILE_SIZE":
      return "File size exceeds the maximum allowed limit.";
    case "LIMIT_FILE_COUNT":
      return "Too many files uploaded.";
    case "LIMIT_UNEXPECTED_FILE":
      return "Unexpected file field.";
    case "LIMIT_FIELD_KEY":
      return "Field name too long.";
    case "LIMIT_FIELD_VALUE":
      return "Field value too long.";
    case "LIMIT_FIELD_COUNT":
      return "Too many fields.";
    case "LIMIT_PART_COUNT":
      return "Too many parts in multipart request.";
    default:
      return "File upload error.";
  }
}
