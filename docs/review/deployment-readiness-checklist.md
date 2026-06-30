# Dealer-Recon V1 Deployment Readiness Report

Status: not ready to deploy until branch decision, Ponytail reviews, production env, migrations, and smoke tests are complete.
Date: 2026-06-30.
Repository: `tcompy1/dealer-recon`.
Local branch inspected: `integration-cleanup-2026-06-10`.

Do not deploy until Ponytail security review and code review findings are resolved or explicitly accepted.

## 1. Current Branch Graph

Local refs inspected on 2026-06-30:

| Ref | HEAD | Commit |
| --- | --- | --- |
| `main` | `37e3ed0` | `Demo readiness pass + Hiley feedback round 1 + validation docs (#8)` |
| `origin/main` | `37e3ed0` | same as local `main` |
| `integration-cleanup-2026-06-10` | `ba684aa` | `Automate dealer-end-day session generation` |
| `origin/integration-cleanup-2026-06-10` | `ba684aa` | same as local branch |
| `origin/local-integration-2026-06-10` | `2ed185e` | `WIP local integration state before cleanup` |

Open GitHub PRs:

| PR | Title | Head/Base | Status |
| --- | --- | --- | --- |
| `#9` | `WIP local integration state before cleanup` | `local-integration-2026-06-10` -> `main` | Open draft, mergeable, head `2ed185e`, base `37e3ed0` |

Merge status:

- `integration-cleanup-2026-06-10` is ahead of `main`.
- `main` has no commits ahead of `integration-cleanup-2026-06-10` in the inspected local refs.
- `origin/local-integration-2026-06-10` contains only the earlier WIP commits and is behind `integration-cleanup-2026-06-10`.
- Latest v1 work is not merged into `main`.

Deployment decision required:

- Choose whether to deploy from `integration-cleanup-2026-06-10` after review, or merge it into `main` first and deploy from `main`.

## 2. Current App Architecture

Frontend build/runtime:

- React 18 + TypeScript + Vite.
- Build command: `cd frontend && npm run build`.
- Runtime image: `nginxinc/nginx-unprivileged:1.27-alpine`.
- Production frontend Dockerfile copies `frontend/dist` to `/usr/share/nginx/html`.
- `VITE_API_BASE_URL` is baked into the frontend at build time.
- Current UI uses in-memory section state in `frontend/src/App.tsx`, not React Router routes.

Backend build/runtime:

- Node 20 + TypeScript + Express.
- Build command: `cd server && npm run build`.
- Runtime command in `Dockerfile.backend`: `node dist/index.js`.
- Backend listens on port `8000`.
- Backend creates a Postgres pool, checks `SELECT 1` at startup, and exposes `/health` and `/ready`.

Database/migrations:

- PostgreSQL 16 in Docker Compose.
- Migration tool: `node-pg-migrate`.
- Local migration command: `cd server && npm run migrate`.
- Production migration command after build: `cd server && npm run migrate:prod`.
- Docker production backend copies compiled `dist` and `src/db/migrations` into `dist/db/migrations`.
- Production backend startup does not run migrations.

File upload/artifact storage:

- Uploads use Multer memory storage with 5 MB limit.
- Raw upload bytes are persisted in Postgres table `source_file_upload_contents`.
- Generated artifacts are persisted in Postgres table `reconciliation_artifacts`.
- Normal artifact downloads use database-backed stored artifacts.
- `UPLOAD_STORAGE_PATH` appears in env docs and dev compose, but current v1 code path does not use filesystem artifact storage.

Auth/session requirements:

- Production requires `DATABASE_URL`, `BACKEND_CORS_ORIGINS`, and `SESSION_SECRET`.
- `SESSION_SECRET` must be at least 32 characters and cannot equal the local placeholder outside dev/test.
- Auth uses HTTP-only cookie `dealer_recon_session`, custom HMAC token, and Postgres-backed users.
- Cookie settings: `httpOnly: true`, `sameSite: "lax"`, `secure: true` only when `NODE_ENV=production`, max age 8 hours.
- Dev/test fallback auth is blocked outside local envs.
- Demo auth seed is an explicit script and refuses production.

Health/readiness endpoints:

- `GET /health` returns `{ status: "ok" }` without dependency checks.
- `GET /ready` runs the provided readiness function, currently database `SELECT 1`.
- `/ready` does not verify migrations/schema or production user provisioning.

## 3. Deployment Readiness

`docker-compose.prod.yml` as-is:

