# v1 UI Workflow Simplification Audit

Date: Thursday, June 18, 2026.
Issue: #23.
Audit branch: `codex/issue-23-ui-workflow-audit`.
Audited base branch: `integration-cleanup-2026-06-10`.
Audited base commit: `ea6fb7e22a34da90793fa06023a118397d388d55`.

## Scope

This audit reviews the visible v1 UI workflow for the Dealer-Recon single-store Hurst Mazda FP REC pilot. It is documentation-only. It does not add features, change reconciliation behavior, change export behavior, introduce Batch 4 scope, or change the application runtime.

The audit focus is the operator-facing path for generating the v1 floorplan reconciliation outputs. The primary workflow should be short, explicit, and limited to the work needed to select the store and task, upload inputs, run reconciliation, and download outputs.

## Canonical v1 Workflow

The primary v1 workflow should be presented as exactly five steps:

1. Select Store
2. Select Task
3. Upload Inputs
4. Run Workflow
5. Download Outputs

For v1, the selected task is floorplan reconciliation for the chosen store and month. The app's responsibility is to generate the workpaper/supporting exports, especially the FP REC export. Exception review happens outside the app through the generated FP REC export.

## Product Boundary

Dealer-Recon v1 should keep the primary app workflow focused on output generation:

- The app should select the store and task.
- The app should accept BOA and Dealertrack inputs.
- The app should run the reconciliation workflow.
- The app should generate and expose the merged floorplan export and FP REC export.
- The FP REC export is the review surface for exceptions.

Dealer-Recon v1 should not make in-app exception handling part of the primary workflow:

- No primary in-app exception resolution workflow.
- No primary in-app reviewer assignment workflow.
- No primary in-app review notes workflow.
- No primary analytics, KPIs, trend charts, run history, or artifact history workflow.

Any secondary diagnostics or evidence views should support export generation and auditability only. They should not compete with the five-step operator path.

## Classification Key

| Classification | Meaning |
| --- | --- |
| Required | Needed for the five-step v1 workflow or for blocking validation required to complete it. |
| Secondary / Export-Only | Useful as evidence, diagnostics, audit support, administration, or downloadable support material, but not part of the primary operator path. |
| Noise / Remove From Primary Workflow | Distracts from the five-step flow, implies unsupported in-app review/management behavior, or belongs outside the v1 primary workflow. |

## Visible UI Area Classification

