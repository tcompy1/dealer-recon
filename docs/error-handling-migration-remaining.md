# Remaining Error Handling Migration Tasks

Status note: this document is historical. The migration described here was completed later; see `docs/error-handling-migration-complete.md`. It is not part of the current Hiley four-step pilot scope.

## Summary

The error handling migration is partially complete. The following endpoints still need to be migrated to use `asyncHandler` and `HttpError` classes.

## Completed Migrations

✅ `/login` - POST
✅ Authentication middleware
✅ `/health` - GET  
✅ `/ready` - GET
✅ `/audit-events` - GET
✅ `/dealer-groups` - GET
✅ `/stores` - GET and POST
✅ `/dealer-groups/analytics` - GET
✅ `/automation/scheduled-jobs` - GET, POST, PATCH
✅ `/automation/run-due-jobs` - POST
✅ `/automation/ingestion-events` - GET
✅ `/automation/events` - GET
✅ `/automation/status` - GET
✅ `/automation/metrics` - GET
✅ `/source-files` - GET
✅ `/accounts/summary` - GET
✅ `/accounts/:account_identifier` - GET
✅ `/reports/month-end` - GET
✅ Multer file filter (using ValidationError instead of AppHttpError)

## Remaining Endpoints to Migrate

### 1. `/upload` - POST (Line ~530)

**Current Pattern:**
```typescript
app.post("/upload", upload.single("file"), async (request, response, next) => {
  try {
    // validation with response.status(422).json({ detail: "..." })
    // ...
  } catch (error) {
    // Special error handling with ingestion event logging
    next(error);
  }
});
```

**Target Pattern:**
```typescript
app.post("/upload", upload.single("file"), asyncHandler(async (request, response) => {
  // Replace all response.status(XXX).json({ detail: "..." }) with throw new XxxError()
  
  const sourceType = request.body.source_type;
  if (!isSourceType(sourceType)) {
    throw new ValidationError("Invalid source_type.", "INVALID_SOURCE_TYPE");
  }
  if (!request.file) {
    throw new ValidationError("File is required.", "FILE_REQUIRED");
  }
  
  // ... rest of logic with throws instead of response.status()
  
  // For duplicate upload (409):
  throw new ConflictError(
    "Duplicate upload detected for this source type and file contents.",
    "DUPLICATE_UPLOAD",
    { source_file_id: duplicateSourceFile.id, filename: duplicateSourceFile.original_filename }
  );
  
  // For unsupported preprocessing:
  throw new ValidationError(
    preprocessingResult.detail,
    "UNSUPPORTED_FILE_FORMAT",
    { preprocessing: preprocessingResult.preprocessingMetadata }
  );
}));
```

**Note:** The catch block that logs ingestion events can be removed since the error handler middleware will handle errors consistently.

### 2. `/reconcile` - POST (Line ~699)

**Migrations Needed:**
- Wrap with `asyncHandler`
- Replace `response.status(422).json({ detail: "..." })` → `throw new ValidationError(...)`
- Replace `response.status(404).json({ detail: "..." })` → `throw new NotFoundError(...)`
- Replace `response.status(403).json({ detail: "..." })` → `throw new ForbiddenError(...)`
- Replace `response.status(400).json({ detail: "..." })` → `throw new BadRequestError(...)`
- Remove try/catch/next(error)

### 3. `/reconciliation-runs` - GET (Line ~804)

**Migrations Needed:**
- Wrap with `asyncHandler`
- Replace `response.status(422).json({ detail: "Invalid store_id." })` → `throw new ValidationError("Invalid store_id.", "INVALID_STORE_ID")`
- Remove try/catch/next(error)

### 4. `/reconciliation-runs/:id` - GET (Line ~828)

**Migrations Needed:**
- Wrap with `asyncHandler`
- Replace `response.status(404).json({ detail: "Reconciliation run was not found." })` → `throw new NotFoundError("Reconciliation run")`
- Replace `response.status(422).json({ detail: "Invalid reconciliation run filter." })` → `throw new ValidationError("Invalid reconciliation run filter.", "INVALID_FILTER")`
- Replace `response.status(403).json({ detail: "..." })` → `throw new ForbiddenError(...)`
- Remove try/catch/next(error)

### 5. `/reconciliation-runs/:id/analytics` - GET (Line ~876)

