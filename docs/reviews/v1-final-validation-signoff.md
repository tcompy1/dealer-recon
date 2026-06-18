# v1 Final Validation Signoff

Date: Thursday, June 18, 2026.
Issue: #21.
Validation branch: `codex/issue-21-final-validation`.
Validated base branch: `integration-cleanup-2026-06-10`.
Validated base commit: `cab2fabfd5e434fa10fb641284ea00a57e4ce01b`.

## Scope

This signoff covers final repository-local validation for the Dealer-Recon v1 single-store Hurst Mazda FP REC pilot. It does not add features, change reconciliation behavior, change export behavior, introduce Batch 4 scope, or start multi-store work.

## Repository State

- Work started from `integration-cleanup-2026-06-10` after pulling latest remote changes.
- PR #20 was already merged into the readiness branch before validation started.
- Working tree was clean before validation started.
- Frontend dependencies were installed locally with `npm ci` because `frontend/node_modules` was absent.
- Ignored local build/dependency folders were not committed.

## Automated Validation

| Command | Result | Notes |
| --- | --- | --- |
| `cd server && npm run lint` | Passed | ESLint completed without findings. |
| `cd server && npm run typecheck` | Passed | `tsc -p tsconfig.json --noEmit` completed successfully. |
| `cd server && npm test` | Passed | 28 files passed, 3 skipped; 332 tests passed, 7 skipped. The expected negative readiness test logged `database unavailable` while asserting the 503 path. |
| `cd frontend && npm test -- --run` | Passed | 1 file passed; 6 tests passed. npm warned that forwarded `--run` is an unknown npm config. |
| `cd frontend && npm run build` | Passed | TypeScript build and Vite production build completed successfully. |
| `git diff --check` | Passed | No whitespace errors on the clean validation tree. |

## Dataset Validation

| Dataset | Local files | Run status | Reconciliation result | Matched | BOA-only | Dealertrack-only | VIN6 amount mismatch | Stored artifacts | FP REC download | Discrepancy from expected clerk-reviewed output |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- |
| February Hurst BOA + Dealertrack | Not available under `docs/discovery/floorplan/hurst` | Not run | Unavailable locally | n/a | n/a | n/a | n/a | n/a | n/a | Not assessed because source files were unavailable locally. |
| March Hurst BOA + Dealertrack | Not available under `docs/discovery/floorplan/hurst` | Not run | Unavailable locally | n/a | n/a | n/a | n/a | n/a | n/a | Not assessed because source files were unavailable locally. |
| April Hurst BOA + Dealertrack | `BOA HURST APRIL (1).csv`; `DT HURST APRIL (1).csv` | Run through app upload, preprocessing, reconcile, artifact, and export routes | Reconciliation run succeeded with 199 matched, 8 exceptions, 0 duplicates | 199 | 6 | 2 | 4 | `RAW_BOA`, `RAW_DEALERTRACK`, `CLEANED_BOA`, `CLEANED_DEALERTRACK`, `MERGED_FLOORPLAN`, `FP_REC` | Passed; stored FP REC downloaded with HTTP 200 and `application/vnd.ms-excel` | No discrepancy found in route-level validation. Full clerk visual workbook review was not performed in this local validation pass. |

April source-file evidence:

- BOA upload accepted 205 transactions, 0 validation errors, and reported 2 rows requiring manual enrichment.
- Dealertrack upload accepted 201 transactions, 0 validation errors, and removed 1 unrecognized row.
- Reconciliation created run `1` in the in-memory validation app with `matched_count=199`, `exception_count=8`, and `duplicate_count=0`.

## Export Validation

April Hurst export validation was performed through the same app route surface used by the product workflow:

- Stored merged floorplan artifact downloaded successfully with HTTP 200 and `application/vnd.ms-excel`.
- Stored FP REC artifact downloaded successfully with HTTP 200 and `application/vnd.ms-excel`.
- Regenerated `/reconciliation-runs/1/merged-floorplan` output matched the stored `MERGED_FLOORPLAN` artifact bytes.
- Regenerated `/reconciliation-runs/1/fp-rec` output matched the stored `FP_REC` artifact bytes.
- JSON export routes returned matching row counts for merged floorplan and FP REC: 199 matched, 6 BOA-only, and 2 Dealertrack-only.
- FP REC remains the output of record for v1.

## Open Technical Risks

- February and March Hurst raw BOA/Dealertrack source files were not available locally, so final local dataset execution covered April only.
- Production deployment, production database migration, production restore testing, and production backup verification were out of scope for this issue.
- Owner decisions remain pending for artifact retention, artifact integrity, accounting month boundary policy, upload security posture, CSRF posture, rate limiting, and infrastructure readiness.
- Accounting month enforcement remains operator-controlled for the pilot rather than enforced by application logic.

## Final Technical Status

Green for repository-local v1 technical validation.

All automated validation commands passed, the available April Hurst dataset passed the app-route reconciliation and artifact checks, and no new technical launch blocker was found in this validation pass. Pilot launch remains conditional on the non-engineering owner and infrastructure decisions tracked in the v1 launch decision materials.

## Next Required Non-Engineering Step

The owner should complete the pending go/no-go decisions in the v1 launch decision package before treating the Hurst Mazda FP REC pilot as approved for deployment or operational use.
