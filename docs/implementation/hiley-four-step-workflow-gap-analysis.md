# Hiley Four-Step Workflow Status And Gap Analysis

Status note: superseded for v1 product definition. This file describes a broader Hiley/multi-store pilot; Dealer-Recon v1 is the single-store Hurst Mazda FP REC pilot documented in `docs/product/fp-rec-four-step-workflow.md`. Keep this file as historical gap analysis only.

## Current Pilot Definition

Dealer-Recon is currently a Hiley store/month floorplan reconciliation pilot.

The product goal is narrow: for one supported store and one accounting month, take the raw BOA and Dealertrack files, process them according to that store's workflow, and produce the artifacts the office needs to trust the reconciliation.

This is not a dashboard analytics product, productivity tracker, triage/review workflow system, generic reconciliation SaaS platform, or consolidated multi-store reporting suite. Those capabilities are future scope unless they directly support the artifact workflow.

## Four-Step Workflow

1. Upload BOA file.
   - Accept the store's BOA Dealer Billing Statement style source file.
   - Preserve the original upload as a run artifact.

2. Upload Dealertrack file.
   - Accept the store's Dealertrack floorplan export.
   - Preserve the original upload as a run artifact.

3. Process reconciliation.
   - Apply store-specific BOA and Dealertrack cleaning rules.
   - Extract VIN6 values.
   - Match only when VIN6 and absolute amount both agree.
   - Keep side-only rows and amount mismatches visible as source-side rows.
   - Persist cleaned BOA and cleaned Dealertrack artifacts.

4. Download artifacts.
   - Merged Floorplan.
   - FP REC.
   - Raw BOA.
   - Raw Dealertrack.
   - Cleaned BOA.
   - Cleaned Dealertrack.

Each run is per store/month. Combined multi-store workbooks are out of scope.

## Supported Store Configurations

| Store | Status | Dealertrack amount behavior | Output labels |
| --- | --- | --- | --- |
| Hurst | Supported | `2100`; excludes `2110` where applicable. | `HURST` / `2100` |
| Acura | Supported | `324`. | `ACURA` / `324` |
| FW | Supported | Aggregates `2100 + 2101 + 2101S`; excludes `2110`; displays `2100`. | `FW` or `FORT WORTH` / `2100` |
| Remaining stores | Not configured | TBD from Tara artifacts. | TBD |

## Current-State Analysis

### Ingestion

Current behavior:

- The backend upload route accepts BOA and Dealertrack files, hashes uploads, detects duplicates, stores source-file metadata, and persists normalized transactions.
- Supported input families include CSV, BOA HTML-as-XLS, Dealertrack SpreadsheetML/XML-style exports, HTML, and plain text MIME variants.
- Native OOXML `.xlsx` upload is detected but rejected with guidance to resubmit as CSV, HTML-as-XLS, or SpreadsheetML-style export.
- Reconciliation now persists raw BOA and raw Dealertrack artifacts for the run.

Remaining gaps:

- Native `.xlsx` support is still absent.
- Remaining stores may expose source-file shapes not yet represented by Hurst, Acura, or FW.

### Preprocessing

Current behavior:

- BOA preprocessing removes title/header noise, zero balances, straightline rows, and non-working columns before reconciliation.
- Dealertrack preprocessing is store-configured:
  - Hurst uses `2100`.
  - Acura uses `324`.
  - FW aggregates `2100`, `2101`, and `2101S`, while excluding `2110`.
- VIN/VIN6 extraction, amount normalization, source lineage, and diagnostics are retained.
- Cleaned BOA and cleaned Dealertrack datasets are persisted as historical artifacts.

Remaining gaps:

- Cleaned artifacts should continue to be reviewed against clerk-recognizable working sheets.
- Store-specific edge cases for remaining stores are unknown until their raw and accepted artifacts are analyzed.

### Merged Spreadsheet Generation

Current behavior:

- A store-configured Merged Floorplan presenter exists.
- The backend export route is `GET /reconciliation-runs/:id/merged-floorplan`.
- The frontend exposes `Download Merged Spreadsheet`.
- Hurst, Acura, and FW use store config for display label and Dealertrack account label.
- FW merged output uses aggregated Dealertrack amount semantics while displaying `2100`.
- Generated Merged Floorplan artifacts are stored and retrievable historically.

Remaining gaps:

- Continue visual comparison against accepted clerk merged workbooks.
- Add new store configs only after fixture-derived counts, totals, labels, and account behavior are known.

### FP REC Generation

Current behavior:

- The generic route `GET /reconciliation-runs/:id/fp-rec` is the preferred route.
- The legacy route `GET /reconciliation-runs/:id/hurst-fp-rec` remains available for compatibility.
- FP REC generation derives from the same merged floorplan/store-config semantics as the merged artifact.
- Hurst uses `HURST` / `2100`.
- Acura uses `ACURA` / `324`.
- FW uses FW/Fort Worth display semantics and aggregated Dealertrack amount behavior.
- Generated FP REC artifacts are stored and retrievable historically.

