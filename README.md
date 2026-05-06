# Dealer Recon

Dealer Recon is an upload-based reconciliation and close automation prototype for auto dealer
groups. The first product wedge is daily bank/cash reconciliation from exported files, with later
support for month-end close and OEM receivables reconciliation.

This repo contains a TypeScript implementation of the upload-based reconciliation prototype. It
supports CSV upload, BOA and Dealertrack floorplan normalization, V1 reconciliation, account close
summaries, month-end reporting, and a local sample-file reconciliation workflow. Authentication and
external integrations are intentionally not built yet.

## Stack

- Backend: TypeScript, Node.js, Express, PostgreSQL
- Frontend: React, Vite, TypeScript, Tailwind
- Database: PostgreSQL 16
- Local dev: Docker Compose

## Project Layout

```text
dealer-recon/
|-- server/                  # TypeScript backend application
|   |-- src/
|   |   |-- cli/             # Local reconciliation command
|   |   |-- db/              # PostgreSQL migration script
|   |   |-- domain/          # Shared backend types
|   |   |-- repositories/    # Memory and PostgreSQL source file/transaction stores
|   |   `-- services/        # CSV normalization and reconciliation logic
|-- backend/                 # Legacy Python backend retained during migration
|-- frontend/                # React application
|   `-- src/
|       |-- api/             # API client modules
|       |-- components/      # Shared UI components
|       |-- pages/           # Route-level page components
|       |-- styles/          # Tailwind entrypoint
|       `-- types/           # Shared frontend types
|-- db/                      # Database init and seed placeholders
|-- sample-data/             # CSV fixtures for future workflow demos
|-- scripts/                 # Local-only import and reconciliation helpers
|-- storage/uploads/         # Local upload storage for prototype use
`-- docker-compose.yml
```

## Local Setup

Copy the example environment file:

```bash
cp .env.example .env
```

Start the local stack:

```bash
docker compose up --build
```

Services:

- Frontend: http://localhost:5173
- Health check: http://localhost:8000/health
- Readiness check: http://localhost:8000/ready
- PostgreSQL: localhost:5432

## Backend Development

Install backend dependencies:

```bash
npm --prefix server install
```

Run backend tests:

```bash
npm --prefix server test
```

Build the backend:

```bash
npm --prefix server run build
```

Run the backend locally without Docker:

```bash
npm --prefix server run migrate
npm --prefix server run dev
```

Run the backend with Docker:

```bash
docker compose up backend db
```

Migrations are managed by `node-pg-migrate` and recorded in the `pgmigrations` table. The backend
does not run migrations automatically when `node dist/index.js` starts. Development Compose runs
migrations before watch mode for local convenience; production deployments should run migrations as
an explicit release step.

Create a migration:

```bash
npm --prefix server exec node-pg-migrate create add_new_table \
  --migrations-dir src/db/migrations \
  --migration-file-language js
```

Run migrations:

```bash
npm --prefix server run migrate
```

Rollback one migration:

```bash
npm --prefix server run migrate:down
```

Before production rollback, take a database backup and review the migration `down` body. The initial
baseline migration has a destructive rollback because it owns the whole prototype schema.

## Deployment Runtime

Development uses `docker-compose.yml`, bind mounts, and `tsx watch`:

```bash
docker compose up --build
```

Production-like Compose uses compiled assets and non-root container users where practical:

```bash
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml run --rm backend npm run migrate:prod
docker compose -f docker-compose.prod.yml up -d
curl -f http://localhost:8000/ready
```

Deployment sequence:

1. Build immutable backend and frontend images.
2. Back up the database.
3. Run `npm run migrate:prod` once against the target database.
4. Start or roll the backend and frontend containers.
5. Check `/ready`, then run the manual smoke test.

If a deployment fails after migrations, prefer restoring the backup for destructive changes. For
small reversible changes, stop the app, run `npm run migrate:prod:down`, redeploy the prior image, and
check `/ready`.

## Tenancy Model

The backend has basic dealership scoping but does not have authentication yet. For now, every API
request runs in temporary single-dealership mode using `DEFAULT_DEALERSHIP_ID` from the backend
environment. Docker defaults this to dealership `1`.

All uploaded source files, normalized transactions, reconciliation runs, and reconciliation
exceptions are stored with `dealership_id`. Reads are filtered to the configured dealership, writes
attach the configured dealership, and cross-dealership source file, run, or exception IDs are
rejected with `403`.

The migration creates `dealerships` and `users` tables and backfills existing prototype data to the
default dealership. The `users` table is only schema groundwork right now; user authentication and
request-level user selection are not implemented.

```text
DEFAULT_DEALERSHIP_ID=1
```

The TypeScript backend exposes:

