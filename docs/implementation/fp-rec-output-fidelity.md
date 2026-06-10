# Hurst FP Rec Output Fidelity Implementation Spec

Parent issue: #10 - Hurst FP Rec Output Fidelity

Branch: `integration-cleanup-2026-06-10`

## Purpose

The Hurst FP Rec workbook must match the accepted clerk workbook closely enough that the Hiley Mazda of Hurst output can be trusted before the workflow is expanded to other stores. The target is not the current application workbook with separate exception sections. The target is the clerk-style side-by-side worksheet where BOA statement rows and Dealertrack 2100 rows are aligned by VIN6 and amount, unmatched rows remain on their own side, totals are preserved, and non-zero variance is allowed.

## Source Of Truth

- `docs/dealer_recon_ground_truth_reverse_engineering.md`
- `sample-data/golden_dataset.csv`
- `server/src/presenters/hurstFpRec.ts`
- `server/src/presenters/hurstFpRec.test.ts`
- `server/src/services/reconciliationEngine.ts`
- `server/src/services/exceptionCategorizer.ts`

## Target Workbook Shape

The generated workbook must contain one primary detail worksheet matching the accepted clerk FP Rec layout. The visible detail grid must have exactly columns A-H in this order:

| Column | Header | Source | Population rule |
|---|---|---|---|
| A | HURST / BOA description | BOA | BOA vehicle/description text. Blank for Dealertrack-only rows. |
| B | Serial No/VIN | BOA | Full BOA VIN/serial number. Blank for Dealertrack-only rows. |
| C | VIN6 from BOA VIN | Derived from BOA | Last six characters of the BOA VIN. Blank for Dealertrack-only rows. |
| D | Ending Balance | BOA | BOA ending balance as a positive currency amount. Blank for Dealertrack-only rows. |
| E | 2100 | Dealertrack | Dealertrack account 2100 amount, preserving the accepted workbook sign convention as a credit/negative amount. Blank for BOA-only rows. |
| F | VIN6 from Dealertrack description | Derived from Dealertrack | Last six characters of the final 17-character VIN token in the Dealertrack description. Blank when no valid Dealertrack row is present. |
| G | Dealertrack Description | Dealertrack | Raw Dealertrack description text. Blank for BOA-only rows. |
| H | Dealertrack Control | Dealertrack | Dealertrack control number, usually the `M`-prefixed stock/control value. Blank for BOA-only rows. |

The detail worksheet must not expose the current presenter-only fields as visible columns in the accepted clerk grid: `Descriptor`, `Stock #`, `VIN`, generic `VIN6`, `Amount`, `GL Floored`, `BOA Floored`, `GL Notes`, `BOA Notes`, `Review Status`, carry-forward fields, or separate section captions.

The workbook may include totals/variance rows outside the detail body, but those rows must not change the visible A-H detail shape or introduce additional visible detail columns.

## Row Types

### Matched Rows

A matched row represents one BOA row and one Dealertrack row on the same worksheet line. It must populate all applicable A-H fields:

- A-D from the BOA row.
- E-H from the matched Dealertrack row.
- C and F must be equal VIN6 values.
- `abs(D)` must equal `abs(E)`.

### BOA-Only Rows

A BOA-only row represents a BOA statement item with no accepted Dealertrack counterpart. It must populate only columns A-D:

- A: BOA description.
- B: BOA VIN.
- C: VIN6 from BOA VIN.
- D: BOA Ending Balance.
- E-H must be blank.

### Dealertrack-Only Rows

A Dealertrack-only row represents a Dealertrack 2100 item with no accepted BOA counterpart. It must populate only columns E-H:

- A-D must be blank.
- E: Dealertrack 2100 amount.
- F: VIN6 from the final VIN token in Dealertrack description.
- G: Dealertrack Description.
- H: Dealertrack Control.

### Amount-Mismatch VIN6 Rows

A VIN6 match with an amount mismatch must not be merged into a single review row. It must be emitted as two independent exception rows:

- The BOA side becomes a BOA-only row with A-D populated and E-H blank.
- The Dealertrack side becomes a Dealertrack-only row with A-D blank and E-H populated.

This treatment is required even when the VIN6 values are equal. Amount equality is a required condition for merging.

## Matching Rules

The primary key for FP Rec output alignment is VIN6.

BOA VIN6 derivation:

- Use the BOA VIN/serial number when present.
- VIN6 is the final six characters of the normalized 17-character VIN.

