# Hiley Four-Step Workflow Gap Analysis

Parent issues:

- #11 - Reset pilot scope: Hiley four-step floorplan workflow
- #10 - Hurst FP Rec Output Fidelity

Source references:

- `docs/dealer_recon_ground_truth_reverse_engineering.md`
- `docs/implementation/fp-rec-output-fidelity.md`
- `docs/demo/BOA-workflow.md`
- `docs/demo/dealertrack-workflow.md`

## 1. Corrected Pilot Product Definition

The pilot product is a Hiley floorplan workbook automation tool.

It exists to take the raw monthly Hiley Bank of America floorplan statement and raw Hiley Dealertrack 2100 schedule, reproduce the Hiley office workflow, and generate the two workbooks the office expects: the merged working spreadsheet and the final FP REC artifact.

The pilot is not a dashboard analytics tool, productivity tracker, triage/review workflow system, generic reconciliation SaaS platform, or broad reporting suite. Those capabilities can exist later only if they support the trusted workbook pipeline.

The success metric is narrow: given Hiley raw BOA and Dealertrack files, the app produces the expected Hiley merged spreadsheet and Hurst FP REC output closely enough that the office user trusts it as the monthly manual workflow replacement.

## 2. Exact Four-Step Workflow Definition

1. Ingest raw source files.
   - Accept the raw BOA floorplan statement export.
   - Accept the raw Dealertrack floorplan/2100 export.
   - Preserve enough source metadata and source lineage to reproduce or audit the run.

2. Clean and process using the actual Hiley workflow.
   - BOA workflow:
     - Remove header/banner rows.
     - Remove location, manufacturer name, plant name, invoice date, invoice number, and interest start date.
     - Sort by maturity date only to identify current-calendar-month maturities that must be tracked for payoff.
     - If no current-calendar-month maturity rows exist, remove the maturity date column.
     - Remove type, model number, stock/lease number, original amount, beginning balance, advances, last advance date, principal payments, and principal adjustments.
     - Keep Ending Balance as the BOA amount.
     - Remove all columns after Ending Balance.
     - Remove zero balances and Straightline rows.
     - Sort by Ending Balance smallest to largest, then VIN6 A to Z.
     - Auto-sum Ending Balance.
   - Dealertrack workflow:
     - Remove Straightline rows.
     - Remove column/account 2110 for this store.
     - Use account 2100 as the Dealertrack floorplan amount.
     - Sort largest to smallest, then VIN6 A to Z.
     - Format numbers as accounting without symbol.
     - Transpose/cut the Dealertrack table and merge it into the BOA statement.
     - Insert helper column between 2100 and VIN6 on the Dealertrack side with `=D2 + E2`, copied down.
     - Align BOA and Dealertrack rows so VIN6 values line up.
     - Insert the Dealertrack VIN6-description helper with `=C2 - F2`, copied down.

3. Generate the merged spreadsheet artifact.
   - Produce the clerk's merged working spreadsheet, not only internal JSON.
   - Include the cleaned BOA side, cleaned Dealertrack side, helper columns/formulas, row alignment, totals, and visible exceptions.
   - Save it historically so the run can be audited and replayed.

4. Generate the FP REC artifact.
   - Produce the final Hurst FP REC workbook in the clerk/CFO format.
   - Visible output is the accepted A-H grid:
     - A: HURST / BOA description
     - B: Serial No/VIN
     - C: VIN6 from BOA VIN
     - D: Ending Balance
     - E: 2100
     - F: VIN6 from Dealertrack description
     - G: Dealertrack Description
     - H: Dealertrack Control
   - Match only when BOA VIN6 equals Dealertrack VIN6 and absolute amounts match exactly.
   - Keep amount mismatches as separate BOA-only and Dealertrack-only exception rows.
   - Allow non-zero variance.

## 3. Current-State Analysis

### Ingestion

Current behavior:

- The backend upload route accepts BOA and Dealertrack source files, enforces a 5 MB upload limit, hashes files, detects duplicates, and stores normalized transactions under `source_files` and `transactions`.
- Backend format handling supports CSV, BOA HTML-as-XLS, Dealertrack SpreadsheetML XML/XLS, HTML, and plain text MIME variants. Native OOXML `.xlsx` is detected but rejected with guidance to resubmit as CSV or SpreadsheetML.
- The frontend upload control currently advertises CSV-only input even though the backend can process the more Hiley-relevant BOA `.xls` and Dealertrack XML/SpreadsheetML forms.
- The upload path stores transaction rows and lineage, but it does not persist the original raw file bytes as a first-class historical artifact. `stored_filename` is currently `null` on import.
- Duplicate upload reuse and unhealthy duplicate reprocessing are implemented, which helps repeat monthly testing.

