# Hiley Demo Validation Guide

Status note: stale for v1 product scope. This guide describes a broader Hiley/multi-store demo path; Dealer-Recon v1 is the single-store Hurst Mazda FP REC pilot documented in `docs/product/fp-rec-four-step-workflow.md`.

## Purpose

Use this guide to validate the current Hiley store/month floorplan pilot. The demo should stay centered on the four-step artifact workflow, not dashboards, productivity metrics, review queues, or consolidated reporting.

## Product Boundary

Dealer-Recon currently produces one reconciliation run per store/month.

For each completed run, the user should be able to download:

- Merged Floorplan
- FP REC
- Raw BOA
- Raw Dealertrack
- Cleaned BOA
- Cleaned Dealertrack

Supported stores for this demo scope:

- Hurst
- Acura
- FW

Remaining stores should not be demoed as supported until their workflow evidence and config are complete.

## 1. Store And Source File Selection

### What To Do

1. Choose the store for the month being reconciled.
2. Confirm the run is for one store and one accounting month.

### What To Verify

- The selected store is Hurst, Acura, or FW.
- The BOA and Dealertrack files belong to the same store/month.
- No combined multi-store export is expected.

## 2. Upload BOA

### What To Do

Upload the BOA file for the selected store/month.

### Expected Behavior

| Signal | Expected behavior |
| --- | --- |
| Upload result | Success confirmation with filename and transaction count. |
| Supported formats | CSV, BOA HTML-as-XLS, HTML/table-style exports, and plain text MIME variants. |
| Unsupported format | Native `.xlsx` upload should fail with guidance to resubmit as CSV or HTML-as-XLS. |
| Cleaning diagnostics | Removed title/header, zero-balance, and straightline rows should be visible in preprocessing diagnostics. |

### Questions To Ask

- Is this the BOA export you would normally use for this store/month?
- Do the removed rows make sense?
- Are any legitimate floorplan vehicles missing from the cleaned dataset?

## 3. Upload Dealertrack

### What To Do

Upload the Dealertrack file for the selected store/month.

### Expected Behavior

| Store | Expected Dealertrack behavior |
| --- | --- |
| Hurst | Uses `2100`; excludes `2110` where applicable. |
| Acura | Uses `324`. |
| FW | Aggregates `2100 + 2101 + 2101S`; excludes `2110`; displays `2100`. |

Supported input families include CSV and SpreadsheetML/XML-style exports. Native `.xlsx` remains unsupported.

### Questions To Ask

- Is this the Dealertrack export you would normally use?
- Does the selected account behavior match your store's process?
- For FW, does excluding `2110` and aggregating `2100 + 2101 + 2101S` match the office workflow?

## 4. Process Reconciliation

### What To Do

Click `Run/process reconciliation`.

### What To Verify

- The run completes without error.
- Match counts and exception counts are plausible for the selected month.
- VIN6 plus exact absolute amount is the match rule.
- VIN6 amount mismatches remain split into BOA-side and Dealertrack-side rows.
- Logical account grouping remains `floorplan`; physical export labels such as `2100` or `324` are output labels, not logical account identifiers.

## 5. Download Primary Artifacts

### Merged Floorplan

Download `Merged Floorplan` and verify:

- File opens in Excel or LibreOffice.
- Columns follow the store matrix:
  - Store label
  - `Serial No/VIN`
  - `VIN6`
  - `Ending Balance`
  - Dealertrack account label, such as `2100` or `324`
  - `VIN6`
  - `Description`
  - `Control`
- Matched rows populate both sides.
- BOA-only rows populate only the BOA side.
- Dealertrack-only rows populate only the Dealertrack side.
- VIN6 amount mismatches remain split.
- Totals row uses the store-configured Dealertrack account label.

### FP REC

Download `FP REC` and verify:

- The UI uses the generic FP REC route.
- Hurst legacy FP REC route still works if tested directly.
- The workbook uses store-configured labels and totals.
- FP REC agrees with the Merged Floorplan on row classifications and totals.
- FW reflects aggregated Dealertrack amount semantics while displaying `2100`.

## 6. Historical Artifact List

After a run completes, verify the stored artifact table shows:

- Raw BOA
- Raw Dealertrack
- Cleaned BOA
- Cleaned Dealertrack
- Merged Floorplan
- FP REC

For each artifact, verify:

- artifact type
- filename
- file size
- created timestamp
- download button

Download at least one raw, one cleaned, and one generated artifact to confirm historical retrieval.

## Deferred Surfaces

Do not make these the focus of the demo:

- dashboard analytics
- account summaries
- month-end reports
- scheduled jobs
- productivity metrics
- review assignment or triage workflow
- consolidated multi-store reporting

These can be mentioned as future or advanced scope only after the four-step artifact path is accepted.
