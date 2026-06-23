# V1 Single-Store Security Readiness Audit

Issue: https://github.com/tcompy1/dealer-recon/issues/31

Date: 2026-06-23

Scope: audit-first review for the v1 Hiley Mazda of Hurst single-store floorplan reconciliation pilot. This review did not rewrite architecture or change runtime behavior.

## Executive Summary

Dealer-Recon v1 has a usable security baseline for an internal, single-store pilot if deployment is tightly controlled. The strongest existing controls are authenticated routes, scoped store authorization checks, explicit production config guards, upload size/type limits, parameterized database access, persisted artifacts behind authorization, spreadsheet formula neutralization for CSV exports, and immutable audit events.

Issue #32 remediated the highest-value code gaps: login brute-force protection, artifact download audit logging, query-string log cleanup, and non-breaking server dependency fixes. Remaining pilot concerns are operational storage/backup controls and a deferred frontend Vite/esbuild advisory that requires a breaking toolchain upgrade.

Final verdict: ready for a controlled single-store pilot once deployment confirms encrypted storage/backups, restricted DB access, and private/allowlisted access. Not ready for broad public production.

## Reviewed Areas

- Authentication and session handling: `server/src/app.ts`, `server/src/auth.ts`, `server/src/config.ts`, frontend API client.
- Authorization: store access helpers, source file/run/artifact routes, read-only role handling.
- File uploads: multer configuration, upload route, persisted upload content migration.
- Artifact downloads: persisted artifacts, download route, generated export fallback routes.
- Path traversal: download implementation and artifact storage model.
- Injection risk: request parsers, repository SQL query style, CSV/spreadsheet formula handling.
- Input validation: positive IDs, enum parsers, upload file filters, config parsing.
- Secrets/config: production config loader, docker compose files, demo auth seeding.
- Audit logging: login, reconcile, replay, exception review, VIN enrichment, immutable audit table.
- Error leakage: HTTP error handler and route-level 403/404 behavior.
- Dependency risk: `npm audit --omit=dev --audit-level=low` for server and frontend.
- Unsafe production defaults: production compose and Dockerfiles.

## Findings

### Critical

None found.

### High

#### H-1: Login has no brute-force or velocity control

- Evidence: `server/src/app.ts:195-207` accepts email/password and returns `401` for invalid credentials; no rate limit, lockout, CAPTCHA, IP/user throttling, or edge protection is enforced in this code path.
- Relevant behavior: bcrypt verification is present, but repeated attempts are only bounded by external infrastructure.
- Why it matters: accounting-user credentials protect financial uploads, persisted raw files, artifacts, and review workflow state. An exposed pilot login without throttling is a practical password-guessing target.
- Recommended remediation: completed in issue #32 with an in-process failed-login throttle.
- Pilot blocker status: fixed for controlled pilot. Private/allowlisted access is still recommended.

#### H-2: Artifact downloads are not audit-logged

- Evidence: `server/src/app.ts:1105-1122` authorizes and sends `/artifacts/:artifactId/download`, but does not call `audit`; `server/src/app.ts:1627-1644` has a reusable audit helper; `server/src/db/migrations/1778065200000_initial_schema.cjs:234-244` defines audit events.
- Relevant behavior: login, reconciliation creation, replay, exception review, and VIN enrichment are audited, but downloading raw BOA, raw Dealertrack, cleaned files, merged floorplan, and FP REC artifacts is not.
- Why it matters: v1 persists and serves accounting artifacts. For a security review and accounting audit trail, artifact access should answer who downloaded what and when.
- Recommended remediation: completed in issue #32 with `artifact_downloaded` audit events for persisted artifact downloads and stored artifact fallback routes.
- Pilot blocker status: fixed for controlled pilot.

#### H-3: Persisted raw uploads and artifacts rely on infrastructure encryption, but that requirement is not documented here