Assessment:

Ingestion is directionally useful for the pilot, but it is still product-shaped around uploads and normalized rows rather than raw-file-to-workbook artifact preservation. The frontend CSV-only affordance is a pilot risk because the actual Hiley workflow starts from BOA and Dealertrack export files.

### Preprocessing

Current behavior:

- BOA preprocessing mirrors much of the documented Hiley process:
  - header/banner detection;
  - Ending Balance selection;
  - zero-balance removal;
  - Straightline removal;
  - VIN/VIN6 extraction;
  - current-calendar-month maturity diagnostics;
  - Hiley working-column pruning;
  - Ending Balance ascending plus VIN6 sort;
  - Ending Balance autosum diagnostics.
- Dealertrack preprocessing mirrors much of the documented Hiley process:
  - account 2100 selected as canonical amount;
  - account 2110 excluded for Hurst;
  - Straightline removal;
  - control normalization;
  - VIN/VIN6 extraction from description or VIN fields;
  - manual VIN enrichment diagnostics;
  - largest-2100-amount then VIN6 sort;
  - working output snapshots with helper formulas.
- Preprocessing diagnostics are visible in the UI and useful for operator trust.
- Cleaned row data is retained in transaction `raw_data`, but there is no downloadable cleaned BOA or cleaned Dealertrack workbook/CSV artifact.

Assessment:

The cleaning logic is one of the strongest pilot-aligned areas. The gap is packaging: the user can see diagnostics, but cannot yet open the cleaned BOA and Dealertrack artifacts as recognizable workflow outputs.

### Merged Spreadsheet Generation

Current behavior:

- Reconciliation creates match groups and exceptions from normalized transactions.
- The engine supports the clerk-critical rules: VIN/full-VIN/VIN6 with exact absolute amount matching, and VIN6 amount mismatches as paired exceptions.
- Historical input snapshots store normalized transactions for replay.
- There is no dedicated merged spreadsheet presenter, endpoint, download link, or saved artifact.
- The UI jumps from upload and reconciliation into review tables and FP REC export.

Assessment:

This is the biggest pilot gap. The documented Hiley workflow has a merged working spreadsheet between cleaning and FP REC. The current app does not yet produce the user's intermediate workbook artifact, so the pilot can appear to skip the office-manager workflow even when the matching logic is correct.

### FP REC Generation

Current behavior:

- `server/src/presenters/hurstFpRec.ts` now builds a side-aware A-H clerk row model.
- The visible XLS HTML export renders one primary A-H grid and omits the old visible schedule/statement/needs-review sections.
- Matched rows are rendered with BOA A-D and Dealertrack E-H on the same row.
- BOA-only rows populate A-D only; Dealertrack-only rows populate E-H only.
- Dealertrack VIN6 prefers the final 17-character VIN token from the description.
- Rows sort by BOA Ending Balance ascending, with blank-D Dealertrack-only rows after BOA-valued rows.
- Totals and non-zero variance are computed from visible D and E values.
- Presenter tests assert A-H headers, side-specific amount mismatch rows, and FEB/MAR/APR golden row counts from `sample-data/golden_dataset.csv`.
- The implementation spec at `docs/implementation/fp-rec-output-fidelity.md` still describes some older sectioned-workbook gaps, so it is now partially stale relative to the current branch.

Assessment:

FP REC fidelity has been partially remediated and is no longer the same gap described by the older spec. The remaining risk is end-to-end fidelity from raw Hiley uploads through preprocessing, matching, and exported XLS, plus visual verification against accepted workbooks.

## 4. Gap Analysis

