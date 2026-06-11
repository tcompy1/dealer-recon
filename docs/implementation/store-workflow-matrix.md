# Store Workflow Matrix

## Purpose

The pilot scope is the Hiley four-step floorplan workflow:

1. Ingest raw BOA and Dealertrack files.
2. Clean and process them using the actual store workflow.
3. Generate the merged spreadsheet artifact.
4. Generate the FP REC artifact from the same reconciliation semantics.

This document separates universal workflow behavior from store-specific configuration. The immediate comparison is Hurst versus Acura. The remaining four store rows are placeholders until Tara's captured artifacts are analyzed with the same evidence standard.

## Evidence Read

| Evidence | Use in this matrix |
| --- | --- |
| GitHub issue #11 | Confirms the pilot reset to the Hiley four-step workflow and rejects dashboard, triage, productivity, and generic SaaS drift. |
| `docs/implementation/hiley-four-step-workflow-gap-analysis.md` | Establishes the current product gap: merged spreadsheet fidelity must precede FP REC and UI simplification. |
| `docs/implementation/fp-rec-output-fidelity.md` | Provides Hurst FP REC expectations, especially side-by-side BOA/Dealertrack columns and exact VIN6 plus amount matching. |
| `docs/dealer_recon_ground_truth_reverse_engineering.md` | Provides Hurst merged workbook semantics, golden counts, column layout, matching rules, totals behavior, and formula intent. |
| `docs/demo/BOA-workflow.md` | Captures the manual BOA cleaning workflow. |
| `docs/demo/dealertrack-workflow.md` | Captures the manual Dealertrack cleaning workflow, including Hurst `2100` handling. |
| Acura CSV evidence from Tara | Confirms Acura raw BOA shape, raw Dealertrack columns, merged workbook columns, account `324`, and totals rows. |

## Store Workflow Comparison

| Store | Analysis status | Store label in merged workbook | BOA raw input shape | Dealertrack raw input shape | Dealertrack account column | Merged workbook columns | Totals row behavior | FP REC output assumptions | Known workflow differences |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Hurst | Analyzed from docs and golden reverse engineering | `HURST` | BOA Dealer Billing Statement family with title/header rows, statement detail rows, `Straight Line` row, and `Total` row; workflow removes non-working rows and zero/straightline rows before reconciliation. | Dealertrack export processed for account `2100`; Hurst workflow removes `2110` and reconciles `2100`. | `2100` | `HURST`, `Serial No/VIN`, `VIN6`, `Ending Balance`, `2100`, `VIN6`, `Description`, `Control` | BOA total is summed from cleaned `Ending Balance`; Dealertrack total is summed from `2100`; variance is allowed and is evidence, not failure. | FP REC should preserve the same Hurst side-by-side semantics and derive from the merged artifact, not an isolated presenter. | Hurst is the current ground-truth store. It uses account `2100`, has Hurst-specific `2110` removal, and cannot define the universal account model by itself. |
| Acura | Analyzed from Tara's raw and merged CSV evidence | `ACURA` | BOA Dealer Billing Statement with title rows, 32-column header row, statement detail rows, `Straight Line` row, and `Total` row. | Three-column Dealertrack export: `Control`, `Description`, `324`. | `324` | `ACURA`, `Serial No/VIN`, `VIN6`, `Ending Balance`, `324`, `VIN6`, `Description`, `Control` | Merged totals rows include BOA total and `324` total. Raw BOA total includes `Straight Line`; merged BOA total excludes it. Dealertrack total is carried from `Final Totals:` under the DT side. | FP REC should use the same merged semantics with `ACURA` and `324`. The explicit Acura FP REC workbook was not in the provided Acura filename list, so final formatting should be confirmed when that export is reviewed. | Acura cannot be supported correctly by hardcoding Hurst labels or account `2100`. Account column, merged label, totals labels, and DT-only placement must be configurable. |
| Remaining store 1 | Placeholder | TBD | TBD after Tara artifact review | TBD after Tara artifact review | TBD | TBD | TBD | TBD | Determine whether this store follows Hurst, Acura, or a third workflow variant. |
| Remaining store 2 | Placeholder | TBD | TBD after Tara artifact review | TBD after Tara artifact review | TBD | TBD | TBD | TBD | Determine whether this store follows Hurst, Acura, or a third workflow variant. |
| Remaining store 3 | Placeholder | TBD | TBD after Tara artifact review | TBD after Tara artifact review | TBD | TBD | TBD | TBD | Determine whether this store follows Hurst, Acura, or a third workflow variant. |
| Remaining store 4 | Placeholder | TBD | TBD after Tara artifact review | TBD after Tara artifact review | TBD | TBD | TBD | TBD | Determine whether this store follows Hurst, Acura, or a third workflow variant. |

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