Dealertrack VIN6 derivation:

- Parse the Dealertrack description.
- Find valid 17-character VIN tokens using the standard VIN character set, excluding I, O, and Q.
- If multiple 17-character VIN tokens are present, use the final 17-character VIN token in the description.
- VIN6 is the final six characters of that final VIN token.
- Do not use earlier VIN-like tokens, dates, control numbers, stock numbers, or generic six-character substrings as the Dealertrack VIN6 for FP Rec output.

A row may be merged only when:

- BOA VIN6 equals Dealertrack VIN6.
- `abs(BOA Ending Balance)` equals `abs(Dealertrack 2100 amount)` exactly in cents.
- Each source row is consumed by no more than one merged output row.

Full VIN equality may be used internally as a stricter way to discover the same accepted pair, but the output contract remains VIN6 + exact absolute amount equality.

## Exception Rules

The output must preserve side-specific exceptions rather than converting them into a generic review section.

- `missing_in_dealertrack` maps to a BOA-only row.
- `missing_in_boa` maps to a Dealertrack-only row.
- `needs_review_vin6_only` / `vin6_match_amount_mismatch` maps to separate BOA-only and Dealertrack-only rows, not a merged review row.
- Amount-only, stock-only, reference-only, duplicate, timing, or other weak-review candidates must not create an accepted merged row unless they also satisfy VIN6 + exact absolute amount equality.
- If a weak-review candidate cannot satisfy the merge rule, each side must remain visible as an exception row on its own side.

## Sorting

The accepted clerk workbook sorts the detail body ascending by BOA Ending Balance.

Required sort behavior:

- Rows with a BOA Ending Balance sort first, ascending by numeric BOA Ending Balance in column D.
- For rows with the same BOA Ending Balance, sort deterministically by BOA VIN6, then Dealertrack VIN6, then Dealertrack Control.
- Dealertrack-only rows have blank BOA Ending Balance. They must sort after all rows that have a BOA Ending Balance.
- Dealertrack-only rows must then sort ascending by absolute 2100 amount in column E, then Dealertrack VIN6, then Dealertrack Control.

This places blank-D Dealertrack-only exceptions at the bottom while keeping their internal order stable and clerk-reviewable.

## Totals And Variance

The workbook must compute and display:

- BOA total: sum of all populated BOA Ending Balance values in column D, including matched, BOA-only, and BOA-side amount-mismatch rows.
- DT 2100 total: sum of all populated 2100 values in column E, including matched, Dealertrack-only, and Dealertrack-side amount-mismatch rows.
- Variance: BOA total + DT 2100 total, using the signed DT 2100 values.

Non-zero variance is valid. The generator must not force variance to zero, hide non-zero variance, or treat non-zero variance as export failure. The golden months intentionally include non-zero variance when exceptions exist.

Golden total targets from the accepted fixtures:

| Month | BOA total | DT 2100 total | Variance |
|---|---:|---:|---:|
| FEB26 | 9,088,877 | -9,662,045 | -573,168 |
| MAR26 | 8,606,561 | -8,470,803 | 135,758 |
| APR26 | 7,949,383 | -7,877,160 | 72,223 |

## Golden Validation Targets

The implementation must reproduce these detail-row classifications from `sample-data/golden_dataset.csv`:

| Month | Matched | BOA-only | Dealertrack-only | Amount-mismatch treatment |
|---|---:|---:|---:|---|
| FEB26 | 238 | 0 | 16 | 0 mismatch pairs |
| MAR26 | 217 | 10 | 6 | 0 mismatch pairs |
| APR26 | 199 | 4 | 2 | 2 amount-mismatch VIN pairs represented as 4 separate exception rows |

For APR26, the two amount-mismatch VIN pairs must increase the visible exception rows by side: two BOA-side rows in A-D and two Dealertrack-side rows in E-H. They must not appear as two merged Needs Review rows.

## Current Implementation Gap Analysis

### Presenter Shape

`server/src/presenters/hurstFpRec.ts` currently builds a sectioned workbook in `buildHurstFpRecWorkbook`:

- `schedule_not_on_statement`
- `statement_not_on_gl`
- `needs_review`
- summary, adjustments/variance, and sign-off sections

`toHurstFpRecXlsHtml` renders section tables through `sectionHtml`, with headers:

- `Descriptor`
- `Stock #`
- `VIN6`
- `VIN`
- `Amount`
- `GL Floored`
- `BOA Floored`
- `GL Notes`
- `BOA Notes`
- `Review Status`