| Area | Required behavior | Current behavior | Severity |
|---|---|---|---|
| Product boundary | Four-step Hiley artifact workflow only | UI and README still emphasize dashboards, analytics, automation, account reports, review workflow, and platform features | P0 |
| Raw BOA ingest | User can upload real BOA raw export and understand it is supported | Backend supports BOA HTML-as-XLS, but frontend file picker advertises CSV only | P1 |
| Raw Dealertrack ingest | User can upload real Dealertrack raw export and understand it is supported | Backend supports Dealertrack SpreadsheetML/XML, but frontend file picker advertises CSV only | P1 |
| Raw source preservation | Raw inputs are saved for audit/replay | Normalized transactions and snapshots are saved; raw uploaded file bytes are not first-class artifacts | P2 |
| Cleaned BOA artifact | Cleaned BOA output can be opened as a recognizable Hiley working sheet | Cleaned data exists in `raw_data` and diagnostics, but no downloadable artifact exists | P1 |
| Cleaned Dealertrack artifact | Cleaned Dealertrack output can be opened as a recognizable Hiley working sheet | Cleaned data exists in `raw_data` and diagnostics, but no downloadable artifact exists | P1 |
| Merged spreadsheet artifact | App generates the merged working spreadsheet before FP REC | No merged workbook presenter, endpoint, download, or saved artifact exists | P0 |
| Merged spreadsheet fidelity | BOA side, Dealertrack side, helper formulas, row manipulation, totals, and exceptions mirror Hiley's sheet | Reconciliation JSON has match groups/exceptions, but not the visible merged sheet | P0 |
| FP REC A-H output | Final workbook matches accepted clerk/CFO A-H format | Current presenter and tests now implement the A-H grid shape and golden counts | P1 |
| Amount mismatch treatment | VIN6 amount mismatches become separate side-specific exception rows | Engine emits paired exceptions; FP REC presenter renders exceptions side-specifically | P1 |
| End-to-end proof | Raw files produce golden-equivalent merged and FP REC artifacts | Golden tests exist at engine/presenter layers, but no full raw-upload-to-artifact proof is documented here | P1 |
| Historical artifacts | Merged and FP REC outputs are saved historically | Runs and snapshots are saved; generated workbook artifacts appear generated on demand | P2 |
| UI workflow | First screen maps to four steps: ingest, clean, merged workbook, FP REC | Current UI interleaves store management, automation, analytics, review queues, reports, and history | P0 |

Severity scale:

- P0: Blocks pilot trust or reinforces the wrong product.
- P1: Blocks output fidelity or end-to-end acceptance.
- P2: Important for audit/replay and repeatability after the core workbook path works.
- P3: Useful later, not needed for pilot acceptance.

## 5. UI Analysis

### What Supports The Pilot

- BOA and Dealertrack upload panels support the first workflow step.
- Preprocessing diagnostics support trust in the cleaning step, especially row removals, zero balances, Straightline removals, VIN issues, duplicate VIN6, and amount-column selection.
- Manual Dealertrack VIN enrichment supports a real Hiley data-quality failure mode.
- The Run reconciliation action connects cleaned source files into matching.
- The Hurst FP REC export button supports the final artifact.
- Recent uploads and run history can help repeat a monthly run, as long as they are presented as artifact history rather than dashboard analytics.

### What Distracts From The Pilot

- Store creation and dealer-group analytics frame the product as multi-store SaaS before Hurst output is trusted.
- Scheduled jobs, automation status, operational alerts, ingestion events, auto-vs-manual rates, and completion-time metrics frame the product as an operations dashboard.
- Run trend analytics, category trend cards, recurring exception counts, and account/month-end reports frame the product as an analytics/reporting suite.
- Match group tables, exception assignment, review status filters, reviewer names, Resolve/Ignore actions, and review notes frame the product as a triage/review workflow.
- The Accounts and Month-end navigation sections pull the pilot away from raw files to artifacts.
- "Export Unmatched Items CSV" is secondary and can make the app feel like a generic exception exporter rather than the Hiley workbook automation path.

### What Should Be Hidden Or Deferred

Hide or defer from the pilot UI:

- Accounts tab.
- Month-end reports tab.
- Store creation UI beyond a fixed/default Hiley Hurst selection.
- Dealer-group analytics and multi-store metrics.
- Scheduled jobs and automation controls.
- Operational alerts and ingestion event panels as primary UI.
- Run trend analytics and category trend analytics.
- Exception assignment, status, review-state filters, Resolve/Ignore actions, and reviewer workflow.
- Match groups table as a default visible surface.
- Generic unmatched-items CSV export as a primary call to action.

Keep but simplify:

- Upload BOA.
- Upload Dealertrack.
- Show concise cleaning summary and blocking data-quality issues.
- Generate/download cleaned BOA.
- Generate/download cleaned Dealertrack.
- Generate/download merged spreadsheet.
- Generate/download FP REC.
- Show artifact history for the four outputs.

## 6. Artifact Analysis

### Cleaned BOA Output

Required artifact:

- Openable cleaned BOA workbook/CSV.
- Columns reflect the Hiley working shape after removals.
- Ending Balance is the canonical amount.
- Zero-balance and Straightline rows are removed.
- Maturity-date payoff review behavior is visible when applicable.
- Rows are sorted by Ending Balance ascending, then VIN6.
- Ending Balance total is present.

Current state:

- BOA preprocessor creates normalized transactions, diagnostics, lineage, and pruned `raw_data`.
- No cleaned BOA export endpoint or UI download exists.

