# Acura Rooftop Reconciliation Evidence Characterization

**Date:** 2026-09-14
**Scope:** Read-only characterization of the local Acura discovery package before production changes
**Canonical acceptance month:** April 2026

This report records aggregate and structural evidence only. It does not reproduce raw rows, VINs, or binary artifacts.

## Evidence inventory

The five rooftop discovery directories exist. The Acura directory contains eight CSV files, one OOXML workbook, one MP4 recording, and one `.DS_Store` metadata file.

| File | Evidence role | Detected structure | SHA-256 |
| --- | --- | --- | --- |
| `.DS_Store` | Operating-system metadata; not business evidence | Finder metadata | Not used |
| `ACURA BOA MARCH(in).csv` | Original BOA export for March | CSV; two banner/store rows, a 32-column header on row 3, detail, `Straight Line`, and final total | `1a7a996954a5188828cc36fc41e8453971c38dc0119cc87620736e633466cd59` |
| `ACURA BOA APRIL(in).csv` | Original BOA export for April | CSV; two banner/store rows, a 32-column header on row 3, detail, `Straight Line`, and final total | `a0c25eb1bdba598f4262254e85f26867fec359d8620ffb08211c3c4374a13a34` |
| `ACURA DT FEB(in).csv` | Original Dealertrack export for February | CSV with `Control`, `Description`, and `324` | `7acdf2fcbd81c2f30034b67b78b183d9379f6e7e7b80847072734d4a9152b0b9` |
| `ACURA DT MARCH(in).csv` | Original Dealertrack export for March | CSV with `Control`, `Description`, and `324` | `60bb57ff2e0e60ff7e4fe0ec20543338597ca68a6d027f6dbc11176823e873df` |
| `ACURA DT APRIL(in).csv` | Original Dealertrack export for April | CSV with `Control`, `Description`, and `324` | `8fe1259168eb940d580710edf786a3138d59390698df9e272b62a260e5852a4e` |
| `ACURA FEB MERGED(BillingStatementFebruary2026).csv` | Completed February reconciliation detail | Eight-column CSV plus one final totals row | `3402037765d824c2f0420e2276be4729ae20b8665751b4cbcafd05f077640ef0` |
| `ACURA MARCH MERGED(BillingStatementMarch2026).csv` | Completed March reconciliation detail | Eight-column CSV plus one final totals row | `0300994e697e9af5548bce493f42df51a2aae54364012ee8a7d4c30d449bc617` |
| `ACURA APRIL MERGED(BillingStatementApril2026).csv` | Completed April reconciliation detail | Eight-column CSV plus one final totals row | `f067bb857700b5bdbe2c96bf432f3d8d56946774db0a339d36f171d985b8cd9f` |
| `Acura FP Rec.xlsx` | Goal FP REC output | OOXML workbook with 93 visible sheets; the four recent evidence sheets are `FEB 26`, `MAR 26`, `APR26`, and `MAY26` | `006175b4f5bc85beaa8360373d4a155268b5dab51249047c4eb1aa3403ce1392` |
| `ACURA SCREEN RECORD.mp4` | Recorded clerk workflow | 13:35.706 MP4; H.264 video at 1920x1080 with AAC audio | `71f1435fc72b86acf47c86960ff06aefabe1fd55c9b2bbb93188113defe1287c` |

The BOA header columns, in order, are: `Location`, `Manufacturer Name`, `Plant Name`, `Invoice Date`, `Invoice Number`, `Interest Start Date`, `Maturity Date`, `Description`, `Type`, `Model Number`, `Serial No/VIN`, `Stock/Lease No`, `Original Amount`, `Beginning Balance`, `Advances`, `Last Advance Date`, `Principal Payments`, `Principal Adjustments`, `Monthly Activity`, `Ending Balance`, `Current Curtailments`, `Past Due Curtailments`, `Current Maturities`, `Past Due Maturities`, `Total Principal Due`, `Interest Amount`, `Prior Period Interest Billed Current Month`, `Flat Charges Amount`, `Item Fee Amount`, `Total Interest / Charges / Fees Due`, `Inception to Date Interest`, and `Average Daily Billing Balance`.

