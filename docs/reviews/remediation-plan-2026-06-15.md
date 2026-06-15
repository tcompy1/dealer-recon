# Dealer-Recon V1 Remediation Plan

Date: 2026-06-15

Source reviews:

- `docs/reviews/security-audit-codex-2026-06-15.md`
- `docs/reviews/code-review-codex-2026-06-15.md`

Product boundary: Dealer-Recon v1 is a single-store Hurst Mazda FP REC pilot. The dashboard guides the clerk through the monthly four-step workflow, and the Hurst FP REC export is the output of record. This plan does not expand v1 into multi-store, direct integrations, analytics, or full accounting-platform scope.

## 1. Executive Summary

The reviews found a small set of launch-blocking issues around authentication defaults, seeded demo credentials, parser abuse, spreadsheet export safety, store authorization, and FP REC artifact correctness. These should be fixed before any production pilot with real Hurst data.

The highest product-quality issue is that stored FP REC artifacts can be generated from a second cleaned-record matcher instead of the reviewed reconciliation result. That can make the output of record disagree with the clerk's exception review and the documented VIN6 plus amount rule.

The plan below combines duplicate findings from both reviews, keeps remediation scoped to v1, and groups the work into three implementation batches. Confirmed issues are listed in P0 through P2. Speculative risks are tracked separately under explicit deferrals and owner decisions.

## 2. P0 Launch Blockers

### 2.1 Remove Demo Credential Exposure

- Title: Remove demo credential exposure.
- Source findings: Security audit "Known demo credentials are seeded by migration."
- Priority: P0.
- Affected files/functions/routes: `server/src/db/migrations/1778151600000_add_local_auth_user.cjs`.
- Intended fix: Remove production migration behavior that creates or resets `demo@dealer-recon.local`; move demo user creation to an explicit local seed path; rotate any affected non-local users.
- Tests to add or update: Production/staging migration test asserting no demo user is created and no blank password hashes are replaced with the demo hash.
- Docs to update: Production deployment checklist; local development setup; security/data-handling docs.
- Risk if deferred: A known credential can upload source files, run reconciliation, and download FP REC artifacts in any environment where the migration ran.
- Suggested implementation batch: Batch 1.

### 2.2 Harden Auth Fallback

- Title: Make dev auth fallback fail closed outside local dev/test.
- Source findings: Security audit "Auth fallback can silently grant platform admin access."
- Priority: P0.
- Affected files/functions/routes: `createApp` in `server/src/app.ts`; server entrypoint options in `server/src/index.ts`; auth-related tests.
- Intended fix: Require an explicit local-only option for fallback auth; throw when fallback is enabled with `NODE_ENV` outside `development` or `test`; keep production entrypoint on real auth repository only.
- Tests to add or update: `createApp(..., { nodeEnv: "production" })` without an auth repository must throw or return 401 on protected routes; local test fallback remains available only when explicitly enabled.
- Docs to update: Production deployment checklist; local development auth notes.
- Risk if deferred: A misconfigured app instance can authenticate every request as `platform_admin`.
- Suggested implementation batch: Batch 1.

### 2.3 Cap Dealertrack SpreadsheetML Cell Indexes

- Title: Bound Dealertrack SpreadsheetML `ss:Index` parsing.
- Source findings: Security audit "Dealertrack SpreadsheetML parser allows memory exhaustion via ss:Index"; code review "Dealertrack SpreadsheetML parser has an unbounded cell-index expansion."
- Priority: P0.
- Affected files/functions/routes: `parseDealertrackXml` and `extractRowCells` in `server/src/services/parsers/dealertrackXmlParser.ts`; parser tests.
- Intended fix: Add a maximum column/index limit per row; return a controlled parser warning or validation failure when an index exceeds the limit.
- Tests to add or update: XML containing a very large `ss:Index` returns a controlled 422 or parser warning and does not allocate a large array.
- Docs to update: Parser invariants and accepted file-format contract.
- Risk if deferred: A small malformed Dealertrack file can consume excessive memory during upload parsing.
- Suggested implementation batch: Batch 1.