- Evidence: `server/src/db/migrations/1781222400000_add_reconciliation_artifacts.cjs:16-24` stores source upload `content BYTEA`; lines `27-39` store reconciliation artifact `content BYTEA`; `docker-compose.prod.yml:1-52` defines a Postgres volume but does not document encryption/backups/retention controls.
- Relevant behavior: raw BOA/Dealertrack uploads and generated artifacts are stored in the database and are retrievable later by authorized users.
- Why it matters: the data is financial/accounting data. If database volumes, snapshots, and backups are not encrypted and access-controlled, artifact persistence widens the blast radius.
- Recommended remediation: document and enforce encrypted database storage, encrypted backups, restricted DB admin access, retention policy, and restore/audit procedure. Avoid app-level encryption for v1 unless infrastructure cannot provide it.
- Pilot blocker status: blocker until deployment owner confirms encrypted storage/backups and restricted DB access.

### Medium

#### M-1: Dependency audit has unresolved advisories

- Evidence: `server/package.json:22-30` includes runtime dependencies `express`, `multer`, `pg`, etc.; `frontend/package.json:18-33` includes Vite/build tooling. `npm audit --omit=dev --audit-level=low` reported server advisories for `brace-expansion`, `qs`, and `express` dependency chain; frontend advisories for `@babel/core`, `esbuild`, and `vite`.
- Relevant behavior: issue #32 applied non-breaking audit fixes. Server production audit now reports 0 vulnerabilities with `--omit=dev`. Frontend still reports Vite/esbuild advisories that require a breaking `npm audit fix --force` toolchain upgrade.
- Why it matters: even pilot deployments should start from a known dependency baseline, especially before formal security review.
- Recommended remediation: defer the frontend breaking Vite upgrade until a focused toolchain PR; keep dev server unexposed and build on trusted machines for pilot.
- Pilot blocker status: not a blocker for controlled pilot; blocker for formal production signoff.

#### M-2: Bearer-token fallback expands session token exposure

- Evidence: `server/src/app.ts:1555-1557` accepts either the `dealer_recon_session` cookie or `Authorization: Bearer`; `server/src/app.ts:219-225` issues an HTTP-only, SameSite cookie.
- Relevant behavior: the frontend uses cookie credentials, but the backend also accepts bearer tokens containing the same signed session value.
- Why it matters: bearer tokens are easier to leak through client storage, proxies, scripts, or copied curl commands. Keeping only the HTTP-only cookie path reduces ways a session can escape.
- Recommended remediation: remove bearer-token auth for the pilot unless a real API client needs it. If kept, document the client and add log redaction rules.
- Pilot blocker status: not a blocker for single-store pilot if no bearer clients are distributed and request logs do not include `Authorization`; should be removed before broader production.

#### M-3: Request logs include raw URL paths and query strings

- Evidence: `server/src/app.ts:1519-1527` logs `path: request.originalUrl`.
- Relevant behavior: filters and identifiers in query strings are written to logs.
- Why it matters: URLs can include account identifiers, run ids, report date ranges, and workflow context. Logs usually have a wider audience and longer retention than app data.
- Recommended remediation: completed in issue #32; request logs now record `request.path` and sorted query key names, not raw query values.
- Pilot blocker status: fixed for controlled pilot.

#### M-4: Upload controls are size/type checks, not content scanning

- Evidence: `server/src/app.ts:101-133` limits uploads to 5 MB, one file, allowed MIME types, and allowed extensions; `server/src/app.ts:541-550` hashes and processes the upload; raw content is persisted later.
- Relevant behavior: the app accepts CSV, BOA HTML-as-XLS, XML/XLS, text/plain, and octet-stream when extension and MIME match the allowlist.
- Why it matters: extension/MIME checks are useful but not a malware or active-content scan. Raw HTML-as-XLS artifacts may be downloaded later.
- Recommended remediation: for pilot, restrict uploaders to trusted accounting users and keep file size limit. Before broader production, add content sniffing/signature checks and malware scanning for persisted raw uploads.
- Pilot blocker status: acceptable for pilot with trusted uploaders and private deployment.

### Low

#### L-1: Account summary/detail routes are dealership-scoped but not store-filtered

