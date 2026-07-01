# V1 Pilot Recommendation Summary

Status: recommendation summary for Dealer-Recon v1 launch decision.
Date: 2026-06-17.
Issue: #17.

## Recommendation

Recommendation: Conditional Go for the private single-store Hurst Mazda FP REC pilot after owner decisions and launch gates are completed.

The completed hardening and review packet are sufficient for an owner go/no-go decision without additional engineering discovery. The pilot should not start with real Hurst data until the launch decision matrix is signed and the must-complete launch gates are evidenced.

This recommendation does not approve broader rollout, multi-store operation, direct integrations, analytics expansion, or Batch 4 scope.

## Decision Recommendations

| Decision | Recommended action for single-store pilot | Recommended action before broader rollout |
| --- | --- | --- |
| Artifact retention policy | Owner should define retention period, deletion authority, and backup retention before pilot. Retain all artifacts through the pilot and at least one subsequent close cycle unless accounting/legal policy requires longer. | Implement retention automation and deletion audit controls aligned with approved policy. |
| Artifact integrity policy | Owner may accept database persistence plus backup/restore validation for the private pilot. Record run IDs and artifact IDs in the monthly close packet. | Implement artifact hash/version tracking and immutability controls before broader rollout or external audit reliance. |
| Accounting month boundary policy | Use an operator-controlled process for pilot: verify BOA and Dealertrack source files belong to the same accounting month before accepting FP REC as final. | Enforce accounting month as an application rule before broader or repeated operational rollout. |
| Upload security policy | Accept trusted-source uploads only if pilot access is restricted and operators use expected BOA/Dealertrack files. | Require malware scanning, content-disarm, or equivalent infrastructure control before less trusted or broader upload exposure. |
| CSRF posture | Accept current same-site session posture only for HTTPS, restricted CORS, and controlled same-site deployment. | Add explicit CSRF protection before broader exposure or less controlled hosting. |
| Rate limiting | Accept controlled-environment access or documented infrastructure throttling for pilot. | Add application or infrastructure rate limiting for login, upload, reconciliation, and downloads before broader rollout. |
| Infrastructure readiness | Must be complete before pilot. Do not accept missing TLS, production secrets, real user provisioning, backup strategy, or restore test as pilot risk. | Formalize production runbooks, monitoring, alerting, restore exercises, and access reviews. |

## Go Conditions

Recommend Go only when all of the following are true:

- Launch decision matrix has owner decisions and dates.
- Must-complete launch gate checklist is satisfied.
- Production environment uses TLS, production secrets, explicit CORS, real users, and verified store assignments.
- Backup and restore test are complete before real Hurst data is uploaded.
- Deployment smoke test passes with non-sensitive BOA and Dealertrack files.
- Stored FP REC artifact can be downloaded and treated as the output of record.
- Accepted pilot risks are explicit and understood by the owner.

## No-Go Conditions

Recommend No-Go if any of the following remain true:

- Owner decisions are missing or ambiguous.
- Infrastructure readiness is incomplete.
- Real user/store provisioning is not verified.
- Backups or restore test are incomplete.
- Source-file formats differ from the documented accepted contract.
- Pilot would be exposed to public or untrusted networks without approved upload, CSRF, and rate-limit controls.
- Stored FP REC artifact cannot be generated, stored, and downloaded in the pilot environment.

## Bottom Line

Dealer-Recon v1 is ready for an owner launch decision, not an automatic launch. The recommended path is a controlled private pilot after explicit owner signoff on the matrix and successful completion of the launch gate checklist.
