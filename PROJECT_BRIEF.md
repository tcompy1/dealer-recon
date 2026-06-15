# Dealer-Recon Project Brief

## Current V1 Goal

Dealer-Recon v1 is a single-store Hurst Mazda FP REC pilot.

The product goal is to automate the clerk's monthly four-step workflow from BOA and Dealertrack source files to the final Hurst FP REC export. The FP REC export is the output of record.

Canonical workflow:

1. Upload BOA and Dealertrack source files.
2. Clean and normalize inputs, including removed-row audit and VIN6 extraction.
3. Run reconciliation and review exceptions.
4. Generate and store the Hurst FP REC export.

The canonical workflow lives in [docs/product/fp-rec-four-step-workflow.md](docs/product/fp-rec-four-step-workflow.md).

## Users

Primary v1 user:

- Hurst Mazda accounting clerk or controller responsible for monthly floorplan reconciliation.

Secondary review audience:

- Engineering reviewer validating upload, parsing, reconciliation, artifact storage, and export generation behavior.
- Accounting stakeholder validating FP REC fidelity against the accepted clerk workbook.

## V1 Scope

In scope for v1:

- Hurst Mazda only.
- One accounting month per reconciliation run.
- One BOA source file and one Dealertrack source file per run.
- Deterministic BOA and Dealertrack cleaning.
- Removed-row diagnostics for preprocessing review.
- VIN6 extraction from BOA VIN and Dealertrack description.
- Reconciliation using VIN6 plus exact absolute amount equality.
- Exception review for source-side rows and VIN6 amount mismatches.
- Hurst FP REC export generation.
- Stored raw, cleaned, merged, and FP REC artifacts.

## V1 Non-Goals

These are future scope, not current v1 behavior:

- Multi-store production support.
- Consolidated multi-store exports.
- Generic reconciliation SaaS positioning.
- Full GL, bank, OEM, lender, or accounting-platform expansion.
- Dashboard analytics, trend deltas, reviewer workload, productivity metrics, and automated close reporting.
- Direct integrations with Dealertrack, BOA, GL systems, or OEM portals.

Historical docs and code may mention these ideas. They should not be used as v1 acceptance criteria.

## Product Boundaries

The dashboard should help the clerk complete the workflow. It should not redefine the product around metrics or generic analytics.

The v1 success condition is simple: a Hurst Mazda user can upload the monthly BOA and Dealertrack files, review the resulting exceptions, and download a stored Hurst FP REC export that preserves the expected row classifications and totals.

## Reconciliation Rules

- Confirmed match: BOA VIN6 equals Dealertrack VIN6 and `abs(BOA amount) == abs(Dealertrack amount)` in cents.
- Matched rows are excluded from exception sections.
- BOA-only row: appears as `On statement-not on GL`.
- Dealertrack-only row: appears as `On schedule-not on statement`.
- VIN6 amount mismatch: never merge into one row. Emit reviewable BOA-side and Dealertrack-side exception lines.
- Non-zero variance is allowed when exceptions exist.

See [docs/implementation/exception-taxonomy.md](docs/implementation/exception-taxonomy.md).

## Artifacts

Each completed run should retain:

- Raw BOA upload.
- Raw Dealertrack upload.
- Cleaned BOA CSV.
- Cleaned Dealertrack CSV.
- Merged Floorplan workbook.
- Hurst FP REC workbook.

Artifact behavior is documented in [docs/implementation/reconciliation-artifacts.md](docs/implementation/reconciliation-artifacts.md).

## Review Readiness

Security and code review should trace risks through:

- File upload limits, MIME/extension filtering, duplicate detection, and store authorization.
- Source-specific parsing and unsupported format handling.
- Preprocessing diagnostics and removed-row audit.
- Reconciliation rules and exception taxonomy.
- Artifact persistence and access-controlled download.
- FP REC export generation from reconciled run data.

## Future Scope

Future work may include more stores, broader accounting workflows, richer review states, direct integrations, object storage, formal retention policy, and analytics. Those items require their own source artifacts, acceptance criteria, and review plan before they become product scope.
