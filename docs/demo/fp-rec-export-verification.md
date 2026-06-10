# Hurst FP Rec Export Verification

Use this workflow to generate FEB/MAR/APR Hurst FP Rec exports from the accepted golden fixture and visually compare them with the clerk workbook shape.

## Generate Exports

From the repo root:

```bash
docker compose exec backend npm run export:hurst-fp-rec -- --month all --out-dir tmp/hurst-fp-rec-exports --format xls,html
```

The backend container runs from `/app/server`, so the command writes host-visible files under:

```text
server/tmp/hurst-fp-rec-exports/
```

Expected files:

```text
server/tmp/hurst-fp-rec-exports/floorplan-reconciliation-hiley-mazda-of-hurst-02-28-26-feb26.xls
server/tmp/hurst-fp-rec-exports/floorplan-reconciliation-hiley-mazda-of-hurst-02-28-26-feb26.html
server/tmp/hurst-fp-rec-exports/floorplan-reconciliation-hiley-mazda-of-hurst-03-31-26-mar26.xls
server/tmp/hurst-fp-rec-exports/floorplan-reconciliation-hiley-mazda-of-hurst-03-31-26-mar26.html
server/tmp/hurst-fp-rec-exports/floorplan-reconciliation-hiley-mazda-of-hurst-04-30-26-april26.xls
server/tmp/hurst-fp-rec-exports/floorplan-reconciliation-hiley-mazda-of-hurst-04-30-26-april26.html
```

To generate only one month:

```bash
docker compose exec backend npm run export:hurst-fp-rec -- --month APRIL26 --out-dir tmp/hurst-fp-rec-exports --format xls,html
```

To use a different fixture file:

```bash
docker compose exec backend npm run export:hurst-fp-rec -- --golden-csv ../sample-data/golden_dataset.csv --month all --out-dir tmp/hurst-fp-rec-exports --format xls,html
```

## What The Command Uses

The generator reads `sample-data/golden_dataset.csv`, which is already classified according to the accepted clerk workbooks. It does not rerun matching and does not change reconciliation rules. It builds the same `ReconciliationRunDetail` shape consumed by `buildHurstFpRecWorkbook`, then writes Excel-compatible HTML as both `.xls` and `.html`.

## Expected Console Summary

The command prints one summary per generated month:

```text
FEB26: matched=238 boa_only=0 dealertrack_only=16 boa_total=9088877.00 dt_2100_total=-9662045.00 variance=-573168.00
MAR26: matched=217 boa_only=10 dealertrack_only=6 boa_total=8606561.00 dt_2100_total=-8470803.00 variance=135758.00
APRIL26: matched=199 boa_only=4 dealertrack_only=2 boa_total=7949383.00 dt_2100_total=-7877160.00 variance=72223.00
```

## Visual Checklist

Open each `.xls` in Excel or LibreOffice, and keep the matching accepted clerk workbook beside it.

Confirm:

- Title shows `Floorplan Reconciliation - Hiley Mazda of Hurst`.
- The detail grid has exactly these visible columns A-H:
  - A: `HURST`
  - B: `Serial No/VIN`
  - C: `VIN6`
  - D: `Ending Balance`
  - E: `2100`
  - F: `VIN6`
  - G: `Description`
  - H: `Control`
- Matched rows populate both A-D and E-H.
- BOA-only rows populate A-D only.
- Dealertrack-only rows populate E-H only.
- BOA-valued rows sort ascending by `Ending Balance`.
- Dealertrack-only rows with blank `Ending Balance` appear after BOA-valued rows.
- The total row is visible.
- BOA total, Dealertrack 2100 total, and variance match the console summary.
- Currency cells are readable, right-aligned, and use parentheses for negative Dealertrack/variance values.

## Known Scope

This workflow verifies export fidelity against the golden accepted workbook shape. It intentionally does not validate source parsing, upload behavior, or matching-rule changes. Use the existing reconciliation golden fixture tests for matching counts and variance behavior.
