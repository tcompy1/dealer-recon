# V1 Security Review Packet

Status: security review packet for Dealer-Recon v1.
Date: 2026-06-23.

## Product Boundary

Dealer-Recon v1 is a single-store Hurst Mazda FP REC pilot. The application supports a clerk through one monthly workflow:

1. Upload BOA and Dealertrack source files.
2. Clean and normalize inputs, including removed-row audit and VIN6 extraction.
3. Run reconciliation and review exceptions.
4. Generate and store the Hurst FP REC export.

The FP REC export is the output of record. The dashboard guides this workflow. Multi-store expansion, direct integrations, analytics, and full accounting-platform scope are future work.

## Security Review Goal

The v1 security review should answer whether the current application is acceptable for a private pilot handling Hurst Mazda floorplan source files and generated FP REC artifacts.

Primary review risks:

- Untrusted file upload and parsing.
- Sensitive source data in raw uploads, cleaned artifacts, exceptions, and exports.
- Store authorization for source files, runs, events, reports, and artifact downloads.
- Spreadsheet injection in CSV and HTML-as-XLS outputs.
- Local development defaults leaking into production.
- Operational readiness for backups, migrations, restore, and rollback.

## Architecture Summary

Relevant backend entry points:

- server/src/index.ts creates the production Express app and supplies Postgres repositories.
- server/src/app.ts defines authentication, upload, reconciliation, artifact, report, and operational routes.
- server/src/config.ts validates runtime configuration.
- server/src/db/migrations contains schema migrations.
- server/src/repositories contains PostgreSQL repository implementations.
- server/src/services contains parsing, preprocessing, reconciliation, artifact persistence, and reporting logic.
- server/src/presenters contains FP REC, merged floorplan, CSV, and report presentation logic.

Relevant frontend entry points:

- frontend/src/api contains the API client and error-message parsing.
- frontend/src/App.tsx and related components guide the clerk workflow.

## Trust Boundaries

| Boundary | Untrusted input | Current controls | Review notes |
| --- | --- | --- | --- |
| Browser to API | Credentials, source file bytes, filenames, query/body parameters | Session cookie, CORS config, request parsers, upload size/type checks, role/store checks | SameSite Lax cookie is used; no explicit CSRF token exists. Production should stay same-site and origin restricted unless CSRF controls are added. |
| Upload to parser | BOA and Dealertrack bytes and filenames | 5 MB upload limit, one file per request, extension and MIME allowlist, content sniffing, parser routing, SpreadsheetML column cap | Native XLSX remains unsupported for upload. |
| Parser to normalization | Parsed rows and diagnostics | Source-specific preprocessors, removed-row diagnostics, row limits, VIN6 extraction helpers | Removed-row metadata may contain sensitive business data. |
| Reconciliation to artifacts | Reviewed run detail and source transactions | VIN/full-VIN/VIN6 plus exact absolute amount matching, exception taxonomy, stored artifact generation from run detail | Accounting month is inferred for artifact metadata, not explicitly enforced at reconcile time. |
| Artifact download | Stored raw, cleaned, merged, and FP REC bytes | Dealership lookup, store-access check, attachment download, basic filename sanitization | No nosniff header or robust filename encoding yet. |

## Data Flow From Upload To Artifact Generation

1. Upload source files through POST /upload.
2. Backend validates source_type, file presence, upload size, MIME/extension allowlist, write role, and store access.
3. Backend hashes the upload bytes and checks duplicate source files for the same dealership, store, source type, and hash.
4. Backend detects file format and routes to BOA CSV/HTML-as-XLS or Dealertrack CSV/SpreadsheetML parsing where supported.
5. Preprocessors clean source-specific rows, extract VIN6, create removed-row/preprocessing diagnostics, and return normalized transactions.
6. Source metadata, raw upload bytes, normalized transactions, ingestion events, and preprocessing metadata are persisted.
7. POST /reconcile requires selected BOA and Dealertrack source IDs, validates dealership, store, and source type, then runs reconciliation.
8. Reconciliation creates match groups and exceptions using the documented taxonomy.
9. persistReconciliationRunArtifacts stores raw uploads, cleaned CSVs, merged floorplan, and FP REC artifacts. The merged and FP REC artifacts are built from reviewed ReconciliationRunDetail.
10. Artifact list and download routes enforce dealership and store authorization before returning metadata or bytes.