All eight discovery CSVs have byte-identical tracked copies under `server/src/presenters/__fixtures__/acura/`. That tracked fixture directory also contains `ACURA BOA FEB(in).csv`, for which the discovery directory has no authoritative counterpart. This report does not use the tracked February BOA copy to establish a discovery fact.

## Period evidence

| Period | BOA evidence | Dealertrack evidence | Completed/goal evidence | Decision |
| --- | --- | --- | --- | --- |
| February 2026 | No raw BOA file exists in the discovery directory | Description dates range through 2026-02-27; the filename token is only a hint | February completed merged CSV and `FEB 26` goal sheet | Characterization-only. The missing authoritative BOA prevents use as a complete raw-input acceptance month. |
| March 2026 | `Dealer Billing Statement for: March 2026` is hard banner evidence | Description dates range through 2026-03-31 with no later-month contradiction | March completed merged CSV and `MAR 26` goal sheet | Complete secondary regression month. |
| April 2026 | `Dealer Billing Statement for: April 2026` is hard banner evidence | Description dates range through 2026-04-30 with no later-month contradiction | April completed merged CSV and `APR26` goal sheet | Canonical end-to-end acceptance month. It is the latest month with both raw inputs, completed detail, and goal output. |
| May 2026 | No raw BOA file exists in the discovery directory | No raw Dealertrack file exists in the discovery directory | `MAY26` goal sheet and the recording show May work; no completed May merged file is present | Output and manual-workflow cross-check only, not an acceptance input. |

The operator-selected accounting month remains authoritative. A BOA banner for a different month is a blocking contradiction. Dealertrack transaction-description dates are supporting evidence: a date after the selected month contradicts it, while dates at or before it are compatible but may be incomplete. Filename month tokens are hints and cannot override content or operator selection.

## Transformations

### BOA

1. Parse as CSV without assuming the first row is the header.
2. Detect the 32-column header on row 3. Remove the two pre-header banner/store rows and the final total row as three auditable non-detail removals.
3. Use `Ending Balance` as the authoritative amount. `Original Amount` is an auditable fallback only when the ending-balance cell is unavailable under a characterized structure; it must not silently replace a present ending balance.
4. Remove zero-ending-balance rows and the `Straight Line` row, recording a reason for each removal.
5. Take the BOA VIN from `Serial No/VIN` and derive VIN6 through `computeVin6()`.
6. Retain the merged-side fields and sort BOA rows by `Ending Balance` ascending, with deterministic tie-breaking.

March removes 70 zero-balance rows, one `Straight Line` row, and three non-detail rows. April removes 88 zero-balance rows, one `Straight Line` row, and three non-detail rows. Every accepted March and April amount resolved from `Ending Balance`; no fallback was needed in these originals.

### Dealertrack

1. Parse the first non-empty row as the three-column header: `Control`, `Description`, `324`.
2. Use `324` as the only included amount column. The raw files contain no competing numeric account columns, and no excluded account columns apply.
3. Preserve imported GL amounts as negative integer cents. Matching compares exact absolute cents and does not change the output sign.
4. Extract the full VIN token from `Description`, then derive VIN6 through `computeVin6()`. Preserve `Control` for the merged output.
5. Remove the single non-detail/unknown row found in each February, March, and April export, recording an auditable reason.
6. Sort the retained GL sequence by absolute `324` amount ascending, with deterministic tie-breaking.

### Recorded manual workflow

The recording shows the clerk exporting BOA and Dealertrack data, reducing BOA to its working fields, deriving VIN6, sorting both lists, placing them side by side, and manually aligning rows by VIN6 and amount. Unmatched rows remain on their source side and are highlighted for follow-up. The clerk then opens the compact FP REC workbook, enters the statement and account `324` totals, copies schedule-only and statement-only exceptions into their sections, carries the floor-date notes, and uses the subtotal, difference, net-adjustment, and variance formulas. The recording focuses on May; it confirms the procedure but does not replace the April files as numerical acceptance evidence. No recorded step contradicts the counts, totals, account selection, or output contract below.

## Counts and totals

All amounts below are integer cents.