Remaining gaps:

- Acura and FW FP REC visual styling should be verified against accepted workbook exports where available.
- Hurst legacy naming should stay compatible, but new UI and docs should prefer the generic FP REC route.

### UI

Current behavior:

- The main workflow screen now foregrounds:
  - Upload BOA.
  - Upload Dealertrack.
  - Run/process reconciliation.
  - Download Merged Spreadsheet.
  - Download FP REC.
- Completed runs show stored artifacts with type, filename, file size, created timestamp, and download buttons.
- Advanced analytics, automation, review, and history surfaces are collapsed or visually de-emphasized.

Remaining gaps:

- Some advanced/dashboard-oriented code and routes still exist.
- Keep these surfaces outside the primary pilot path until the artifact workflow is fully accepted.

## Gap Analysis

| Area | Required behavior | Current behavior | Severity |
| --- | --- | --- | --- |
| Remaining store analysis | Every pilot store has raw BOA, raw Dealertrack, merged, and FP REC evidence before config. | Hurst, Acura, and FW are configured; remaining stores are placeholders. | P0 |
| Native `.xlsx` upload | User can upload native Excel workbooks when Tara/Hiley exports them. | Native OOXML `.xlsx` is still unsupported. | P1 |
| Visual workbook fidelity | Merged Floorplan and FP REC visually match accepted clerk artifacts. | Counts/totals are covered for known stores; ongoing visual checks are still needed. | P1 |
| Product boundary | UI/docs describe the store/month artifact workflow first. | README and core docs are now reset; historical PRD/project docs are marked as historical. | P1 |
| Historical artifacts | Raw, cleaned, merged, and FP REC artifacts are persisted and downloadable. | Implemented. | Complete |
| Generic FP REC route | New integrations use `/fp-rec`, not Hurst-specific naming. | Implemented; legacy route preserved. | Complete |
| Store config | Physical account labels do not become logical account identifiers. | Implemented for Hurst, Acura, and FW. | Complete |

Severity scale:

- P0: Blocks pilot trust or next-store implementation.
- P1: Blocks output fidelity or clerk acceptance.
- P2: Important polish or operational hardening.

## Definition Of Done For The Pilot

The pilot is done when:

- Hiley users can run one store/month reconciliation from raw BOA and raw Dealertrack files.
- Hurst, Acura, FW, and remaining pilot stores have documented store configuration.
- Merged Floorplan artifacts match accepted store/month workbooks closely enough for office use.
- FP REC artifacts match accepted store/month workbook expectations.
- Raw BOA, raw Dealertrack, cleaned BOA, cleaned Dealertrack, Merged Floorplan, and FP REC artifacts are saved and downloadable for historical runs.
- Native `.xlsx` support is either implemented or explicitly excluded from the pilot operating procedure.
- The primary UI remains the four-step workflow.
- Dashboard analytics, productivity metrics, review assignment, generic reporting, and consolidated SaaS platform features remain deferred.

## Current Roadmap

1. Analyze and configure the remaining stores.
   - Review at least one raw BOA file, raw Dealertrack file, accepted merged artifact, and FP REC export per store.
   - Extend store config only from evidence.

2. Tighten visual fidelity for known store artifacts.
   - Compare Hurst, Acura, and FW Merged Floorplan and FP REC outputs against accepted workbooks.
   - Capture any remaining formatting, title, totals-row, or section-order differences.

3. Decide native `.xlsx` handling.
   - Either implement native OOXML parsing or document a firm export/resave operating procedure.

4. Harden artifact retention.
   - Confirm storage size expectations and retention policy.
   - Consider moving large artifact content to object/file storage if database storage becomes a deployment concern.

5. Keep UI simplified.
   - Maintain the four-step path as the first-screen workflow.
   - Avoid promoting dashboards, reports, automation, or review queues into the pilot path.

## Follow-Up Codex Tasks

| Task | Acceptance criteria |
| --- | --- |
| Add next-store workflow matrix rows | Each remaining store has raw BOA shape, raw Dealertrack shape, account columns, merged columns, totals behavior, FP REC assumptions, and open risks documented. |
| Add next-store config and golden tests | New store config is driven by accepted artifacts; tests prove raw inputs reproduce fixture-derived counts and totals. |
| Perform Excel visual QA for stored artifacts | For Hurst, Acura, and FW, downloaded Merged Floorplan and FP REC artifacts open in Excel/LibreOffice and match accepted workbook layout expectations. |
| Decide native `.xlsx` support | Either parser support is implemented with tests, or docs and UI copy clearly say native `.xlsx` is unsupported. |
| Document artifact retention policy | Run artifacts have an explicit retention/storage strategy suitable for pilot deployment. |