## Universal Workflow

The universal workflow is the same across stores, but specific columns, labels, totals labels, and placement rules come from store configuration.

1. Raw BOA ingest: accept the store's BOA Dealer Billing Statement export and preserve a raw-input artifact for audit.
2. Raw Dealertrack ingest: accept the store's Dealertrack export and preserve a raw-input artifact for audit.
3. Store-specific cleaning: remove BOA title/header noise, straightline rows, zero rows, and non-working columns; select the configured Dealertrack account column and remove non-reconciling account columns or rows.
4. VIN6 extraction: compute BOA VIN6 from `Serial No/VIN` and Dealertrack VIN6 from the configured Dealertrack description/VIN rule.
5. Amount confirmation: only merge a BOA row and Dealertrack row when VIN6 matches and absolute amounts match; leave mismatches visible as exceptions.
6. Merged spreadsheet artifact: generate the clerk-style side-by-side merged working spreadsheet before FP REC.
7. FP REC artifact: generate FP REC from the merged artifact and store config so the final workbook is downstream of the same reconciliation semantics.

## Store-Specific Configuration Model

| Config field | Purpose | Hurst value | Acura value | Notes |
| --- | --- | --- | --- | --- |
| `store_key` | Stable internal identifier. | `hurst` | `acura` | Must not be inferred from filename alone. |
| `display_name` | Human-readable store name in UI/history. | Hiley Mazda of Hurst, confirm exact display string | Acura / North Fort Worth Dealership Acquisition, confirm exact display string | Acura BOA title row uses `North Fort Worth Dealership Acquisition`; merged workbook label is `ACURA`. |
| `merged_sheet_label` | Header for BOA description/store column in the merged artifact. | `HURST` | `ACURA` | This is not always the same as display name. |
| `dealertrack_account_column` | Raw Dealertrack account column to reconcile. | `2100` | `324` | Primary reason Hurst hardcoding fails for Acura. |
| `dealertrack_account_label` | Output label for the Dealertrack amount column. | `2100` | `324` | Usually same as account column, but keep separate for workbook fidelity. |
| `output_filename_prefix` | Store-specific prefix for merged and FP REC artifact names. | TBD Hurst convention | TBD Acura convention | Should be explicit once historical exports are reviewed. |
| `boa_description_column_behavior` | How the BOA `Description` column is carried into the merged workbook. | Use BOA Description values under `HURST` header. | Use BOA Description values under `ACURA` header. | The merged header is a store label, not the literal source-column name. |
| `totals_row_labels` | Labels and cells used for BOA/Dealertrack totals. | BOA total in `Ending Balance`, DT total in `2100`; verify exact label text in workbook exports. | BOA total in `Ending Balance`, DT total in `324`, `Final Totals:` on DT side. | Do not force zero variance. |
| `dt_only_placement_rule` | Where DT-only exception rows appear in the merged artifact. | Default Hurst behavior: BOA-valued rows sort by BOA balance; blank-BOA DT-only rows may follow BOA-valued rows unless the workbook proves otherwise. | Acura evidence shows DT-only rows with blank BOA cells and populated DT cells; placement must follow the Acura merged artifact rather than Hurst assumptions. | This may become a per-store sort/display strategy. |
| `boa_statement_header_strategy` | How to locate the real BOA header row after title rows. | BOA statement header detection | BOA statement header detection | Universal parser, store-configured validation. |
| `boa_excluded_rows` | Rows to exclude from cleaned BOA totals. | Zero balance and straightline rows | `Straight Line` row and zero rows | Exclusion must happen before totals are calculated. |
| `dealertrack_total_label` | Label expected on the DT total row. | TBD from Hurst exports | `Final Totals:` | Needed for workbook fidelity, not matching. |
| `merged_columns` | Exact output columns for the merged artifact. | Hurst A-H columns | Acura A-H columns | Same shape so far, but account/store labels differ. |
| `fp_rec_template_variant` | Store-specific FP REC formatting variant if needed. | Hurst baseline | TBD after Acura FP REC export review | FP REC should still be generated from merged semantics. |