This diverges from the target accepted clerk grid, which must render a single A-H side-by-side worksheet with BOA columns A-D and Dealertrack columns E-H.

### Matched Rows Are Not Rendered In Detail

`buildHurstFpRecWorkbook` uses `detail.match_groups` only for totals. It does not create visible detail rows for matched BOA/Dealertrack pairs. The accepted clerk workbook requires matched rows to appear in the same A-H body as exceptions.

### Needs Review Routing Conflicts With Amount-Mismatch Target

`NEEDS_REVIEW_CATEGORIES` in `server/src/presenters/hurstFpRec.ts` routes `vin6_match_amount_mismatch` and related categories into the `needs_review` section. For the accepted output, VIN6 amount mismatches must not become a merged or separate review section row. They must become two side-specific exception rows in the A-H grid.

### Current Row Model Is Side-Neutral

`HurstFpRecRow` and `buildRow` store one generic `descriptor`, `vin`, `vin6`, and `amount`. The target row model must be side-aware:

- BOA fields: description, VIN, VIN6, ending balance.
- Dealertrack fields: 2100 amount, derived VIN6 from description, description, control.

The current side-neutral row shape cannot represent a matched row with both BOA and Dealertrack descriptions/amounts on one output line.

### Current Dealertrack VIN6 Derivation Is Too Generic For Output Fidelity

`buildRow` uses `computeVin6(transaction.vin) ?? extractVin6FromDescription(transaction.description)`. `reconciliationEngine.ts` similarly uses `matchingVin6` for matching. The FP Rec output contract requires Dealertrack column F to come from the final 17-character VIN token in the Dealertrack description. If `transaction.vin` exists but the description has a different final VIN token, the workbook output must follow the description-token rule for column F.

### Current Sorting Is Section-Local

`buildSection` sorts each exception section independently by absolute amount and VIN6. The target requires one combined detail body sorted by BOA Ending Balance ascending, with Dealertrack-only blank-D rows after BOA-valued rows.

### Engine Behavior Partially Aligns But Presenter Does Not

`server/src/services/reconciliationEngine.ts` already uses exact absolute amount equality in `amountsMatch`. Its auto-match tiers include full VIN + amount, derived full VIN + amount, and VIN6 + amount. It also emits paired `needs_review_vin6_only` exceptions when VIN6 agrees but amounts differ.

`server/src/services/exceptionCategorizer.ts` maps `needs_review_vin6_only` to `vin6_match_amount_mismatch`. That categorization is useful signal, but the presenter must reinterpret it for FP Rec output as side-specific exception rows rather than a `Needs Review` section.

### Existing Tests Assert The Old Shape

`server/src/presenters/hurstFpRec.test.ts` asserts the sectioned workbook structure, including:

- section partitioning into schedule/statement/needs-review buckets;
- accepted section headings;
- `GL Floored` and `BOA Floored` columns;
- `Review Status`;
- sign-off and note-oriented section output.

These tests protect the current workbook shape, not the target A-H clerk grid. They must be replaced or supplemented in follow-up work; this spec does not modify them.

## Implementation Plan

### Task 1 - Golden Output Tests

Create presenter/export tests that build workbook output from the golden fixture data and assert the accepted A-H shape.

Test coverage:

- Headers A-H exactly match the target names and order.
- FEB26 row counts are matched 238, BOA-only 0, Dealertrack-only 16.
- MAR26 row counts are matched 217, BOA-only 10, Dealertrack-only 6.
- APR26 row counts are matched 199, BOA-only 4, Dealertrack-only 2, with 2 mismatch VIN pairs rendered as 4 side-specific exception rows.
- Matched rows populate A-H.
- BOA-only rows populate A-D only.
- Dealertrack-only rows populate E-H only.
- Amount-mismatch VIN6 pairs never populate both sides on one row.
- Totals and variance equal the golden targets.

### Task 2 - Presenter Row Model

Replace or add an FP Rec presenter model that represents one target worksheet row:

- `boa_description`
- `boa_vin`
- `boa_vin6`
- `boa_ending_balance_cents`
- `dt_2100_amount_cents`
- `dt_vin6_from_description`
- `dt_description`
- `dt_control`
- `row_classification`: `matched`, `boa_only`, `dealertrack_only`
- optional audit fields that are not visible columns

Build rows from both `detail.match_groups` and `detail.exceptions`; matched rows must come from `match_groups`, not only totals.