| Visible UI Area | Current Surface | Classification | Audit Finding |
| --- | --- | --- | --- |
| Session check | `frontend/src/App.tsx` | Required | The loading state protects authenticated access before the workflow is shown. Keep it outside the five-step language. |
| Login form | `frontend/src/pages/LoginPage.tsx` | Required | Authentication is required support for the app, but it is not one of the five workflow steps. |
| Reconciliation navigation tab | `frontend/src/App.tsx` | Required | This is the closest current surface to Select Task. It should map to Step 2: Select Task and identify the v1 floorplan reconciliation task. |
| Advanced tools disclosure | `frontend/src/App.tsx` | Secondary / Export-Only | Accounts and month-end reports should remain outside the primary workflow. Keeping them behind advanced navigation is directionally correct. |
| Signed-in user and logout controls | `frontend/src/App.tsx` | Secondary / Export-Only | Useful account context and access control, but not part of the workflow. Keep compact. |
| Dashboard heading and intro copy | `frontend/src/pages/DashboardPage.tsx` | Required | The page correctly frames the store/month floorplan task. The step language should align to the canonical five-step workflow. |
| Pilot workflow intro | `frontend/src/components/WorkflowDashboard.tsx` | Required | Currently presents four steps: upload BOA, upload Dealertrack, run/process, download artifacts. It should be rewritten in follow-up work to show the five required steps explicitly. |
| Store selector | `frontend/src/components/WorkflowDashboard.tsx` | Required | This is Step 1: Select Store. It should remain prominent and early. |
| Add/create store controls | `frontend/src/components/WorkflowDashboard.tsx` | Secondary / Export-Only | Store administration supports setup, but it is not part of the daily primary workflow. Keep it secondary or collapsed. |
| Advanced store analytics | `frontend/src/components/WorkflowDashboard.tsx` | Noise / Remove From Primary Workflow | Store run counts, unresolved counts, and recurring exception metrics distract from Select Store. Remove from the primary workflow. |
| Advanced automation and operational status disclosure | `frontend/src/components/WorkflowDashboard.tsx` | Secondary / Export-Only | Scheduled jobs, store automation status, recent ingestion events, and operational alerts are operational/admin surfaces. Keep out of the primary path. |
| Automation KPI tiles | `frontend/src/components/WorkflowDashboard.tsx` | Noise / Remove From Primary Workflow | Scheduled-job counts, average completion, and auto reconciliation percentages are not needed to run the v1 five-step flow. |
| BOA upload panel | `frontend/src/components/WorkflowDashboard.tsx` | Required | Required input for Step 3: Upload Inputs. The label should be grouped under Upload Inputs rather than presented as Step 1. |
| Dealertrack upload panel | `frontend/src/components/WorkflowDashboard.tsx` | Required | Required input for Step 3: Upload Inputs. The label should be grouped under Upload Inputs rather than presented as Step 2. |
| Upload validation errors | `frontend/src/components/WorkflowDashboard.tsx` | Required | Blocking upload feedback is needed so the operator can complete the workflow. |
| Upload receipts | `frontend/src/components/WorkflowDashboard.tsx` | Required | Immediate confirmation that the expected file, store, and row counts were accepted helps prevent running on the wrong inputs. Detailed metadata should stay compact. |
| Preprocessing diagnostics | `frontend/src/components/preprocessing/PreprocessingDiagnosticsPanel.tsx` | Secondary / Export-Only | Diagnostics can support auditability and troubleshooting. Keep detailed diagnostics collapsed and out of the primary happy path. |
| Manual VIN enrichment modal | `frontend/src/components/preprocessing/VinEnrichmentModal.tsx` | Required | Conditional required flow when VIN enrichment blocks input readiness. This is source-file repair before reconciliation, not exception review. |
| VIN-repaired stale-run banner | `frontend/src/components/WorkflowDashboard.tsx` | Required | The operator needs this blocking cue to rerun reconciliation after source repair. |
| Recent uploads table | `frontend/src/components/WorkflowDashboard.tsx` | Secondary / Export-Only | Historical input records support auditability, but source-file history should not sit in the primary workflow. |
| Run/process reconciliation button | `frontend/src/components/WorkflowDashboard.tsx` | Required | This is Step 4: Run Workflow. The label should use the canonical step language. |
| Running status banner | `frontend/src/components/WorkflowDashboard.tsx` | Required | The operator needs transient feedback while the workflow is running. |
| Merged spreadsheet download | `frontend/src/components/WorkflowDashboard.tsx` | Required | Primary output for Step 5: Download Outputs. |
| FP REC download | `frontend/src/components/WorkflowDashboard.tsx` | Required | Primary output for Step 5: Download Outputs and the review surface for exception review outside the app. |
| Stored artifacts panel | `frontend/src/components/WorkflowDashboard.tsx` | Secondary / Export-Only | Full raw, cleaned, merged, and FP REC artifact history supports evidence and export recovery. It should not compete with the two primary download outputs. |
| Result metric tiles | `frontend/src/components/WorkflowDashboard.tsx` | Secondary / Export-Only | Counts for clean matches, unmatched items, duplicates, and run ID can confirm output generation, but they are not a primary workflow step. |
| Advanced review, analytics, and audit disclosure | `frontend/src/components/WorkflowDashboard.tsx` | Noise / Remove From Primary Workflow | The combined advanced area introduces review and analytics concepts that conflict with the simplified v1 operator path. |
| Exception breakdown | `frontend/src/components/WorkflowDashboard.tsx` | Secondary / Export-Only | Category counts can support FP REC evidence, but exception review should occur in the FP REC export, not in the app. |
| Run trend analytics | `frontend/src/components/WorkflowDashboard.tsx` | Noise / Remove From Primary Workflow | Trends, new exception counts, and category history are KPI/analytics scope and should be removed from the primary workflow. |
| Historical replay panel | `frontend/src/components/WorkflowDashboard.tsx` | Secondary / Export-Only | Replay/version evidence may support audit needs, but it is not part of the v1 five-step workflow. |
| VIN presence diagnostics | `frontend/src/components/VinPresenceDiagnosticsPanel.tsx` | Secondary / Export-Only | Helpful diagnostic evidence when troubleshooting, but not a primary operator step unless a blocking validation state requires it. |
| Match groups table | `frontend/src/components/WorkflowDashboard.tsx` | Secondary / Export-Only | Detailed match evidence belongs in audit/export support, not in the primary workflow. |
| Exceptions table filters | `frontend/src/components/WorkflowDashboard.tsx` | Noise / Remove From Primary Workflow | Source, type, status, review, assignment, and search filters imply in-app exception triage. Exception review belongs outside the app through FP REC. |
| Exception review status controls | `frontend/src/components/WorkflowDashboard.tsx` | Noise / Remove From Primary Workflow | In-app review status is outside the v1 product boundary. Remove from the primary workflow. |
| Exception reviewer assignment controls | `frontend/src/components/WorkflowDashboard.tsx` | Noise / Remove From Primary Workflow | Reviewer assignment is outside the v1 product boundary. Remove from the primary workflow. |
| Exception note controls | `frontend/src/components/WorkflowDashboard.tsx` | Noise / Remove From Primary Workflow | Review notes are outside the v1 product boundary. Remove from the primary workflow. |
| Resolve/ignore exception actions | `frontend/src/components/WorkflowDashboard.tsx` | Noise / Remove From Primary Workflow | In-app exception resolution conflicts with the FP REC export review boundary. Remove from the primary workflow. |
| Export unmatched items CSV | `frontend/src/components/WorkflowDashboard.tsx` | Secondary / Export-Only | A supporting export can remain secondary, but FP REC should be the output of record for exception review. |
| Advanced run history | `frontend/src/components/WorkflowDashboard.tsx` | Secondary / Export-Only | Run history supports auditability and troubleshooting, but it should stay outside the primary workflow. |
| Accounts page | `frontend/src/pages/AccountsPage.tsx` | Secondary / Export-Only | Account close support is useful secondary reporting, not part of the v1 floorplan reconciliation workflow. |
| Month-end reports page | `frontend/src/pages/ReportsPage.tsx` | Secondary / Export-Only | Month-end report generation and CSV download are secondary/export surfaces, not part of the primary FP REC workflow. |