Gap:

- The cleaning step is implemented as data transformation, not as a user-facing artifact.

### Cleaned Dealertrack Output

Required artifact:

- Openable cleaned Dealertrack workbook/CSV.
- Straightline rows removed.
- Account 2110 removed for Hurst.
- Account 2100 retained as the canonical amount.
- Numbers formatted as accounting without symbols.
- Rows sorted largest-to-smallest by 2100, then VIN6.
- Control, 2100, VIN6, description, and helper formulas are present in merge-ready shape.

Current state:

- Dealertrack preprocessor creates normalized transactions, diagnostics, lineage, and pruned `raw_data`.
- No cleaned Dealertrack export endpoint or UI download exists.

Gap:

- The app can explain what it did, but it cannot hand the user the cleaned Dealertrack working artifact.

### Merged Spreadsheet Output

Required artifact:

- Openable merged working spreadsheet that mirrors the Hiley clerk's intermediate workbook.
- Cleaned BOA side and cleaned Dealertrack side are visible in one sheet.
- Dealertrack side is merged into the BOA statement structure.
- Helper columns/formulas are inserted and copied down.
- Rows are manipulated/aligned so BOA and Dealertrack VIN6 values line up when they match.
- Exceptions remain visible on their source side.
- Totals are present.
- The artifact is historically saved.

Current state:

- No merged spreadsheet artifact exists.
- Reconciliation output has enough match/exception data to build one, but it is not rendered as the clerk's working sheet.

Gap:

- This is the primary missing artifact and should be fixed before more FP REC polish or UI expansion.

### FP REC Output

Required artifact:

- Openable Hurst FP REC workbook in accepted A-H layout.
- Matched rows show BOA and Dealertrack on the same row.
- BOA-only and Dealertrack-only rows remain side-specific.
- Amount mismatches remain separate side-specific rows.
- Sort, totals, and non-zero variance match the accepted workbook.

Current state:

- Current presenter exports the A-H grid and has golden-count tests.
- The export is generated on demand from run detail.
- Visual comparison and raw-upload end-to-end acceptance remain the key proof gaps.

Gap:

- FP REC is close, but it should be treated as "needs end-to-end fidelity verification," not done.

## 7. Definition Of Done For The Pilot

The pilot is done when all of the following are true:

- A Hiley user can upload the raw BOA export and raw Dealertrack export without converting through a confusing non-Hiley path.
- The app applies the documented Hiley BOA cleaning workflow.
- The app applies the documented Hiley Dealertrack cleaning workflow.
- The user can download a cleaned BOA artifact.
- The user can download a cleaned Dealertrack artifact.
- The user can download a merged spreadsheet artifact that mirrors the clerk's merged working sheet.
- The user can download the final Hurst FP REC workbook.
- The merged spreadsheet and FP REC artifacts are saved historically for the run.
- FEB26, MAR26, and APRIL26 outputs match golden counts, signs, totals, variance, amount-mismatch treatment, and sort behavior.
- The FP REC workbook opens in Excel without repair prompts.
- Non-zero variance is displayed as expected, not treated as failure.
- The pilot UI foregrounds only the four-step artifact workflow.
- Dashboard analytics, productivity metrics, review assignment, generic reporting, and SaaS platform features are hidden or deferred.

## 8. Prioritized Implementation Roadmap

### 1. Store Workflow Matrix First

Acura and the other Tara-captured stores prove the pilot cannot be implemented as Hurst-only automation with hardcoded account `2100`.

Create `docs/implementation/store-workflow-matrix.md` before more implementation work.

The matrix must compare:

- Hurst.
- Acura.
- The remaining Tara-captured stores.
- Raw BOA shapes.
- Raw Dealertrack shapes.
- Cleaned/merged workbook shapes.
- FP REC output shapes.
- Store-specific labels, account columns, totals, and output naming.

Deliverable:

- A universal workflow definition.
- A store-specific configuration model.
- A list of workflow differences that must be supported before rollout.

### 2. Merged Spreadsheet Fidelity For Hurst + Acura Second

The merged spreadsheet is the missing P0 artifact.

Implement a merged spreadsheet generator that can reproduce the clerk working sheet for at least:

- Hurst, using account `2100`.
- Acura, using account `324`.

The merged artifact must be openable, downloadable, and visually recognizable as the clerk's working spreadsheet.

### 3. Store Configuration Model Third

Introduce store configuration before expanding further.

At minimum, store config must include:

- `store_key`
- `display_name`
- `merged_sheet_label`
- `dealertrack_account_column`
- `dealertrack_account_label`
- `output_filename_prefix`
- BOA description behavior
- totals row labels
- DT-only placement rule