**Migrations Needed:**
- Wrap with `asyncHandler`
- Replace 404 and 403 errors with throws
- Remove try/catch/next(error)

### 6. `/reconciliation-runs/:id/snapshot` - GET (Line ~919)

**Migrations Needed:**
- Wrap with `asyncHandler`
- Replace 404 and 403 errors with throws
- Remove try/catch/next(error)

### 7. `/reconciliation-runs/:id/replay` - GET (Line ~961)

**Migrations Needed:**
- Wrap with `asyncHandler`
- Replace 404 and 403 errors with throws
- Remove try/catch/next(error)

### 8. `/reconciliation-runs/:id/exceptions.csv` - GET (Line ~1009)

**Migrations Needed:**
- Wrap with `asyncHandler`
- Replace 404, 422, and 403 errors with throws
- Remove try/catch/next(error)

### 9. `/reconciliation-runs/:id/hurst-fp-rec` - GET (Line ~1056)

**Migrations Needed:**
- Wrap with `asyncHandler`
- Replace 404 and 403 errors with throws
- Remove try/catch/next(error)

### 10. `/reconciliation-runs/:id/exceptions/:exception_id` - PATCH (Line ~1112)

**Migrations Needed:**
- Wrap with `asyncHandler`
- Replace all response.status().json() with throws
- Remove try/catch/next(error)

### 11. `/source-files/:sourceFileId/transactions` - GET (Line ~1183)

**Migrations Needed:**
- Wrap with `asyncHandler`
- Replace 404 and 403 errors with throws
- Remove try/catch/next(error)

### 12. `/transactions/:transactionId/vin-enrichment` - POST (Line ~1229)

**Migrations Needed:**
- Wrap with `asyncHandler`
- Replace all response.status().json() with throws
- Remove try/catch/next(error)

### 13. Remove `AppHttpError` class (Line ~1509)

**Action:**
Delete the entire `AppHttpError` class definition:
```typescript
class AppHttpError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}
```

This class is no longer needed since we're using the `HttpError` classes from `server/src/errors/HttpError.ts`.

## Migration Pattern Reference

### Common Replacements

| Old Pattern | New Pattern |
|------------|-------------|
| `response.status(400).json({ detail: "msg" })` | `throw new BadRequestError("msg")` |
| `response.status(401).json({ detail: "msg" })` | `throw new UnauthorizedError("msg", "CODE")` |
| `response.status(403).json({ detail: "Not authorized." })` | `throw new ForbiddenError()` |
| `response.status(403).json({ detail: "msg" })` | `throw new ForbiddenError("msg", "CODE")` |
| `response.status(404).json({ detail: "X was not found." })` | `throw new NotFoundError("X")` |
| `response.status(409).json({ detail: "msg" })` | `throw new ConflictError("msg", "CODE")` |
| `response.status(422).json({ detail: "msg" })` | `throw new ValidationError("msg", "CODE")` |
| `response.status(503).json({ detail: "msg" })` | `throw new ServiceUnavailableError("msg")` |

### Endpoint Wrapper Pattern

**Before:**
```typescript
app.get("/endpoint", async (request, response, next) => {
  try {
    // logic
  } catch (error) {
    next(error);
  }
});
```

**After:**
```typescript
app.get("/endpoint", asyncHandler(async (request, response) => {
  // logic - no try/catch needed
}));
```

## Testing After Migration

After completing the migration:

1. **Run unit tests:**
   ```bash
   npm test
   ```

2. **Test each endpoint manually or with integration tests:**
   - Verify error responses have the new format
   - Check that request_id is included in error responses
   - Ensure HTTP status codes are correct
   - Validate error codes are present

3. **Check logs:**
   - Unexpected errors should be logged
   - Request IDs should correlate between requests and errors

## Benefits After Complete Migration

- ✅ Consistent error format across all endpoints
- ✅ No boilerplate try/catch blocks
- ✅ Type-safe error handling
- ✅ Automatic error logging for unexpected errors
- ✅ Request ID tracking
- ✅ Easier to maintain and extend
- ✅ Better API client experience

## Next Steps

1. Complete the remaining endpoint migrations listed above
2. Remove the `AppHttpError` class
3. Run tests to verify everything works
4. Update the main error handling documentation
5. Consider updating frontend error handling to use the new error format