### 2.4 Neutralize Spreadsheet Formula Injection

- Title: Neutralize spreadsheet formulas in CSV and HTML-as-XLS exports.
- Source findings: Security audit "Spreadsheet formula injection is not neutralized."
- Priority: P0.
- Affected files/functions/routes: `server/src/presenters/hurstFpRec.ts`; `server/src/presenters/mergedFloorplan.ts`; `server/src/presenters/csv.ts`; `server/src/services/reconciliationArtifacts.ts`; export/download route tests.
- Intended fix: Add one shared spreadsheet text-cell sanitizer for values beginning with `=`, `+`, `-`, `@`, tab, CR, or LF where appropriate; apply it to text cells in FP REC, merged XLS, exceptions CSV, cleaned CSV, and month-end CSV while leaving numeric cells numeric.
- Tests to add or update: Source description/control/stock/note values such as `=HYPERLINK("http://example.test","x")` export as inert text in every spreadsheet artifact.
- Docs to update: Spreadsheet export safety checklist; artifact/export behavior docs.
- Risk if deferred: Clerk-opened exports can execute attacker-controlled spreadsheet formulas from source-file text.
- Suggested implementation batch: Batch 1.

### 2.5 Generate FP REC From Reviewed Reconciliation Detail

- Title: Build stored FP REC artifacts from reviewed reconciliation detail.
- Source findings: Security audit "Stored FP REC can diverge from reviewed reconciliation results"; code review "FP REC artifacts can be built from a second matcher instead of reviewed run results."
- Priority: P0.
- Affected files/functions/routes: `persistReconciliationRunArtifacts` in `server/src/services/reconciliationArtifacts.ts`; `buildMergedFloorplanArtifactFromTransactions` in `server/src/services/mergedFloorplanExport.ts`; cleaned-record matcher in `server/src/presenters/mergedFloorplan.ts`; `/reconciliation-runs/:id/fp-rec`; `/reconciliation-runs/:id/merged-floorplan`.
- Intended fix: Generate stored `MERGED_FLOORPLAN` and `FP_REC` from `ReconciliationRunDetail` and persisted match/exception rows only. Do not use stock/control or VIN-prefix fallback matching for the v1 output of record.
- Tests to add or update: Same amount plus same stock/control but missing Dealertrack VIN6 remains split in stored merged and FP REC artifacts; stored artifact content matches the detail-based route output.
- Docs to update: Exception taxonomy; reconciliation artifacts; FP REC workflow.
- Risk if deferred: The FP REC output of record can disagree with reviewed exceptions and violate the VIN6 plus amount rule.
- Suggested implementation batch: Batch 2.

### 2.6 Fix Null-Store And Store Authorization Boundaries

- Title: Deny null-store access for store-scoped v1 data.
- Source findings: Security audit "Store authorization treats null store scope as globally accessible."
- Priority: P0.
- Affected files/functions/routes: `canAccessStore` in `server/src/access/storeAccess.ts`; `/source-files`; `/automation/ingestion-events`; `/automation/events`; `/reconciliation-runs`; `/artifacts/:artifactId/download`; artifact and source-file migrations that allow nullable store IDs.
- Intended fix: For v1, require Hurst store association on uploads, runs, and artifacts; deny null-store sensitive resources to store-scoped roles; ensure all list routes apply store filtering and do not return all-store data by default to store users.
- Tests to add or update: A user assigned to the Hurst store cannot read another store's events or download a null-store artifact; v1 upload/reconcile fails if no store can be resolved.
- Docs to update: Store/dealership access-control matrix; artifact download docs.
- Risk if deferred: Store-scoped users can see all-store event metadata, and null-store source/run/artifact records become broadly visible inside a dealership.
- Suggested implementation batch: Batch 2.

## 3. P1 Before V1 Review

### 3.1 Standardize Frontend And Backend Error Messages

