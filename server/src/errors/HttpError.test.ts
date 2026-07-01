import { describe, it, expect } from "vitest";
import {
  HttpError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  PayloadTooLargeError,
  ValidationError,
  ServiceUnavailableError,
} from "./HttpError.js";

describe("HttpError", () => {
  it("should create a basic HTTP error", () => {
    const error = new HttpError("Test error", 500);
    expect(error.message).toBe("Test error");
    expect(error.statusCode).toBe(500);
    expect(error.name).toBe("HttpError");
  });

  it("should include error code when provided", () => {
    const error = new HttpError("Test error", 500, "TEST_ERROR");
    expect(error.code).toBe("TEST_ERROR");
  });

  it("should include details when provided", () => {
    const error = new HttpError("Test error", 500, "TEST_ERROR", { field: "value" });
    expect(error.details).toEqual({ field: "value" });
  });

  it("should serialize to JSON correctly", () => {
    const error = new HttpError("Test error", 500, "TEST_ERROR", { field: "value" });
    expect(error.toJSON()).toEqual({
      error: {
        message: "Test error",
        code: "TEST_ERROR",
        details: { field: "value" },
      },
    });
  });

  it("should serialize to JSON without optional fields", () => {
    const error = new HttpError("Test error", 500);
    expect(error.toJSON()).toEqual({
      error: {
        message: "Test error",
      },
    });
  });
});

describe("BadRequestError", () => {
  it("should create a 400 error", () => {
    const error = new BadRequestError("Invalid request");
    expect(error.statusCode).toBe(400);
    expect(error.message).toBe("Invalid request");
    expect(error.name).toBe("BadRequestError");
  });
});

describe("UnauthorizedError", () => {
  it("should create a 401 error with default message", () => {
    const error = new UnauthorizedError();
    expect(error.statusCode).toBe(401);
    expect(error.message).toBe("Authentication required.");
    expect(error.name).toBe("UnauthorizedError");
  });

  it("should create a 401 error with custom message", () => {
    const error = new UnauthorizedError("Invalid token");
    expect(error.message).toBe("Invalid token");
  });
});

describe("ForbiddenError", () => {
  it("should create a 403 error with default message", () => {
    const error = new ForbiddenError();
    expect(error.statusCode).toBe(403);
    expect(error.message).toBe("Not authorized.");
    expect(error.name).toBe("ForbiddenError");
  });

  it("should create a 403 error with custom message", () => {
    const error = new ForbiddenError("Insufficient permissions");
    expect(error.message).toBe("Insufficient permissions");
  });
});

describe("NotFoundError", () => {
  it("should create a 404 error", () => {
    const error = new NotFoundError("User");
    expect(error.statusCode).toBe(404);
    expect(error.message).toBe("User was not found.");
    expect(error.name).toBe("NotFoundError");
  });
});

describe("ConflictError", () => {
  it("should create a 409 error", () => {
    const error = new ConflictError("Resource already exists");
    expect(error.statusCode).toBe(409);
    expect(error.message).toBe("Resource already exists");
    expect(error.name).toBe("ConflictError");
  });
});

describe("PayloadTooLargeError", () => {
  it("should create a 413 error with default message", () => {
    const error = new PayloadTooLargeError();
    expect(error.statusCode).toBe(413);
    expect(error.message).toBe("Request payload too large.");
    expect(error.name).toBe("PayloadTooLargeError");
  });
});

describe("ValidationError", () => {
  it("should create a 422 error", () => {
    const error = new ValidationError("Validation failed");
    expect(error.statusCode).toBe(422);
    expect(error.message).toBe("Validation failed");
    expect(error.name).toBe("ValidationError");
  });

  it("should create from field errors", () => {
    const error = ValidationError.fromFields({
      email: "Email is required.",
      password: "Password must be at least 8 characters.",
    });
    expect(error.statusCode).toBe(422);
    expect(error.message).toBe("Validation failed.");
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.details).toEqual({
      fields: {
        email: "Email is required.",
        password: "Password must be at least 8 characters.",
      },
    });
  });
});

describe("ServiceUnavailableError", () => {
  it("should create a 503 error with default message", () => {
    const error = new ServiceUnavailableError();
    expect(error.statusCode).toBe(503);
    expect(error.message).toBe("Service temporarily unavailable.");
    expect(error.name).toBe("ServiceUnavailableError");
  });
});