## Authentication Model

Authentication is local username/password backed by the users table.

- Passwords are stored as bcrypt hashes.
- Login route: POST /login.
- Session cookie: dealer_recon_session.
- Cookie settings: httpOnly, sameSite lax, secure true when NODE_ENV is production, eight-hour max age.
- Session token: HMAC-signed token containing user ID, dealership ID, and expiration.
- GET /me returns the current authenticated user.
- POST /logout clears the session cookie.
- Failed login attempts are throttled in process: 5 failures per client/email key in 15 minutes, with successful login clearing that key.

Production protections now present:

- server/src/index.ts constructs createApp with PostgresAuthRepository and allowDevDealershipFallback false.
- createApp rejects dev fallback when NODE_ENV is not development or test.
- createApp rejects missing auth repository outside explicit local dev/test fallback.
- Production migration behavior does not create demo@dealer-recon.local or set known demo hashes.
- Demo auth seeding exists only as explicit dev/test seed behavior in server/src/db/seedDemoAuth.ts.

## Authorization And Store-Access Model

| Role | Current behavior |
| --- | --- |
| platform_admin | Can access all stores and null-store records inside the dealership. |
| dealer_group_admin | Can access stores in the user's dealer group. Cannot access null-store records. |
| store_manager | Can access assigned stores only. Cannot access null-store records. |
| accounting_user | Can access assigned stores only. Cannot access null-store records. |
| read_only_auditor | Can read permitted records, but cannot upload, reconcile, or update review workflow state. |

Store access is centralized in server/src/access/storeAccess.ts:

- platform_admin returns true for any store ID, including null.
- Non-platform roles return false for null store IDs.
- Dealer group admins are checked against store dealer-group ownership.
- Store users are checked against assigned store_ids.

Routes with store-sensitive behavior include:

- POST /upload.
- GET /source-files.
- POST /reconcile.
- GET /reconciliation-runs and GET /reconciliation-runs/:id.
- GET /reconciliation-runs/:id/artifacts.
- GET /artifacts/:artifactId/download.
- GET /automation/ingestion-events and GET /automation/events.
- GET /reports/month-end.

## Accepted File-Format Contract

V1 source files are limited to the Hurst workflow source formats supported by the current parsers:

- BOA CSV.
- BOA HTML-as-XLS table export.
- Dealertrack CSV where supported by the parser router.
- Dealertrack SpreadsheetML/XML export.

Upload controls:

- One uploaded file per request.
- 5 MB upload limit.
- Source type must be BOA or DEALERTRACK.
- Extension/MIME allowlist is enforced.
- File format detection routes only supported content to source-specific parsers.
- Native XLSX is not accepted for v1 upload behavior.

## Parser Abuse And Malformed Input Posture

Relevant parser controls:

- SpreadsheetML ss:Index column expansion is capped in server/src/services/parsers/dealertrackXmlParser.ts.
- Normal SpreadsheetML indexed gaps still parse.
- Malformed or unsupported files return controlled parser or validation errors.
- BOA and Dealertrack preprocessors record removed-row diagnostics rather than silently absorbing unexpected rows.
- Row and field normalization logic is covered by parser/preprocessor tests.

Residual parser risks:

- No malware scanning is performed on uploaded files.
- Parser/preprocessor version identity is not yet included in duplicate upload reuse decisions.
- Accounting month is not enforced as a parser or reconciliation invariant.

## Sensitive Data Inventory

Sensitive or business-sensitive data handled by v1 includes:

- VINs and VIN6 values.
- Stock numbers.
- Control numbers.
- Vehicle descriptions.
- Dates and accounting dates.
- Amounts, balances, and floorplan charges.
- Source filenames.
- User identifiers and roles.
- Names if present in uploaded source files.

Locations where sensitive data may persist:

- source_files metadata.
- source_file_upload_contents raw bytes.
- normalized transactions.
- reconciliation runs, match groups, exceptions, and snapshots.
- reconciliation_artifacts raw, cleaned, merged, and FP REC bytes.
- ingestion, operational, and audit events.
- downloaded CSV and HTML-as-XLS files.
- application logs if request context or error details are expanded in production.

