Must-Fix Before V1
FP REC artifacts can be built from a second matcher instead of reviewed run results
Priority: P0
Evidence: [reconciliationArtifacts.ts (line 66)](/home/trent/workspace/dealer-recon-clean/server/src/services/reconciliationArtifacts.ts:66) persists merged/FP REC artifacts from source transactions. [mergedFloorplanExport.ts (line 28)](/home/trent/workspace/dealer-recon-clean/server/src/services/mergedFloorplanExport.ts:28) calls buildMergedFloorplanWorkbook, which re-matches cleaned rows in [mergedFloorplan.ts (line 172)](/home/trent/workspace/dealer-recon-clean/server/src/presenters/mergedFloorplan.ts:172). That matcher accepts fallback stock/control or VIN-prefix matches at [mergedFloorplan.ts (line 325)](/home/trent/workspace/dealer-recon-clean/server/src/presenters/mergedFloorplan.ts:325).
Why it matters: The FP REC output of record can disagree with the reconciliation exceptions the clerk reviewed.
Recommended fix: Persist merged and FP REC artifacts from ReconciliationRunDetail only, using the existing detail-based presenter path. Remove the cleaned-record matcher from stored artifact generation for v1.
Suggested regression test: A BOA/Dealertrack pair with same amount and stock/control but no Dealertrack VIN6 must remain split in the stored FP REC artifact.

Reconciliation runs do not have an explicit accounting month boundary
Priority: P1
Evidence: /reconcile validates dealership, store, and source type but not accounting month in [app.ts (line 808)](/home/trent/workspace/dealer-recon-clean/server/src/app.ts:808). Source files and reconciliation runs have no accounting-month field in [1778065200000_initial_schema.cjs (line 70)](/home/trent/workspace/dealer-recon-clean/server/src/db/migrations/1778065200000_initial_schema.cjs:70) and [1778065200000_initial_schema.cjs (line 110)](/home/trent/workspace/dealer-recon-clean/server/src/db/migrations/1778065200000_initial_schema.cjs:110). Automation pairs the latest BOA and Dealertrack files by source type only in [reconciliationAutomation.ts (line 368)](/home/trent/workspace/dealer-recon-clean/server/src/services/reconciliationAutomation.ts:368). Export period dates are inferred from latest transaction date or run creation time in [hurstFpRec.ts (line 636)](/home/trent/workspace/dealer-recon-clean/server/src/presenters/hurstFpRec.ts:636).
Why it matters: V1 is one Hurst accounting month per run. A wrong-month BOA file can be reconciled with a Dealertrack file and still produce a plausible FP REC.
Recommended fix: Add an explicit accounting month to upload or reconcile state, require both files to match it, and scope duplicate/automation pairing by that month.
Suggested regression test: BOA September plus Dealertrack October fails before run creation and creates no artifacts.

Duplicate upload reuse does not account for parser/preprocessor version drift
Priority: P1
Evidence: Duplicate reuse is decided before reprocessing at [app.ts (line 577)](/home/trent/workspace/dealer-recon-clean/server/src/app.ts:577). Health only checks transaction count, row count, and validation error count in [app.ts (line 1697)](/home/trent/workspace/dealer-recon-clean/server/src/app.ts:1697). Source-file rows do not store parser/preprocessing version in [1778065200000_initial_schema.cjs (line 70)](/home/trent/workspace/dealer-recon-clean/server/src/db/migrations/1778065200000_initial_schema.cjs:70).
Why it matters: A same-hash upload parsed under old logic can be reused forever if it looks “healthy,” even when removed-row audit, VIN6 extraction, or Hurst account handling changed.
Recommended fix: Store parser route, parser version, preprocessing version, and store workflow config key on source files; reprocess duplicates when any version/config differs.
Suggested regression test: A duplicate with old preprocessing metadata is reprocessed even when it has persisted transactions.

Future-scope UI and API calls are hard dependencies for the core workflow
Priority: P1
Evidence: The workflow dashboard loads dealer-group analytics, scheduled jobs, automation status, events, and operational metrics in the same Promise.all as source files and runs at [WorkflowDashboard.tsx (line 145)](/home/trent/workspace/dealer-recon-clean/frontend/src/components/WorkflowDashboard.tsx:145). Store creation and analytics are rendered in the primary workflow container at [WorkflowDashboard.tsx (line 438)](/home/trent/workspace/dealer-recon-clean/frontend/src/components/WorkflowDashboard.tsx:438). Future store configs are compiled into v1 at [storeWorkflowConfig.ts (line 1)](/home/trent/workspace/dealer-recon-clean/server/src/config/storeWorkflowConfig.ts:1).
Why it matters: A broken analytics/automation endpoint can disrupt the Hurst FP REC workflow, and the UI still centers multi-store/future concepts.
Recommended fix: Load the v1 workflow data path independently; feature-flag or remove future panels/routes from the v1 screen.
Suggested regression test: If analytics or automation endpoints return 500, BOA/Dealertrack upload and reconciliation still render and work.

