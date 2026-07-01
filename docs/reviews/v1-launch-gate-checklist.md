# V1 Launch Gate Checklist

Status: launch gate checklist for Dealer-Recon v1 pilot decision.
Date: 2026-06-23.
Issue: #17.

## Purpose

This checklist separates work that must be complete before the single-store Hurst Mazda FP REC pilot from risk that can be explicitly accepted for the pilot and work that should remain post-pilot.

It is a deployment-readiness decision package only. It does not implement new functionality, change application behavior, or introduce Batch 4 scope.

## Must Be Complete Before Pilot

| Gate | Required evidence | Status |
| --- | --- | --- |
| Launch decision matrix signed | Every row in [v1-launch-decision-matrix.md](v1-launch-decision-matrix.md) has owner decision and decision date. | Pending |
| Production environment chosen | Hosting environment, network exposure, and access boundary are documented. | Pending |
| TLS enabled | Frontend and backend traffic use HTTPS/TLS in the pilot environment. | Pending |
| Secrets managed | SESSION_SECRET, DATABASE_URL, database credentials, and deployment secrets are stored outside source control and local defaults are not used. | Pending |
| CORS restricted | BACKEND_CORS_ORIGINS is set to explicit pilot frontend origin(s), not wildcard or unrelated local defaults. | Pending |
| Production users provisioned | Real pilot users exist, demo seed is not run, and Hurst store assignments are verified. | Pending |
| Store authorization smoke test passed | Store-scoped user can access Hurst data and cannot access other-store or null-store records. | Pending |
| Database backup configured | Automated backup exists before real source files are uploaded. | Pending |
| Restore test completed | Restore test into non-production proves stored FP REC artifact can be downloaded after restore. | Pending |
| Artifact retention decision recorded | Owner approves artifact retention period, deletion authority, and backup retention. | Pending |
| Artifact integrity decision recorded | Owner accepts current database persistence for pilot or requires hash/version/immutability before pilot. | Pending |
| Accounting month process recorded | Owner chooses operator-controlled process or application-enforced rule before pilot. | Pending |
| Upload security decision recorded | Owner accepts trusted-source/no-malware-scan pilot posture or requires scanning before pilot. | Pending |
| CSRF decision recorded | Owner accepts same-site session posture for pilot or requires explicit CSRF protection before pilot. | Pending |
| Rate limiting decision recorded | Owner confirms controlled environment or infrastructure/app rate controls before pilot. | Pending |
| Validation evidence current | [v1-validation-evidence-2026-06-17.md](v1-validation-evidence-2026-06-17.md) is current or equivalent validation is rerun. | Pending |
| Deployment smoke test passed | Health, readiness, login, upload, reconcile, artifact list, and stored FP REC download are verified with non-sensitive test files. | Pending |
| Go/no-go owner signoff | Owner signs Go or No-Go after reviewing open accepted risks. | Pending |

## Can Be Accepted As Pilot Risk

These items can be accepted for the private single-store pilot only if the owner records that decision in the launch matrix:

- No artifact hash ledger, artifact version label, or immutability lock.
- No application-enforced accounting month boundary.
- No app-level malware scanning for trusted BOA and Dealertrack source files.
- No explicit CSRF token when deployed same-site with restricted CORS and HTTPS.
- No app-level upload/reconcile/download rate limiting when pilot access is controlled by network or infrastructure.
- Duplicate upload reuse without parser/preprocessor version identity.
- Frontend workflow cleanup deferred while the dashboard still guides the four-step workflow.
- Native XLSX upload remains unsupported for v1.

## Deferred Until Post-Pilot

These should not be implemented under Issue #17 unless the owner changes launch criteria in a separate issue:

- Artifact retention automation.
- Artifact hash/version tracking.
- Artifact immutability controls.
- Application-enforced accounting month boundary.
- Parser/preprocessor versioning for duplicate upload reuse.
- Broader frontend workflow cleanup.
- Explicit CSRF tokens if not required for the private pilot.
- Broader application-level rate limiting if controlled environment is accepted for pilot.
- Multi-store production readiness.
- Direct BOA, Dealertrack, GL, OEM, or accounting-platform integrations.
- Analytics, dashboard metrics, trend deltas, or reviewer workload reporting.
- Batch 4 or later scope.

## No-Go Conditions

Pilot launch should be No-Go if any of the following are true:

- Required owner decisions remain blank.
- TLS, production secrets, CORS, or real user provisioning is incomplete.
- Backups are not configured before real Hurst data is uploaded.
- Restore test cannot recover and download a stored FP REC artifact.
- Store-scoped authorization smoke test fails.
- Stored FP REC artifact cannot be downloaded after reconciliation.
- The expected BOA or Dealertrack source-file format changes before pilot and is not validated.
- Public or untrusted-network exposure is planned without upload, CSRF, and rate-limit controls approved by the owner.
