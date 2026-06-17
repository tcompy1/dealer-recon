# Finding Validation Report

## Remove Demo Credential Exposure

Status:
Confirmed

Evidence:
- `server/src/db/migrations/1778151600000_add_local_auth_user.cjs`: `up` inserts `demo@dealer-recon.local` with a fixed bcrypt hash and assigns store 1 access; it also updates the demo user and any user with a null or empty `password_hash` to the same known hash.
- `frontend/src/pages/LoginPage.tsx`: `LoginPage` initializes the email and password fields to `demo@dealer-recon.local` and `dealer-recon-demo`.
- Routes affected after login: `/upload`, `/reconcile`, `/reconciliation-runs/:id`, `/reconciliation-runs/:id/fp-rec`, `/artifacts/:artifactId/download`, and other authenticated routes.

Current test coverage:
- `server/src/db/demoAuth.test.ts`: `seeded demo user > logs in, returns /me, has store 1 access, and can upload` covers the current demo login behavior.
- `server/src/db/demoAuth.test.ts`: `seeded demo user > seeds the demo user with bcrypt hash and store 1 assignment` covers current demo seeding.
- `server/src/db/migrate.test.ts`: `migrate > can run twice and leaves import scoping columns in place` asserts the demo user exists after migration.
- Regression test already exists: No. Existing tests enforce the risky behavior rather than production-safe behavior.

Reproduction method:
Integration test or manual workflow. Run migrations, log in with the demo credentials, and call a protected upload/export route.

Recommended next action:
Fix now.

## Harden Auth Fallback

Status:
Partial

Evidence:
- `server/src/app.ts`: `createApp` defaults `allowDevDealershipFallback` to `authRepository === undefined`.
- `server/src/app.ts`: auth middleware creates `local-dev-fallback@dealer-recon.local` as `platform_admin` when no session user is resolved and fallback is enabled.
- `server/src/index.ts`: production entrypoint passes `authRepository`, `sessionSecret`, `nodeEnv`, and `allowDevDealershipFallback: false`, so the normal server path is explicitly hardened.
- Routes affected if `createApp` is misused: every route registered after the auth middleware, including `/upload`, `/reconcile`, `/source-files`, `/automation/*`, `/reconciliation-runs/*`, and `/artifacts/:artifactId/download`.

Current test coverage:
- `server/src/app.test.ts`: `protected routes require authentication when auth is configured` covers configured-auth denial.
- Many `server/src/app.test.ts` tests call `createApp(new MemoryTransactionRepository())` and implicitly rely on fallback admin access.
- `server/src/config.test.ts`: production config tests cover session secret and CORS defaults, not fallback auth behavior.
- Regression test already exists: No. There is no test proving `createApp` fails closed in production or staging when no auth repository is supplied.

Reproduction method:
Integration test. Instantiate `createApp(new MemoryTransactionRepository(), ["https://app.example.com"], 1, async () => undefined, { nodeEnv: "production" })` without `authRepository`, then call a protected route and observe fallback access unless explicitly disabled.

Recommended next action:
Fix now.

## Cap Dealertrack SpreadsheetML Cell Indexes

Status:
Confirmed

Evidence:
- `server/src/services/parsers/dealertrackXmlParser.ts`: `parseDealertrackXml` calls `extractRowCells` for each row.
- `server/src/services/parsers/dealertrackXmlParser.ts`: `extractRowCells` parses arbitrary `ss:Index` values and pushes empty cells until `target - 1`, with no max column/index guard.
- Route path: `POST /upload` -> `runUploadPreprocessing` -> `preprocessUpload` -> Dealertrack SpreadsheetML parser for Dealertrack XML/XLS SpreadsheetML uploads.

Current test coverage:
- `server/src/services/parsers/dealertrackXmlParser.test.ts`: `parseDealertrackXml > honors ss:Index gaps in cells` covers normal indexed gaps.
- `server/src/services/parsers/dealertrackXmlParser.test.ts`: parser tests cover empty documents, truncated rows, row warnings, and VIN extraction.
- `server/src/app.test.ts`: `POST /upload returns preprocessing diagnostics summary for Dealertrack SpreadsheetML uploads` covers happy-path upload routing.
- Regression test already exists: No. No hostile large-index test exists.

Reproduction method:
Unit test and integration test. A unit test can pass XML with `ss:Index="1000000000"` to `parseDealertrackXml`; an integration test can upload the same content through `POST /upload`.

Recommended next action:
Fix now.

## Neutralize Spreadsheet Formula Injection

Status:
Confirmed