```text
GET /health
GET /ready
GET /accounts/summary
GET /accounts/:account_identifier
GET /reports/month-end
GET /source-files
GET /reconciliation-runs
GET /reconciliation-runs/:id
GET /reconciliation-runs/:id/exceptions.csv
PATCH /reconciliation-runs/:id/exceptions/:exception_id
POST /upload
POST /reconcile
```

`POST /upload` accepts multipart form data:

```text
source_type: bank | boa | dealertrack | dms | gl | oem
file: CSV file
```

Uploads are limited to CSV files, 5 MB, and 10,000 rows. The backend hashes file contents with
SHA-256 and rejects duplicate uploads for the same `source_type` and file contents with `409`.

The response includes the created source file ID, source type, filename, parsed transaction count,
and row-level validation errors:

```json
{
  "source_file_id": 1,
  "source_type": "boa",
  "filename": "boa_floorplan_sample.csv",
  "transaction_count": 4,
  "validation_errors": []
}
```

`GET /source-files` lists uploaded files. It accepts an optional `source_type` query parameter:

```text
GET /source-files?source_type=boa
```

Each item includes:

```json
{
  "source_file_id": 1,
  "source_type": "boa",
  "filename": "boa_floorplan_sample.csv",
  "row_count": 4,
  "validation_error_count": 0,
  "created_at": "2026-05-04T16:00:00.000Z"
}
```

`POST /reconcile` requires a selected BOA upload and Dealertrack upload:

```json
{
  "boa_source_file_id": 1,
  "dealertrack_source_file_id": 2
}
```

The endpoint rejects mismatched source file types with `400` and only compares transactions attached
to the selected imports. Each successful reconciliation creates an auditable reconciliation run with
persisted match groups, linked transactions, and exceptions.

The response includes `reconciliation_run_id` along with the reconciliation summary:

```json
{
  "reconciliation_run_id": 10,
  "matched_count": 3,
  "exception_count": 3,
  "duplicate_count": 1,
  "match_groups": [],
  "exceptions": []
}
```

V1 matching uses:

```text
1. VIN exact match
2. Stock number exact match plus absolute amount match
3. Absolute amount match plus reference/context overlap
```

Money is normalized at the CSV parsing boundary into integer cents and stored in PostgreSQL as
`BIGINT` in `transactions.amount_cents`. The old floating/decimal amount storage is not used.
Matching uses strict equality on absolute integer cents. There is no rounding tolerance by default;
amounts that differ by one cent do not match. Positive and negative versions of the same cent value
are treated as matching values.

The response includes matched count, exception count, duplicate count, match groups, exceptions,
match reasons, confidence scores, display `amount` strings, and `amount_cents`.

`GET /reconciliation-runs` lists prior runs with BOA and Dealertrack filenames, counts, status, and
creation time. `GET /reconciliation-runs/:id` returns the run summary, source file metadata, match
groups with linked transactions, and exceptions with transaction details.

`GET /reconciliation-runs/:id` accepts optional exception filters:

```text
GET /reconciliation-runs/10?source_type=boa
GET /reconciliation-runs/10?exception_type=missing_in_dealertrack
GET /reconciliation-runs/10?status=unresolved
GET /reconciliation-runs/10?search=M30202
```

Supported `exception_type` values are `missing_in_boa`, `missing_in_dealertrack`, and
`duplicate_transaction`. Supported exception review statuses are `unresolved`, `ignored`, and
`resolved`. Filters apply to the `exceptions` array while the run summary counts remain the
persisted run totals.

`GET /reconciliation-runs/:id/exceptions.csv` exports the filtered exceptions as CSV. It accepts the
same `source_type`, `exception_type`, `status`, and `search` query parameters and returns one row per
exception with run ID, exception metadata, review status, note, transaction identifiers, dates,
amount, stock number, VIN, description, reason, and creation time.

Exceptions start as `unresolved`. Reviewers can mark an exception `resolved` when follow-up is
complete, or `ignored` when the exception is accepted as non-actionable. Review notes are stored with
the exception and returned in run detail and CSV exports.

```json
{
  "status": "resolved",
  "note": "Cleared by warranty credit."
}
```

```text
PATCH /reconciliation-runs/10/exceptions/42
```

## Account Close Support

The account view summarizes persisted transaction activity by account identifier, account type, and
source. BOA and Dealertrack floorplan uploads default to the `floorplan` account identifier. Generic
CSV uploads can provide `account_type` and `account_identifier` columns; otherwise
`account_identifier` falls back to `account`, then `unassigned`.

`GET /accounts/summary` returns one row per account with source totals, signed net difference, and
the unresolved exception count:

```json
{
  "account_identifier": "floorplan",
  "account_type": "floorplan",
  "source_totals": [],
  "net_difference_amount_cents": -100,
  "net_difference_amount": "-1.00",
  "unresolved_exception_count": 2
}
```

