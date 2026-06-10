/**
 * Base HTTP error class for API errors with status codes
 */
export class HttpError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code?: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "HttpError";
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      error: {
        message: this.message,
        ...(this.code ? { code: this.code } : {}),
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }
}

/**
 * 400 Bad Request - Client sent invalid data
 */
export class BadRequestError extends HttpError {
  constructor(message: string, code?: string, details?: Record<string, unknown>) {
    super(message, 400, code, details);
    this.name = "BadRequestError";
  }
}

/**
 * 401 Unauthorized - Authentication required or failed
 */
export class UnauthorizedError extends HttpError {
  constructor(message = "Authentication required.", code?: string) {
    super(message, 401, code);
    this.name = "UnauthorizedError";
  }
}

/**
 * 403 Forbidden - User lacks permission
 */
export class ForbiddenError extends HttpError {
  constructor(message = "Not authorized.", code?: string) {
    super(message, 403, code);
    this.name = "ForbiddenError";
  }
}

/**
 * 404 Not Found - Resource doesn't exist
 */
export class NotFoundError extends HttpError {
  constructor(resource: string, code?: string) {
    super(`${resource} was not found.`, 404, code);
    this.name = "NotFoundError";
  }
}

/**
 * 409 Conflict - Request conflicts with current state
 */
export class ConflictError extends HttpError {
  constructor(message: string, code?: string, details?: Record<string, unknown>) {
    super(message, 409, code, details);
    this.name = "ConflictError";
  }
}

/**
 * 413 Payload Too Large - Request entity too large
 */
export class PayloadTooLargeError extends HttpError {
  constructor(message = "Request payload too large.", code?: string) {
    super(message, 413, code);
    this.name = "PayloadTooLargeError";
  }
}

/**
 * 422 Unprocessable Entity - Validation failed
 */
export class ValidationError extends HttpError {
  constructor(message: string, code?: string, details?: Record<string, unknown>) {
    super(message, 422, code, details);
    this.name = "ValidationError";
  }

  static fromFields(errors: Record<string, string>): ValidationError {
    return new ValidationError("Validation failed.", "VALIDATION_ERROR", { fields: errors });
  }
}

/**
 * 503 Service Unavailable - Service temporarily unavailable
 */
export class ServiceUnavailableError extends HttpError {
  constructor(message = "Service temporarily unavailable.", code?: string) {
    super(message, 503, code);
    this.name = "ServiceUnavailableError";
  }
}
