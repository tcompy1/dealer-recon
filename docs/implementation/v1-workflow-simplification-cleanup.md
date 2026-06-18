# v1 Workflow Simplification Cleanup

Date: Thursday, June 18, 2026.
Issue reference: #23.
Source audit: `docs/reviews/v1-ui-workflow-simplification-audit.md`.

## Summary

This cleanup implements the primary UI workflow findings from the v1 UI Workflow Simplification Audit. The application now presents the operator path as five explicit steps:

1. Select Store
2. Select Task
3. Upload Inputs
4. Run Workflow
5. Download Outputs

For v1, the selected task is Floorplan Reconciliation. The FP REC export remains the final workpaper and the surface used for exception review outside the app.

## What Changed

- Reworked the primary workflow intro from a four-step upload/run/download sequence to the canonical five-step workflow.
- Split store and task into prominent primary sections:
  - Step 1: Select Store
  - Step 2: Select Task
- Grouped BOA and Dealertrack file controls under Step 3: Upload Inputs.
- Renamed the run action area to Step 4: Run Workflow.
- Renamed the result area to Step 5: Download Outputs.
- Kept the required primary controls prominent:
  - store selection
  - Floorplan Reconciliation task framing
  - BOA upload
  - Dealertrack upload
  - upload validation feedback
  - run workflow button
  - running status
  - merged export download
  - FP REC download
- Moved recent upload history behind a collapsed secondary input-history disclosure.
- Moved automation/operational status behind a collapsed secondary disclosure.
- Moved stored artifact history, run summary metrics, exception breakdown, replay, VIN diagnostics, and match group details behind a collapsed secondary export/audit disclosure.
- Kept run history behind a collapsed advanced run-history disclosure.
- Removed the rendered in-app exception review controls from the workflow:
  - review status filters and controls
  - reviewer assignment controls
  - review note controls
  - resolve/ignore actions
- Removed the rendered run trend analytics panel from the workflow.

## Behavior Boundary

This cleanup is frontend workflow presentation only.

No reconciliation behavior changed. No export behavior changed. No parser, preprocessor, matching, artifact-generation, or backend API behavior changed.

## Deferred

- Backend endpoints and types for exception review remain in the codebase for compatibility and can be evaluated separately.
- Secondary automation, artifact, replay, diagnostic, and run-history surfaces remain available behind collapsed disclosures.
- Full removal of unused legacy UI components remains a separate cleanup decision.
- Broader product decisions such as artifact retention, artifact integrity, deployment posture, and Batch 4 scope remain outside this cleanup.