No new Hurst-only assumptions should be added to the workflow path.

### 4. FP REC Generation From Merged Artifact / Store Config Fourth

FP REC should not be treated as an isolated presenter.

It should be generated from the same cleaned and merged workbook semantics used by the merged spreadsheet artifact.

This ensures the FP REC and merged workbook agree.

### 5. UI Simplification Around The Four-Step Workflow Fifth

Simplify the pilot UI around:

1. Upload raw BOA.
2. Upload raw Dealertrack.
3. Generate/download merged spreadsheet.
4. Generate/download FP REC.

Hide or defer analytics, accounts, month-end reports, scheduled jobs, multi-user review queues, operational metrics, and generic reports.

### 6. Historical Artifact Storage Sixth

After the workbook path is correct, persist the actual artifacts:

- raw BOA input
- raw Dealertrack input
- cleaned BOA artifact
- cleaned Dealertrack artifact
- merged spreadsheet
- FP REC

These artifacts must be redownloadable and tied to a reconciliation run for audit/replay.

## 9. Concrete Follow-Up Codex Tasks With Acceptance Criteria

### Task 1 - Implement Hiley Merged Spreadsheet Spec And Tests

Prompt:

Create an implementation spec and failing tests for the Hiley merged spreadsheet artifact. Do not change UI yet.

Acceptance criteria:

- Spec defines visible columns, helper formulas, row alignment rules, totals, and exception placement.
- Tests cover matched rows, BOA-only rows, Dealertrack-only rows, and VIN6 amount mismatches.
- Tests use FEB/MAR/APR golden fixture expectations where possible.
- Tests fail because no merged spreadsheet presenter exists yet.

### Task 2 - Build The Merged Spreadsheet Presenter And Export Endpoint

Prompt:

Implement the merged spreadsheet artifact for a reconciliation run using existing preprocessing and reconciliation detail data.

Acceptance criteria:

- Backend exposes a merged spreadsheet download endpoint for a run.
- Presenter emits an Excel-openable artifact.
- Artifact includes cleaned BOA side, cleaned Dealertrack side, helper formulas, aligned rows, totals, and visible exceptions.
- Amount mismatches are not merged as accepted matches.
- Tests from Task 1 pass.
- No existing FP REC output regression.

### Task 3 - Add Cleaned BOA And Cleaned Dealertrack Artifact Downloads

Prompt:

Expose cleaned BOA and cleaned Dealertrack outputs as downloadable artifacts generated from preprocessing output.

Acceptance criteria:

- BOA artifact matches the documented BOA cleanup steps.
- Dealertrack artifact matches the documented Dealertrack cleanup steps.
- Artifacts are available from the run or source-file context.
- Output includes enough lineage or metadata to trace removed rows through diagnostics.
- UI can download both artifacts without exposing dashboard features.

### Task 4 - Prove FP REC End To End From Raw Inputs

Prompt:

Add end-to-end tests and verification for raw Hiley BOA plus raw Dealertrack files through FP REC export.

Acceptance criteria:

- Raw source fixtures are ingested through the real upload/preprocessing path.
- Generated FP REC matches FEB/MAR/APR golden counts.
- Generated FP REC preserves signs, totals, variance, sorting, and amount-mismatch behavior.
- Export opens as Excel-compatible XLS HTML.
- Any remaining mismatch is documented with exact row-level evidence.

### Task 5 - Simplify The Pilot UI To Four Steps

Prompt:

Refactor the reconciliation UI into the Hiley four-step artifact workflow and hide non-pilot dashboard/review features.

Acceptance criteria:

- First screen shows only raw file ingestion, cleaning status/artifacts, merged spreadsheet artifact, and FP REC artifact.
- Accounts, month-end reporting, automation controls, operational metrics, review assignment, and trend analytics are hidden or moved outside the pilot path.
- Upload controls communicate the actual supported BOA and Dealertrack raw export formats.
- Primary buttons download cleaned BOA, cleaned Dealertrack, merged spreadsheet, and FP REC artifacts.

### Task 6 - Persist Historical Artifacts

Prompt:

Persist raw inputs and generated workbook artifacts for each reconciliation run.

Acceptance criteria:

- Raw BOA and Dealertrack files or canonical raw snapshots are retained.
- Cleaned BOA, cleaned Dealertrack, merged spreadsheet, and FP REC artifacts are saved with run metadata.
- Users can redownload historical artifacts.
- Replay can detect whether regenerated artifacts differ from saved historical artifacts.
- Artifact storage does not make dashboard analytics a pilot dependency.