Exception review is hidden behind “advanced” UI while downloads are primary
Priority: P1
Evidence: Step 4 download buttons appear immediately after a run at [WorkflowDashboard.tsx (line 1150)](/home/trent/workspace/dealer-recon-clean/frontend/src/components/WorkflowDashboard.tsx:1150). Exception review, analytics, replay, diagnostics, match groups, and exceptions are all nested under “Advanced review, analytics, and audit details” at [WorkflowDashboard.tsx (line 1200)](/home/trent/workspace/dealer-recon-clean/frontend/src/components/WorkflowDashboard.tsx:1200).
Why it matters: The canonical workflow requires “run reconciliation and review exceptions” before generating/storing the FP REC output of record.
Recommended fix: Make exceptions and removed-row review first-class step 3 content; place stored FP REC download as the final step after review context.
Suggested regression test: A run with exceptions renders the exceptions section visibly without expanding an advanced panel.

Dealertrack SpreadsheetML parser has an unbounded cell-index expansion
Priority: P1
Evidence: [dealertrackXmlParser.ts (line 147)](/home/trent/workspace/dealer-recon-clean/server/src/services/parsers/dealertrackXmlParser.ts:147) reads arbitrary ss:Index; lines 151-153 push empty cells until that index. Parser tests cover normal gaps but not hostile indexes in [dealertrackXmlParser.test.ts (line 32)](/home/trent/workspace/dealer-recon-clean/server/src/services/parsers/dealertrackXmlParser.test.ts:32).
Why it matters: Parser behavior is brittle under malformed input and can consume excessive memory.
Recommended fix: Cap maximum columns/index per row and return a parser warning or validation error when exceeded.
Suggested regression test: XML with ss:Index="1000000000" returns a controlled failure and does not allocate a huge row.

Error response shapes are inconsistent, and the frontend drops standardized messages
Priority: P1
Evidence: Standard errors return { error: { message } } in [errorHandler.ts (line 48)](/home/trent/workspace/dealer-recon-clean/server/src/middleware/errorHandler.ts:48). Several routes manually return { detail }, such as [app.ts (line 457)](/home/trent/workspace/dealer-recon-clean/server/src/app.ts:457) and [app.ts (line 384)](/home/trent/workspace/dealer-recon-clean/server/src/app.ts:384). The frontend API client only reads body.detail in [client.ts (line 49)](/home/trent/workspace/dealer-recon-clean/frontend/src/api/client.ts:49).
Why it matters: Important v1 workflow errors can show up as generic “API request failed” messages.
Recommended fix: Standardize backend error envelopes or update the frontend client to read both detail and error.message; migrate manual route errors to shared error classes.
Suggested regression test: A store-access 403 and invalid reconcile 422 both surface their concrete backend messages in the frontend/API client.

Should-Fix
Removed-row audit data exists but is not wired as the formal workflow artifact in the UI
Priority: P2
Evidence: Backend upload responses include removed_rows at [app.ts (line 1880)](/home/trent/workspace/dealer-recon-clean/server/src/app.ts:1880). A dedicated RemovedRowsAuditPanel exists at [RemovedRowsAuditPanel.tsx (line 16)](/home/trent/workspace/dealer-recon-clean/frontend/src/components/preprocessing/RemovedRowsAuditPanel.tsx:16), but it is not imported anywhere. The active diagnostics panel renders grouped diagnostics instead at [PreprocessingDiagnosticsPanel.tsx (line 31)](/home/trent/workspace/dealer-recon-clean/frontend/src/components/preprocessing/PreprocessingDiagnosticsPanel.tsx:31).
Why it matters: V1 explicitly includes removed-row audit. The current UI can obscure the structured audit table the backend already prepares.
Recommended fix: Wire RemovedRowsAuditPanel into the BOA/Dealertrack upload step or merge its explicit row table into the active diagnostics panel.
Suggested regression test: Upload with zero-balance or straightline removals renders row number, reason, and key values in the workflow.

Source types and legacy CSV fallback exceed v1 scope
Priority: P2
Evidence: sourceTypes includes bank, dms, gl, and oem at [types.ts (line 1)](/home/trent/workspace/dealer-recon-clean/server/src/domain/types.ts:1). Non-floorplan CSV uploads fall through to legacy normalization in [transactionNormalizer.ts (line 84)](/home/trent/workspace/dealer-recon-clean/server/src/services/transactionNormalizer.ts:84). runUploadPreprocessing labels non-BOA/Dealertrack fallback removed rows as BOA at [app.ts (line 1889)](/home/trent/workspace/dealer-recon-clean/server/src/app.ts:1889).
Why it matters: Future source types increase parser, test, and UX surface area while v1 only needs BOA and Dealertrack.
Recommended fix: In v1 mode, reject non-BOA/Dealertrack uploads or hide them behind an explicit future-scope flag.
Suggested regression test: source_type=bank returns a clear v1 unsupported response in production/v1 mode.

