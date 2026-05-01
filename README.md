# Dealer Recon

Dealer Recon is an upload-based reconciliation and close automation prototype for auto dealer
groups. The first product wedge is daily bank/cash reconciliation from exported files, with later
support for month-end close and OEM receivables reconciliation.

This repo currently contains the initial project scaffold only. Business logic, file parsing,
matching rules, authentication, and production deployment hardening are intentionally not built yet.

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

The backend app is served by Uvicorn with reload enabled. The initial API includes only:

```text
GET /health
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

1. Add SQLAlchemy models and Alembic migrations for source files, transactions, match groups, and
   exceptions.
2. Build CSV upload and local file storage.
3. Normalize uploaded rows into transactions.
4. Add reconciliation run records and matching-rule services.
5. Build the exception dashboard and reconciliation summary views.
