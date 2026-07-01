# Hurst FP REC Four-Step Workflow

## Purpose

This is the canonical v1 product workflow for Dealer-Recon.

Dealer-Recon v1 automates the Hurst Mazda clerk's monthly floorplan reconciliation from BOA and Dealertrack source files to the Hurst FP REC export. The FP REC export is the output of record.

## Canonical Four Steps

1. Upload BOA and Dealertrack source files.
2. Clean and normalize inputs, including removed-row audit and VIN6 extraction.
3. Run reconciliation and review exceptions.
4. Generate and store the Hurst FP REC export.

## Workflow

### 1. Upload Source Files

The operator uploads one BOA source file and one Dealertrack source file for the same Hurst Mazda accounting month.

Expected controls:

- The upload is associated with the selected Hurst store/month run.
- The original BOA and Dealertrack files are retained as raw artifacts.
- Unsupported formats fail with a clear validation message.

### 2. Clean And Normalize Inputs

The system parses each source file and produces normalized transaction rows.

BOA cleaning should:

- Remove non-working header/title rows.
- Remove zero-balance and straightline rows where applicable.
- Preserve the BOA ending balance used for reconciliation.
- Extract VIN6 from the BOA VIN.

Dealertrack cleaning should:

- Use the Hurst floorplan account behavior: `2100`, excluding `2110` where applicable.
- Normalize amounts in cents.
- Extract Dealertrack VIN6 from the VIN token in the description.

The cleaned BOA and cleaned Dealertrack datasets are stored as artifacts. Removed-row and preprocessing diagnostics support audit review.

### 3. Reconcile And Review Exceptions

The reconciliation rule is VIN6 plus exact absolute amount equality.

- A row is matched only when BOA VIN6 equals Dealertrack VIN6 and the absolute amounts match exactly in cents.
- Matched rows are excluded from exception sections.
- BOA-only rows map to `On statement-not on GL`.
- Dealertrack-only rows map to `On schedule-not on statement`.
- VIN6 amount mismatches are not merged. They produce reviewable BOA-side and Dealertrack-side exception lines.

Exception details are documented in [../implementation/exception-taxonomy.md](../implementation/exception-taxonomy.md).

### 4. Generate And Store Hurst FP REC

The final product outcome is the Hurst FP REC export.

The run should store:

- Raw BOA.
- Raw Dealertrack.
- Cleaned BOA.
- Cleaned Dealertrack.
- Merged Floorplan.
- Hurst FP REC.

Artifact behavior is documented in [../implementation/reconciliation-artifacts.md](../implementation/reconciliation-artifacts.md).

## Dashboard Role

The dashboard exists to guide the four-step workflow:

- choose source files,
- start reconciliation,
- review exceptions,
- download stored artifacts.

Dashboard analytics, trend deltas, reviewer workload, productivity metrics, and multi-store rollups are future scope unless explicitly moved into v1 by a new product decision.

## V1 Done Means

- A Hurst Mazda monthly run can be completed from BOA and Dealertrack uploads.
- Cleaned inputs and removed-row diagnostics can be reviewed.
- Exceptions reflect the taxonomy in the implementation docs.
- The stored Hurst FP REC export preserves the expected row classifications and totals.
- Stored artifacts can be listed and downloaded after the run.
