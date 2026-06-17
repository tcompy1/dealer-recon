# V1 Deployment Readiness Checklist

Status: deployment readiness guide for Dealer-Recon v1 review.
Date: 2026-06-17.

## Purpose

This checklist prepares Dealer-Recon v1 for a private Hurst Mazda FP REC pilot deployment. It documents prerequisites, environment variables, migrations, backup and recovery expectations, deployment checks, rollback checks, and local defaults that must not become production defaults.

It does not implement deployment automation or new application behavior.

## Deployment Scope

V1 deployment scope:

- Single-store Hurst Mazda FP REC pilot.
- Authenticated clerk/controller workflow for monthly close.
- PostgreSQL-backed source files, normalized transactions, reconciliation runs, raw upload bytes, and generated artifacts.
- Frontend hosted with access to the backend API.
- Stored FP REC artifact as the output of record.

Out of scope:

- Multi-store production operations.
- Direct bank, Dealertrack, or GL integrations.
- Public SaaS exposure.
- Artifact object storage or retention automation.
- New reconciliation behavior.

## Required Environment Variables

### Backend

| Variable | Required in production | Purpose | Notes |
| --- | --- | --- | --- |
| NODE_ENV | Yes | Runtime mode | Use production. Production config turns on secure cookies and fail-closed config checks. |
| DATABASE_URL | Yes | PostgreSQL connection string | Required outside dev and test. |
| PORT | Optional | Backend listen port | Defaults to 8000. Must be a positive integer. |
| BACKEND_CORS_ORIGINS | Yes | Allowed frontend origins | Required outside dev and test. Use explicit URLs only. |
| DEFAULT_DEALERSHIP_ID | Recommended | Dealership ID used by migration/config defaults | Defaults to 1. Must be a positive integer. |
| SESSION_SECRET | Yes | Session signing secret | Required outside dev and test, at least 32 characters, and not the local default. |
| PARSER_DEBUG | No | Parser debug logging | Leave unset or false outside local development. |

### Frontend

| Variable | Required in production | Purpose | Notes |
| --- | --- | --- | --- |
| VITE_API_BASE_URL | Yes | Backend API base URL baked into frontend build | Set to the production backend origin before building the frontend. |

### Local Docker Compose Only

| Variable | Local default | Production note |
| --- | --- | --- |
| POSTGRES_DB | dealer_recon | Use managed production database naming and secret management. |
| POSTGRES_USER | dealer_recon | Use production credential rotation and least privilege. |
| POSTGRES_PASSWORD | dealer_recon | Never use the local default in production. |
| UPLOAD_STORAGE_PATH | /app/storage/uploads | Raw uploads and output artifacts are stored in PostgreSQL for v1. |

## Database Migration Process

Local development:

    cd server
    npm run migrate

Production after build:

    cd server
    npm run build
    npm run migrate:prod

Rollback migration command:

    cd server
    npm run migrate:prod:down

Migration readiness checks:

- Confirm the target database is backed up before migration.
- Confirm DEFAULT_DEALERSHIP_ID is the intended dealership ID before migration.
- Confirm production migrations do not seed demo users.
- Confirm a real production user and Hurst store assignment are provisioned after migration.
- Confirm pgmigrations records the expected migration set.

Use down migrations only as part of a tested rollback plan. Prefer restoring a verified database backup if data or artifact integrity is in question.

## Production User Provisioning

Before pilot use:

- Create at least one real admin or accounting user.
- Assign store-scoped users to the Hurst store.
- Do not run the demo auth seed command in production or staging.
- Verify login succeeds with the real user.
- Verify a store-scoped user only sees assigned-store records.
- Verify platform admin access is intentional and limited.

## Backup And Recovery Considerations

PostgreSQL contains the review-critical data:

- User records and store assignments.
- Source file metadata.
- Raw upload bytes in source_file_upload_contents.
- Normalized transactions.
- Reconciliation runs, match groups, exceptions, and input snapshots.
- Stored artifacts, including FP REC bytes, in reconciliation_artifacts.
- Ingestion, operational, and audit events.

