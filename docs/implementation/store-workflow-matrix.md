# Store Workflow Matrix

## Purpose

The pilot scope is the Hiley four-step floorplan workflow:

1. Ingest raw BOA and Dealertrack files.
2. Clean and process them using the actual store workflow.
3. Generate the merged spreadsheet artifact.
4. Generate the FP REC artifact from the same reconciliation semantics.

This document separates universal workflow behavior from store-specific configuration. The analyzed comparison now covers Hurst, Acura, and Fort Worth (FW). The remaining store rows are placeholders until Tara's captured artifacts are analyzed with the same evidence standard.

## Evidence Read

| Evidence | Use in this matrix |
| --- | --- |
| GitHub issue #11 | Confirms the pilot reset to the Hiley four-step workflow and rejects dashboard, triage, productivity, and generic SaaS drift. |
| `docs/implementation/hiley-four-step-workflow-gap-analysis.md` | Establishes the current pilot status: Hurst, Acura, and FW are supported; remaining stores still need evidence-driven configuration. |
| `docs/implementation/fp-rec-output-fidelity.md` | Provides Hurst FP REC expectations, especially side-by-side BOA/Dealertrack columns and exact VIN6 plus amount matching. |
| `docs/dealer_recon_ground_truth_reverse_engineering.md` | Provides Hurst merged workbook semantics, golden counts, column layout, matching rules, totals behavior, and formula intent. |
| `docs/demo/BOA-workflow.md` | Captures the manual BOA cleaning workflow. |
| `docs/demo/dealertrack-workflow.md` | Captures the manual Dealertrack cleaning workflow, including Hurst `2100` handling. |
| Acura CSV evidence from Tara | Confirms Acura raw BOA shape, raw Dealertrack columns, merged workbook columns, account `324`, and totals rows. |
| `docs/discovery/floorplan/FW/` | Confirms FW raw BOA shape, multi-column Dealertrack export, accepted merged workbook columns/totals, and FP REC workbook assumptions. |

## Store Workflow Comparison

| Store | Analysis status | Store label in merged workbook | BOA raw input shape | Dealertrack raw input shape | Dealertrack account column | Merged workbook columns | Totals row behavior | FP REC output assumptions | Known workflow differences |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Hurst | Analyzed from docs and golden reverse engineering | `HURST` | BOA Dealer Billing Statement family with title/header rows, statement detail rows, `Straight Line` row, and `Total` row; workflow removes non-working rows and zero/straightline rows before reconciliation. | Dealertrack export processed for account `2100`; Hurst workflow removes `2110` and reconciles `2100`. | `2100` | `HURST`, `Serial No/VIN`, `VIN6`, `Ending Balance`, `2100`, `VIN6`, `Description`, `Control` | BOA total is summed from cleaned `Ending Balance`; Dealertrack total is summed from `2100`; variance is allowed and is evidence, not failure. | FP REC should preserve the same Hurst side-by-side semantics and derive from the merged artifact, not an isolated presenter. | Hurst is the current ground-truth store. It uses account `2100`, has Hurst-specific `2110` removal, and cannot define the universal account model by itself. |
| Acura | Analyzed from Tara's raw and merged CSV evidence | `ACURA` | BOA Dealer Billing Statement with title rows, 32-column header row, statement detail rows, `Straight Line` row, and `Total` row. | Three-column Dealertrack export: `Control`, `Description`, `324`. | `324` | `ACURA`, `Serial No/VIN`, `VIN6`, `Ending Balance`, `324`, `VIN6`, `Description`, `Control` | Merged totals rows include BOA total and `324` total. Raw BOA total includes `Straight Line`; merged BOA total excludes it. Dealertrack total is carried from `Final Totals:` under the DT side. | FP REC should use the same merged semantics with `ACURA` and `324`. The explicit Acura FP REC workbook was not in the provided Acura filename list, so final formatting should be confirmed when that export is reviewed. | Acura cannot be supported correctly by hardcoding Hurst labels or account `2100`. Account column, merged label, totals labels, and DT-only placement must be configurable. |
| FW / Fort Worth | Analyzed from Tara's FW raw, merged, and FP REC evidence | `FW` in February/March merged CSVs; `FORT WORTH` in April merged CSV | BOA Dealer Billing Statement with title rows, store row `Hiley Cars Fort Worth, LP`, 32-column header row, statement detail rows, `$2,000,000.00` `Straight Line` row, and `Total` row. | Multi-column Dealertrack export: `Control`, `Description`, `2100`, `2101`, `2101S`, `2110`. | Display label is `2100`; reconciled amount is the aggregate of `2100`, `2101`, and `2101S`; `2110` is excluded as straightline. | `FW` or `FORT WORTH`, `Serial No/VIN`, `VIN6`, `Ending Balance`, `2100`, `VIN6`, `Description`, `Control` | BOA merged total equals raw BOA `Ending Balance` total less the `$2,000,000.00` `Straight Line` row. Dealertrack merged total equals `Final Totals:` for `2100 + 2101 + 2101S`, displayed under the single `2100` column, excluding `2110`. | FW FP REC workbook uses title `Floorplan Reconciliation - Hiley Cars Fort Worth`; recent sheets show `Outstanding on STMT`, GL row `2100`, `Total GL`, `Difference`, and exception sections generated from the same merged totals. | FW introduces a third configuration variant: a single output account label backed by multiple raw Dealertrack amount columns. It also has an accepted merged-label inconsistency between `FW` and `FORT WORTH`. |
| Remaining store 1 | Placeholder | TBD | TBD after Tara artifact review | TBD after Tara artifact review | TBD | TBD | TBD | TBD | Determine whether this store follows Hurst, Acura, FW, or another workflow variant. |
| Remaining store 2 | Placeholder | TBD | TBD after Tara artifact review | TBD after Tara artifact review | TBD | TBD | TBD | TBD | Determine whether this store follows Hurst, Acura, FW, or another workflow variant. |
| Remaining store 3 | Placeholder | TBD | TBD after Tara artifact review | TBD after Tara artifact review | TBD | TBD | TBD | TBD | Determine whether this store follows Hurst, Acura, FW, or another workflow variant. |

