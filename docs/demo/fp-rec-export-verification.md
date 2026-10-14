# Hurst FP Rec Export Verification

> Evidence cleanup (2026-10-14): ordinary CLI exports now use the independently invented `sample-data/hurst-synthetic.csv`. Historical counts/totals recorded below remain historical results and are verified separately by protected Hurst acceptance; they are not expected demo output. No client dataset is an ordinary CLI default. See `docs/development/client-evidence-policy.md`.

Status note: Hurst fixture/CLI verification reference. It supports FP REC fidelity checks, but the canonical v1 product source of truth is `docs/product/fp-rec-four-step-workflow.md`. The primary application export route is `GET /reconciliation-runs/:id/fp-rec`; `GET /reconciliation-runs/:id/hurst-fp-rec` remains a legacy compatibility alias.

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
docker compose exec backend npm run export:hurst-fp-rec -- --golden-csv ../sample-data/hurst-synthetic.csv --month all --out-dir tmp/hurst-fp-rec-exports --format xls,html
```

## What The Command Uses

The generator reads `sample-data/hurst-synthetic.csv`, which contains independently invented, preclassified demo scenarios. It does not rerun matching and does not change reconciliation rules. It builds the same `ReconciliationRunDetail` shape consumed by `buildHurstFpRecWorkbook`, then writes Excel-compatible HTML as both `.xls` and `.html`.

## Expected Console Summary

The command prints one summary per generated month:

```text
FEB26: matched=2 boa_only=0 dealertrack_only=1 boa_total=3000.00 dt_2100_total=-3300.00 variance=0.00
MAR26: matched=1 boa_only=1 dealertrack_only=1 boa_total=1900.00 dt_2100_total=-1600.00 variance=0.00
APRIL26: matched=1 boa_only=2 dealertrack_only=2 boa_total=1900.00 dt_2100_total=-1950.00 variance=0.00
```

## Visual Checklist

For an optional operational smoke test, open each invented `.xls` in Microsoft Excel and compare it with the synthetic scenario expectations. Historical client workpapers belong only in separately authorized protected acceptance. Another application is not proof of Microsoft Excel usability.

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
