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
- Removed the recent upload history disclosure from the v1 operator workflow.
- Removed the automation/operational status disclosure from the v1 operator workflow.
- Moved stored artifact history, run summary metrics, exception breakdown, replay, VIN diagnostics, and match group details behind a collapsed secondary export/audit disclosure.
- Removed the advanced run-history panel and its non-visible View action from the primary workflow.
- Removed the rendered in-app exception review controls from the workflow:
  - review status filters and controls
  - reviewer assignment controls
  - review note controls
  - resolve/ignore actions
- Removed the rendered run trend analytics panel from the workflow.
- Updated the Accounts page so account selection has a persistent selected state instead of a transient View action.
- Converted the Accounts detail page to tabs for BOA, Dealertrack, and unresolved exceptions instead of stacking all detail tables in one scroll.
- Removed Related runs from the Accounts detail page.
- Hid the Month-end Generate report and CSV controls from users without platform admin access, and shows the blocked access state before any click.

## PR #25 Smoke-Test Follow-Up

Human smoke testing on Thursday, June 18, 2026 found additional v1 cleanup needed before PR #25 can merge:

- Secondary automation/operational status and secondary input history still added noise to the workflow.
- Advanced run history and Accounts View actions could load and then return to their default labels without a visible output.
- Accounts detail content rendered BOA, Dealertrack, unresolved exceptions, and related runs as one long scroll.
- Month-end report generation showed an authorization error only after a non-platform user clicked the primary action.

Follow-up changes remove those noisy or broken surfaces, keep account detail focused to BOA/Dealertrack/unresolved exception tabs, and make the month-end blocked state explicit before click.

## Behavior Boundary

This cleanup is frontend workflow presentation only.

No reconciliation behavior changed. No export behavior changed. No parser, preprocessor, matching, artifact-generation, or backend API behavior changed.

## Deferred

- Backend endpoints and types for exception review remain in the codebase for compatibility and can be evaluated separately.
- Secondary artifact, replay, diagnostic, and match-detail surfaces remain available behind the collapsed export/audit disclosure.
- Full removal of unused legacy UI components remains a separate cleanup decision.
- Broader product decisions such as artifact retention, artifact integrity, deployment posture, and Batch 4 scope remain outside this cleanup.

## Validation

- `cd frontend && npm test -- --run`: passed, 6 tests passed. npm emitted the existing warning about forwarded `--run`.
- `cd frontend && npm run build`: passed.
- `git diff --check`: passed, with Windows LF-to-CRLF working-copy warnings only.