`GET /accounts/:account_identifier` adds transactions grouped by source type, related
reconciliation runs, and unresolved exceptions for the selected account.

## Month-End Reports

Month-end reports are generated from persisted transactions, reconciliation runs, and reconciliation
exceptions. They do not re-run the reconciliation engine.

```text
GET /reports/month-end?start_date=2025-09-01&end_date=2025-09-30
GET /reports/month-end?start_date=2025-09-01&end_date=2025-09-30&format=csv
```

The JSON report includes the reporting period, generated timestamp, account summaries, source totals
by account, net differences, unresolved/resolved/ignored exception counts, and reconciliation runs
included in the period. The CSV export returns one row per account with:

```text
account_identifier
account_type
boa_total
dealertrack_total
net_difference
unresolved_exception_count
resolved_exception_count
ignored_exception_count
```

Report data is filtered to the configured dealership and to transactions whose transaction date, or
post date when transaction date is absent, falls inside the inclusive reporting period.

## Sample Data

Floorplan reconciliation samples are available in:

```text
sample-data/boa_floorplan_sample.csv
sample-data/dealertrack_floorplan_sample.csv
```

These samples include a VIN match, stock-number matches where Dealertrack has no VIN, BOA-only and
Dealertrack-only exceptions, and a duplicate Dealertrack entry.

## Manual Smoke Test

Use this path from a clean checkout to prove the upload, reconciliation, review, history, and export
loop works end to end. No Playwright setup is required.

Start the stack:

```bash
cp .env.example .env
docker compose up --build
```

Open http://localhost:5173 and use the workflow dashboard:

1. Upload `sample-data/boa_floorplan_sample.csv` as the BOA file.
2. Upload `sample-data/dealertrack_floorplan_sample.csv` as the Dealertrack file.
3. Click `Run reconciliation`.
4. Confirm the result summary shows `Matched: 3`, `Exceptions: 3`, and `Duplicates: 1`.
5. In the exceptions table, mark one exception resolved or ignored and add a note.
6. Use the status/source/type/search filters to confirm exceptions reload from the API.
7. Click `Export CSV` and confirm the downloaded file contains the currently filtered exceptions.
8. In History, reopen the run and confirm the same result counts and review state are still present.

Expected sample outcome:

```text
BOA transactions: 4
Dealertrack transactions: 5
Matched groups: 3
Exceptions: 3
Duplicates: 1
```

## Local Discovery File Reconciliation

Real discovery exports should stay outside this repo. Do not commit client files.

The local helper can reconcile a BOA billing statement CSV against a Dealertrack floorplan CSV using
the same CSV normalization logic as the API and the same V1 reconciliation engine:

```bash
npm --prefix server run recon -- \
  --boa-file "/path/to/BillingStatementMarch2026 (6).csv" \
  --dealertrack-file "/path/to/dealertrack.csv"
```

If the Dealertrack file is an `.xlsx` export, convert it first:

```bash
ssconvert "FLOORPLAN RECON - 2026-04-30T144427.635.XLS.xlsx" dealertrack.csv
```

See [scripts/convert_xlsx_to_csv.md](scripts/convert_xlsx_to_csv.md) for local `ssconvert`
instructions.

The helper prints:

```text
matched count
exceptions count
duplicates count
BOA-only rows
Dealertrack-only rows
duplicate Dealertrack rows
match reason and confidence
```

## Frontend Development

Install frontend dependencies:

```bash
npm --prefix frontend install
```

The frontend runs through Vite:

```bash
docker compose up frontend
```

The frontend supports the floorplan close loop:

```text
upload BOA CSV -> upload Dealertrack CSV -> run reconciliation -> review exceptions -> export -> accounts -> reports
```

The dashboard shows uploaded source file IDs, validation errors, current reconciliation results,
duplicate rows in the exceptions table, and prior persisted reconciliation runs. The Accounts
section provides account-level close summaries and detail. The Reports section generates month-end
JSON-backed summaries and links to the CSV export for the selected date range.

Useful frontend checks:

```bash
docker compose run --rm frontend npm run build
docker compose run --rm frontend npm run lint
```

## Environment Variables

```text
POSTGRES_DB=dealer_recon
POSTGRES_USER=dealer_recon
POSTGRES_PASSWORD=dealer_recon
NODE_ENV=development
DATABASE_URL=postgresql://dealer_recon:dealer_recon@db:5432/dealer_recon
BACKEND_CORS_ORIGINS=http://localhost:5173
UPLOAD_STORAGE_PATH=/app/storage/uploads
DEFAULT_DEALERSHIP_ID=1
VITE_API_BASE_URL=http://localhost:8000
```

## MVP Build Order

1. Add exportable month-end reports.
2. Add authentication and real user selection.
