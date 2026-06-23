# V1 Risk Register And Known Limitations

Status: review packet risk register for Dealer-Recon v1.
Date: 2026-06-23.

## Scope

This register documents known security, code quality, operational, and product limitations for the Dealer-Recon v1 Hurst Mazda FP REC pilot.

It does not authorize new v1 scope. Multi-store expansion, direct integrations, analytics, parser versioning, artifact retention automation, and accounting-platform expansion remain future work unless explicitly approved later.

## Risk Summary

| ID | Risk | Status | Severity | Owner decision needed |
| --- | --- | --- | --- | --- |
| R1 | Artifact retention, hash, version, and immutability policy is documented but not implemented | Accepted for v1 review | Medium | Yes |
| R2 | Accounting month boundary is not enforced as an invariant | Accepted for v1 review | Medium | Yes |
| R3 | Duplicate upload reuse does not include parser or preprocessor version identity | Deferred Batch 3 | Medium | Yes |
| R4 | No malware or antivirus scanning for uploaded files | Accepted for private pilot only | Medium | Yes |
| R5 | No explicit CSRF token beyond same-site session-cookie posture | Accepted for private pilot review | Medium | Yes |
| R6 | Login has in-process throttling; upload/reconcile/download throttling is still controlled by deployment posture | Accepted for controlled environment only | Medium | Yes |
| R7 | Review packet assumes secure infrastructure for TLS, logging, backups, and secret management | Deployment dependency | Medium | Yes |
| R8 | Some non-v1 routes and data models exist for future reporting or store concepts | Scope guard required | Low | No new v1 behavior |
| R9 | Frontend workflow cleanup remains deferred | Deferred Batch 3 | Low | No |
| R10 | Native XLSX is detected but not supported as an accepted v1 input | Product limitation | Low | Only if input contract changes |

## Accepted Or Deferred Risks

### R1. Artifact Retention, Hash, Version, And Immutability Policy

Status: Accepted for v1 review.
Severity: Medium.
Affected areas: reconciliation_artifacts table, artifact download routes, deployment operations.

Current state:

- FP REC, merged floorplan, cleaned CSV, and raw upload artifacts are persisted in PostgreSQL.
- The stored FP REC artifact is the v1 output of record.
- The application does not yet enforce a formal retention schedule, content hash ledger, artifact version metadata, or immutable artifact lock.

Why it matters:

The pilot can preserve and retrieve generated artifacts, but auditors and operators do not yet have a first-class integrity and retention control for long-term evidence handling.

Required owner decision:

Define retention period, deletion authority, backup retention, and whether a content hash/version ledger is required before or after pilot launch.

Deferred implementation:

Do not implement as part of Issue #15. This remains Batch 3 or later unless the owner changes launch criteria.

### R2. Accounting Month Boundary

Status: Accepted for v1 review.
Severity: Medium.
Affected areas: upload selection, reconciliation run creation, export generation, operator workflow.

Current state:

- The clerk selects source files and runs reconciliation.
- The system stores upload timestamps and source metadata.
- The application does not currently enforce that selected BOA and Dealertrack files belong to a declared accounting month.

Why it matters:

A user can accidentally select files from the wrong close period unless the operator runbook and review process catch it.

Required owner decision:

Decide whether the private pilot can rely on operator review, or whether month-boundary enforcement must become pre-launch work.

Deferred implementation:

Do not implement as part of Issue #15. This is explicitly Batch 3 scope.

### R3. Duplicate Upload Parser And Preprocessor Versioning

Status: Deferred Batch 3.
Severity: Medium.
Affected areas: duplicate upload health gate, parser routing, cleaned artifact reuse.

Current state:

- Duplicate upload handling prevents unsafe reuse when previous processing is unhealthy.
- The reuse model does not include parser or preprocessing version identity.

Why it matters:

If parser behavior changes, a duplicate file may be associated with artifacts created by older parsing logic unless version-aware reuse is added.

Required owner decision:

Confirm whether parser/preprocessor versioning is required before real monthly close data is processed.

Deferred implementation:

Do not implement as part of Issue #15. This is explicitly Batch 3 scope.

### R4. Malware Or Antivirus Scanning

Status: Accepted for private pilot only.
Severity: Medium.
Affected areas: file upload route and operational infrastructure.

Current state:

- Uploads are limited by size, extension, MIME type, source type, and parser contracts.
- The application does not scan uploaded files with antivirus or content-disarm tooling.

Why it matters:

