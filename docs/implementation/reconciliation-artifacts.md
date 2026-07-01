# Reconciliation Artifacts

## Purpose

This document defines the artifacts created by the Hurst FP REC workflow and the review risks around storing and downloading them. It supports steps 1, 2, and 4 of [../product/fp-rec-four-step-workflow.md](../product/fp-rec-four-step-workflow.md).

## Artifact Set

Each completed Hurst monthly run should retain these artifacts:

| Artifact type | Source | Format | Purpose |
| --- | --- | --- | --- |
| `RAW_BOA` | Original BOA upload | Original upload bytes | Audit copy of the BOA source file. |
| `RAW_DEALERTRACK` | Original Dealertrack upload | Original upload bytes | Audit copy of the Dealertrack source file. |
| `CLEANED_BOA` | Parsed BOA transactions | CSV | Reviewable normalized BOA rows after cleaning. |
| `CLEANED_DEALERTRACK` | Parsed Dealertrack transactions | CSV | Reviewable normalized Dealertrack rows after cleaning. |
| `MERGED_FLOORPLAN` | Reconciled run detail | Excel-compatible HTML/XLS | Intermediate working artifact that shows side-by-side row classification. |
| `FP_REC` | Reconciled run detail | Excel-compatible HTML/XLS | Final Hurst FP REC export and output of record. |

## Persistence Behavior

Raw upload content is stored in `source_file_upload_contents`.

Run artifacts are stored in `reconciliation_artifacts` with:

- `reconciliation_run_id`,
- `dealership_id`,
- `dealership_store_id`,
- `accounting_month`,
- `uploaded_by_user_id`,
- `artifact_type`,
- filename, content type, file size, content bytes, and created timestamp.

The database enforces one stored artifact per run and artifact type with `UNIQUE (reconciliation_run_id, artifact_type)`.

Current storage uses PostgreSQL `BYTEA`. Object storage and retention automation are future scope unless separately implemented.

## Download Behavior

Primary routes:

| Route | Behavior |
| --- | --- |
| `GET /reconciliation-runs/:id/artifacts` | Lists stored artifact metadata for the run after store authorization. |
| `GET /artifacts/:artifactId/download` | Downloads the stored artifact bytes after dealership and store authorization. |
| `GET /reconciliation-runs/:id/merged-floorplan` | For normal XLS downloads, returns the stored `MERGED_FLOORPLAN` if present; otherwise generates from run data. |
| `GET /reconciliation-runs/:id/fp-rec` | For normal XLS downloads, returns the stored `FP_REC` if present; otherwise generates from run data. |

`format=json` and explicit `store_key` override paths are diagnostic/export paths and do not represent the normal stored-artifact download behavior.

`GET /reconciliation-runs/:id/hurst-fp-rec` remains a legacy compatibility alias for the FP REC route.

## Security And Code Review Trace

| Area | Review risk | Current controls to verify |
| --- | --- | --- |
| File upload | Oversized or unsupported files, wrong source type, unauthorized upload | 5 MB limit, one file per request, allowed MIME/extensions, `source_type` validation, write-role check, store access check. |
| Parsing | Malformed input, wrong parser route, native `.xlsx` rejection | File format detection, source-specific parser routing, unsupported-format validation, preprocessing metadata. |
| Cleaning | Legitimate rows removed or invalid rows retained | Removed-row diagnostics, cleaned CSV artifacts, parser/preprocessor tests. |
| Reconciliation | False matches, hidden amount mismatches | VIN6 plus exact absolute amount rule, amount mismatch split behavior, exception taxonomy tests. |
| Artifact storage | Wrong run/store association, overwritten outputs, large database growth | Run/store IDs on artifact rows, one artifact per type per run, file size metadata, future retention policy needed. |
| Artifact download | Cross-store or cross-dealership data exposure | Dealership-scoped lookup, store access checks, sanitized download filename. |
| FP REC generation | Export differs from reviewed run data | FP REC built from reconciled run detail and merged semantics; compare stored artifact to accepted Hurst workbook expectations. |

## Review Checklist

- A run with successful reconciliation creates all six artifact types.
- Raw artifacts match the uploaded filenames and content types.
- Cleaned artifacts contain normalized transaction rows, not raw unparsed bytes.
- The stored FP REC can be downloaded from `/artifacts/:artifactId/download`.
- The normal `/reconciliation-runs/:id/fp-rec` route returns the stored FP REC when available.
- Unauthorized users cannot list or download artifacts for another store.
- Retention and object-storage requirements are explicitly deferred or separately specified before production use.