## Hurst Findings

| Field | Finding |
| --- | --- |
| Store label used in merged workbook | `HURST` |
| BOA raw input shape | BOA Dealer Billing Statement style input cleaned by removing title/header noise, irrelevant columns, zero balances, straightline rows, and non-working maturity/current-month review columns before the merged workbook is produced. |
| Dealertrack raw input shape | Dealertrack floorplan export with Hurst workflow focused on account `2100`; `2110` is removed for Hurst. |
| Dealertrack account column | `2100` |
| Merged workbook columns | `HURST`, `Serial No/VIN`, `VIN6`, `Ending Balance`, `2100`, `VIN6`, `Description`, `Control` |
| VIN6 behavior | BOA VIN6 comes from the last six characters of `Serial No/VIN`; Dealertrack VIN6 comes from the last six characters of the VIN-like token in `Description`. |
| Match behavior | A row is a confirmed match only when VIN6 matches and absolute BOA/Dealertrack amounts match exactly. Amount mismatches remain visible as side-specific exceptions. |
| Totals row behavior | BOA total is the cleaned `Ending Balance` sum. Dealertrack total is the cleaned `2100` sum. A non-zero variance is acceptable and should remain visible. |
| FP REC output assumptions | FP REC should be generated from the merged workbook semantics. It should not re-create independent matching or Hurst-only layout assumptions in a separate presenter. |
| Known workflow differences | Hurst establishes the current gold standard but is not universal: the account label is `2100`, Hurst has a `2110` removal step, and Hurst-specific output naming/layout must not leak into other stores. |

## Acura Findings

