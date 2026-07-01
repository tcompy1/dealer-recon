# Ponytail Code Review Packet

Status: ready for Ponytail code review before Dealer-Recon v1 deployment.
Date: 2026-06-30.
Branch reviewed: `integration-cleanup-2026-06-10` at `ba684aa`.

Do not deploy until Ponytail code review findings are resolved or explicitly accepted by the owner.

## Scope

Review correctness, simplicity, and launch risk for the Hurst Mazda v1 flow:

1. Upload BOA and Dealertrack files.
2. Preprocess and normalize source rows.
3. Reconcile by VIN/VIN6 plus amount.
4. Review exceptions.
5. Persist raw, cleaned, merged, and FP REC artifacts.
6. Download/export the FP REC output of record.

Non-goals:

- Do not expand v1 into generic accounting reconciliation.
- Do not add speculative abstractions or provider integrations.
- Do not refactor UI styling unless it blocks the v1 workflow.

## Exact Files To Review

Reconciliation engine:

- `server/src/services/reconciliationEngine.ts`
- `server/src/services/reconciliationReplay.ts`
- `server/src/services/reconciliationAutomation.ts`
- `server/src/services/exceptionCategorizer.ts`
- `server/src/services/exceptionCarryForward.ts`
- `server/src/domain/vin6.ts`
- `server/src/domain/money.ts`
- `server/src/domain/types.ts`

Upload preprocessing and parsers:

- `server/src/services/preprocessing/index.ts`
- `server/src/services/preprocessing/boaPreprocessor.ts`
- `server/src/services/preprocessing/dealertrackPreprocessor.ts`
- `server/src/services/preprocessing/manualVinEnrichment.ts`
- `server/src/services/preprocessing/types.ts`
- `server/src/services/parsers/sourceParserRouter.ts`
- `server/src/services/parsers/csvTableParser.ts`
- `server/src/services/parsers/boaHtmlXlsParser.ts`
- `server/src/services/parsers/dealertrackXmlParser.ts`
- `server/src/services/fileFormatDetector.ts`
- `server/src/services/transactionNormalizer.ts`

Artifact persistence/downloads:

- `server/src/services/reconciliationArtifacts.ts`
- `server/src/services/mergedFloorplanExport.ts`
- `server/src/presenters/mergedFloorplan.ts`
- `server/src/presenters/hurstFpRec.ts`
- `server/src/presenters/csv.ts`
- `server/src/spreadsheetText.ts`
- `server/src/app.ts`
- `server/src/repositories/postgresTransactionRepository.ts`
- `server/src/db/migrations/1781222400000_add_reconciliation_artifacts.cjs`

FP REC export generation:

- `server/src/presenters/hurstFpRec.ts`
- `server/src/presenters/hurstFpRec.test.ts`
- `server/src/cli/generateHurstFpRecExport.ts`
- `server/src/cli/generateHurstFpRecExport.test.ts`
- `docs/demo/fp-rec-export-verification.md`
- `docs/implementation/fp-rec-output-fidelity.md`
- `docs/product/fp-rec-four-step-workflow.md`

Migration safety:

- `server/src/db/migrate.ts`
- `server/src/db/migrations/1778065200000_initial_schema.cjs`
- `server/src/db/migrations/1778151600000_add_local_auth_user.cjs`
- `server/src/db/migrations/1779001200000_split_review_notes.cjs`
- `server/src/db/migrations/1781222400000_add_reconciliation_artifacts.cjs`
- `server/src/db/migrate.test.ts`
- `server/src/repositories/reconciliationPersistence.test.ts`

Frontend workflow path:

- `frontend/src/App.tsx`
- `frontend/src/components/WorkflowDashboard.tsx`
- `frontend/src/components/preprocessing/PreprocessingDiagnosticsPanel.tsx`
- `frontend/src/components/preprocessing/RemovedRowsAuditPanel.tsx`
- `frontend/src/components/preprocessing/VinEnrichmentModal.tsx`
- `frontend/src/components/VinPresenceDiagnosticsPanel.tsx`
- `frontend/src/api/client.ts`
- `frontend/src/api/uploads.ts`
- `frontend/src/api/reconciliation.ts`
- `frontend/src/api/errorMessage.ts`
- `frontend/src/types/reconciliation.ts`
- `frontend/src/types/sourceFile.ts`

Error handling:

- `server/src/middleware/errorHandler.ts`
- `server/src/middleware/asyncHandler.ts`
- `server/src/errors/HttpError.ts`
- `server/src/validators/requestParsers.ts`
- `frontend/src/api/errorMessage.ts`
- `frontend/src/api/errorMessage.test.ts`
- `docs/error-handling-migration-complete.md`
- `docs/error-handling-migration-remaining.md`

Tests covering v1 flow:

