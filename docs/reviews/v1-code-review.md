# V1 Code Review Packet

Status: code review packet for Dealer-Recon v1.
Date: 2026-06-17.

## Product Boundary

Dealer-Recon v1 is a single-store Hurst Mazda FP REC pilot. The code review should evaluate whether the current implementation reliably supports the clerk's monthly four-step workflow:

1. Upload BOA and Dealertrack source files.
2. Clean and normalize inputs, including removed-row audit and VIN6 extraction.
3. Run reconciliation and review exceptions.
4. Generate and store the Hurst FP REC export.

The stored Hurst FP REC artifact is the output of record. Dashboard metrics and broader accounting-platform scope are not the v1 product goal.

## Review Goal

The code review should focus on correctness, maintainability, and reviewability of the v1 workflow without requesting architecture rewrites or future-scope product expansion.

Primary review questions:

- Are uploads constrained to the accepted source-file contract?
- Are parser and preprocessor failures controlled and testable?
- Are removed-row diagnostics preserved without hiding source-data problems?
- Are reconciliation invariants clear enough for reviewer confidence?
- Are stored artifacts generated from reviewed reconciliation detail?
- Are artifact downloads and regenerated exports aligned?
- Are store authorization checks explicit and covered?
- Are frontend workflow errors understandable to operators?

## Repository Map

Backend:

- server/src/app.ts: Express route composition and workflow orchestration.
- server/src/index.ts: production app construction.
- server/src/config.ts: environment validation.
- server/src/access/storeAccess.ts: store and null-store authorization rules.
- server/src/services/parsers: source file parsers and parser routing.
- server/src/services/preprocessing: BOA and Dealertrack normalization plus removed-row diagnostics.
- server/src/services/reconciliationEngine.ts and related tier/golden tests: matching and exception behavior.
- server/src/services/reconciliationArtifacts.ts: stored raw, cleaned, merged, and FP REC artifact generation.
- server/src/presenters: FP REC, merged floorplan, CSV, and report presentation.
- server/src/repositories: database access and persistence.
- server/src/db/migrations: schema and migration behavior.

Frontend:

- frontend/src/api: API requests and error-message extraction.
- frontend/src/App.tsx and components: workflow screen and dashboard guidance.

## Upload And Source-File Handling

Primary route: POST /upload in server/src/app.ts.

Relevant implementation areas:

- Multer memory storage with 5 MB max upload size.
- Extension and MIME checks before parsing.
- source_type validation for BOA or DEALERTRACK.
- Dealership and store access checks.
- Duplicate upload health gate by dealership, store, source type, and file hash.
- Raw upload bytes persisted separately from source metadata.
- Parser routing via server/src/services/parsers/sourceParserRouter.ts.

Review position:

The route is broad but explicit enough for v1. It handles validation, parsing, preprocessing, persistence, duplicate handling, and event recording in one workflow. Further decomposition can wait unless reviewers find a correctness bug.

Known limitation:

Duplicate reuse does not include parser/preprocessor version identity. This is deferred Batch 3 scope.

## Parsing And Normalization

BOA path:

- BOA CSV and HTML-as-XLS parser behavior is tested.
- BOA preprocessor removes non-transaction rows, normalizes amounts/dates, and extracts VIN6 where available.

Dealertrack path:

- Dealertrack CSV and SpreadsheetML/XML parser behavior is routed by source parser logic.
- SpreadsheetML ss:Index expansion is capped to avoid large allocation from hostile input.
- Normal indexed gaps remain supported.
- Dealertrack preprocessor extracts VIN6 from descriptions and normalizes transaction data.

Review position:

Parser behavior is intentionally source-specific rather than generic spreadsheet ingestion. That is correct for v1 because the accepted source contract is narrow.

Known limitations:

- Native XLSX is not supported as a v1 input.
- Malware scanning is not implemented.
- Parser/preprocessor versioning is not yet part of duplicate reuse.

## Removed-Row Audit Behavior

Removed-row and preprocessing diagnostics are part of the v1 cleaning/normalization step. They support review when source rows are ignored or transformed.

Review expectations:

- Do not remove diagnostics just to simplify output.
- Treat diagnostics as business-sensitive data.
- Avoid logging row-level source details in production.
- Keep diagnostics tied to the same store and source-file authorization model as source files.

## Reconciliation Invariants

Core v1 matching invariant:

- Match only when VIN/full-VIN/VIN6 identity and absolute amount agree.

Exception behavior:

- BOA-only rows map to On statement-not on GL.
- Dealertrack-only rows map to On schedule-not on statement.
- VIN6 amount mismatches remain split as reviewable BOA-side and Dealertrack-side exceptions.
- Matched rows are excluded from exception sections.