| Field | Finding |
| --- | --- |
| Store label used in merged workbook | `ACURA` |
| BOA raw input shape | Acura BOA raw is a BOA Dealer Billing Statement with title rows, a 32-column header row, statement detail rows, a `Straight Line` row, and a `Total` row. |
| Dealertrack raw input shape | Acura Dealertrack raw columns are exactly `Control`, `Description`, `324`. |
| Dealertrack account column | `324` |
| Merged workbook columns | `ACURA`, `Serial No/VIN`, `VIN6`, `Ending Balance`, `324`, `VIN6`, `Description`, `Control` |
| VIN6 behavior | Same semantic rule as Hurst: BOA VIN6 comes from `Serial No/VIN`; Dealertrack VIN6 comes from the VIN embedded at the end of `Description`. |
| Match behavior | Same semantic rule as Hurst: VIN6 and absolute amount must both confirm before a BOA row and Dealertrack row are merged. |
| Totals row behavior | Acura merged totals rows include the BOA total and the `324` total. The raw BOA `Total` includes the `Straight Line` row; the merged BOA total excludes `Straight Line`. The Dealertrack side carries `Final Totals:`. |
| FP REC output assumptions | Acura FP REC should be generated from the merged artifact and store config, with `ACURA` as the BOA-side label and `324` as the Dealertrack account. The explicit Acura FP REC export should be reviewed before locking final workbook styling. |
| Known workflow differences | Acura has no `2100` account column in the raw Dealertrack evidence. It uses account `324`, has a different merged label, and shows DT-only rows in the side-by-side merged artifact with blank BOA cells and populated `324`/VIN6/Description/Control cells. |

Acura monthly evidence:

| Month | BOA raw total | Straight Line removed | Merged BOA total | Dealertrack `324` total | Detail rows observed in merged CSV |
| --- | ---: | ---: | ---: | ---: | ---: |
| February 2026 | `$6,969,814.40` | `$1,500,000.00` | `$5,469,814.40` | `(6,188,160.30)` | 129 |
| March 2026 | `$11,309,373.10` | `$1,500,000.00` | `$9,809,373.10` | `(10,276,498.70)` | 213 |
| April 2026 | `$11,556,651.40` | `$1,500,000.00` | `$10,056,651.40` | `(10,394,112.00)` | 208 |

Concrete Acura conclusion: Acura cannot be supported correctly by hardcoding Hurst, `HURST`, or account `2100`.

## FW / Fort Worth Findings

| Field | Finding |
| --- | --- |
| Store label used in merged workbook | February and March accepted merged CSVs use `FW`; April accepted merged CSV uses `FORT WORTH`. The implementation needs either a canonical `merged_sheet_label` plus accepted-label aliases for golden validation, or Tara confirmation that one label should win going forward. |
| BOA raw input shape | FW BOA raw is a BOA Dealer Billing Statement with `Dealer Billing Statement for: [Month] 2026`, store row `Hiley Cars Fort Worth, LP`, the same 32-column statement header family seen in Acura, statement detail rows, a `Straight Line` row, and a `Total` row. |
| Dealertrack raw input shape | FW Dealertrack raw columns are `Control`, `Description`, `2100`, `2101`, `2101S`, and `2110`. |
| Dealertrack account column | The accepted merged and FP REC artifacts display a single GL/account label `2100`, but the amount is not the raw `2100` column alone. It aggregates `2100`, `2101`, and `2101S`; `2110` is excluded. |
| Merged workbook columns | `FW` or `FORT WORTH`, `Serial No/VIN`, `VIN6`, `Ending Balance`, `2100`, `VIN6`, `Description`, `Control` |
| VIN6 behavior | Same semantic rule as Hurst and Acura: BOA VIN6 comes from `Serial No/VIN`; Dealertrack VIN6 comes from the VIN embedded in `Description`. |
| Match behavior | Same semantic rule as Hurst and Acura: VIN6 and absolute amount must both confirm before side-by-side merging. Amount mismatches and side-only rows remain visible. |
| Totals row behavior | BOA merged total excludes the `$2,000,000.00` `Straight Line` row. Dealertrack merged total is the sum of configured floorplan DT totals `2100 + 2101 + 2101S`, shown as a parenthesized amount under the output label `2100`; raw DT `2110` is excluded. |
| FP REC output assumptions | `FW FP Rec.xlsx` recent sheets use `Floorplan Reconciliation - Hiley Cars Fort Worth`, `Outstanding on STMT`, GL row `2100`, `Total GL`, `Difference`, `On schedule-not on statement`, and `On statement-not on GL`. Sheet totals for February, March, and April match the accepted merged BOA totals and the aggregated DT totals. |
| Differences from Hurst | FW shares the output label `2100`, but FW cannot be generated by selecting raw `2100` alone. It needs multi-column DT aggregation and explicit `2110` exclusion. FW also has accepted labels `FW` and `FORT WORTH`, while Hurst uses a stable `HURST` label in the documented merged artifact. |
| Differences from Acura | Acura has a three-column DT export with one account column, `324`. FW has a six-column DT export and aggregates `2100`, `2101`, and `2101S` into one displayed `2100` amount. FW removes a `$2,000,000.00` straightline amount, while Acura removes `$1,500,000.00`. |
| Configuration-model conclusion | The current store configuration model covers FW by using `dealertrack_amount_columns`, `dealertrack_excluded_account_columns`, output account labels, and accepted merged-label aliases. Remaining stores still need the same evidence review before they are configured. |