- `server/src/app.test.ts`
- `server/src/services/reconciliationEngine.test.ts`
- `server/src/services/reconciliationEngineTiers.test.ts`
- `server/src/services/reconciliationGoldenFixtures.test.ts`
- `server/src/services/preprocessing/index.test.ts`
- `server/src/services/preprocessing/boaPreprocessor.test.ts`
- `server/src/services/preprocessing/dealertrackPreprocessor.test.ts`
- `server/src/services/preprocessing/manualVinEnrichment.test.ts`
- `server/src/services/parsers/*.test.ts`
- `server/src/presenters/mergedFloorplan.test.ts`
- `server/src/presenters/hurstFpRec.test.ts`
- `server/src/repositories/reconciliationPersistence.test.ts`
- `frontend/src/api/errorMessage.test.ts`

## Review Questions

Reconciliation engine:

- Confirm matching rules match v1: exact amount plus VIN/full VIN/VIN6 agreement, with VIN6 amount mismatches staying reviewable.
- Confirm duplicate handling cannot hide genuine exceptions.
- Confirm run snapshots and replay behavior are useful for detecting logic drift.
- Confirm exception carry-forward cannot leak notes between stores or unrelated months.

Upload preprocessing:

- Confirm BOA, Dealertrack CSV, Dealertrack XML, and BOA HTML `.xls` paths choose the correct parser.
- Confirm removed-row audit is preserved and visible enough for the operator.
- Confirm source-specific preprocessing does not silently coerce bad data into healthy rows.
- Confirm duplicate upload reuse does not reuse stale parser/preprocessing output after meaningful parser changes, or mark as accepted risk.

Artifact persistence/downloads:

- Confirm each completed Hurst run stores six artifacts: raw BOA, raw Dealertrack, cleaned BOA, cleaned Dealertrack, merged floorplan, FP REC.
- Confirm stored artifacts are preferred for normal downloads.
- Confirm generated fallback routes do not become a second source of truth without audit visibility.
- Confirm filenames, content types, file sizes, and accounting month are correct.

FP REC export generation:

- Confirm FP REC workbook rows, section placement, totals, formulas, and exception mapping match accepted Hurst workbooks.
- Confirm spreadsheet formula injection neutralization applies to source text.
- Confirm output generation consumes reviewed reconciliation detail and not a divergent matcher.

Migration safety:

- Confirm migrations are idempotent enough for existing pilot data.
- Confirm production migrations do not seed demo auth users.
- Confirm migration rollback/down behavior is documented but not relied on over backups for real data.
- Confirm `DEFAULT_DEALERSHIP_ID` behavior is safe for a single-store pilot.

Frontend workflow path:

- Confirm the app’s first screen after login supports the whole four-step operator flow without requiring hidden endpoints.
- Confirm upload errors, parser diagnostics, removed rows, VIN enrichment, stale-run notices, run results, artifact downloads, and FP REC downloads are understandable.
- Confirm no unsupported broad dashboard workflow is presented as the v1 output of record.

Error handling:

- Confirm backend error envelopes and frontend error readers align.
- Confirm invalid upload/source/store/reconcile states return actionable errors.
- Confirm no route still returns raw errors or ambiguous generic failures in the v1 flow.

## Validation Commands

Run from repo root unless a command changes directory:

```bash
cd server && npm run lint
cd server && npm run typecheck
cd server && npm test
cd server && npm run build
cd frontend && npm run lint
cd frontend && npm test
cd frontend && npm run build
docker compose -f docker-compose.prod.yml --env-file .env.production build
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm backend npm run migrate:prod
docker compose -f docker-compose.prod.yml --env-file .env.production up
```

Manual smoke path after migrations and real test user provisioning:

```bash
curl -fsS http://localhost:8000/health
curl -fsS http://localhost:8000/ready
```

Then in the browser:

1. Login as a real non-demo user.
2. Upload a non-sensitive BOA sample for the selected Hurst store.
3. Upload a non-sensitive Dealertrack sample for the same store/month.
4. Run reconciliation.
5. Review exception counts and removed-row diagnostics.
6. List stored artifacts.
7. Download raw, cleaned, merged floorplan, and FP REC artifacts.
8. Open the FP REC export and compare totals/sections against the accepted workbook expectations.

Expected local validation observed on 2026-06-30:

- Backend lint passed.
- Backend typecheck passed.
- Backend tests passed: 334 passed, 7 skipped.
- Backend build passed.
- Frontend lint passed.
- Frontend tests passed: 6 passed. Vitest printed `WebSocket server error: Port is already in use`; tests still exited 0.
- Frontend build passed.

## Known Risks For Ponytail To Confirm Or Challenge

- Latest v1 work is still ahead of `main`, so reviewers must inspect the deployment branch, not only `main`.
- Database-backed migration tests were skipped in the default local test run unless test DB env is configured.
- Production compose does not run migrations automatically.
- `/ready` checks Postgres connectivity plus required migrated tables, including `pgmigrations`, `source_file_upload_contents`, and `reconciliation_artifacts`.
- Current frontend has no React Router client routes, but nginx lacks an explicit SPA fallback for future route refreshes.
- Cross-site frontend/backend hosting is not supported for v1; serve frontend and backend from the same site/origin behind HTTPS because cookies are `SameSite=Lax` and no CSRF token is implemented yet.
- `UPLOAD_STORAGE_PATH` is obsolete/confusing for current v1 because raw uploads and artifacts are stored in Postgres.
- Artifact retention/deletion policy remains an owner decision, not a code behavior.