- Does not work without env vars. `docker compose -f docker-compose.prod.yml config` fails because required values such as `POSTGRES_USER` are missing.
- With `.env.example`, compose config renders, but `.env.example` is not production-safe. It contains local DB credentials, localhost CORS/API URLs, and the local session secret that the backend should reject when `NODE_ENV=production`.
- It builds three services: `db`, `backend`, `frontend`.
- It persists Postgres data through `postgres_data`.
- It does not mount an upload/artifact filesystem volume, which is acceptable for current v1 because storage is in Postgres.

`Dockerfile.backend` production target:

- Builds TypeScript and runs `node dist/index.js`.
- Does not run migrations.
- Requires separate migration command before serving real traffic:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm backend npm run migrate:prod
```

Uploaded raw files/artifacts persistence:

- Current code persists raw uploads and artifacts in Postgres.
- `UPLOAD_STORAGE_PATH` does not need a mounted volume for the current v1 code path.
- Production backup/restore must treat Postgres as sensitive artifact storage because it contains raw source files, cleaned CSVs, merged workbook bytes, FP REC bytes, VINs, stock numbers, amounts, and audit data.

Nginx routing fallback:

- `Dockerfile.frontend` uses default nginx config with no SPA fallback.
- Current app does not use path-based client routing, so normal `/` loading works.
- Add a fallback config before adding or exposing client routes that users may refresh directly.

CORS/cookie settings with different frontend/backend domains:

- Frontend fetches with `credentials: "include"`.
- Backend CORS allows credentials and explicit origins.
- Same-site subdomains over HTTPS, such as `app.example.com` and `api.example.com`, can work with `SameSite=Lax`.
- Unrelated domains, such as static hosting on one provider domain and API on another provider domain, are likely to break cookie persistence because the cookie is not `SameSite=None; Secure`.
- If using split hosting on unrelated domains, either put frontend/backend behind a same-site reverse proxy/domain or change cookie/CSRF strategy before deployment.

SESSION_SECRET, SameSite, secure cookies, HTTPS:

- `SESSION_SECRET` validation is production-safe if real secret management is used.
- `secure: true` only happens with `NODE_ENV=production`, so production must set it exactly.
- HTTPS is required; secure cookies will not work over plain HTTP.
- `SameSite=Lax` plus no explicit CSRF token is acceptable only for a controlled same-site/private pilot if Ponytail and owner accept the risk.

## 4. Validation Commands

Backend:

```bash
cd server
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

Frontend:

```bash
cd frontend
npm ci
npm run lint
npm test
npm run build
```

Docker production build:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production build
```

Production compose smoke test:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up
curl -fsS http://localhost:8000/health
curl -fsS http://localhost:8000/ready
```