Backup requirements before pilot:

- Automated database backups are enabled.
- Backup encryption at rest is provided by the infrastructure platform.
- Restore has been tested into a non-production environment.
- Restore test includes downloading a stored FP REC artifact from restored data.
- Backup retention is approved by the data owner.
- Access to backups is limited to operators with need-to-know access to VINs, stock numbers, control numbers, amounts, dates, and source files.

Recovery objectives should be owner-approved before storing real Hurst data:

| Decision | Required owner input |
| --- | --- |
| RPO | Maximum acceptable data loss window for uploaded source files and FP REC artifacts. |
| RTO | Maximum acceptable downtime during monthly close. |
| Retention period | How long raw uploads, cleaned CSVs, merged XLS, and FP REC artifacts remain stored. |
| Deletion process | Who may delete real source and artifact data and how deletion is audited. |

## Deployment Checklist

Before deployment:

- Confirm PRs for required remediation batches are merged into the deployment branch.
- Confirm [v1-validation-evidence-2026-06-17.md](../reviews/v1-validation-evidence-2026-06-17.md) is current or rerun validation.
- Confirm no application code changes are bundled with documentation-only review packet changes.
- Build backend and frontend artifacts.
- Set production backend environment variables.
- Set frontend VITE_API_BASE_URL before frontend build.
- Confirm NODE_ENV is production.
- Confirm SESSION_SECRET is unique, secret-managed, at least 32 characters, and not the local default.
- Confirm BACKEND_CORS_ORIGINS exactly matches the frontend origin.
- Confirm TLS or HTTPS is enabled in front of frontend and backend.
- Run migrations against the target database.
- Provision real users and store assignments.
- Confirm the demo auth seed command has not been run.
- Confirm the backup job has completed at least one successful backup.

Smoke test after deployment:

- GET /health returns ok.
- GET /ready returns ready.
- Login succeeds with a real user.
- Store-scoped user sees only Hurst store data.
- Upload non-sensitive test BOA and Dealertrack files in the target environment.
- Run reconciliation for the selected pair.
- Confirm expected artifact types are listed.
- Download stored FP REC from the artifact download route.
- Confirm frontend displays concrete errors for a known invalid action, such as invalid store or source selection.

Do not use real Hurst files until smoke tests pass.

## Rollback Checklist

Trigger rollback if:

- Authentication or store authorization behaves unexpectedly.
- Source uploads fail for accepted BOA or Dealertrack formats.
- Reconciliation output differs from reviewed exceptions.
- Stored FP REC cannot be downloaded.
- Database migration corrupts or hides existing source, run, or artifact data.
- Health or readiness checks fail after deployment.

Rollback steps:

1. Stop accepting new uploads.
2. Capture logs and the current deployment version or commit.
3. Put the frontend into maintenance mode or restrict access if available.
4. Restore the previous backend and frontend build.
5. If migration rollback is safe and tested, run the production down migration command; otherwise restore the pre-deployment database backup.
6. Verify GET /ready.
7. Verify login with a known real user.
8. Verify existing stored artifacts can be listed and downloaded.
9. Confirm no partially generated FP REC artifact is treated as the monthly output of record without accounting review.
10. Document the incident, affected run IDs, source file IDs, and artifact IDs.

## Local Defaults That Must Not Become Production Defaults

- Local PostgreSQL username and password from docker-compose.yml.
- The local development session secret.
- Localhost CORS origins unless explicitly serving a local development environment.
- Local frontend API base URL.
- Dev and test auth fallback.
- Demo auth seed user.
- Parser debug logging.

## Readiness Decision

A production pilot should not proceed until the owner accepts the open risks in [v1-risk-register.md](../reviews/v1-risk-register.md), especially artifact retention/hash/version policy and accounting-month boundary behavior.