Artifact persistence overwrites the output of record without version identity
Priority: P2
Evidence: Artifact rows are unique by (reconciliation_run_id, artifact_type) in [1781222400000_add_reconciliation_artifacts.cjs (line 40)](/home/trent/workspace/dealer-recon-clean/server/src/db/migrations/1781222400000_add_reconciliation_artifacts.cjs:40). Writes use ON CONFLICT DO UPDATE and replace content at [postgresTransactionRepository.ts (line 1115)](/home/trent/workspace/dealer-recon-clean/server/src/repositories/postgresTransactionRepository.ts:1115).
Why it matters: The FP REC export is the output of record; silent replacement makes review and support harder.
Recommended fix: Add artifact content hashes and either immutable versions or explicit replacement audit events.
Suggested regression test: Re-persisting FP_REC records a new version or replacement audit with old/new hashes.

VIN6 and identifier extraction rules are duplicated across engine and presenters
Priority: P2
Evidence: Reconciliation uses matchingVin6 plus trusted-source checks in [reconciliationEngine.ts (line 297)](/home/trent/workspace/dealer-recon-clean/server/src/services/reconciliationEngine.ts:297). Merged export has separate BOA/Dealertrack VIN helpers in [mergedFloorplan.ts (line 548)](/home/trent/workspace/dealer-recon-clean/server/src/presenters/mergedFloorplan.ts:548). FP REC repeats similar logic in [hurstFpRec.ts (line 544)](/home/trent/workspace/dealer-recon-clean/server/src/presenters/hurstFpRec.ts:544).
Why it matters: Small differences in fallback order can change whether a row is matched, displayed as BOA-only, or displayed as Dealertrack-only.
Recommended fix: Centralize v1 VIN/VIN6 extraction and provenance helpers in one domain module; presenters should consume already-classified run detail whenever possible.
Suggested regression test: The same fixture row produces the same VIN6/provenance in preprocessing, engine, merged export, and FP REC export.

Frontend has no app-level regression tests for the four-step workflow
Priority: P2
Evidence: No frontend test/spec files were found under frontend/src; workflow behavior is concentrated in [WorkflowDashboard.tsx (line 101)](/home/trent/workspace/dealer-recon-clean/frontend/src/components/WorkflowDashboard.tsx:101).
Why it matters: The main v1 user path is a complex stateful UI with upload, diagnostics, reconciliation, exception review, and artifacts.
Recommended fix: Add focused component/integration tests around the four steps using mocked API responses.
Suggested regression test: BOA upload, Dealertrack upload, run reconciliation, visible exceptions, and FP REC artifact download link all appear in order.

Code Areas Clean Enough For V1
Source-specific parser routing is explicit and testable in [sourceParserRouter.ts (line 27)](/home/trent/workspace/dealer-recon-clean/server/src/services/parsers/sourceParserRouter.ts:27).
BOA/Dealertrack preprocessing returns structured diagnostics and summaries, which is the right shape for review.
Reconciliation engine has meaningful invariant and taxonomy tests, including VIN6 amount mismatch behavior.
FP REC presenter is reasonably isolated when fed ReconciliationRunDetail, with fixture-backed tests around Hurst output sections.
Production config loading rejects missing CORS origins and default session secrets in [config.ts (line 15)](/home/trent/workspace/dealer-recon-clean/server/src/config.ts:15).
Areas Needing More Tests Before Review
Stored FP REC parity with reviewed ReconciliationRunDetail.
Duplicate upload reprocessing when parser/preprocessing versions change.
Same-store, same-month source-file pairing.
Malformed SpreadsheetML limits.
Frontend four-step workflow and error states.
Removed-row audit rendering.
Stored artifact overwrite/version behavior.
Error envelope compatibility between backend and frontend.
Refactors To Avoid Until After V1
Full rewrite of parsers into a generic spreadsheet framework.
General multi-store workflow architecture.
Full dashboard analytics redesign.
Native .xlsx implementation unless it directly blocks Hurst FP REC pilot files.
Replacing all frontend state management; targeted extraction around v1 workflow is enough.
Documentation Updates Required Because Of Code Reality
Document that code currently includes Acura/FW store configs and automation/analytics routes, even though v1 is Hurst-only.
Document current accepted upload behavior, including .xlsx rejection and legacy CSV fallback.
Document that accounting month is inferred today, not explicitly enforced.
Document duplicate upload reuse and the current health gate.
Document artifact overwrite behavior until immutable/versioned artifacts are implemented.
Prioritized Remediation Plan
P0: Generate stored FP REC from reviewed reconciliation detail only.
P1: Add explicit accounting month and enforce file pairing.
P1: Version duplicate upload parsing/preprocessing and reprocess stale duplicates.
P1: Decouple v1 workflow UI from future analytics/automation calls.
P1: Make exception review and removed-row audit visible in the primary workflow.
P1: Add SpreadsheetML parser bounds.
P1: Normalize backend/frontend error handling.
P2: Lock v1 source types to BOA/Dealertrack.
P2: Add artifact hashes/versioning.
P2: Add frontend workflow regression tests.