Migration smoke test:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm backend npm run migrate:prod
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm backend npm run migrate:prod
docker compose -f docker-compose.prod.yml --env-file .env.production exec db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select id, name from dealerships order by id;"'
docker compose -f docker-compose.prod.yml --env-file .env.production exec db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select * from pgmigrations order by run_on, id;"'
```

Login/upload/reconcile/export smoke test:

```bash
curl -fsS http://localhost:8000/health
curl -fsS http://localhost:8000/ready
```

Then in the deployed frontend:

1. Login with a real non-demo user.
2. Confirm `/me` returns the user and assigned store access.
3. Upload a non-sensitive BOA Hurst sample.
4. Upload a non-sensitive Dealertrack Hurst sample for the same accounting month.
5. Run reconciliation.
6. Confirm run detail loads.
7. Confirm artifact list includes `RAW_BOA`, `RAW_DEALERTRACK`, `CLEANED_BOA`, `CLEANED_DEALERTRACK`, `MERGED_FLOORPLAN`, and `FP_REC`.
8. Download stored FP REC via `/artifacts/:artifactId/download`.
9. Download `/reconciliation-runs/:id/fp-rec` and confirm it matches expected Hurst workbook structure.

Local validation executed on 2026-06-30:

- `cd server && npm run lint`: passed.
- `cd server && npm run typecheck`: passed.
- `cd server && npm test`: passed, 334 tests passed and 7 skipped.
- `cd server && npm run build`: passed.
- `cd frontend && npm run lint`: passed.
- `cd frontend && npm test`: passed, 6 tests passed. Vitest printed `WebSocket server error: Port is already in use`.
- `cd frontend && npm run build`: passed.
- `docker compose -f docker-compose.prod.yml config`: failed as expected without required env vars.
- `docker compose -f docker-compose.prod.yml --env-file .env.example config`: rendered config, but `.env.example` is not production-safe.

## 5. Deployment Options

### VPS With Docker Compose

Recommendation: simplest credible first deployment target.

Why:

- Matches existing `docker-compose.prod.yml`.
- Keeps frontend, backend, and Postgres on one same-site host or behind one reverse proxy.
- Avoids cross-site cookie problems.
- Makes migration and backup operations explicit.
- Fewest moving parts for a private dealership pilot.

Required:

- VPS with Docker and Compose.
- HTTPS reverse proxy, such as Caddy, nginx, or Traefik.
- Real `.env.production` secret file or host secret manager.
- Postgres backup automation and restore test.
- Manual migration step before first traffic.

### Render/Fly/Railway

Viable but less simple for this repo as-is.

Pros:

- Managed deploy workflow and logs.
- Managed Postgres options.
- Easier HTTPS.

Cons:

- Need explicit migration release command.
- Need persistent/managed Postgres backup configuration.
- Need same-site domain planning for cookies.
- Docker Compose may not map directly, depending on provider.

### Split Frontend Static Hosting + Backend Service + Managed Postgres

Not recommended as the first pilot unless the frontend and backend use same-site custom domains.

Pros:

- Cheap static frontend.
- Managed Postgres.
- Independent frontend/backend deployment.

Cons:

- Highest chance of cookie/CORS issues if using unrelated provider domains.
- Requires careful `VITE_API_BASE_URL`, `BACKEND_CORS_ORIGINS`, HTTPS, cookie, and CSRF decisions.
- Needs migration orchestration outside current compose file.

## 6. Risks, Blockers, Unknowns, Required Decisions

Blockers before dealership exposure:

- Latest v1 work is not merged into `main`.
- Ponytail security review is not complete.
- Ponytail code review is not complete.
- Production deployment target is not selected.
- Production domain layout is not selected.
- Production `.env.production` secrets do not exist yet.
- Production migrations have not been run against target DB.
- Real users and store assignments are not provisioned in target DB.
- Backups and restore test are not confirmed.
- HTTPS reverse proxy is not configured.
- Login/upload/reconcile/export smoke test has not run in the target environment.

Risks to explicitly accept or fix:

- `/ready` can pass before migrations are applied.
- Production compose does not run migrations automatically.
- `SameSite=Lax` cookie and no CSRF token require controlled same-site/private deployment.
- In-process login throttle is single-instance only.
- Postgres contains raw uploads and artifacts; backup access is sensitive.
- `UPLOAD_STORAGE_PATH` is misleading but not currently required.
- Nginx lacks SPA fallback config.
- Default local frontend test run showed a Vitest websocket port warning.
- Database-backed migration tests are skipped unless a test database is configured.
- Artifact retention/deletion policy is not implemented in code.
- Owner must decide RPO, RTO, retention, deletion process, and who can access backups.

## 7. Recommended Deployment Plan

1. Freeze deployment branch: use `integration-cleanup-2026-06-10` at `ba684aa` or merge it into `main` and deploy the resulting `main` SHA.
2. Run Ponytail security review using `docs/review/security-review-packet.md`.
3. Run Ponytail code review using `docs/review/code-review-packet.md`.
4. Resolve or explicitly accept every Ponytail finding.
5. Choose VPS + Docker Compose for the first private pilot unless there is a strong hosting constraint.
6. Configure production DNS with same-site frontend/backend origins, preferably one reverse proxy host.
7. Create `.env.production` outside git with real values:

```bash
POSTGRES_DB=dealer_recon
POSTGRES_USER=dealer_recon
POSTGRES_PASSWORD=<strong-db-password>
DATABASE_URL=postgresql://dealer_recon:<strong-db-password>@db:5432/dealer_recon
BACKEND_CORS_ORIGINS=https://<frontend-origin>
DEFAULT_DEALERSHIP_ID=1
SESSION_SECRET=<openssl-rand-hex-32-or-better>
VITE_API_BASE_URL=https://<backend-origin>
```

8. Build production images:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production build
```

9. Start Postgres and run migrations:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d db
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm backend npm run migrate:prod
```

10. Provision real production user(s) and Hurst store assignments. Do not run demo seed in production.
11. Start backend and frontend:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d backend frontend
```

12. Verify health/readiness:

```bash
curl -fsS https://<backend-origin>/health
curl -fsS https://<backend-origin>/ready
```

13. Run login/upload/reconcile/export smoke test with non-sensitive files.
14. Verify database backup completes.
15. Restore backup into non-production and confirm a stored FP REC artifact can be downloaded from restored data.
16. Get owner signoff on accepted risks and pilot scope.
17. Expose app to dealership users.
