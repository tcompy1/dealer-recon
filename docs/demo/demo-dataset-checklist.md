# Demo Dataset Checklist

Use this checklist before a Hiley pilot demo to verify the selected store/month files and artifact outputs.

## Supported Demo Stores

- Hurst
- Acura
- FW

Do not demo remaining stores as supported until their raw BOA, raw Dealertrack, accepted merged workbook, and FP REC evidence have been analyzed and configured.

## Input File Checklist

### BOA

| Check | Expected result |
| --- | --- |
| Store/month | Matches the selected store and accounting month. |
| Format | CSV, BOA HTML-as-XLS, or HTML/table-style export. |
| Native `.xlsx` | Unsupported; resubmit as CSV or HTML-as-XLS. |
| Amount column | `Ending Balance` is the floorplan amount. |
| Straightline rows | Removed from cleaned data and totals. |
| Zero-balance rows | Removed from cleaned data. |
| VIN/VIN6 | VIN can be extracted and VIN6 can be derived. |

### Dealertrack

| Store | Expected amount behavior |
| --- | --- |
| Hurst | `2100`; excludes `2110` where applicable. |
| Acura | `324`. |
| FW | Aggregates `2100 + 2101 + 2101S`; excludes `2110`; displays `2100`. |

Dealertrack supported formats include CSV and SpreadsheetML/XML-style exports. Native `.xlsx` is unsupported.

## Upload Validation

After each upload:

- Upload succeeds.
- Filename and transaction count are shown.
- Preprocessing diagnostics show removed rows and parser metadata.
- No unexpected validation errors appear.
- Store identity is preserved for the run.

## Reconciliation Validation

After clicking `Run/process reconciliation`:

- Run completes without error.
- Match and exception counts are plausible for the month.
- VIN6 plus exact absolute amount determines matched rows.
- BOA-only and Dealertrack-only rows remain source-specific.
- VIN6 amount mismatches remain split into side-specific rows.

## Artifact Validation

Completed run should show these stored artifacts:

- Raw BOA
- Raw Dealertrack
- Cleaned BOA
- Cleaned Dealertrack
- Merged Floorplan
- FP REC

For each artifact:

- Type is readable.
- Filename is shown.
- File size is shown.
- Created timestamp is shown.
- Download button works.

## Merged Floorplan Validation

Download Merged Floorplan and verify:

- File opens in Excel or LibreOffice.
- Columns match the store matrix:
  - store label
  - `Serial No/VIN`
  - `VIN6`
  - `Ending Balance`
  - configured Dealertrack account label
  - `VIN6`
  - `Description`
  - `Control`
- Hurst output uses `HURST` and `2100`.
- Acura output uses `ACURA` and `324`.
- FW output uses FW/Fort Worth label and displays `2100` while reflecting aggregated Dealertrack amount semantics.
- Totals row is present.

## FP REC Validation

Download FP REC and verify:

- File opens in Excel or LibreOffice.
- Output is for the selected store/month only.
- Store label and account label come from store config.
- Totals agree with the Merged Floorplan for the same run.
- Hurst legacy FP REC route remains compatible if tested directly, but the UI should use the generic FP REC route.

## Deferred Demo Items

Keep these out of the primary demo path:

- account summaries
- month-end reports
- dashboard analytics
- automation metrics
- productivity metrics
- triage/review workflow
- consolidated multi-store reporting
