# Workflow Assumptions

## Purpose

These are the current assumptions behind the Hiley store/month floorplan pilot. Validate or invalidate them with Tara and the office users as more store artifacts are reviewed.

Status options: `Confirmed` | `Invalidated` | `Partially true` | `Unknown`

## Product Scope Assumptions

### A1. One run equals one store/month

The product assumes one reconciliation run has one BOA upload, one Dealertrack upload, one selected store, and one accounting month.

Risk: Some stores may require multiple source files for one month.

Validate by asking: Do you ever combine multiple BOA files or multiple Dealertrack exports for one month's floorplan reconciliation?

Status: Unknown

### A2. No combined multi-store exports

The product assumes each store/month produces its own Merged Floorplan and FP REC. It does not produce one consolidated multi-store workbook for the pilot.

Validate by asking: Do you reconcile floorplan separately by rooftop, or do you ever submit a consolidated floorplan package?

Status: Unknown

### A3. Dashboard and reporting features are future scope

The pilot assumes the first accepted workflow is upload, process, and download artifacts. Dashboards, productivity metrics, triage queues, and month-end reporting are not part of pilot acceptance.

Validate by asking: Does anything outside the six stored artifacts need to be visible before you can trust the monthly workflow?

Status: Unknown

## Input Format Assumptions

### A4. BOA input can be CSV or HTML-as-XLS

The product currently supports CSV and BOA HTML/table-style exports. Native OOXML `.xlsx` upload is unsupported.

Risk: If a store can only provide native `.xlsx`, the current upload flow will reject it.

Validate by asking: Which BOA export format do you actually receive for each store?

Status: Unknown

### A5. Dealertrack input can be CSV or SpreadsheetML/XML-style export

The product currently supports CSV and SpreadsheetML/XML-style Dealertrack exports. Native OOXML `.xlsx` upload is unsupported.

Validate by asking: Does Dealertrack export the same file shape each month for each store?

Status: Unknown

### A6. Remaining stores may have new Dealertrack account behavior

Hurst, Acura, and FW are known. Remaining stores may use one account column, multiple aggregated columns, or a new exclusion rule.

Validate by asking: For each remaining store, which Dealertrack columns are part of floorplan and which should be excluded?

Status: Unknown

## Matching Assumptions

### A7. VIN6 plus absolute amount confirms a match

The product assumes two rows are a confirmed match when BOA VIN6 equals Dealertrack VIN6 and absolute dollar amounts match exactly.

Risk: VIN6 collisions or partial curtailments can create false positives or amount mismatches.

Validate by asking: Have you seen two vehicles with the same VIN6 and same amount in one month?

Status: Unknown

### A8. Amount mismatches stay split

The product assumes a shared VIN6 with different amounts should not be merged. It remains visible as a BOA-side row and a Dealertrack-side row.

Validate by asking: In the manual workbook, do you keep those rows separate until the difference is explained?

Status: Unknown

### A9. Physical account labels are not logical account identifiers

The product assumes `2100`, `324`, `2101`, and similar columns are store/export labels. The logical account identifier for account endpoint grouping remains `floorplan`.

Validate by asking: Should account labels in the workbook ever change how runs are grouped in app history?

Status: Unknown

## Artifact Assumptions

### A10. Six artifacts are sufficient for audit/replay

The product persists Raw BOA, Raw Dealertrack, Cleaned BOA, Cleaned Dealertrack, Merged Floorplan, and FP REC for each reconciliation run.

Validate by asking: Is there another intermediate workbook or note file you need retained with the run?

Status: Unknown

### A11. Merged Floorplan is the clerk working artifact

The product assumes the Merged Floorplan is the intermediate working sheet the office expects before FP REC.

Validate by asking: Does the merged output match the sheet you would normally work from?

Status: Unknown

### A12. FP REC is downstream of merged semantics

The product assumes FP REC totals and row classifications should agree with the Merged Floorplan for the same run.

Validate by asking: When FP REC and the merged workbook disagree, which one should be considered the source of truth?

Status: Unknown

## Store Configuration Assumptions

### A13. Hurst configuration is stable

Hurst uses `HURST` and Dealertrack account label `2100`.

Status: Partially true

### A14. Acura configuration is stable

Acura uses `ACURA` and Dealertrack account label `324`.

Status: Partially true

### A15. FW requires multi-column Dealertrack aggregation

FW displays `2100`, but its amount comes from `2100 + 2101 + 2101S`; `2110` is excluded.

Status: Partially true

### A16. Remaining stores cannot be inferred from Hurst

The product assumes remaining stores need artifact review before configuration.

Validate by asking: Can Tara provide raw BOA, raw Dealertrack, accepted merged workbook, and FP REC export for each remaining store/month?

Status: Unknown