Review position:

The implementation is intentionally conservative. Do not reintroduce fallback stock/control/VIN-prefix matching for stored output-of-record artifacts.

Relevant tests:

- server/src/services/reconciliationEngine.test.ts.
- server/src/services/reconciliationEngineTiers.test.ts.
- server/src/services/reconciliationGoldenFixtures.test.ts.
- server/src/services/exceptionCategorizer.test.ts.

## Artifact Persistence And Export Behavior

Stored artifact path:

- server/src/services/reconciliationArtifacts.ts builds raw, cleaned, merged, and FP REC artifacts for a run.
- Stored merged and FP REC artifacts are generated from reviewed ReconciliationRunDetail.
- The old transaction-based merged export helper was removed from the v1 output-of-record path.

Download/regeneration behavior:

- GET /artifacts/:artifactId/download returns stored artifact bytes after access checks.
- GET /reconciliation-runs/:id/fp-rec returns stored FP REC when available and can regenerate for JSON/debug or fallback behavior.
- GET /reconciliation-runs/:id/merged-floorplan follows the same reviewed-detail model.

Review position:

The stored FP REC is the output of record. Code review should preserve agreement between reviewed detail, stored artifact classifications, and regenerated export routes.

Known limitation:

Artifact retention, hash, version, and immutability policy is documented but not implemented.

## Frontend Workflow Alignment

Current frontend position:

- The dashboard guides the v1 workflow rather than defining the product goal.
- API error handling now extracts both detail and error.message shapes.
- Upload-specific errors continue to surface concrete backend messages.

Review position:

Frontend workflow cleanup remains Batch 3. Reviewers should flag functional workflow confusion, but avoid requesting visual or analytics expansion under v1.

## Error Handling

Backend:

- Domain and validation failures are represented through controlled HTTP errors where touched by Batch 1/2 work.
- Store authorization failures return 403.
- Parser and upload validation failures return controlled messages.

Frontend:

- frontend/src/api/errorMessage.test.ts verifies detail and error.message parsing.

Review position:

Standardized error handling is good enough for v1 review, but production logs and unexpected errors should remain a security review focus.

## Tests Clean Enough For V1

The following areas have meaningful coverage for v1 review:

- Reconciliation matching and exception taxonomy.
- Golden fixtures for reviewed reconciliation output.
- BOA and Dealertrack parser/preprocessor behavior.
- SpreadsheetML ss:Index cap.
- Spreadsheet formula neutralization.
- Stored artifact generation and download/regeneration agreement.
- Store and null-store authorization boundaries.
- Frontend/backend error-message handling.
- Config production guardrails.

See [v1-validation-evidence-2026-06-17.md](v1-validation-evidence-2026-06-17.md) for current command results.

## Areas Needing More Tests Before Broader Launch

These are not Issue #15 implementation requests, but they should remain visible to reviewers:

- End-to-end browser workflow with representative non-sensitive BOA and Dealertrack files.
- Restore-from-backup artifact download test.
- Explicit production-like smoke test after deployment.
- Parser/preprocessor versioning once duplicate reuse becomes version-aware.
- Accounting month boundary behavior once implemented.
- Artifact retention/hash/version behavior once implemented.

## Refactors To Avoid Until After V1

Avoid these unless a concrete bug requires them:

- Generic reconciliation dashboard redesign.
- New multi-store product behavior.
- Direct integration abstractions for BOA, Dealertrack, GL, or OEM systems.
- Large route/controller architecture rewrites.
- Broad parser framework rewrites.
- Analytics/reporting expansion.
- Batch 4 or later scope.

## Documentation Updates Required By Code Reality

Already covered by this packet:

- Security review packet.
- Code review packet.
- Deployment readiness checklist.
- Risk register and known limitations.
- Validation evidence.
- README documentation map link.

Existing canonical docs remain valid:

- docs/product/fp-rec-four-step-workflow.md.
- docs/operator/monthly-fp-rec-runbook.md.
- docs/implementation/exception-taxonomy.md.
- docs/implementation/reconciliation-artifacts.md.
- docs/implementation/documentation-audit.md.

## Code Review Checklist

Reviewers should verify:

- Upload route rejects unsupported source types and unsupported file formats.
- Parser failures do not persist partial successful uploads as healthy source files.
- Removed-row diagnostics remain accessible only through authorized paths.
- Reconciliation does not match VIN6 amount mismatches.
- Stored FP REC and merged floorplan artifacts use reviewed detail.
- Stored and regenerated exports agree for the same run.
- Store-scoped users cannot access other-store or null-store data.
- Frontend workflow surfaces backend validation and authorization errors.
- Local dev/test defaults cannot become production behavior without explicit configuration.
