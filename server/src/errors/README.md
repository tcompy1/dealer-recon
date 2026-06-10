# Error Handling System

This directory contains the improved error handling infrastructure for the Dealer Recon API.

## Overview

The error handling system provides:
- **Consistent error responses** across all API endpoints
- **Type-safe error classes** for common HTTP errors
- **Centralized error handling middleware** that catches and formats all errors
- **Structured error responses** with error codes, messages, and optional details
- **Request ID tracking** for debugging and log correlation

## Error Response Format

All API errors follow this consistent JSON structure:

```json
{
  "error": {
    "message": "Human-readable error message",
    "code": "MACHINE_READABLE_ERROR_CODE",
    "details": {
      "additional": "context"
    },
    "request_id": "uuid-for-tracking"
  }
}
```

### Fields

- **message** (required): Human-readable description of the error
- **code** (optional): Machine-readable error code for programmatic handling
- **details** (optional): Additional context about the error (e.g., validation field errors)
- **request_id** (optional): Unique identifier for the request, useful for log correlation

## Error Classes

### HttpError (Base Class)

Base class for all HTTP errors. Rarely used directly.

```typescript
import { HttpError } from "./errors/HttpError.js";

throw new HttpError("Something went wrong", 500, "INTERNAL_ERROR", { context: "value" });
```

### BadRequestError (400)

Client sent invalid data that cannot be processed.

```typescript
import { BadRequestError } from "./errors/HttpError.js";

throw new BadRequestError("Invalid date format", "INVALID_DATE_FORMAT");
```

### UnauthorizedError (401)

Authentication required or authentication failed.

```typescript
import { UnauthorizedError } from "./errors/HttpError.js";

throw new UnauthorizedError("Invalid credentials", "INVALID_CREDENTIALS");
throw new UnauthorizedError(); // Uses default message: "Authentication required."
```

### ForbiddenError (403)

User is authenticated but lacks permission for the requested resource.

```typescript
import { ForbiddenError } from "./errors/HttpError.js";

throw new ForbiddenError("Insufficient permissions", "INSUFFICIENT_PERMISSIONS");
throw new ForbiddenError(); // Uses default message: "Not authorized."
```

### NotFoundError (404)

Requested resource does not exist.

```typescript
import { NotFoundError } from "./errors/HttpError.js";

throw new NotFoundError("User", "USER_NOT_FOUND");
// Response: "User was not found."
```

### ConflictError (409)

Request conflicts with the current state of the server.

```typescript
import { ConflictError } from "./errors/HttpError.js";

throw new ConflictError("Email already registered", "DUPLICATE_EMAIL");
```

### PayloadTooLargeError (413)

Request payload exceeds size limits.

```typescript
import { PayloadTooLargeError } from "./errors/HttpError.js";

throw new PayloadTooLargeError("File exceeds 5MB limit", "FILE_TOO_LARGE");
```

### ValidationError (422)

Request validation failed.

```typescript
import { ValidationError } from "./errors/HttpError.js";

// Simple validation error
throw new ValidationError("Invalid input", "VALIDATION_FAILED");

// Field-specific validation errors
throw ValidationError.fromFields({
  email: "Email is required.",
  password: "Password must be at least 8 characters.",
});
```

### ServiceUnavailableError (503)

Service is temporarily unavailable.

```typescript
import { ServiceUnavailableError } from "./errors/HttpError.js";

throw new ServiceUnavailableError("Database connection failed", "DB_UNAVAILABLE");
```

## Middleware

### errorHandler

Centralized error handling middleware that catches all errors and formats them consistently.

**Features:**
- Handles custom HttpError instances
- Handles Multer file upload errors
- Handles legacy error types (CsvNormalizationError, DuplicateSourceFileError)
- Logs unexpected errors
- Returns consistent JSON error responses
- Includes request ID in responses

**Usage:**

The error handler is automatically registered as the last middleware in the Express app:

```typescript
import { errorHandler } from "./middleware/errorHandler.js";

app.use(errorHandler);
```

### asyncHandler

Wrapper for async route handlers that automatically catches promise rejections and forwards them to the error handling middleware.

**Usage:**

```typescript
import { asyncHandler } from "./middleware/asyncHandler.js";

app.get("/users/:id", asyncHandler(async (request, response) => {
  const user = await findUser(request.params.id);
  if (!user) {
    throw new NotFoundError("User");
  }
  response.json(user);
}));
```

**Benefits:**
- No need for try/catch blocks in route handlers
- Cleaner, more readable code
- Automatic error forwarding to centralized handler

## Migration Guide

### Before (Old Pattern)

```typescript
app.get("/users/:id", async (request, response, next) => {
  try {
    const userId = parsePositiveInteger(request.params.id);
    if (userId === null) {
      response.status(422).json({ detail: "Invalid user ID." });
      return;
    }
    
    const user = await repository.findUser(userId);
    if (!user) {
      response.status(404).json({ detail: "User was not found." });
      return;
    }
    
    response.json(user);
  } catch (error) {
    next(error);
  }
});
```

### After (New Pattern)

```typescript
import { asyncHandler } from "./middleware/asyncHandler.js";
import { ValidationError, NotFoundError } from "./errors/HttpError.js";

app.get("/users/:id", asyncHandler(async (request, response) => {
  const userId = parsePositiveInteger(request.params.id);
  if (userId === null) {
    throw new ValidationError("Invalid user ID.", "INVALID_USER_ID");
  }
  
  const user = await repository.findUser(userId);
  if (!user) {
    throw new NotFoundError("User");
  }
  
  response.json(user);
}));
```

### Benefits of New Pattern

1. **No try/catch boilerplate** - asyncHandler handles it
2. **Consistent error responses** - All errors go through errorHandler
3. **Better error codes** - Machine-readable codes for client handling
4. **Type safety** - TypeScript knows the error types
5. **Cleaner code** - Throw errors instead of manual response.status() calls
6. **Request tracking** - Automatic request_id in all error responses

## Validation Helpers

The `validators/validationHelpers.ts` module provides utilities for building validation logic:

```typescript
import {
  validateRequiredString,
  validateOptionalPositiveInteger,
  ValidationError,
} from "./validators/validationHelpers.js";

const nameResult = validateRequiredString(body.name, "name");
if ("error" in nameResult) {
  throw ValidationError.fromFields({ name: nameResult.error });
}

const ageResult = validateOptionalPositiveInteger(body.age, "age");
if ("error" in ageResult) {
  throw ValidationError.fromFields({ age: ageResult.error });
}

// Use validated values
const name = nameResult.value;
const age = ageResult.value;
```

## Best Practices

1. **Use specific error classes** - Don't use generic HttpError when a specific class exists
2. **Include error codes** - Provide machine-readable codes for programmatic handling
3. **Use asyncHandler** - Wrap all async route handlers
4. **Validate early** - Throw validation errors before business logic
5. **Provide context** - Include relevant details in error responses
6. **Log appropriately** - The errorHandler logs unexpected errors automatically
7. **Don't catch and re-throw** - Let errors bubble up to the error handler

## Testing

Error classes include comprehensive unit tests in `HttpError.test.ts`. Run tests with:

```bash
npm test
```

## Future Improvements

- [ ] Add error code constants/enum
- [ ] Add i18n support for error messages
- [ ] Add error monitoring integration (Sentry, etc.)
- [ ] Add rate limiting error responses
- [ ] Add OpenAPI/Swagger error documentation