- Title: Standardize error envelopes and frontend message extraction.
- Source findings: Code review "Error response shapes are inconsistent, and the frontend drops standardized messages."
- Priority: P1.
- Affected files/functions/routes: `server/src/middleware/errorHandler.ts`; manual `{ detail }` responses in `server/src/app.ts`; `getErrorMessage` in `frontend/src/api/client.ts`; upload error handling in `frontend/src/api/uploads.ts`.
- Intended fix: Migrate manual route errors to shared HTTP errors where practical; update the frontend client to read both `detail` and `error.message`.
- Tests to add or update: Store-access 403, invalid reconcile 422, invalid upload 422, and artifact 404 all surface concrete backend messages to the frontend/API client.
- Docs to update: Error-handling guide; operator runbook troubleshooting section.
- Risk if deferred: Clerks may see generic failures during the monthly workflow and need engineering support for routine validation errors.
- Suggested implementation batch: Batch 2.

### 3.2 Add Accounting Month Boundary

- Title: Add explicit accounting month to source pairing and artifacts.
- Source findings: Security audit "Month boundary is not enforced"; code review "Reconciliation runs do not have an explicit accounting month boundary."
- Priority: P1.
- Affected files/functions/routes: `/upload`; `/reconcile`; `source_files`; `reconciliation_runs`; `reconciliation_artifacts`; `evaluateAutoRunAfterUpload`; `findLatestSourceFilePair`; FP REC/merged period-date helpers.
- Intended fix: Capture accounting month during upload or reconcile; require BOA and Dealertrack files to share the same Hurst accounting month; scope duplicate lookup and automation pairing by month; use the explicit month for artifact metadata and filenames.
- Tests to add or update: BOA September plus Dealertrack October fails before run creation; duplicate reuse is month-scoped; artifacts store the explicit month.
- Docs to update: Monthly runbook; four-step workflow; artifact persistence; accepted upload contract.
- Risk if deferred: A wrong-month file can generate a valid-looking FP REC for the wrong period.
- Suggested implementation batch: Batch 3.

### 3.3 Version Duplicate Upload Parsing And Preprocessing

- Title: Reprocess duplicate uploads when parser or workflow versions change.
- Source findings: Code review "Duplicate upload reuse does not account for parser/preprocessor version drift."
- Priority: P1.
- Affected files/functions/routes: `/upload`; `assessSourceFileHealth`; duplicate hash lookup in `server/src/app.ts`; `source_files` metadata; parser/preprocessor version constants; store workflow config key.
- Intended fix: Store parser route, parser version, preprocessing version, store workflow key, and relevant parser options with source files; treat duplicates as stale when any value differs and reprocess them through the current pipeline.
- Tests to add or update: A same-hash duplicate with old preprocessing metadata is reprocessed; a same-hash duplicate with matching metadata is reused.
- Docs to update: Duplicate upload behavior; parser invariants; operator runbook.
- Risk if deferred: Healthy-looking old parses can bypass improved VIN6, removed-row, or Hurst account logic.
- Suggested implementation batch: Batch 3.

### 3.4 Clean Up V1 Workflow UI

- Title: Align frontend workflow with the four-step Hurst FP REC process.
- Source findings: Code review "Future-scope UI and API calls are hard dependencies for the core workflow"; "Exception review is hidden behind advanced UI"; "Removed-row audit data exists but is not wired as the formal workflow artifact in the UI"; "Frontend has no app-level regression tests"; security audit "Future-scope routes and source types remain active."
- Priority: P1.
- Affected files/functions/routes: `frontend/src/components/WorkflowDashboard.tsx`; `frontend/src/components/preprocessing/RemovedRowsAuditPanel.tsx`; `frontend/src/components/preprocessing/PreprocessingDiagnosticsPanel.tsx`; `frontend/src/api/automation.ts`; `frontend/src/api/stores.ts`; source-type controls and backend v1 upload validation.
- Intended fix: Load the v1 workflow path independently from future analytics/automation calls; make removed-row audit and exception review visible in the main workflow; keep FP REC download as the final workflow outcome; hide or flag future-scope panels/source types for v1.
- Tests to add or update: Mocked frontend workflow test for BOA upload, Dealertrack upload, visible removed-row audit, run reconciliation, visible exceptions, stored FP REC download; analytics endpoint failure does not block the v1 workflow.
- Docs to update: README dashboard role; monthly runbook screenshots/flow notes if maintained; documentation audit stale/future-scope notes.
- Risk if deferred: The UI can still behave like a generic reconciliation dashboard and can block the clerk on non-v1 panels.
- Suggested implementation batch: Batch 3.