## Removed-Row Audit Exposure

Removed-row and preprocessing diagnostics are useful for auditability, but they may expose source-derived values. Treat them as business-sensitive data.

Review expectations:

- Removed-row data should be visible only to authenticated users with appropriate store access.
- Removed-row diagnostics should not be logged verbosely in production.
- Exports and artifacts containing removed-row details should follow the same retention and access policy as source files.

## Artifact Storage And Downloads

V1 stores artifacts in PostgreSQL through reconciliation_artifacts. Artifact types include:

- RAW_BOA.
- RAW_DEALERTRACK.
- CLEANED_BOA.
- CLEANED_DEALERTRACK.
- MERGED_FLOORPLAN.
- FP_REC.

Current controls:

- Artifacts are tied to a reconciliation run.
- V1 runs/artifacts carry store identity through the selected source files/run path.
- Store-scoped users cannot access other-store or null-store artifacts.
- Download routes require authentication and store authorization.
- Filenames are sanitized for header safety.
- Stored and generated fallback artifact downloads emit `artifact_downloaded` audit events.

Known limitations:

- No retention automation.
- No content hash ledger exposed for review.
- No artifact immutability/version policy beyond database persistence.
- No object-storage access controls because artifacts are stored in PostgreSQL for v1.

## Export And Spreadsheet Injection Safety

Source-derived text in CSV and HTML-as-XLS presenters is neutralized when it starts with formula-leading characters or leading control characters. This protects downloaded artifacts from spreadsheet formula execution when opened in desktop spreadsheet tools.

Applied areas include:

- FP REC HTML-as-XLS export.
- Merged floorplan HTML-as-XLS export.
- Exceptions CSV.
- Cleaned transactions CSV/artifacts.
- Reachable report CSV presenter paths.

Intentional app-generated workbook formulas should remain intact where the app explicitly creates them. Numeric amount cells should remain numeric/formatted where appropriate.

## Error Handling And Information Disclosure

Current posture:

- Backend routes generally return controlled detail or error.message responses.
- Frontend API client surfaces both response shapes.
- Workflow errors now show concrete backend messages rather than only API request failed.
- Request logging includes method, route pattern or sanitized known path, query key names, status, and duration. It does not log raw query values or known dynamic route IDs.

Review risks:

- Production logs should not include raw source-file content, full parser payloads, or sensitive row-level details.
- Parser debug logging should remain disabled outside local development.
- Unexpected internal errors should avoid leaking stack traces to the frontend.

## Local Defaults That Must Not Become Production Defaults

Do not use these in production or staging:

- Local PostgreSQL username/password from docker-compose.yml.
- Local development session secret.
- Localhost-only CORS origins unless intentionally running local development.
- Local frontend API base URL.
- Dev/test auth fallback.
- Demo auth seed user.
- Parser debug logging.

Production must provide:

- DATABASE_URL.
- SESSION_SECRET with at least 32 characters and secret-manager handling.
- BACKEND_CORS_ORIGINS with explicit frontend origin(s).
- NODE_ENV production.
- Real production users and store assignments.
- TLS/HTTPS termination.
- Database backup and restore process.

## Security Test Evidence

Security-relevant tests are summarized in [v1-validation-evidence-2026-06-17.md](v1-validation-evidence-2026-06-17.md).

Key covered areas:

- Auth fallback fail-closed behavior.
- Login throttling and successful-login failure reset.
- Demo auth not seeded by production migration behavior.
- SpreadsheetML ss:Index cap.
- Spreadsheet formula neutralization.
- Store and null-store authorization boundaries.
- Artifact download audit events.
- Frontend/backend error message handling.

## Residual Security Risks

See [v1-risk-register.md](v1-risk-register.md) for the accepted/deferred risk register.

Most important remaining owner decisions:

- Artifact retention, hash, version, and immutability policy.
- Accounting month boundary enforcement.
- Malware scanning for uploaded files.
- Explicit CSRF tokens.
- Upload/reconcile/download rate limiting beyond the current login throttle.
- Production hosting, secret management, logging, backup, and restore controls.
