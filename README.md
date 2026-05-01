# Dealer Recon

Dealer Recon is an upload-based reconciliation and close automation prototype for auto dealer
groups. The first product wedge is daily bank/cash reconciliation from exported files, with later
support for month-end close and OEM receivables reconciliation.

This repo currently contains the initial project scaffold plus CSV upload and transaction
normalization. Reconciliation logic, authentication, external integrations, and production
deployment hardening are intentionally not built yet.

## Stack

- Backend: FastAPI, SQLAlchemy, PostgreSQL, Alembic
- Frontend: React, Vite, TypeScript, Tailwind
- Database: PostgreSQL 16
- Local dev: Docker Compose

## Project Layout

```text
dealer-recon/
|-- backend/                 # FastAPI application
|   |-- app/
|   |   |-- api/             # API dependencies and route modules
|   |   |-- core/            # Settings and database wiring
|   |   |-- models/          # SQLAlchemy model modules
|   |   |-- schemas/         # Pydantic schema modules
|   |   |-- services/        # Future parsing/reconciliation services
|   |   `-- tests/           # Backend tests
|   `-- alembic/             # Database migrations
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
- Backend docs: http://localhost:8000/docs
- Health check: http://localhost:8000/health
- PostgreSQL: localhost:5432

## Backend Development

From the repo root, the backend runs in Docker by default:

```bash
docker compose up backend db
```

The backend app is served by Uvicorn with reload enabled. Alembic migrations run when the backend
container starts. The initial API includes:

```text
GET /health
POST /upload
POST /reconcile
```

`POST /upload` accepts multipart form data:

```text
source_type: bank | boa | dealertrack | dms | gl | oem
file: CSV file
```

The response includes the source type, filename, parsed transaction count, and row-level validation
errors.

`POST /reconcile` compares uploaded BOA and Dealertrack transactions. V1 matching uses:

```text
1. VIN exact match
2. Stock number exact match plus absolute amount match
3. Absolute amount match plus reference/context overlap
```

Positive and negative versions of the same amount are treated as matching values. The response
includes matched count, exception count, duplicate count, match groups, exceptions, match reasons,
and confidence scores.

## Sample Data

Floorplan reconciliation samples are available in:

```text
sample-data/boa_floorplan_sample.csv
sample-data/dealertrack_floorplan_sample.csv
```

These samples include a VIN match, stock-number matches where Dealertrack has no VIN, BOA-only and
Dealertrack-only exceptions, and a duplicate Dealertrack entry.

## Local Discovery File Reconciliation

Real discovery exports should stay outside this repo. Do not commit client files.

The local helper can reconcile a BOA billing statement CSV against a Dealertrack floorplan CSV using
the same CSV normalization logic as the API and the same V1 reconciliation engine:

```bash
python scripts/run_floorplan_recon.py \
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

Database migrations are scaffolded with Alembic. Once models exist, create and run migrations from
inside the backend container:

```bash
docker compose exec backend alembic revision --autogenerate -m "create initial tables"
docker compose exec backend alembic upgrade head
```

## Frontend Development

The frontend runs through Vite:

```bash
docker compose up frontend
```

The initial app shell is intentionally minimal and does not include product workflows yet.

## Environment Variables

```text
POSTGRES_DB=dealer_recon
POSTGRES_USER=dealer_recon
POSTGRES_PASSWORD=dealer_recon
DATABASE_URL=postgresql+psycopg://dealer_recon:dealer_recon@db:5432/dealer_recon
BACKEND_CORS_ORIGINS=http://localhost:5173
UPLOAD_STORAGE_PATH=/app/storage/uploads
VITE_API_BASE_URL=http://localhost:8000
```

## MVP Build Order

1. Add source file tracking for uploaded files.
2. Persist reconciliation runs and match groups.
3. Build deeper filtering for the exception dashboard.
4. Add account-level close support views.
5. Add exportable exception and month-end reports.