## 4. P2 Deferred Hardening

### 4.1 Define Artifact Retention, Hashing, And Version Policy

- Title: Define and implement minimum artifact retention, hash, and version controls.
- Source findings: Security audit "Sensitive raw data is stored without retention or immutable output controls"; code review "Artifact persistence overwrites the output of record without version identity."
- Priority: P2.
- Affected files/functions/routes: `source_file_upload_contents`; `reconciliation_artifacts`; `createReconciliationArtifact`; artifact download routes; artifact docs.
- Intended fix: Document retention and deletion expectations first; add content hashes; add immutable versions or explicit replacement audit events for output-of-record artifacts.
- Tests to add or update: Stored artifacts include stable hashes; re-persisting `FP_REC` creates a version or replacement audit entry.
- Docs to update: Reconciliation artifacts; security/data-handling policy; production deployment checklist.
- Risk if deferred: Sensitive source data remains indefinitely and FP REC replacement history is unclear.
- Suggested implementation batch: Batch 3.

### 4.2 Minimize Removed-Row And Preprocessing Data Exposure

- Title: Redact or gate sensitive preprocessing and removed-row metadata.
- Source findings: Security audit "Removed-row and preprocessing metadata expose sensitive business data."
- Priority: P2.
- Affected files/functions/routes: upload response in `server/src/app.ts`; `buildRemovedRows`; ingestion event metadata; frontend diagnostics panels.
- Intended fix: Define a redacted audit schema; show full row-level details only to roles that need them; keep broad event feeds to counts, states, and non-sensitive summaries.
- Tests to add or update: Read-only users see counts/reasons but not VIN6, stock numbers, maturity dates, or raw diagnostic details; accounting users still see the audit values needed to complete the monthly run.
- Docs to update: Removed-row audit contract; data-handling policy; operator runbook.
- Risk if deferred: Business-sensitive values can be exposed more broadly than necessary.
- Suggested implementation batch: Batch 3 or later hardening.

### 4.3 Tighten Accepted File-Format Contract

- Title: Make upload format detection authoritative and consistent.
- Source findings: Security audit "Accepted file-format contract is inconsistent and partly extension-driven."
- Priority: P2.
- Affected files/functions/routes: multer upload filter in `server/src/app.ts`; `detectFileFormat`; `preprocessUpload`; upload tests; frontend upload accept string.
- Intended fix: Reject low-confidence/binary CSV extension fallback; allow true `.xlsx` files to reach detector and return the same unsupported OOXML response as renamed OOXML; document accepted BOA and Dealertrack formats.
- Tests to add or update: Binary renamed `.csv` is rejected; true `.xlsx` gets the documented unsupported-format response; accepted BOA HTML/XLS and Dealertrack SpreadsheetML still pass.
- Docs to update: Accepted file-format contract; monthly runbook; README v1 scope.
- Risk if deferred: Users receive inconsistent errors and malformed files enter parser paths unnecessarily.
- Suggested implementation batch: Post Batch 3 hardening.

### 4.4 Harden Download Headers And Filenames

- Title: Use one safe download-header builder.
- Source findings: Security audit "Download headers and filename handling are incomplete."
- Priority: P2.
- Affected files/functions/routes: `sendArtifactDownload`; regenerated merged and FP REC routes; raw artifact content types; filename helpers.
- Intended fix: Add `X-Content-Type-Options: nosniff`; generate fixed content types by artifact type; use robust filename encoding and a single helper for stored and regenerated downloads.
- Tests to add or update: Malicious filenames produce safe `Content-Disposition`; downloads include `nosniff`; regenerated and stored routes use the same header behavior.
- Docs to update: Spreadsheet export and download safety checklist.
- Risk if deferred: Low-level header inconsistencies remain and future filename changes can reintroduce unsafe behavior.
- Suggested implementation batch: Post Batch 3 hardening.

