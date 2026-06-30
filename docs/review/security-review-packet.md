# Ponytail Security Review Packet

Status: ready for Ponytail security review before Dealer-Recon v1 deployment.
Date: 2026-06-30.
Branch reviewed: `integration-cleanup-2026-06-10` at `ba684aa`.

Do not deploy until Ponytail security findings are resolved or explicitly accepted by the owner.

## Scope

Review the production security posture for the single-store Hurst Mazda FP REC pilot. Focus on authentication, authorization, upload safety, artifact access, database query safety, production secrets, logging, and deployment assumptions.

Non-goals:

- Do not redesign authentication beyond what is required for a private v1 pilot.
- Do not add broad SaaS/multi-tenant features.
- Do not review historical docs as launch source of truth except where they document accepted risk.

## Exact Files To Review

Core backend security surface:

- `server/src/app.ts`
- `server/src/auth.ts`
- `server/src/config.ts`
- `server/src/access/storeAccess.ts`
- `server/src/middleware/errorHandler.ts`
- `server/src/errors/HttpError.ts`
- `server/src/logger.ts`
- `server/src/validators/requestParsers.ts`

Persistence and SQL:

- `server/src/repositories/postgresTransactionRepository.ts`
- `server/src/repositories/transactionRepository.ts`
- `server/src/db/migrate.ts`
- `server/src/db/seedDemoAuth.ts`
- `server/src/db/migrations/1778065200000_initial_schema.cjs`
- `server/src/db/migrations/1778151600000_add_local_auth_user.cjs`
- `server/src/db/migrations/1779001200000_split_review_notes.cjs`
- `server/src/db/migrations/1781222400000_add_reconciliation_artifacts.cjs`

Upload, preprocessing, and artifact handling:

- `server/src/services/preprocessing/index.ts`
- `server/src/services/preprocessing/boaPreprocessor.ts`
- `server/src/services/preprocessing/dealertrackPreprocessor.ts`
- `server/src/services/preprocessing/manualVinEnrichment.ts`
- `server/src/services/parsers/sourceParserRouter.ts`
- `server/src/services/parsers/csvTableParser.ts`
- `server/src/services/parsers/boaHtmlXlsParser.ts`
- `server/src/services/parsers/dealertrackXmlParser.ts`
- `server/src/services/reconciliationArtifacts.ts`
- `server/src/services/mergedFloorplanExport.ts`
- `server/src/presenters/hurstFpRec.ts`
- `server/src/spreadsheetText.ts`

Frontend auth/API surface:

- `frontend/src/api/client.ts`
- `frontend/src/api/auth.ts`
- `frontend/src/api/uploads.ts`
- `frontend/src/api/reconciliation.ts`
- `frontend/src/App.tsx`
- `frontend/src/components/WorkflowDashboard.tsx`
- `frontend/src/components/preprocessing/PreprocessingDiagnosticsPanel.tsx`
- `frontend/src/components/preprocessing/RemovedRowsAuditPanel.tsx`
- `frontend/src/components/preprocessing/VinEnrichmentModal.tsx`

Deployment and environment:

- `docker-compose.prod.yml`
- `docker-compose.yml`
- `Dockerfile.backend`
- `Dockerfile.frontend`
- `.env.example`
- `.github/workflows/ci.yml`
- `README.md`
- `docs/operator/v1-deployment-readiness.md`
- `docs/reviews/v1-security-review.md`
- `docs/reviews/v1-single-store-security-readiness-issue-31.md`
- `docs/reviews/v1-security-remediation-issue-32.md`
- `docs/reviews/v1-launch-gate-checklist.md`
- `docs/reviews/v1-risk-register.md`

## Security Questions

Auth/session/cookie handling:

- Confirm `/login`, `/logout`, `/me`, protected-route middleware, `dealer_recon_session`, and bearer-token fallback are acceptable for a private pilot.
- Confirm the custom HMAC token verifier has no obvious parsing, expiry, user binding, or timing issues.
- Confirm cookie settings are production-safe only when served over HTTPS with `NODE_ENV=production`.
- Confirm `sameSite: "lax"` is acceptable only for same-site frontend/backend deployment. If frontend and backend are on unrelated domains, login will likely not persist for fetch/XHR because the cookie is not `SameSite=None; Secure`.
- Confirm lack of CSRF token is accepted only for same-site/private pilot deployment with tightly scoped CORS, or require CSRF protection before internet exposure.
- Confirm in-process login throttling is accepted only for one backend instance; multi-instance deployment needs shared rate limiting.