| Month | BOA accepted | Dealertrack accepted | Matched | BOA-only | DT-only | BOA cents | DT cents | FP REC difference cents |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Feb 2026 | 114 | 129 | 114 | 0 | 15 | 546981440 | -618816030 | -71834590 |
| Mar 2026 | 204 | 213 | 204 | 0 | 9 | 980937310 | -1027649870 | -46712560 |
| Apr 2026 | 199 | 208 | 199 | 0 | 9 | 1005665140 | -1039411200 | -33746060 |

February's BOA count and total come from the completed merged output because the discovery package has no raw February BOA. March and April raw preprocessing reproduces the accepted counts and totals exactly. The current reconciliation kernel also reproduces 204 matches with nine Dealertrack-only exceptions for March and 199 matches with nine Dealertrack-only exceptions for April.

| Source/month | Rows scanned | Zero removed | Straight Line removed | Non-detail/unknown removed | Accepted |
| --- | ---: | ---: | ---: | ---: | ---: |
| BOA March | 278 | 70 | 1 | 3 | 204 |
| BOA April | 291 | 88 | 1 | 3 | 199 |
| Dealertrack February | 130 | 0 | 0 | 1 | 129 |
| Dealertrack March | 214 | 0 | 0 | 1 | 213 |
| Dealertrack April | 209 | 0 | 0 | 1 | 208 |

## Merged contract

April governs the canonical eight-column detail layout:

1. `ACURA`
2. `Serial No/VIN`
3. `VIN6`
4. `Ending Balance`
5. `324`
6. `VIN6`
7. `Description`
8. `Control`

A matched row populates both sides only when VIN6 is equal and the absolute amounts are exactly equal in cents. A BOA-only row populates columns A-D and leaves E-H blank. A Dealertrack-only row leaves A-D blank and populates E-H. The three completed months contain no BOA-only rows and no same-VIN6/different-amount exception pair, so the latter remains a required tested rule but has no client example in this evidence set.

The completed CSVs preserve two independently ascending amount sequences. BOA rows remain ascending by `Ending Balance`; Dealertrack rows remain ascending by absolute `324` amount. Blank cells are inserted on the opposite side so Dealertrack-only rows appear at their GL sort positions among matched rows rather than being moved to the bottom. The recording shows this manual alignment.

February contains one repeated VIN6 group on both sides. It consists of two distinct amounts and two exact matched rows, so it is deterministic duplicate-candidate evidence without a duplicate exception. March and April contain no repeated VIN6 groups. Every matched row in all three completed CSVs has exact absolute-cent equality.

Each completed CSV ends with one totals row: the BOA total in column D, the signed account `324` total in column E, and `Final Totals:` in column G. April is the canonical label and capitalization reference; March's lowercase second `vin6` header is historical drift, not the future contract.

## FP REC contract

The goal workbook, not the merged CSV or the Hurst A-H fidelity document, defines Acura FP REC. Its recent goal sheets are `FEB 26`, `MAR 26`, `APR26`, and `MAY26`. Each has populated content only in A:D and a print area restricted to A:D:

| Sheet | Print area | Month-end date | Formula rows |
| --- | --- | --- | --- |
| `FEB 26` | `A1:D41` | 2026-02-28 | B6, B7, B26, B35, B36, B37 |
| `MAR 26` | `A1:D41` | 2026-03-31 | B6, B7, B26, B35, B36, B37 |
| `APR26` | `A1:D33` | 2026-04-30 | B6, B7, B21, B27, B28, B29 |
| `MAY26` | `A1:D40` | 2026-05-31 | B6, B7, B28, B34, B35, B36 |

The operative four-column layout is:

- A: titles, summary labels, and exception descriptors.
- B: statement/GL totals, exception amounts, subtotals, net adjustments, and variance.
- C: `GL FLOORED` dates for exception work.
- D: `BOA FLOORED` dates for exception work.

Required labels include `Floorplan Reconciliation-Hiley Acura`, `Outstanding STMT`, `GL Balances`, account `324`, `Total GL`, `Difference`, `On schedule-not on statement`, `On statement-not on GL`, `GL FLOORED`, `BOA FLOORED`, `Net adjustments`, and `Variance`.

The formula semantics are:

- `Total GL = SUM(account rows)`; the recent sheets use the single account row `324`.
- `Difference = Outstanding STMT + Total GL` because the imported GL amount is negative.
- `Schedule-only subtotal = SUM(schedule-only exception amounts)`.
- `Statement-only subtotal = SUM(statement-only exception amounts)`.
- `Net adjustments = schedule-only subtotal + statement-only subtotal`.
- `Variance = Net adjustments - Difference`.