### 4.5 Reduce Future-Scope API And Source-Type Surface

- Title: Keep future-scope routes and source types out of v1 production behavior.
- Source findings: Security audit "Future-scope routes and source types remain active"; code review "Source types and legacy CSV fallback exceed v1 scope."
- Priority: P2.
- Affected files/functions/routes: `sourceTypes`; `/dealer-groups/analytics`; `/automation/*`; `/accounts/*`; `/reports/month-end`; `/reconciliation-runs/:id/analytics`; `/snapshot`; `/replay`; frontend advanced panels.
- Intended fix: Feature-flag or hide non-v1 surfaces for the Hurst pilot; reject non-BOA/Dealertrack uploads in v1 mode.
- Tests to add or update: In v1 mode, non-v1 source uploads return clear unsupported responses and future-scope routes are hidden or disabled.
- Docs to update: PROJECT_BRIEF future scope; documentation audit; README endpoint list.
- Risk if deferred: Security and code-review scope remains larger than the actual Hurst FP REC pilot.
- Suggested implementation batch: Batch 3 UI cleanup or later hardening.

### 4.6 Consolidate VIN6 Helper Usage

- Title: Consolidate VIN6 and identifier helper usage after output correctness is fixed.
- Source findings: Code review "VIN6 and identifier extraction rules are duplicated across engine and presenters."
- Priority: P2.
- Affected files/functions/routes: `reconciliationEngine.ts`; `mergedFloorplan.ts`; `hurstFpRec.ts`; `vin6.ts`; preprocessing modules.
- Intended fix: Avoid a broad rewrite. After stored artifacts are detail-based, centralize only the small helper functions still needed by multiple modules.
- Tests to add or update: Same fixture row produces consistent VIN6/provenance across preprocessing, reconciliation detail, merged export, and FP REC export.
- Docs to update: Exception taxonomy code-review trace if helper boundaries move.
- Risk if deferred: Low once FP REC is generated from reviewed detail; remaining risk is maintenance drift.
- Suggested implementation batch: After v1 review unless touched by Batch 2.

## 5. Owner Decisions Required

- Artifact retention: Decide how long raw uploads, cleaned CSVs, merged XLS, and FP REC exports remain stored for the Hurst pilot.
- Artifact immutability: Decide whether an FP REC replacement creates a new version or an audit record with old/new hashes.
- Accounting month input: Decide whether month is entered by the clerk at upload time, selected at reconcile time, or inferred then confirmed.
- Removed-row visibility: Decide which roles can see VIN6, stock, maturity date, amount totals, and diagnostic details.
- V1 feature gating: Decide whether future-scope routes are disabled at the backend, hidden in the frontend, or both for the pilot.
- Deployment assumptions: Decide whether v1 is same-site/private enough to defer explicit CSRF tokens, malware scanning, and rate limiting.
- Accepted formats: Confirm the exact BOA and Dealertrack formats for v1 and whether native `.xlsx` remains unsupported.

## 6. Implementation Batches

### Batch 1: Small Security-Critical Fixes

Scope:

1. Remove demo credential exposure.
2. Harden auth fallback.
3. Cap Dealertrack SpreadsheetML `ss:Index`.
4. Neutralize spreadsheet formulas.

Exit criteria:

- No known demo credentials are seeded by production migrations.
- Auth fallback cannot run outside explicit local dev/test.
- Malicious `ss:Index` input fails safely.
- All spreadsheet exports neutralize formula-leading text.

### Batch 2: Output Correctness And Access Boundaries

Scope:

1. Generate stored FP REC and merged artifacts from reviewed reconciliation detail.
2. Fix null-store/store authorization behavior.
3. Standardize frontend/backend error message handling.

Exit criteria:

- Stored FP REC matches reviewed match/exception detail.
- Store-scoped users cannot access null-store or all-store sensitive resources.
- Frontend displays concrete backend validation and authorization errors.

