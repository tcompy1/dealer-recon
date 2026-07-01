# Monthly FP REC Runbook

Status: current v1 operator guide for Hurst Mazda.

Use this runbook to complete one monthly Hurst Mazda FP REC run. The workflow follows the [canonical four-step workflow](../product/fp-rec-four-step-workflow.md).

## Before You Start

Confirm:

- The BOA file is the Hurst Mazda floorplan statement source for the month.
- The Dealertrack file is the Hurst Mazda floorplan export for the same month.
- The files are CSV, BOA HTML-as-XLS, Dealertrack SpreadsheetML/XML-style export, or another currently supported parser format.
- Native `.xlsx` files have been resaved/exported to a supported format.

Do not combine stores or months in one run.

## Step 1: Upload Source Files

1. Open the workflow screen.
2. Select or confirm Hurst Mazda.
3. Upload the BOA source file.
4. Upload the Dealertrack source file.
5. Confirm each upload reports the expected filename and a plausible transaction count.

Stop if either file belongs to a different store or month.

## Step 2: Review Cleaning And Normalization

Check the preprocessing or removed-row audit for both sources.

BOA checks:

- Header/title rows were removed.
- Zero-balance rows were removed.
- Straightline rows were removed.
- Ending balance is retained as the floorplan amount.
- VIN6 is derived from the BOA VIN where available.

Dealertrack checks:

- Hurst floorplan amount behavior uses `2100`.
- `2110` is excluded where applicable.
- Amount signs look consistent with the expected credit/debit convention.
- VIN6 is derived from the Dealertrack description or VIN content.
- Control/reference values are retained for review.

If legitimate floorplan rows appear to be removed, stop and investigate before reconciling.

## Step 3: Run Reconciliation And Review Exceptions

Run reconciliation for the selected BOA and Dealertrack files.

Review exceptions using the taxonomy in [exception-taxonomy.md](../implementation/exception-taxonomy.md):

- BOA-only means BOA has a balance with no accepted Dealertrack row.
- Dealertrack-only means Dealertrack has a floorplan amount with no accepted BOA balance.
- VIN6 amount mismatch means the identity appears related, but amounts differ; the rows stay split.

Do not use match-rate trends, reviewer workload, or dashboard metrics to decide whether the month is acceptable. The question is whether the exceptions are explainable and the FP REC export is correct.

## Step 4: Generate And Store FP REC

Download or generate the FP REC export.

Confirm:

- The file opens in Excel or LibreOffice.
- The export is for Hurst Mazda and the selected accounting month.
- Matched rows, BOA-only rows, Dealertrack-only rows, and amount-mismatch rows follow the expected source-side behavior.
- Totals and variance are visible.
- Non-zero variance is not hidden or forced to zero.

The FP REC is the final output of record.

## Artifact Check

After the run completes, confirm these artifacts are listed and downloadable:

- `RAW_BOA`
- `RAW_DEALERTRACK`
- `CLEANED_BOA`
- `CLEANED_DEALERTRACK`
- `MERGED_FLOORPLAN`
- `FP_REC`

See [reconciliation-artifacts.md](../implementation/reconciliation-artifacts.md) for artifact behavior and review risks.

## Troubleshooting

| Issue | Action |
| --- | --- |
| Native `.xlsx` rejected | Resave or export as CSV, BOA HTML-as-XLS, or Dealertrack SpreadsheetML/XML-style file. |
| Upload succeeds but counts look wrong | Review preprocessing diagnostics and source-file shape before running reconciliation. |
| Many missing VIN6 values | Check whether the source export changed columns or description format. |
| VIN6 appears on both sides but amounts differ | Treat as source-side exceptions until the accounting difference is explained. |
| FP REC is missing from artifacts | Try the `/fp-rec` export route; if it regenerates correctly, investigate artifact persistence. |
| Artifact belongs to wrong store/month | Do not use the export. Restart with the correct source files. |

## Done Criteria

The monthly run is complete when the final FP REC export is generated, reviewed, stored, and traceable back to the raw and cleaned BOA and Dealertrack artifacts for the same Hurst Mazda month.
