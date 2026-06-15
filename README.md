# Dealer-Recon

Dealer-Recon v1 automates the Hurst Mazda monthly floorplan reconciliation workflow. The product takes one BOA source file and one Dealertrack source file, cleans and reconciles them, and produces the Hurst FP REC export as the output of record.

The dashboard exists to guide that workflow. It is not the v1 product goal, and dashboard analytics, trend metrics, reviewer workload, multi-store reporting, and full accounting-platform expansion are future scope.

## V1 Workflow

One run represents one Hurst Mazda accounting month.

1. Upload BOA and Dealertrack source files.
2. Clean and normalize inputs, including removed-row audit and VIN6 extraction.
3. Run reconciliation and review exceptions.
4. Generate and store the Hurst FP REC export.

See [docs/product/fp-rec-four-step-workflow.md](docs/product/fp-rec-four-step-workflow.md) for the canonical workflow.

## V1 Scope

In scope:

- Hurst Mazda floorplan reconciliation.
- BOA Dealer Billing Statement style input.
- Dealertrack floorplan input for Hurst account `2100`, excluding `2110` where applicable.
- VIN6 extraction from BOA VINs and Dealertrack descriptions.
- Matching only when VIN6 and absolute amount both agree.
- Reviewable exception output for BOA-only rows, Dealertrack-only rows, and VIN6 amount mismatches.
- Stored raw, cleaned, merged, and FP REC artifacts for each run.

Out of scope for v1:

- Multi-store operation.
- Full accounting-platform reconciliation.
- Generic analytics dashboards.
- Reviewer productivity or workload reporting.
- Direct Dealertrack, bank, GL, or OEM integrations.
- Native OOXML `.xlsx` upload support unless separately implemented and tested.

Some historical docs and code paths mention broader Hiley or multi-store work. Treat those as historical or future-scope context unless a current source-of-truth doc says otherwise.

## Exception Rules

- Matched rows are not listed in exception sections.
- BOA-only rows map to `On statement-not on GL`.
- Dealertrack-only rows map to `On schedule-not on statement`.
- VIN6 amount mismatches must not be merged. They remain reviewable as one BOA-side exception line and one Dealertrack-side exception line.

See [docs/implementation/exception-taxonomy.md](docs/implementation/exception-taxonomy.md).

## Stored Artifacts

Each completed run should store:

- Raw BOA upload.
- Raw Dealertrack upload.
- Cleaned BOA CSV.
- Cleaned Dealertrack CSV.
- Merged Floorplan workbook.
- Hurst FP REC workbook.

Normal artifact downloads use stored records. Export routes can regenerate output for JSON/debug or fallback behavior when a stored artifact is absent.

See [docs/implementation/reconciliation-artifacts.md](docs/implementation/reconciliation-artifacts.md).

## Primary API Endpoints

The backend listens on `http://localhost:8000` in local Docker Compose.

| Method | Endpoint | V1 purpose |
| --- | --- | --- |
| `POST` | `/upload` | Upload one BOA or Dealertrack source file. |
| `POST` | `/reconcile` | Create one reconciliation run from selected BOA and Dealertrack uploads. |
| `GET` | `/reconciliation-runs` | List reconciliation runs. |
| `GET` | `/reconciliation-runs/:id` | Read run detail and exceptions. |
| `GET` | `/reconciliation-runs/:id/merged-floorplan` | Download the merged working artifact. |
| `GET` | `/reconciliation-runs/:id/fp-rec` | Download the Hurst FP REC export. |
| `GET` | `/reconciliation-runs/:id/artifacts` | List stored artifacts for a run. |
| `GET` | `/artifacts/:artifactId/download` | Download one stored artifact. |

`GET /reconciliation-runs/:id/hurst-fp-rec` remains as a legacy compatibility alias.

## Local Development

Prerequisites:

- Docker Desktop or compatible Docker runtime.
- Node.js 18+ if running packages outside Docker.

Start the app:

```bash
docker compose up --build
```

Local services:

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:8000`
- PostgreSQL: host port `5433`

Validation commands:

```bash
docker compose exec backend npm run typecheck
docker compose exec backend npm test
docker compose run --rm frontend npm run build
```

## Documentation Map

- [PROJECT_BRIEF.md](PROJECT_BRIEF.md) - v1 scope, future scope, and product boundaries.
- [docs/product/fp-rec-four-step-workflow.md](docs/product/fp-rec-four-step-workflow.md) - canonical Hurst workflow.
- [docs/implementation/exception-taxonomy.md](docs/implementation/exception-taxonomy.md) - exception classifications and FP REC placement.
- [docs/implementation/reconciliation-artifacts.md](docs/implementation/reconciliation-artifacts.md) - artifact persistence, downloads, and review risks.
- [docs/operator/monthly-fp-rec-runbook.md](docs/operator/monthly-fp-rec-runbook.md) - monthly operator runbook.
- [docs/implementation/documentation-audit.md](docs/implementation/documentation-audit.md) - documentation inventory, contradictions, and archival recommendations.
