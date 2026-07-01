# Documentation Audit

Status: current audit, 2026-06-15.

Scope: authored markdown in this repository, excluding dependency `node_modules` documentation. Ignored local files under `analysis/` are included because they exist in the working tree, but they are not product docs.

## Canonical Product Truth

Dealer-Recon v1 is a single-store Hurst Mazda FP REC pilot. It supports the clerk's monthly workflow:

1. Upload BOA and Dealertrack source files.
2. Clean and normalize inputs, including removed-row audit and VIN6 extraction.
3. Run reconciliation and review exceptions.
4. Generate and store the Hurst FP REC export.

The dashboard exists to guide that workflow. The output of record is the FP REC export. Multi-store support and broader accounting-platform expansion are future scope.

## Inventory

| Path | Classification | Notes |
| --- | --- | --- |
| `README.md` | Current | Rewritten around Hurst Mazda v1 and the FP REC output of record. |
| `PROJECT_BRIEF.md` | Current | Rewritten to separate current v1 from future dealer-group scope. |
| `analysis/README.md` | Current | Local-only data safety guidance; not a product doc. |
| `analysis/api-contracts-backend.md` | Archive candidate | Ignored local analysis output; do not treat as current API source. |
| `analysis/data-models-backend.md` | Archive candidate | Ignored local analysis output; may be stale against current schema. |
| `analysis/index.md` | Archive candidate | Ignored local analysis index; not current product framing. |
| `analysis/source-tree-analysis.md` | Archive candidate | Ignored local analysis output; useful only as historical scan. |
| `analysis/technology-stack.md` | Archive candidate | Ignored local analysis output; may drift from package files. |
| `analysis/ui-components-frontend.md` | Archive candidate | Ignored local analysis output; not v1 workflow guidance. |
| `docs/dealer_recon_ground_truth_reverse_engineering.md` | Current | Hurst FEB/MAR/APR evidence for matching, exceptions, totals, and FP REC shape. |
| `docs/demo/BOA-workflow.md` | Archive candidate | Raw manual-cleaning notes; useful evidence, not operator guidance. |
| `docs/demo/dealertrack-workflow.md` | Archive candidate | Raw manual-cleaning notes; useful evidence, not operator guidance. |
| `docs/demo/demo-dataset-checklist.md` | Stale | Broader Hiley demo checklist with Acura/FW assumptions; banner added. |
| `docs/demo/demo-observations.md` | Archive candidate | User-research template; includes stale dashboard/review surface prompts. |
| `docs/demo/fp-rec-export-verification.md` | Current | Hurst fixture/CLI verification support; not product source of truth. |
| `docs/demo/hiley-demo-notes.md` | Archive candidate | Raw notes naming dashboard metrics and reviewer workload as removable. |
| `docs/demo/hiley-demo-validation.md` | Stale | Broader Hiley multi-store demo guide; banner added. |
| `docs/demo/workflow-assumptions.md` | Needs revision | Broader Hiley assumptions; Hurst-only v1 assumptions should move into product/runbook docs as validated. |
| `docs/error-handling-improvements.md` | Duplicate | Historical implementation overview; overlaps `server/src/errors/README.md`. |
| `docs/error-handling-migration-complete.md` | Archive candidate | Historical migration completion note. |
| `docs/error-handling-migration-remaining.md` | Needs revision | May still contain useful backend cleanup tasks but is not tied to v1 FP REC risk. |
| `docs/implementation/documentation-audit.md` | Current | This audit. |
| `docs/implementation/exception-taxonomy.md` | Current | New code-review guide for match and exception behavior. |
| `docs/implementation/fp-rec-output-fidelity.md` | Current | Hurst FP REC fidelity details; status note tightened. |
| `docs/implementation/hiley-four-step-workflow-gap-analysis.md` | Stale | Superseded Hiley/multi-store framing; banner added. |
| `docs/implementation/reconciliation-artifacts.md` | Current | New artifact persistence and review-risk guide. |
| `docs/implementation/store-workflow-matrix.md` | Needs revision | Future-scope multi-store reference; Hurst row remains useful evidence. |
| `docs/operator/monthly-fp-rec-runbook.md` | Current | New Hurst monthly operator guide. |
| `docs/product/fp-rec-four-step-workflow.md` | Current | New canonical v1 workflow. |
| `docs/prds/prd-dealer-recon-clean-2026-06-03/.decision-log.md` | Archive candidate | Historical PRD decision log; superseded by Hurst FP REC v1 scope. |
| `docs/prds/prd-dealer-recon-clean-2026-06-03/prd.md` | Stale | Broad product PRD; do not use as current scope. |
| `sample-data/synthetic/README.md` | Current | Good committed-fixture safety policy. |
| `scripts/convert_xlsx_to_csv.md` | Current | Useful workaround while native `.xlsx` upload remains unsupported. |
| `server/src/errors/README.md` | Current | Current backend error-handling implementation guide. |

## Contradictions Found

- Several docs described a Hiley multi-store pilot with Hurst, Acura, and FW as current supported workflow. V1 is Hurst Mazda only.
- Older docs framed the product as a generic reconciliation dashboard, broader accounting automation platform, or dealer-group SaaS wedge. V1 is the Hurst FP REC workflow.
- Demo docs included dashboard analytics, match-rate movement, trend deltas, reviewer workload, and review status prompts. Those are not v1 outcomes.
- Some docs treated the merged floorplan as peer output. In v1 it is a supporting artifact; FP REC is the output of record.
- Store workflow docs claimed or implied future store behavior as active current behavior. Multi-store support is future scope.
- Historical PRD and project-brief material described bank/cash, OEM receivables, close automation, direct integrations, and generalized exception queues. Those are future discovery only.

## Changes Made In This Pass

- Rewrote `README.md`.
- Rewrote `PROJECT_BRIEF.md`.
- Created the canonical workflow doc under `docs/product/`.
- Created implementation docs for exception taxonomy and artifact persistence.
- Created the Hurst monthly operator runbook.
- Added or tightened stale/future-scope status notes on older Hiley, demo, and FP REC implementation docs.

## Missing Docs For Security And Code Review Readiness

These remain documentation risks:

| Missing or incomplete doc | Risk traced to |
| --- | --- |
| Upload threat model and accepted file-format contract | Upload and parsing |
| Parser invariants and removed-row audit contract | Parsing and normalization |
| Artifact retention, storage-location, encryption, and deletion policy | Artifact storage |
| Store/dealership access-control matrix | Artifact storage and downloads |
| Spreadsheet export injection and filename/header safety checklist | Export generation |
| Reconciliation invariant tests map | Reconciliation and exception review |
| Production data-handling policy for VINs, stock numbers, controls, amounts, and dates | Upload, artifacts, and exports |

The new [reconciliation-artifacts.md](reconciliation-artifacts.md) and [exception-taxonomy.md](exception-taxonomy.md) provide starting points, but they do not replace a full security review.

## Recommended Cleanup

1. Keep `README.md`, `PROJECT_BRIEF.md`, `docs/product/fp-rec-four-step-workflow.md`, `docs/operator/monthly-fp-rec-runbook.md`, `docs/implementation/exception-taxonomy.md`, and `docs/implementation/reconciliation-artifacts.md` as the current documentation spine.
2. Treat `docs/demo/*` as historical/demo support only. Do not link to those files as source of truth.
3. Move stale PRDs and broad Hiley multi-store docs to an archive folder after confirming no active issue links depend on their current paths.
4. Replace local ignored `analysis/*.md` files with generated reports only when needed; do not cite them in product docs.