## Corrected Implementation Order

1. Store workflow matrix first.
2. Merged spreadsheet fidelity for Hurst and Acura second.
3. Store configuration model third.
4. FP REC generation from merged artifact and store config fourth.
5. UI simplification around the four-step workflow fifth.
6. Historical artifact storage sixth.

## Follow-Up Codex Tasks

| Task | Acceptance criteria |
| --- | --- |
| Build merged spreadsheet generator | Given cleaned Hurst inputs, produces the Hurst A-H merged workbook columns with matching, exceptions, sort behavior, and totals matching the documented golden artifacts. Given cleaned Acura inputs, produces the Acura A-H merged workbook columns with account `324`, BOA total excluding `Straight Line`, and DT `Final Totals:` retained. |
| Add store config for Hurst and Acura | Introduces explicit config for `store_key`, `display_name`, `merged_sheet_label`, `dealertrack_account_column`, `dealertrack_account_label`, `output_filename_prefix`, BOA description behavior, totals row labels, and DT-only placement rule. No `HURST`, `ACURA`, `2100`, or `324` output behavior is hardcoded in shared presenter logic. |
| Add Acura golden tests | Adds golden fixtures from Acura February, March, and April raw/merged evidence. Tests assert raw DT columns `Control`, `Description`, `324`; merged columns `ACURA`, `Serial No/VIN`, `VIN6`, `Ending Balance`, `324`, `VIN6`, `Description`, `Control`; and monthly merged totals. |
| Update FP REC generator to use store config | FP REC generation reads the merged artifact semantics and store config instead of re-running Hurst-only matching or formatting. Hurst output remains stable and Acura output uses `ACURA` plus account `324`. |
| Simplify UI around four-step workflow | UI primary path is only raw ingest, clean/process, download merged spreadsheet, and download FP REC. Dashboard analytics, productivity metrics, triage/review queues, and generic reconciliation SaaS affordances are hidden or deferred. |

## Open Analysis Slots For Remaining Stores

Each remaining store should be added to the matrix only after reviewing at least one raw BOA file, one raw Dealertrack file, one cleaned or merged artifact, and one FP REC export when available.

For each store, capture:

| Required capture | Why it matters |
| --- | --- |
| Store label in merged workbook | Prevents display labels from being inferred from Hurst. |
| BOA raw input shape | Confirms whether the universal BOA parser handles title/header/total rows. |
| Dealertrack raw input shape | Identifies the account column and whether extra account columns must be removed. |
| Dealertrack account column and label | Drives matching, merged workbook output, FP REC output, and tests. |
| Merged workbook columns | Confirms whether the Hurst/Acura A-H shape is universal. |
| Totals row behavior | Prevents incorrect variance and audit totals. |
| DT-only placement rule | Preserves clerk-style workbook fidelity. |
| FP REC workbook assumptions | Keeps FP REC downstream of merged artifact semantics while allowing store-specific presentation. |