FW monthly evidence:

| Month | BOA raw total | Straight Line removed | Merged BOA total | Dealertrack included total | Dealertrack excluded total | Matched rows | BOA-only rows | DT-only rows | Detail rows observed in merged CSV |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| February 2026 | `$36,498,941.54` | `$2,000,000.00` | `$34,498,941.54` | `(32,751,773.49)` | `(2,000,000.00)` from `2110` | 620 | 53 | 15 | 688 |
| March 2026 | `$43,134,465.98` | `$2,000,000.00` | `$41,134,465.98` | `(37,765,469.94)` | `(2,000,000.00)` from `2110` | 749 | 63 | 13 | 825 |
| April 2026 | `$42,348,201.96` | `$2,000,000.00` | `$40,348,201.96` | `(35,997,028.41)` | `(2,000,000.00)` from `2110` | 687 | 107 | 38 | 832 |

Concrete FW conclusion: FW cannot be supported correctly by the current single raw Dealertrack account-column assumption. The output can still display `2100`, but generation must aggregate configured floorplan columns and exclude configured non-reconciling columns.

## Universal Workflow

The universal workflow is the same across stores, but specific columns, labels, totals labels, and placement rules come from store configuration.

1. Raw BOA ingest: accept the store's BOA Dealer Billing Statement export and preserve a raw-input artifact for audit.
2. Raw Dealertrack ingest: accept the store's Dealertrack export and preserve a raw-input artifact for audit.
3. Store-specific cleaning: remove BOA title/header noise, straightline rows, zero rows, and non-working columns; select or aggregate the configured Dealertrack floorplan amount columns and remove non-reconciling account columns or rows.
4. VIN6 extraction: compute BOA VIN6 from `Serial No/VIN` and Dealertrack VIN6 from the configured Dealertrack description/VIN rule.
5. Amount confirmation: only merge a BOA row and Dealertrack row when VIN6 matches and absolute amounts match; leave mismatches visible as exceptions.
6. Merged spreadsheet artifact: generate the clerk-style side-by-side merged working spreadsheet before FP REC.
7. FP REC artifact: generate FP REC from the merged artifact and store config so the final workbook is downstream of the same reconciliation semantics.

## Store-Specific Configuration Model