Evidence:
- `server/src/presenters/hurstFpRec.ts`: `exceptionWorkpaperRow` places source-derived text into workpaper cells; `workpaperCellHtml` HTML-escapes text but does not neutralize spreadsheet formula prefixes.
- `server/src/presenters/mergedFloorplan.ts`: `rowHtml` writes source-derived VIN, description, control, and store text through `escapeHtml`, which only performs HTML escaping.
- `server/src/presenters/csv.ts`: `toExceptionsCsv` writes source and review text fields; `toCsvCell` only quotes CSV syntax characters.
- `server/src/services/reconciliationArtifacts.ts`: `toCleanedTransactionsCsv` writes cleaned transaction text fields; `toCsvCell` only quotes CSV syntax characters.
- Routes affected: `GET /reconciliation-runs/:id/fp-rec`, `GET /reconciliation-runs/:id/hurst-fp-rec`, `GET /reconciliation-runs/:id/merged-floorplan`, `GET /reconciliation-runs/:id/exceptions.csv`, `GET /artifacts/:artifactId/download`, and `GET /reports/month-end?format=csv`.

Current test coverage:
- `server/src/presenters/hurstFpRec.test.ts`: presenter tests cover FP REC sections, exception placement, and internal workbook formulas such as `x:fmla="=B5"`.
- `server/src/cli/generateHurstFpRecExport.test.ts`: CLI export tests cover expected internal formulas.
- `server/src/presenters/mergedFloorplan.test.ts`: merged workbook tests cover classifications and store-specific headers.
- `server/src/app.test.ts`: artifact/export route tests cover downloads and stored artifacts.
- Regression test already exists: No. Existing formula tests cover intentional workbook formulas, not neutralization of source text beginning with `=`, `+`, `-`, `@`, tab, CR, or LF.

Reproduction method:
Unit test and integration test. Inject a source value such as `=HYPERLINK("http://example.test","x")` into description/control/stock/review text and export FP REC, merged XLS, exceptions CSV, and cleaned CSV.

Recommended next action:
Fix now.

## Generate FP REC From Reviewed Reconciliation Detail

Status:
Confirmed

Evidence:
- `server/src/services/reconciliationArtifacts.ts`: `persistReconciliationRunArtifacts` fetches `ReconciliationRunDetail`, but then calls `buildMergedFloorplanArtifactFromTransactions` with raw cleaned BOA and Dealertrack transactions.
- `server/src/services/mergedFloorplanExport.ts`: `buildMergedFloorplanArtifactFromTransactions` calls `buildMergedFloorplanWorkbook`, while `buildMergedFloorplanArtifact` is the detail-based path.
- `server/src/presenters/mergedFloorplan.ts`: `buildRowsFromCleanedRecords` performs a second matching pass; `cleanedRecordIdentifiersMatch` allows stock/control or Dealertrack VIN-prefix fallback when Dealertrack VIN6 is absent.
- Routes affected: `POST /reconcile` persists artifacts through `createReconciliationRunFromSourceFiles`; `GET /reconciliation-runs/:id/merged-floorplan` and `GET /reconciliation-runs/:id/fp-rec` also regenerate through `buildMergedFloorplanArtifactFromTransactions` when stored artifacts are absent or a store override/debug format is used.

Current test coverage:
- `server/src/app.test.ts`: `reconciliation artifacts persist raw, cleaned, merged, and FP REC downloads` covers artifact creation and that the merged route matches the stored merged artifact.
- `server/src/app.test.ts`: `fp-rec returns a compact accounting worksheet export model and preserves the legacy Hurst alias` covers the FP REC route behavior.
- `server/src/presenters/hurstFpRec.test.ts`: presenter tests cover detail-based FP REC placement, including VIN6 amount mismatch split behavior.
- `server/src/presenters/mergedFloorplan.test.ts`: merged presenter tests cover the cleaned-record workbook path and future store configs.
- Regression test already exists: Partial. Tests cover artifacts and detail-based presenter behavior, but none proves stored FP REC is generated from reviewed reconciliation detail or catches divergence from the second matcher.

Reproduction method:
Integration test. Upload/reconcile a BOA and Dealertrack pair with same amount and stock/control but missing Dealertrack VIN6; compare reviewed run detail against stored merged/FP REC artifact output.

Recommended next action:
Fix now.

## Fix Null-Store And Store Authorization Boundaries

Status:
Confirmed

Evidence:
- `server/src/access/storeAccess.ts`: `canAccessStore` returns true for non-admin users when `storeId === null`.
- `server/src/db/migrations/1778065200000_initial_schema.cjs`: `source_files.dealership_store_id` and `reconciliation_runs.dealership_store_id` are nullable.
- `server/src/db/migrations/1781222400000_add_reconciliation_artifacts.cjs`: `source_file_upload_contents.dealership_store_id` and `reconciliation_artifacts.dealership_store_id` are nullable.
- `server/src/app.ts`: `/automation/ingestion-events` and `/automation/events` pass missing `store_id` as null to `canAccessStore`, then call repository list methods without a store filter.
- `server/src/app.ts`: `/artifacts/:artifactId/download` authorizes on `artifact.store_id`; a null-store artifact is allowed by `canAccessStore`.
- `server/src/app.ts`: `/source-files`, `/reconciliation-runs`, `/reconciliation-runs/:id`, `/reconciliation-runs/:id/artifacts`, `/reconciliation-runs/:id/fp-rec`, and `/reconciliation-runs/:id/merged-floorplan` all rely on the same null-store access helper for sensitive store-scoped data.

