# Dealer-Recon

Dealer-Recon is currently a Hiley store/month floorplan reconciliation pilot.

The active product is not a generic reconciliation SaaS platform, dashboard analytics product, productivity tracker, triage queue, or consolidated multi-store reporting suite. Those surfaces may remain in code as advanced or future-scope capabilities, but the pilot path is the four-step artifact workflow below.

## Pilot Workflow

Each reconciliation run is scoped to one store and one accounting month.

1. Upload the BOA file.
2. Upload the Dealertrack file.
3. Process reconciliation with the selected store's workflow configuration.
4. Download the stored artifacts for that run:
   - Merged Floorplan
   - FP REC
   - Raw BOA
   - Raw Dealertrack
   - Cleaned BOA
   - Cleaned Dealertrack

Every store/month run produces its own merged spreadsheet and its own FP REC. The pilot does not generate combined multi-store exports.

## Supported Stores

| Store | Dealertrack floorplan behavior | Output labels |
| --- | --- | --- |
| Hurst | Uses account `2100`; excludes `2110` where applicable. | `HURST` / `2100` |
| Acura | Uses account `324`. | `ACURA` / `324` |
| FW | Aggregates `2100 + 2101 + 2101S`; excludes `2110`; displays `2100`. | `FW` or `FORT WORTH` / `2100` |

Remaining stores still require artifact analysis and store configuration before they are pilot-supported.

## Current Capabilities

- Upload and parse BOA and Dealertrack source files for a store/month run.
- Supported source formats include CSV, BOA HTML-as-XLS, Dealertrack SpreadsheetML/XML-style exports, HTML, and plain text MIME variants.
- Native OOXML `.xlsx` upload is still unsupported; resubmit as CSV, HTML-as-XLS, or SpreadsheetML-style export.
- Normalize raw source files into BOA and Dealertrack transaction datasets.
- Apply store-configured Dealertrack amount-column behavior.
- Generate a Merged Floorplan artifact from the same merged-row semantics used downstream.
- Generate FP REC from store-configured merged artifact semantics.
- Persist historical artifact records for raw uploads, cleaned datasets, merged spreadsheet, and FP REC.
- Reopen historical runs and download stored artifacts.
- Preserve the legacy Hurst FP REC route while preferring the generic FP REC route.

## Primary API Endpoints

The backend listens on `http://localhost:8000` in local Docker Compose.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/upload` | Upload one BOA or Dealertrack source file. |
| `POST` | `/reconcile` | Process selected BOA and Dealertrack source files into one reconciliation run. |
| `GET` | `/reconciliation-runs` | List reconciliation runs. |
| `GET` | `/reconciliation-runs/:id` | Read run detail. |
| `GET` | `/reconciliation-runs/:id/merged-floorplan` | Download the run's Merged Floorplan artifact. |
| `GET` | `/reconciliation-runs/:id/fp-rec` | Download the run's FP REC artifact. Preferred route. |
| `GET` | `/reconciliation-runs/:id/hurst-fp-rec` | Legacy Hurst-compatible FP REC route. |
| `GET` | `/reconciliation-runs/:id/artifacts` | List stored artifact metadata for the run. |
| `GET` | `/artifacts/:artifactId/download` | Download one stored historical artifact. |

Additional account, report, automation, analytics, and review endpoints may still exist, but they are not part of the current pilot acceptance path.

## Architecture Overview

```text
Raw BOA + Dealertrack files
        |
        v
Source-specific parsing and cleaning
        |
        v
Store workflow configuration
        |
        v
VIN6 + amount reconciliation
        |
        v
Merged Floorplan artifact
        |
        v
FP REC artifact
        |
        v
Historical artifact storage and download
```

## Local Development

### Prerequisites

- Docker Desktop or compatible Docker runtime
- Node.js 18+ if running packages outside Docker

### Start The App

```bash
docker compose up --build
```

Local services:

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:8000`
- PostgreSQL: host port `5433`

The backend runs migrations automatically during `docker compose up`.

### Validation Commands

```bash
docker compose exec backend npm run typecheck
docker compose exec backend npm test
docker compose run --rm frontend npm run build
```

Use `docker compose run --rm frontend npm run build` when the frontend dev service is not already running.

## Documentation Map

- `docs/implementation/store-workflow-matrix.md` - store-specific workflow evidence for Hurst, Acura, and FW.
- `docs/implementation/hiley-four-step-workflow-gap-analysis.md` - current pilot status and remaining gaps.
- `docs/implementation/fp-rec-output-fidelity.md` - Hurst FP REC fidelity history and output expectations.
- `docs/demo/hiley-demo-validation.md` - current demo walkthrough for the four-step workflow.
- `docs/demo/workflow-assumptions.md` - assumptions still needing clerk validation.

Historical PRDs and older project briefs may describe broader SaaS, dashboard, analytics, or reporting goals. Treat those as historical context unless explicitly pulled into the pilot roadmap.

## Current Release Caveats

- Native `.xlsx` uploads are not accepted yet.
- Hurst, Acura, and FW are the only configured floorplan workflows.
- Remaining stores need raw BOA, raw Dealertrack, merged workbook, and FP REC evidence before implementation.
- Excel visual fidelity should continue to be checked against accepted clerk artifacts.
- Dashboard, reporting, automation, and review workflow surfaces should stay de-emphasized until the store/month artifact workflow is fully trusted.