- Evidence: `server/src/app.ts:480-503` returns account summary/detail by dealership id; store scoping is enforced elsewhere by `canAccessStore` in `server/src/access/storeAccess.ts:12-29`.
- Relevant behavior: non-platform users with access to one store may still see dealership-level account views if multiple stores exist in the same dealership.
- Why it matters: v1 pilot is single-store, so blast radius is low now. It becomes a data-minimization issue as more stores are added.
- Recommended remediation: document that account pages are pilot/admin-only, or add store-aware account filtering before multi-store rollout.
- Pilot blocker status: not a single-store blocker.

#### L-2: Route errors sometimes distinguish cross-dealership existence from not found

- Evidence: several routes return explicit `403` messages such as dealership mismatch; examples include reconciliation run checks around `server/src/app.ts:1013-1017` and artifact/store checks around `server/src/app.ts:1118-1120`.
- Relevant behavior: authenticated users may learn that an object id exists outside their dealership/store.
- Why it matters: this is low impact in a single-store pilot but becomes unnecessary information disclosure later.
- Recommended remediation: standardize unauthorized resource responses to `404` where object existence should not be disclosed.
- Pilot blocker status: not a blocker.

## Explicit Non-Findings

- Production secret/config guard exists: `server/src/config.ts:19-54` requires `DATABASE_URL`, explicit `BACKEND_CORS_ORIGINS`, non-default `SESSION_SECRET`, and minimum secret length outside local/test.
- Dev auth fallback is blocked outside local/test: `server/src/app.ts:155-160`.
- Session cookie is HTTP-only, SameSite=Lax, secure in production, and expires after 8 hours: `server/src/app.ts:219-225`.
- Password hashes use bcrypt: `server/src/auth.ts:108-117`.
- Store authorization exists for source files, runs, artifacts, upload, replay, and VIN enrichment through `canAccessStore`: `server/src/access/storeAccess.ts:12-29`.
- Read-only auditors are blocked from write actions through `canWrite`: `server/src/access/storeAccess.ts:8-10`.
- Artifact downloads do not use caller-controlled filesystem paths; content is loaded by id/dealership from the repository and sent from memory: `server/src/app.ts:1105-1122`, `server/src/app.ts:1597-1614`.
- Download filenames strip CR/LF/quotes before `Content-Disposition`: `server/src/app.ts:1605-1613`.
- SQL injection risk is low in reviewed repository paths because queries use `$1` parameter binding, including artifact lookup: `server/src/repositories/postgresTransactionRepository.ts:1174-1187`.
- Spreadsheet formula injection is mitigated for CSV exports by `neutralizeSpreadsheetText`: `server/src/spreadsheetText.ts:1-24`, `server/src/presenters/csv.ts:135-145`, `server/src/services/reconciliationArtifacts.ts:183-199`.
- Audit events are append-only at the database layer: `server/src/db/migrations/1778065200000_initial_schema.cjs:570-580`.
- Demo auth seeding is restricted to development/test: `server/src/db/seedDemoAuth.ts:20-23`.

## Acceptable Pilot Mitigations

- Private network, VPN, or IP allowlist for backend/frontend access.
- Strong unique pilot passwords; no reused demo credentials.
- Single accounting-user group with named accounts only; no shared login.
- Encrypted Postgres volume and encrypted backups; restricted DB/admin access.
- Short retention for app logs; logs accessible only to operators.
- Manual review of audit events after each pilot reconciliation.
- Controlled build machine while frontend build-tool advisories are remediated.
- Trusted uploader policy for BOA/Dealertrack source files.

## Must Fix Before Pilot

1. Confirm encrypted database storage, encrypted backups, backup retention, and restricted DB access for persisted uploads/artifacts.
2. Confirm production deployment uses `docker-compose.prod.yml`-style required secrets, not dev defaults from `docker-compose.yml`.
3. Keep pilot deployment private/allowlisted and do not expose the frontend dev server.
4. Formally accept the deferred frontend Vite/esbuild advisory for pilot, or schedule the breaking toolchain upgrade before broader production.

## Final Readiness Verdict

Ready for a controlled single-store pilot after the remaining operational storage/deployment confirmations are signed off.

Not ready for broad production or internet-exposed deployment until the deferred toolchain advisory and operational storage controls are fully closed.