Current test coverage:
- `server/src/app.test.ts`: `accounting users are scoped to assigned stores` covers explicit store 2 denial for `/source-files` and `/upload`.
- `server/src/app.test.ts`: `scheduled jobs can auto-run reconciliation when expected files arrive` covers event routes with `store_id=1` under fallback auth.
- `server/src/app.test.ts`: `scheduled due jobs run and missing expected files generate alerts` calls `/automation/events` without `store_id`, but under local fallback platform-admin behavior.
- `server/src/app.test.ts`: `reconciliation artifacts persist raw, cleaned, merged, and FP REC downloads` confirms artifacts for normal runs carry `store_id=1`.
- Regression test already exists: Partial. Explicit store scoping is tested; null-store access and missing-store event-list behavior for store-scoped users are not tested.

Reproduction method:
Integration test. Authenticate as an accounting user assigned to store 1, create or seed a null-store artifact/event or store 2 event, then request `/artifacts/:artifactId/download`, `/automation/events`, or `/automation/ingestion-events` without an allowed store filter.

Recommended next action:
Fix now.

## Standardize Frontend And Backend Error Messages

Status:
Confirmed

Evidence:
- `server/src/middleware/errorHandler.ts`: `HttpError` and other centralized errors return `{ error: { message, code, details } }`.
- `server/src/app.ts`: manual route handlers still return `{ detail }`, including `/source-files`, `/automation/ingestion-events`, `/automation/events`, `/accounts/:account_identifier`, and some reconciliation detail/analytics paths.
- `frontend/src/api/client.ts`: `getErrorMessage` reads only `body.detail` and falls back to `API request failed: <status>`, dropping standardized `error.message` responses.
- `frontend/src/api/uploads.ts`: upload handling has a separate parser that reads both `detail` and `error.message`, so upload is a special-case exception.
- Routes affected: frontend calls through `apiGet`, `apiPost`, or `apiPatch`, including `/reconcile`, `/stores`, `/dealer-groups/analytics`, `/automation/*`, `/reconciliation-runs/:id`, `/reconciliation-runs/:id/artifacts`, `/accounts/*`, and `/reports/month-end`.

Current test coverage:
- `server/src/errors/HttpError.test.ts`: covers `HttpError` serialization shape.
- `server/src/app.test.ts`: upload error tests assert standardized `error.message` plus preprocessing details for unsupported/malformed upload paths.
- `server/src/app.test.ts`: some route tests assert HTTP status for 403/422 responses.
- No frontend tests exist under `frontend/src`.
- Regression test already exists: No. There is no frontend test proving `getErrorMessage` reads `error.message`, and backend tests still allow both response shapes.

Reproduction method:
Unit test and manual workflow. A frontend unit test can feed `getErrorMessage` a response body shaped as `{ error: { message: "Invalid query." } }`; a manual workflow can trigger a standardized backend error outside upload and observe the generic frontend fallback.

Recommended next action:
Fix now.

## Add Accounting Month Boundary

Status:
Confirmed

Evidence:
- `server/src/db/migrations/1778065200000_initial_schema.cjs`: `source_files` and `reconciliation_runs` do not store an explicit accounting month.
- `server/src/db/migrations/1781222400000_add_reconciliation_artifacts.cjs`: artifacts store `accounting_month`, but this is derived after run creation.
- `server/src/app.ts`: `/reconcile` validates source file IDs, dealership, store, and source type but does not validate accounting month compatibility.
- `server/src/services/reconciliationAutomation.ts`: `evaluateAutoRunAfterUpload` uses `findLatestSourceFilePair`, which pairs the latest BOA and Dealertrack files by source type/store without month scope.
- `server/src/services/reconciliationArtifacts.ts`: `resolveAccountingMonth` infers artifact month from the latest transaction/post date or run creation fallback.
- `server/src/presenters/hurstFpRec.ts`: `resolvePeriodAnchorDate` infers period date from transaction/post dates in detail.

Current test coverage:
- `server/src/app.test.ts`: `reconciliation artifacts persist raw, cleaned, merged, and FP REC downloads` asserts derived `accounting_month` is `2025-09` for a normal fixture.
- `server/src/app.test.ts`: month-end report tests cover explicit reporting date ranges, not source pairing boundaries.
- `server/src/services/reconciliationGoldenFixtures.test.ts`: fixture tests exercise known dates but not mismatched-month rejection.
- Regression test already exists: No. There is no test that BOA and Dealertrack files from different accounting months are rejected before run/artifact creation.