On `APR26`, the concrete formulas are `B6=SUM(B5:B5)`, `B7=SUM(B3+B6)`, `B21=SUM(B9:B20)`, `B27=SUM(B23:B26)`, `B28=B27+B21`, and `B29=B28-B7`. April's displayed final variance is zero. The rendered sheets use accounting-style amounts with parenthesized negatives, highlight `Difference` and `Net adjustments` in yellow, use border lines to separate the exception sections, and print in portrait orientation. The OOXML worksheet dimensions retain blank/formatted cells through column I, but there are no populated cells beyond D in these four sheets and the print areas stop at D; this does not change the four-column business contract.

## Conflicts

| Conflict or ambiguity | Evidence-authority resolution |
| --- | --- |
| February has a completed merged CSV and goal sheet, but no raw BOA in the discovery directory. A tracked test fixture contains a February BOA. | Discovery evidence outranks tests. February remains characterization-only until an authoritative raw BOA is supplied. The tracked copy must be replaced with sanitized fixture data in later authorized work, not treated as discovery authority. |
| The eight matching tracked Acura CSV fixtures are byte-identical to the discovery originals and therefore contain client-like data. | Do not stage discovery artifacts or copy their rows into new fixtures. Later fixture work must sanitize them while retaining structural and aggregate test coverage. Git-history cleanup requires separate authorization. |
| May appears in the goal workbook and recording, but no May raw BOA, Dealertrack, or completed merged set is present. | May is a workflow/output cross-check only. April remains the acceptance month. |
| `docs/implementation/fp-rec-output-fidelity.md` defines Hurst FP REC as an A-H detail grid and places Dealertrack-only rows after BOA-valued rows. | The Acura goal workbook outranks Hurst documentation and defines Acura FP REC as A:D. The completed Acura merged CSV owns the A-H detail and interleaved side-specific ordering. Express this as explicit profile/presenter behavior without changing Hurst. |
| `docs/implementation/store-workflow-matrix.md` says the explicit Acura FP REC workbook was absent and formatting was TBD. | That statement is stale. The now-present `Acura FP Rec.xlsx` is the authoritative Acura goal output. |
| The current CSV preprocessing summaries report legacy parser formats and versions (`html_table_xls`/`boa-html-xls-v1` and `xml_spreadsheet`/`dealertrack-xml-v1`). | The source files are CSV. Later provenance work must persist the actual parser and preprocessor names/versions. No production code changes are part of this task. |
| March's completed merged header uses lowercase `vin6` in column F while February and April use `VIN6`. | April is the canonical acceptance artifact, so the future contract uses uppercase `VIN6`; golden comparison may document March's historical case drift. |
| Dealertrack descriptions contain dates from earlier months as well as the selected month. | These dates are supporting evidence, not an exclusive period key. The latest observed date does not exceed the selected month in February, March, or April, so there is no contradiction. |
| The recording demonstrates May rather than April. | Use it to establish the clerk's manual sequence and workbook use. Use April's raw, merged, and goal files for acceptance counts and totals. |
| The recent goal sheets have OOXML dimensions extending through I because of residual blank formatting. | Populated content and print areas are A:D. Four-column fidelity is defined by the operative and printed range, not by blank formatted cells. |
| No completed Acura month contains a same-VIN6/different-amount exception example. | Keep the approved side-specific mismatch rule and cover it with sanitized deterministic tests; do not invent a client example. |

## Gate verdict

**PASS — the Task 1 characterization stop gate is clear.**

- April 2026 is the latest complete and approved raw/merged/goal example.
- Dealertrack account `324` is exclusive in all three raw Dealertrack files; there are no excluded account columns.
- Acura FP REC is the compact four-column A:D workpaper, while the completed merged CSV owns the eight-column detail.
- The February, March, and April counts and integer-cent totals reproduce the required baselines exactly.
- The recorded manual workflow agrees with the preprocessing, matching, exception, and FP REC formula semantics.
- Every identified conflict has an evidence-authority resolution; no mandatory-stop condition remains unresolved.

This verdict completes characterization only. It does not itself start or complete any later implementation task.