### Batch 3: Workflow Integrity And Review Readiness

Scope:

1. Add accounting month boundary.
2. Version duplicate parser/preprocessor metadata.
3. Document and start artifact retention/hash/version controls.
4. Clean up v1 UI workflow around removed-row audit, exception review, and FP REC download.

Exit criteria:

- BOA and Dealertrack pairings are store/month scoped.
- Duplicate reuse respects parser, preprocessing, and store workflow versions.
- Artifact data-handling docs are explicit enough for v1 review.
- The frontend presents the four-step Hurst FP REC workflow without relying on future-scope panels.

## 7. Regression Test Map

| Area | Tests |
| --- | --- |
| Demo credentials | Production/staging migration does not create `demo@dealer-recon.local`; no blank password is replaced with the demo hash. |
| Auth fallback | Production `createApp` without auth repository fails closed; protected route requires login. |
| SpreadsheetML parser | Large `ss:Index` returns controlled validation failure and does not allocate huge arrays. |
| Spreadsheet injection | Formula-leading source text is inert in FP REC XLS, merged XLS, exceptions CSV, cleaned CSV, and month-end CSV. |
| FP REC from detail | Stored FP REC and stored merged artifacts match detail-based classifications; fallback stock/control match remains an exception. |
| Store authorization | Store-scoped user cannot read another store, all-store event feeds, or null-store artifacts. |
| Error handling | Backend `{ error.message }` and `{ detail }` cases both surface concrete messages in the frontend client. |
| Accounting month | Mismatched-month BOA and Dealertrack files cannot create a run; artifact month uses explicit month. |
| Duplicate versioning | Same-hash stale parser/preprocessor version reprocesses; same-hash current version reuses. |
| Artifact versioning | Re-persisted FP REC records hash/version or replacement audit. |
| Removed-row audit | Removed rows render row number, reason, and allowed key values in the main workflow. |
| Frontend workflow | BOA upload, Dealertrack upload, reconciliation, exception review, and FP REC download appear in order with mocked APIs. |
| V1 feature gating | Non-BOA/Dealertrack uploads and future-scope routes are hidden or rejected in v1 mode. |

## 8. Documentation Updates Required

- `README.md`: Keep v1 endpoint list and dashboard role aligned with actual feature gating.
- `PROJECT_BRIEF.md`: Record confirmed v1 scope and explicit future-scope deferrals.
- `docs/product/fp-rec-four-step-workflow.md`: Add accounting-month boundary once implemented.
- `docs/operator/monthly-fp-rec-runbook.md`: Add month selection, removed-row review, exception review, and troubleshooting behavior.
- `docs/implementation/exception-taxonomy.md`: Confirm stored FP REC uses reviewed detail classifications only.
- `docs/implementation/reconciliation-artifacts.md`: Add artifact hash/version, retention, replacement, and download-header behavior.
- New or existing security docs: Add upload threat model, accepted file-format contract, parser limits, store/month access-control matrix, removed-row data classification, spreadsheet export safety, and production deployment checklist.
- `docs/implementation/documentation-audit.md`: Update stale/future-scope notes after v1 feature gating.

## 9. Explicit Deferrals

- Multi-store production support remains future scope.
- Direct Dealertrack, BOA, GL, OEM, or accounting-system integrations remain future scope.
- Generic analytics dashboards, trend deltas, reviewer workload metrics, and productivity reporting remain future scope.
- Native `.xlsx` parsing remains deferred unless Hurst v1 source files require it.
- Full parser framework rewrite is deferred; only bounded, source-specific parser fixes are in scope.
- Full frontend state-management rewrite is deferred; only targeted workflow cleanup is in scope.
- Explicit CSRF token work may be deferred only if deployment remains same-site, private, and origin-restricted.
- Malware scanning may be deferred for the private pilot if raw artifact downloads remain access-controlled.
- Upload/login rate limiting may be deferred only with an owner decision that the pilot is not internet-exposed.
- Parser debug cleanup may be deferred if `PARSER_DEBUG` remains disabled outside local development.