Reproduction method:
Integration test and manual workflow. Upload a September BOA file and an October Dealertrack file for the same store, then call `POST /reconcile` and verify whether a run and artifacts are created.

Recommended next action:
Fix now.

## Version Duplicate Upload Parsing And Preprocessing

Status:
Confirmed

Evidence:
- `server/src/app.ts`: duplicate upload reuse is decided by `getSourceFileByHash(dealershipId, storeId, sourceType, fileHash)` before preprocessing.
- `server/src/app.ts`: healthy duplicate reuse returns the existing source file and `preprocessing: null`.
- `server/src/app.ts`: `assessSourceFileHealth` checks only persisted transaction count, row count, and validation error count.
- `server/src/db/migrations/1778065200000_initial_schema.cjs`: `source_files` has no parser route, parser version, preprocessing version, store workflow key, or parser options fields.
- `server/src/db/migrations/1778065200000_initial_schema.cjs`: `reconciliation_run_inputs` stores parser version and metadata only after a reconciliation run snapshot is created, not at the duplicate upload health gate.
- Route affected: `POST /upload`; duplicate reuse can also trigger automation through `evaluateAutoRunAfterUpload`.

Current test coverage:
- `server/src/app.test.ts`: `POST /upload reuses duplicate file contents for the same source type` covers current same-hash reuse.
- `server/src/app.test.ts`: `POST /upload reprocesses unhealthy duplicate Dealertrack source files` covers count-based repair.
- `server/src/app.test.ts`: `duplicate uploads reuse the existing source file and create a warning event` covers duplicate event creation.
- `server/src/app.test.ts`: snapshot/replay tests cover parser versions in `reconciliation_run_inputs`, after a run exists.
- Regression test already exists: No. There is no source-file-level version/config metadata and no test that stale parser/preprocessing versions force reprocessing.

Reproduction method:
Integration test after adding version metadata. Currently, manual/code inspection reproduces the gap: a healthy same-hash upload cannot be distinguished by parser/preprocessing version because the source-file record has no such fields.

Recommended next action:
Fix now.

## Clean Up V1 Workflow UI

Status:
Confirmed

Evidence:
- `frontend/src/components/WorkflowDashboard.tsx`: `refreshLists` loads source files and reconciliation runs in the same `Promise.all` as dealer-group analytics, scheduled jobs, automation status, ingestion events, operational events, and metrics.
- `frontend/src/components/WorkflowDashboard.tsx`: `StoreManagementPanel` and analytics data render in the primary workflow container.
- `frontend/src/components/WorkflowDashboard.tsx`: the intro says `Hiley floorplan pilot workflow`, not the narrower Hurst Mazda FP REC pilot.
- `frontend/src/components/WorkflowDashboard.tsx`: Step 4 download buttons render before exception review content.
- `frontend/src/components/WorkflowDashboard.tsx`: `ExceptionsTable`, match groups, diagnostics, replay, and analytics are nested under `Advanced review, analytics, and audit details`.
- `frontend/src/components/preprocessing/RemovedRowsAuditPanel.tsx`: dedicated removed-row audit component exists, but no import/use was found under `frontend/src`.
- `frontend/src/App.tsx`: advanced accounts and month-end tools remain exposed in the app navigation.
- `server/src/domain/types.ts`: source types include `bank`, `dms`, `gl`, and `oem` beyond v1 BOA/Dealertrack.
- `server/src/config/storeWorkflowConfig.ts`: Acura and FW workflow configs are compiled alongside Hurst.
- Backend future-scope routes remain active, including `/dealer-groups/analytics`, `/automation/*`, `/accounts/*`, `/reports/month-end`, `/reconciliation-runs/:id/analytics`, `/reconciliation-runs/:id/snapshot`, and `/reconciliation-runs/:id/replay`.

Current test coverage:
- No frontend tests exist under `frontend/src`.
- `server/src/app.test.ts`: backend tests cover future store configs and future-scope routes such as analytics, automation, accounts, reports, snapshot, and replay.
- `server/src/app.test.ts`: upload/reconciliation tests cover backend workflow behavior, not UI ordering or fallback when future endpoints fail.
- Regression test already exists: No. There is no app-level four-step workflow test and no test that analytics/automation endpoint failure leaves the core Hurst workflow usable.

Reproduction method:
Manual workflow and frontend integration test. In the browser, observe initial workflow load dependence on future endpoints, hidden exception review, and missing removed-row audit component; a mocked frontend test can reproduce the same state by making analytics/automation calls fail.

Recommended next action:
Fix now.
