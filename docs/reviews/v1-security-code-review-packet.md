# Dealer-Recon V1 Security And Code Review Packet

Status: review-ready packet for the single-store Hurst Mazda FP REC pilot.
Date: 2026-06-23.

## Purpose

This packet gives security reviewers, code reviewers, deployment reviewers, and Hurst stakeholders one current entry point for Dealer-Recon v1 review.

Dealer-Recon v1 is a single-store Hurst Mazda FP REC pilot. The product supports the clerk's monthly four-step workflow from BOA and Dealertrack source files to the final Hurst FP REC export. The FP REC export is the output of record. The dashboard guides the workflow; it is not the product goal.

Canonical workflow:

1. Upload BOA and Dealertrack source files.
2. Clean and normalize inputs, including removed-row audit and VIN6 extraction.
3. Run reconciliation and review exceptions.
4. Generate and store the Hurst FP REC export.

The canonical workflow is documented in [../product/fp-rec-four-step-workflow.md](../product/fp-rec-four-step-workflow.md).

## Packet Contents

| Document | Review use |
| --- | --- |
| [Security Review Packet](v1-security-review.md) | Architecture, trust boundaries, upload/data-flow risks, auth, authorization, artifact storage, sensitive data, security assumptions, and known limitations. |
| [Code Review Packet](v1-code-review.md) | Repository structure, service responsibilities, reconciliation/export/artifact workflows, test strategy, technical debt, and deferred work. |
| [Deployment Readiness Checklist](../operator/v1-deployment-readiness.md) | Environment variables, migrations, backup/recovery, deployment checks, rollback checks, and production-default warnings. |
| [Risk Register](v1-risk-register.md) | Known limitations and owner decisions required before or after v1 pilot deployment. |
| [Validation Evidence](v1-validation-evidence-2026-06-17.md) | Current validation commands and green-state evidence for the review packet. |
| [Launch Decision Matrix](v1-launch-decision-matrix.md) | Owner decisions required before the single-store pilot can proceed. |
| [Launch Gate Checklist](v1-launch-gate-checklist.md) | Must-complete gates, accepted pilot risks, post-pilot deferrals, and no-go conditions. |
| [Pilot Recommendation Summary](v1-pilot-recommendation-summary.md) | Conditional go/no-go recommendation for the private Hurst pilot and broader-rollout guidance. |
| [Issue #32 Remediation](v1-security-remediation-issue-32.md) | Minimal security fixes completed after the audit: login throttling, artifact download audit logging, query logging cleanup, and dependency-audit status. |

## Issue #15 Closeout Coverage

| Issue #15 requirement | Current packet location |
| --- | --- |
| System architecture overview | [Security Review Packet](v1-security-review.md#architecture-summary) and [Code Review Packet](v1-code-review.md#repository-map). |
| Upload-to-artifact data flow | [Security Review Packet](v1-security-review.md#data-flow-from-upload-to-artifact-generation). |
| Authentication model | [Security Review Packet](v1-security-review.md#authentication-model). |
| Authorization/store-access model | [Security Review Packet](v1-security-review.md#authorization-and-store-access-model). |
| Artifact storage model | [Security Review Packet](v1-security-review.md#artifact-storage-and-downloads) and [Reconciliation Artifacts](../implementation/reconciliation-artifacts.md). |
| Sensitive data handling | [Security Review Packet](v1-security-review.md#sensitive-data-inventory). |
| Security assumptions and limitations | [Security Review Packet](v1-security-review.md#residual-security-risks), [Risk Register](v1-risk-register.md), and [Issue #32 Remediation](v1-security-remediation-issue-32.md). |
| Repository structure and services | [Code Review Packet](v1-code-review.md#repository-map). |
| Reconciliation workflow | [Code Review Packet](v1-code-review.md#reconciliation-invariants) and [Exception Taxonomy](../implementation/exception-taxonomy.md). |
| Export generation workflow | [Code Review Packet](v1-code-review.md#artifact-persistence-and-export-behavior). |
| Historical artifact workflow | [Reconciliation Artifacts](../implementation/reconciliation-artifacts.md) and [Code Review Packet](v1-code-review.md#artifact-persistence-and-export-behavior). |
| Test strategy | [Code Review Packet](v1-code-review.md#tests-clean-enough-for-v1) and [Validation Evidence](v1-validation-evidence-2026-06-17.md). |
| Deployment prerequisites, environment, migrations, backups, checklist, rollback | [Deployment Readiness Checklist](../operator/v1-deployment-readiness.md). |
| Known technical debt and deferred work | [Risk Register](v1-risk-register.md), [Launch Gate Checklist](v1-launch-gate-checklist.md), and [Code Review Packet](v1-code-review.md#areas-needing-more-tests-before-broader-launch). |
| Validation evidence | [Validation Evidence](v1-validation-evidence-2026-06-17.md). |

## Source-Of-Truth Map

Use these documents as the current v1 source of truth:

- [../../README.md](../../README.md) for the product summary and local development entry point.
- [../../PROJECT_BRIEF.md](../../PROJECT_BRIEF.md) for v1 scope and future scope separation.
- [../product/fp-rec-four-step-workflow.md](../product/fp-rec-four-step-workflow.md) for the canonical four-step workflow.
- [../operator/monthly-fp-rec-runbook.md](../operator/monthly-fp-rec-runbook.md) for the monthly clerk runbook.
- [../implementation/exception-taxonomy.md](../implementation/exception-taxonomy.md) for reconciliation outcomes and FP REC placement.
- [../implementation/reconciliation-artifacts.md](../implementation/reconciliation-artifacts.md) for artifact persistence and download behavior.

Historical demo, PRD, analysis, and broader Hiley/multi-store documents are not v1 source of truth unless explicitly cited by one of the current documents above.

## Current Review Position

Completed before this packet:

- Demo auth seeding moved out of production migrations and into explicit dev/test seed behavior.
- Auth fallback now fails closed outside explicit local dev/test opt-in.
- Dealertrack SpreadsheetML ss:Index expansion is capped.
- Spreadsheet formula-leading text is neutralized in reviewed CSV and HTML-as-XLS outputs.
- Stored merged and FP REC artifacts are generated from reviewed ReconciliationRunDetail.
- Store-scoped users are blocked from other-store and null-store sensitive records.
- Frontend API error handling surfaces backend { detail } and { error: { message } } messages.
- The unused legacy transaction-based merged export helper was removed.
- Issue #32 added in-process login throttling, route-pattern request logging, artifact download audit events for stored and generated downloads, and non-breaking dependency remediation.

Remaining limitations are documented in the [Risk Register](v1-risk-register.md). The most important deferred items are explicit accounting-month enforcement, parser/preprocessor versioning for duplicate reuse, artifact hash/version/retention policy, and broader v1 UI workflow cleanup.

## Scope Guard

This packet does not introduce new functionality, does not change reconciliation behavior, and does not move Batch 4 or later items into v1 scope. It documents the current implementation and the review risks that remain.