## Non-Visible Legacy or Support Surfaces

These components exist in the frontend source but were not found mounted in the visible app path during this audit:

| Source Area | Classification If Surfaced | Audit Finding |
| --- | --- | --- |
| `frontend/src/components/FileUploader.tsx` | Noise / Remove From Primary Workflow | Legacy generic upload concepts include broader source types than the v1 BOA/Dealertrack path. Do not reintroduce into the primary workflow. |
| `frontend/src/components/ReconciliationSummary.tsx` | Noise / Remove From Primary Workflow | Legacy standalone reconciliation summary duplicates and broadens the current app workflow. Do not reintroduce into the primary workflow. |
| `frontend/src/components/preprocessing/RemovedRowsAuditPanel.tsx` | Secondary / Export-Only | Removed-row audit evidence can support export/audit review if needed, but it should remain outside the primary five-step path. |

## Recommended Primary Workflow Shape

The primary screen should be organized around this operator path:

| Step | Required UI | Notes |
| --- | --- | --- |
| 1. Select Store | Store selector | Store creation and store analytics should be secondary. |
| 2. Select Task | Floorplan reconciliation task selector or task label | Accounts and month-end reports should remain advanced/export-only tools. |
| 3. Upload Inputs | BOA upload, Dealertrack upload, blocking validation feedback | Upload receipts and required VIN repair can remain in-line; detailed diagnostics should be collapsed. |
| 4. Run Workflow | Run Workflow button and running status | Avoid analytics/KPI panels around the run action. |
| 5. Download Outputs | Download Merged Spreadsheet and Download FP REC | FP REC is the review surface for exceptions outside the app. |

## Follow-Up Cleanup Recommendations

These recommendations are intentionally limited to v1 UI simplification and should be handled separately from this documentation-only audit:

- Rewrite primary step labels to the canonical five-step workflow.
- Keep BOA and Dealertrack upload controls grouped under Step 3: Upload Inputs.
- Move recent uploads, stored artifact history, run history, and detailed diagnostics into secondary/export-only surfaces.
- Remove primary analytics and trend panels from the operator path.
- Remove in-app exception review, assignment, note, resolve, and ignore controls from the primary workflow.
- Preserve FP REC as the output of record for exception review outside the app.
- Confirm unused legacy components remain unmounted or retire them in a separate cleanup.

## Validation Notes

This audit is documentation-only. No application code, reconciliation behavior, or export behavior was changed.

Because no Markdown links were added, Markdown link validation is not applicable. The required control-character scan and whitespace validation should pass before opening the PR.
