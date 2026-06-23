# V1 Launch Decision Matrix

Status: owner-decision matrix for Dealer-Recon v1 pilot launch.
Date: 2026-06-23.
Issue: #17.

## Purpose

This matrix converts documented v1 risks into explicit owner decisions for the single-store Hurst Mazda FP REC pilot.

Dealer-Recon v1 supports the clerk's monthly workflow from BOA and Dealertrack source files to the stored Hurst FP REC export. The FP REC export is the output of record. This document does not introduce new functionality, change reconciliation behavior, or add Batch 4 scope.

## Decision Matrix

| Decision required | Current state | Risk if deferred | Recommendation | Owner decision | Decision date |
| --- | --- | --- | --- | --- | --- |
| Artifact retention policy | Raw uploads, cleaned CSVs, merged floorplan artifacts, and FP REC artifacts are stored in PostgreSQL. No formal retention or deletion schedule is enforced by the app. | Artifacts may be retained too long, removed too early, or deleted without clear authority. Backup retention may not match business/audit needs. | Before pilot, owner should choose retention period, deletion authority, and backup retention. For the private pilot, retain all artifacts through the pilot and at least one subsequent close cycle unless legal/accounting policy requires longer. | Pending | Pending |
| Artifact integrity policy | Stored artifacts are persisted as database records. No artifact hash ledger, version label, or immutability lock is implemented. | Reviewers may have less evidence that downloaded artifacts are unchanged over time. Later disputes may require database backup comparison instead of first-class artifact integrity metadata. | For the single-store pilot, accept database persistence plus backup/restore validation if owner agrees. Before broader rollout, require artifact hash/version tracking and immutability requirements. | Pending | Pending |
| Accounting month boundary policy | One run represents one Hurst Mazda accounting month by operator practice. The application does not enforce selected-file month boundaries. | Clerk may accidentally reconcile BOA and Dealertrack files from different periods unless caught by monthly close review. | For the pilot, use an operator-controlled process and require close-packet review of selected files before treating FP REC as final. Before broader rollout, enforce accounting month as an application rule. | Pending | Pending |
| Upload security policy | Uploads are size-limited, format-limited, parser-routed, and authenticated. Malware scanning is not implemented in the app. | A malicious or compromised source file could reach storage or downstream operator tools even if parser behavior is constrained. | For the private pilot, accept trusted-source uploads only if access is restricted and owners approve the risk. Before broader rollout or less trusted upload paths, require malware scanning or equivalent infrastructure control. | Pending | Pending |
| CSRF posture | Sessions use HTTP-only same-site cookies, production secure cookies, and explicit CORS origins. No explicit CSRF token is implemented. | Same-site cookie posture may be insufficient if the app is exposed beyond a controlled same-site environment. | For the private pilot, accept current posture only with same-origin or tightly controlled origins over HTTPS. Before broader rollout, require explicit CSRF protection for authenticated write actions. | Pending | Pending |
| Rate limiting | Login has in-process failed-attempt throttling. Upload, reconcile, export, and download routes rely on controlled network access or infrastructure controls. | Upload parsing, reconciliation work, and downloads could be abused if exposed to untrusted networks. | For the pilot, allow only controlled network access or confirm infrastructure rate controls. Before broader rollout, require application or infrastructure rate limiting with evidence. | Pending | Pending |
| Infrastructure readiness | Deployment readiness docs identify TLS, secret management, backups, restore testing, production user provisioning, CORS, and environment requirements. These are not verified by repository tests. | Real Hurst data could be uploaded into an environment without adequate transport security, secret handling, backup/restore, or user access controls. | Must be complete before pilot. No owner risk acceptance should bypass TLS, production secrets, real user provisioning, backup strategy, and restore test evidence. | Pending | Pending |

## Decision Sources

- [v1-risk-register.md](v1-risk-register.md) documents accepted and deferred risks.
- [v1-security-review.md](v1-security-review.md) documents security posture and residual risks.
- [v1-code-review.md](v1-code-review.md) documents code review posture and deferred engineering work.
- [../operator/v1-deployment-readiness.md](../operator/v1-deployment-readiness.md) documents deployment readiness checks.
- [v1-launch-gate-checklist.md](v1-launch-gate-checklist.md) separates must-complete launch gates from accepted pilot risk and post-pilot work.
- [v1-pilot-recommendation-summary.md](v1-pilot-recommendation-summary.md) summarizes the recommended go/no-go position.

## Owner Signoff

Pilot launch should not proceed until every row has an owner decision and decision date. A decision may be Accept for pilot, Require before pilot, or Defer until post-pilot, but it must be explicit.