### Task 3 - Dealertrack VIN6 Extraction

Add an output-specific Dealertrack description VIN parser:

- Return the VIN6 from the final valid 17-character VIN token in the description.
- Return blank/null when no valid token exists.
- Do not fall back to stock/control, dates, or arbitrary six-character substrings for column F.

Keep engine matching helpers stable unless tests show they must also adopt the final-token behavior.

### Task 4 - Amount-Mismatch Output Behavior

Map `needs_review_vin6_only` / `vin6_match_amount_mismatch` exceptions into side-specific output rows:

- BOA exception transaction -> BOA-only target row.
- Dealertrack exception transaction -> Dealertrack-only target row.
- Do not render these in a separate Needs Review section for Hurst FP Rec output.

Preserve enough metadata internally to identify these rows as amount-mismatch exceptions for debugging, but do not change the A-H visible shape.

### Task 5 - Sorting And Totals

Implement one combined sort for all target detail rows:

- BOA-valued rows first by column D ascending.
- Blank-D Dealertrack-only rows last by absolute column E ascending.
- Stable tiebreakers: BOA VIN6, Dealertrack VIN6, Dealertrack Control.

Compute totals from the visible row model:

- BOA total from column D.
- DT total from column E.
- Variance as BOA total + DT total.

### Task 6 - Workbook Export Fidelity

Update `toHurstFpRecXlsHtml` or introduce a dedicated Hurst FP Rec export path to render:

- one primary A-H detail grid;
- accepted headers;
- currency formatting for D and E;
- blank cells on the absent side of exception rows;
- totals/variance rows that do not add visible detail columns.

Remove or hide the old schedule/statement/needs-review sections from the accepted Hurst FP Rec export. If the old sectioned workbook is still needed elsewhere, move it behind a different export mode so it cannot be confused with the clerk-accepted output.

### Task 7 - Store Expansion Readiness

Before expanding beyond Hurst:

- Make the target output contract explicit per store.
- Keep Hurst-specific labels (`HURST / BOA description`) configurable rather than hard-coded into shared generic reconciliation output.
- Require each new store to provide its own accepted workbook sample, fixture rows, target headers, source column mapping, and variance rules.
- Do not reuse Hurst VIN6/2100 assumptions for stores whose floorplan account, VIN location, or clerk workbook shape differs.

## Acceptance Criteria

The work is accepted only when generated workbook output satisfies all criteria below:

- The exported Hurst FP Rec workbook opens in Excel without repair prompts.
- The primary visible detail grid has exactly columns A-H with the required headers and order.
- Matched rows show BOA data in A-D and Dealertrack data in E-H on the same row.
- BOA-only rows have values only in A-D and blanks in E-H.
- Dealertrack-only rows have blanks in A-D and values only in E-H.
- Dealertrack VIN6 in column F is derived from the final 17-character VIN token in the Dealertrack description.
- A row is merged only when VIN6 matches and absolute amount in cents matches exactly.
- VIN6 amount mismatches are represented as separate BOA-only and Dealertrack-only rows, never as one merged review row.
- Detail rows sort ascending by BOA Ending Balance, with blank-D Dealertrack-only rows after all BOA-valued rows.
- BOA total equals the sum of visible column D values.
- DT 2100 total equals the sum of visible column E values.
- Variance equals BOA total + DT 2100 total and may be non-zero.
- Golden FEB26 output has 238 matched rows, 0 BOA-only rows, and 16 Dealertrack-only rows.
- Golden MAR26 output has 217 matched rows, 10 BOA-only rows, and 6 Dealertrack-only rows.
- Golden APR26 output has 199 matched rows, 4 BOA-only rows, 2 Dealertrack-only rows, and 2 amount-mismatch VIN pairs represented as 4 separate side-specific exception rows.
- Existing generated output paths for other stores are unchanged unless a store-specific target workbook contract is added and tested.

## Assumptions And Ambiguities

- The target detail worksheet is a single visible A-H grid. Any summary/totals rows are allowed only if they do not alter the detail column contract.
- Dealertrack-only rows have no BOA Ending Balance, so this spec places them after all BOA-valued rows. This is an explicit implementation decision for blank column D sorting.
- Currency precision is cents. Display can omit cents only if it matches the accepted workbook format, but matching and totals must use cents.
- The prompt names `sample-data/golden_dataset.csv`; historical test context also references `server/src/services/__fixtures__/golden_dataset.csv`. The implementation should keep one canonical fixture or ensure both copies remain identical.