| Config field | Purpose | Hurst value | Acura value | FW value | Notes |
| --- | --- | --- | --- | --- | --- |
| `store_key` | Stable internal identifier. | `hurst` | `acura` | `fw` or `fort_worth`; choose one canonical key before implementation. | Must not be inferred from filename alone. |
| `display_name` | Human-readable store name in UI/history. | Hiley Mazda of Hurst, confirm exact display string | Acura / North Fort Worth Dealership Acquisition, confirm exact display string | Hiley Cars Fort Worth | Acura BOA title row uses `North Fort Worth Dealership Acquisition`; FW BOA title row uses `Hiley Cars Fort Worth, LP`. |
| `merged_sheet_label` | Header for BOA description/store column in the merged artifact. | `HURST` | `ACURA` | `FW` or `FORT WORTH`; February/March evidence uses `FW`, April uses `FORT WORTH`. | This is not always the same as display name. FW needs a canonical label decision or aliases for accepted historical artifacts. |
| `merged_sheet_label_aliases` | Accepted historical labels for fixture validation and import tolerance. | None known | None known | `FW`, `FORT WORTH` | New field recommended by FW evidence. Do not let aliases change the current export label without an explicit config decision. |
| `dealertrack_account_column` | Raw Dealertrack account column to reconcile when the store has exactly one DT amount column. | `2100` | `324` | Not sufficient by itself for FW. | Keep for Hurst/Acura compatibility, but treat FW as multi-column. |
| `dealertrack_amount_columns` | Raw Dealertrack amount column or columns whose values feed the logical floorplan amount. | `["2100"]` | `["324"]` | `["2100", "2101", "2101S"]` | New field required by FW. This is the matching/totals input, not necessarily the output label. |
| `dealertrack_excluded_account_columns` | Raw Dealertrack account columns explicitly excluded from floorplan matching/totals. | `["2110"]`, based on Hurst workflow docs | `[]` | `["2110"]` | FW `2110` is the `$2,000,000.00` straightline amount and is excluded from accepted merged and FP REC totals. |
| `dealertrack_account_label` | Output label for the Dealertrack amount column. | `2100` | `324` | `2100` | FW proves this can differ from the raw amount semantics: one displayed label may represent multiple raw columns. |
| `output_filename_prefix` | Store-specific prefix for merged and FP REC artifact names. | TBD Hurst convention | TBD Acura convention | `FW` in current evidence paths; confirm desired downloaded filename prefix. | Should be explicit once historical exports are reviewed. |
| `boa_description_column_behavior` | How the BOA `Description` column is carried into the merged workbook. | Use BOA Description values under `HURST` header. | Use BOA Description values under `ACURA` header. | Use BOA Description values under the configured `FW`/`FORT WORTH` header. | The merged header is a store label, not the literal source-column name. |
| `totals_row_labels` | Labels and cells used for BOA/Dealertrack totals. | BOA total in `Ending Balance`, DT total in `2100`; verify exact label text in workbook exports. | BOA total in `Ending Balance`, DT total in `324`, `Final Totals:` on DT side. | BOA total in `Ending Balance`; aggregated DT total under `2100`; `Final Totals:` on DT side, with `otals:` appearing in the second VIN6 cell in CSV export. | Do not force zero variance. Preserve clerk-style total placement even when labels look odd in CSV. |
| `dt_only_placement_rule` | Where DT-only exception rows appear in the merged artifact. | Default Hurst behavior: BOA-valued rows sort by BOA balance; blank-BOA DT-only rows may follow BOA-valued rows unless the workbook proves otherwise. | Acura evidence shows DT-only rows with blank BOA cells and populated DT cells; placement must follow the Acura merged artifact rather than Hurst assumptions. | FW evidence shows DT-only rows with blank BOA cells and populated aggregated DT amount/VIN6/Description/Control cells. | This may become a per-store sort/display strategy. |
| `boa_statement_header_strategy` | How to locate the real BOA header row after title rows. | BOA statement header detection | BOA statement header detection | BOA statement header detection | Universal parser, store-configured validation. |
| `boa_excluded_rows` | Rows to exclude from cleaned BOA totals. | Zero balance and straightline rows | `Straight Line` row and zero rows | `Straight Line` row and zero rows; straightline observed as `$2,000,000.00`. | Exclusion must happen before totals are calculated. |
| `dealertrack_total_label` | Label expected on the DT total row. | TBD from Hurst exports | `Final Totals:` | `Final Totals:` | Needed for workbook fidelity, not matching. |
| `merged_columns` | Exact output columns for the merged artifact. | Hurst A-H columns | Acura A-H columns | Same A-H columns with FW/FORT WORTH and `2100` labels. | Same shape so far, but account/store labels and DT amount semantics differ. |
| `fp_rec_template_variant` | Store-specific FP REC formatting variant if needed. | Hurst baseline | TBD after Acura FP REC export review | FW workbook variant with title `Floorplan Reconciliation - Hiley Cars Fort Worth`, `Outstanding on STMT`, GL row `2100`, and exception sections. | FP REC should still be generated from merged semantics. |