CSV, HTML, XML, and XLS-like files can still carry malicious payloads for downstream tools or operators even when parser handling is constrained.

Required owner decision:

Decide whether infrastructure-level scanning is required before production pilot launch.

Deferred implementation:

Safe to defer only for a private controlled pilot with trusted source files and restricted operator access.

### R5. CSRF Posture

Status: Accepted for private pilot review.
Severity: Medium.
Affected areas: session-authenticated write routes.

Current state:

- Session cookies are HTTP-only and same-site lax.
- Production cookies are secure when NODE_ENV is production.
- The application does not currently use explicit CSRF tokens.

Why it matters:

Same-site cookie posture reduces common cross-site risk, but explicit CSRF tokens would be stronger for authenticated write actions.

Required owner decision:

Decide whether explicit CSRF protection is required before exposing the app beyond a controlled private environment.

Deferred implementation:

Do not add as part of Issue #15 unless launch exposure changes.

### R6. Rate Limiting

Status: Accepted for controlled environment only.
Severity: Medium.
Affected areas: login, upload, reconcile, export routes.

Current state:

- Login has an in-process failed-attempt throttle: 5 failures per client/email key in 15 minutes.
- Successful login clears that client/email failure key.
- The throttle is intentionally local to one backend process and resets on restart.
- Upload, reconcile, export, and download routes do not have separate application-level throttles.
- Deployment infrastructure may provide broader request controls, but that is outside the repository.

Why it matters:

The highest-value brute-force login control exists for the single-store pilot, but upload/parser/reconciliation work can still be abused if the app is exposed to untrusted networks.

Required owner decision:

Confirm controlled network access or infrastructure throttling for upload/reconcile/download routes before production access.

Deferred implementation:

Do not add a broader rate-limit layer as part of Issue #15.

### R7. Infrastructure Security Dependencies

Status: Deployment dependency.
Severity: Medium.
Affected areas: production hosting, database, secrets, logs, backups.

Current state:

The repository documents application expectations, but production TLS, secret storage, database backup encryption, log access, and restore operations are infrastructure responsibilities.

Why it matters:

The app handles business-sensitive vehicle and accounting data. Secure infrastructure must exist before real Hurst data is uploaded.

Required owner decision:

Approve hosting environment, secret management, backup policy, and operator access model.

Deferred implementation:

Not repository code scope for Issue #15.

### R8. Future-Scope Data And Routes

Status: Scope guard required.
Severity: Low.
Affected areas: store/dealership model, reporting surfaces, operational events.

Current state:

The codebase contains structures that can support broader dealership and reporting concepts, but v1 behavior is constrained to the Hurst Mazda FP REC pilot.

Why it matters:

Reviewers may mistake future-capable scaffolding for current product scope.

Required owner decision:

None. Product docs must continue to frame current behavior as single-store v1.

Deferred implementation:

No new multi-store behavior should be introduced under Issue #15.

### R9. Frontend Workflow Cleanup

Status: Deferred Batch 3.
Severity: Low.
Affected areas: dashboard and workflow screens.

Current state:

The dashboard guides the workflow, but additional UI cleanup remains deferred from Batch 3.

Why it matters:

The product goal is clear, but operator ergonomics can still improve after v1 review.

Required owner decision:

None for security/code review readiness unless reviewer feedback makes it blocking.

Deferred implementation:

Do not implement as part of Issue #15.

### R10. Native XLSX Input

Status: Product limitation.
Severity: Low.
Affected areas: accepted file-format contract and upload parser.

Current state:

The system supports the v1 BOA and Dealertrack source formats expected for the pilot. Native XLSX is not a current accepted source format.

Why it matters:

Operators must provide the expected CSV, HTML, XML, or XLS-like SpreadsheetML sources rather than modern native XLSX workbooks.

Required owner decision:

Only needed if Hurst source-file exports change before pilot launch.

Deferred implementation:

Do not implement as part of Issue #15.

## Launch Blocker Position

No new launch blocker is introduced by this register. The pilot should not begin with real Hurst data until owner decisions for R1, R2, R4, R5, R6, and R7 are explicitly accepted or converted into required pre-launch fixes.

## Explicit Deferrals

The following are intentionally deferred and should not be included in Issue #15:

- Accounting month boundary enforcement.
- Duplicate parser and preprocessor versioning.
- Artifact retention, hash, version, or immutability implementation.
- Frontend workflow cleanup.
- Multi-store product expansion.
- Direct integrations.
- Analytics or dashboard metric expansion.
- Batch 4 or later scope.
