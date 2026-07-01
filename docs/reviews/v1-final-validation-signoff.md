# v1 Final Validation Signoff

Date: Tuesday, June 23, 2026.
Issue: #21.
Validation branch: `integration-cleanup-2026-06-10`.
Validated commit: `266733bef7dcfecbecb45c8db7806bfe87681fc0`.

## Scope

This signoff covers repository-local validation for the Dealer-Recon v1 single-store Hurst Mazda FP REC pilot. It does not add features, change reconciliation behavior, change export behavior, introduce Batch 4 scope, or start multi-store work.

## Repository State

- `git pull --ff-only` reported `Already up to date.`
- Work started from `integration-cleanup-2026-06-10`.
- Working tree was clean before validation started.
- No unrelated local files or generated artifacts are included in this signoff update.

## Automated Validation

| Command | Result | Notes |
| --- | --- | --- |
| `cd server && npm run lint` | Passed | ESLint completed without findings. |
| `cd server && npm run typecheck` | Passed | `tsc -p tsconfig.json --noEmit` completed successfully. |
| `cd server && npm test` | Passed | 28 files passed, 3 skipped; 334 tests passed, 7 skipped. |
| `cd frontend && npm test -- --run` | Passed | 1 file passed; 6 tests passed. |
| `cd frontend && npm run build` | Passed | TypeScript build and Vite production build completed successfully. |
| `git diff --check` | Passed | No whitespace errors on the clean validation tree. |

## Dataset Validation

| Dataset | Local files | Run status | Reconciliation result | Matched | BOA-only | Dealertrack-only | VIN6 mismatch | Stored artifacts | FP REC verification | Discrepancies |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- |
| February Hurst BOA + Dealertrack | Not available under `docs/discovery/floorplan/hurst` | Not run | Unavailable locally | n/a | n/a | n/a | n/a | n/a | n/a | Not assessed because source files were unavailable locally. |
| March Hurst BOA + Dealertrack | Not available under `docs/discovery/floorplan/hurst` | Not run | Unavailable locally | n/a | n/a | n/a | n/a | n/a | n/a | Not assessed because source files were unavailable locally. |
| April Hurst BOA + Dealertrack | `BOA HURST APRIL (1).csv`; `DT HURST APRIL (1).csv` | Run through login, upload, reconcile, artifact, and export routes | Succeeded: 199 matched, 8 exceptions, 0 duplicates | 199 | 6 | 2 | 4 | `RAW_BOA`, `RAW_DEALERTRACK`, `CLEANED_BOA`, `CLEANED_DEALERTRACK`, `MERGED_FLOORPLAN`, `FP_REC` | Passed: stored FP REC HTTP 200, `application/vnd.ms-excel`; regenerated FP REC matched stored bytes | No route-level discrepancy found. Full clerk visual workbook review was not performed locally. |

April source-file evidence:

- BOA upload accepted 205 transactions with 0 validation errors.
- Dealertrack upload accepted 201 transactions with 0 validation errors.
- Stored artifact sizes were nonzero: raw BOA 29003 bytes, raw Dealertrack 16375 bytes, cleaned BOA 25972 bytes, cleaned Dealertrack 28523 bytes, merged floorplan 68306 bytes, FP REC 3805 bytes.

## Export Validation

April Hurst export validation used the same app route surface as the product workflow:

- Stored merged floorplan artifact downloaded with HTTP 200 and `application/vnd.ms-excel`.
- Stored FP REC artifact downloaded with HTTP 200 and `application/vnd.ms-excel`.
- Regenerated `/reconciliation-runs/1/merged-floorplan` output matched the stored `MERGED_FLOORPLAN` artifact bytes.
- Regenerated `/reconciliation-runs/1/fp-rec` output matched the stored `FP_REC` artifact bytes.
- JSON export routes returned 207 rows for both merged floorplan and FP REC.
- FP REC remains the v1 output of record.

## Open Technical Risks

- February and March Hurst raw BOA/Dealertrack source pairs were not available locally, so repository-local dataset execution covered April only.
- Production deployment, production database migration, production restore testing, and production backup verification were out of scope for this issue.
- Owner decisions remain pending for artifact retention, artifact integrity, accounting month boundary policy, upload security posture, CSRF posture, broader rate limiting, and infrastructure readiness.
- Accounting month enforcement remains operator-controlled for the pilot rather than enforced by application logic.

## Final Technical Status

Green for repository-local v1 technical validation.

All automated validation commands passed, the available April Hurst dataset passed app-route reconciliation and artifact checks, and no new technical launch blocker was found. Pilot launch remains conditional on the non-engineering owner and infrastructure decisions tracked in the v1 launch materials.

## Next Required Non-Engineering Step

The owner should complete the pending go/no-go decisions in the v1 launch decision package before treating the Hurst Mazda FP REC pilot as approved for deployment or operational use.