## Current Implementation Status

| Capability | Status |
| --- | --- |
| Store workflow matrix | Implemented for Hurst, Acura, and FW; remaining stores are placeholders. |
| Store configuration model | Implemented for Hurst, Acura, and FW, including FW multi-column Dealertrack aggregation. |
| Merged Floorplan generation | Implemented for Hurst, Acura, and FW. |
| FP REC generation | Implemented from merged floorplan/store-config semantics. |
| Generic FP REC route | Implemented at `/reconciliation-runs/:id/fp-rec`; legacy `/hurst-fp-rec` remains compatible. |
| Historical artifact storage | Implemented for raw uploads, cleaned datasets, Merged Floorplan, and FP REC. |
| Frontend artifact access | Implemented in the completed-run state. |

## Remaining Implementation Roadmap

1. Analyze and configure the remaining stores from Tara artifacts.
2. Continue visual workbook fidelity checks for Merged Floorplan and FP REC outputs.
3. Decide whether to implement native `.xlsx` upload or keep it explicitly unsupported.
4. Define artifact retention/storage policy for pilot deployment.
5. Keep dashboard, reporting, productivity, and review workflow surfaces outside the primary pilot path.

## Follow-Up Codex Tasks

| Task | Acceptance criteria |
| --- | --- |
| Add next-store matrix rows | For each remaining store, document raw BOA shape, raw Dealertrack shape, account behavior, merged columns, totals rows, FP REC assumptions, and unknowns. |
| Add next-store config and golden tests | Raw store fixtures preprocess into fixture-derived Merged Floorplan counts/totals, and FP REC uses store-configured labels and totals. |
| Perform visual artifact QA | Downloaded Merged Floorplan and FP REC artifacts for Hurst, Acura, and FW open in Excel/LibreOffice and match accepted workbook layout expectations. |
| Decide native `.xlsx` support | Either native OOXML upload is implemented with tests, or docs and UI copy clearly tell users to upload CSV, HTML-as-XLS, or SpreadsheetML-style files. |
| Define artifact retention policy | Historical artifacts have a deployment-ready storage and retention plan. |

## Open Analysis Slots For Remaining Stores

Each remaining store should be added to the matrix only after reviewing at least one raw BOA file, one raw Dealertrack file, one cleaned or merged artifact, and one FP REC export when available. FW proves the remaining stores cannot be assumed to have one Dealertrack amount column just because Hurst and Acura were already understood.

For each store, capture:

| Required capture | Why it matters |
| --- | --- |
| Store label in merged workbook | Prevents display labels from being inferred from Hurst. |
| BOA raw input shape | Confirms whether the universal BOA parser handles title/header/total rows. |
| Dealertrack raw input shape | Identifies the account column and whether extra account columns must be removed. |
| Dealertrack account columns and label | Drives matching, merged workbook output, FP REC output, and tests. Must capture whether the store uses one source column or an aggregate of several columns. |
| Merged workbook columns | Confirms whether the Hurst/Acura A-H shape is universal. |
| Totals row behavior | Prevents incorrect variance and audit totals. |
| DT-only placement rule | Preserves clerk-style workbook fidelity. |
| FP REC workbook assumptions | Keeps FP REC downstream of merged artifact semantics while allowing store-specific presentation. |

Current unknowns and risks for remaining stores:

| Risk | Why it matters |
| --- | --- |
| Multi-account Dealertrack exports may recur. | FW shows that the output label can be `2100` while the actual amount comes from multiple raw columns. Remaining stores need column-level evidence before config is added. |
| Store label may vary across accepted artifacts. | FW uses `FW` and `FORT WORTH` across accepted merged CSVs. Golden tests need to tolerate accepted history while export config chooses one deliberate label. |
| Straightline amounts are store-specific. | Acura removes `$1,500,000.00`; FW removes `$2,000,000.00`. The rule should identify `Straight Line` rows, not hardcode an amount. |
| FP REC workbook variants may differ by store. | FW has a long historical workbook with recent monthly tabs and a `Hiley Cars Fort Worth` title. The FP REC generator should use merged semantics plus store config rather than assuming one template string. |