CORS config:

- Confirm `BACKEND_CORS_ORIGINS` rejects missing or invalid origins outside dev/test.
- Confirm Express CORS with `credentials: true` and explicit origins is safe for the chosen domains.
- Confirm no wildcard or localhost production origin is used.

Upload validation:

- Confirm max upload size of 5 MB is acceptable.
- Confirm extension plus MIME checks are sufficient for CSV, BOA HTML `.xls`, and Dealertrack XML/SpreadsheetML.
- Confirm parser behavior cannot be abused into excessive CPU/memory on crafted files inside the 5 MB limit.
- Confirm upload validation errors do not leak raw source data.

File storage/artifact access:

- Raw upload bytes and artifacts are stored in Postgres tables `source_file_upload_contents` and `reconciliation_artifacts`, not filesystem storage.
- Confirm artifact download routes enforce dealership and store access before returning bytes.
- Confirm generated export fallback behavior is acceptable when stored artifact is missing.
- Confirm audit events for artifact downloads do not leak sensitive content and are useful enough for a pilot.
- Confirm backup/encryption/retention decisions cover Postgres because it contains raw files and FP REC artifacts.

RBAC/store access controls:

- Confirm `platform_admin`, `dealer_group_admin`, `store_manager`, `accounting_user`, and `read_only_auditor` behavior.
- Confirm null-store data is not exposed to store-scoped users.
- Confirm upload, reconcile, VIN enrichment, exception review, artifact list/download, reports, automation events, and store creation apply the intended role/store checks.

SQL/query safety:

- Confirm application queries use parameterized SQL everywhere user input reaches SQL.
- Review migration SQL interpolation for `DEFAULT_DEALERSHIP_ID`.
- Confirm raw JSON/audit state handling does not allow SQL injection or oversized audit records.

Secrets/env handling:

- Confirm `DATABASE_URL`, `BACKEND_CORS_ORIGINS`, and `SESSION_SECRET` are required outside dev/test.
- Confirm production refuses the local development session secret.
- Confirm `.env.example` is documentation only and must not be used as production secrets.
- Confirm demo auth seeding is explicit and blocked outside dev/test.

Production logging/data leakage:

- Confirm request logs use sanitized route patterns and query-key names only.
- Confirm `serializeError` stack traces are acceptable in production logs or should be reduced before dealership exposure.
- Confirm `PARSER_DEBUG` must stay unset/false in production because parser samples can contain VINs, stock numbers, and amounts.

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
docker compose -f docker-compose.prod.yml config
docker compose -f docker-compose.prod.yml --env-file .env.production config
docker compose -f docker-compose.prod.yml --env-file .env.production build
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm backend npm run migrate:prod
docker compose -f docker-compose.prod.yml --env-file .env.production up
curl -fsS http://localhost:8000/health
curl -fsS http://localhost:8000/ready
```

Expected results:

- Lint, typecheck, tests, and builds pass.
- `docker compose -f docker-compose.prod.yml config` fails unless required env vars are provided.
- `.env.example` must not be used for production smoke because it contains local defaults; backend should reject its default `SESSION_SECRET` when `NODE_ENV=production`.
- Production migration command runs before smoke testing authenticated API flows.

## Known Risks For Ponytail To Confirm Or Challenge

- Latest v1 work is not merged into `main`; deployment branch must be selected deliberately.
- `docker-compose.prod.yml` does not run migrations automatically.
- `/ready` confirms database connectivity only, not migration/schema readiness.
- Cross-site split hosting is risky with `SameSite=Lax`; prefer same-site deployment or a reverse proxy for v1.
- No explicit CSRF token exists.
- In-process login throttle is not shared across backend replicas.
- Postgres stores raw uploads and artifacts; database backups are sensitive artifacts.
- `UPLOAD_STORAGE_PATH` appears in env docs/compose but current v1 storage is database-backed.
- Production frontend nginx has no custom SPA fallback config. Current app has no client routes, but fallback is still safer before adding route paths.
