# Current-tree client-evidence cleanup handoff — 2026-10-14

## Result and scope

The completed Fort Worth branch is ready for push/PR from the evidence-cleanup perspective, subject to normal current-main/integration review. No push, PR, merge, deployment, existing application database migration, or Fort Worth enablement was performed.

Baseline: `8320eefa7dc9567dcf82467347012517472d48d8`, branch `codex/fort-worth-reconciliation`. Cleanup is a separate commit after the completed Fort Worth implementation/remediation. The original temporary worktree had lost its Git marker; a fresh worktree was created at `/private/tmp/dealer-recon-evidence-cleanup-20261014` on the preserved branch. Old temporary remnants and the original checkout were left untouched.

Production accounting/reconciliation, presenters, exports/artifact persistence, VIN correction, database schema, authorization and frontend behavior are unchanged. The only existing executable production-source edit is the Hurst demo export CLI's default path, from the historical dataset to `sample-data/hurst-synthetic.csv`. No manifest or lockfile changed. Fort Worth remains `enabled:false`.

## Removed and replacement paths

These seventeen preserved client-evidence paths are removed from the feature tree (Git history is retained):

- `docs/discovery/floorplan/acura/merged/ACURA APRIL MERGED(BillingStatementApril2026).csv`
- `docs/discovery/floorplan/acura/merged/ACURA FEB MERGED(BillingStatementFebruary2026).csv`
- `docs/discovery/floorplan/acura/merged/ACURA MARCH MERGED(BillingStatementMarch2026).csv`
- `docs/discovery/floorplan/acura/raw/ACURA BOA APRIL(in).csv`
- `docs/discovery/floorplan/acura/raw/ACURA BOA FEB(in).csv`
- `docs/discovery/floorplan/acura/raw/ACURA BOA MARCH(in).csv`
- `docs/discovery/floorplan/acura/raw/ACURA DT APRIL(in).csv`
- `docs/discovery/floorplan/acura/raw/ACURA DT FEB(in).csv`
- `docs/discovery/floorplan/acura/raw/ACURA DT MARCH(in).csv`
- `docs/discovery/floorplan/hurst/BOA HURST APRIL (1).csv`
- `docs/discovery/floorplan/hurst/BOA HURST APRIL (1).xlsx`
- `docs/discovery/floorplan/hurst/DT HURST APRIL (1).csv`
- `docs/discovery/floorplan/hurst/DT HURST APRIL (1).xlsx`
- `docs/discovery/floorplan/hurst/Hurst FP Rec (3).xlsx`
- `sample-data/golden_dataset.csv`
- `server/src/services/__fixtures__/DT HURST APRIL (1).csv`
- `server/src/services/__fixtures__/golden_dataset.csv`

Replacements:

- `sample-data/hurst-synthetic.csv`: one independently invented canonical dataset replaces both ordinary golden copies and the CLI default. Historical populations are not copied or forced.
- `server/src/testFixtures/hurst/dealertrack-reprocessing-synthetic.csv`: two invented transactions, original format characteristics (BOM, quoted/comma-formatted account header, padded Control, VIN6 and Description), signed amounts and explicit expected counts.
- Existing Acura synthetic fixtures remain unchanged; no nine-file synthetic duplication was needed.
- Ordinary inline identities/controls and associated sample stock references were replaced consistently. Behavioral test cases remain; the historical inline workpaper input was preserved separately. The new synthetic-identity checksum is not represented as the original historical byte baseline.
- Detailed ground-truth documentation was replaced with historical aggregate expectations and current synthetic/evidence guidance. The original detailed report remains protected; historical sign-off and Acura decision documents have dated location notes without rewriting results.

## Protected locations and status

Protected root: `/Users/tcompy/Developer/dealer-recon/docs/discovery/hiley-artifacts` in the original checkout, confirmed ignored. No evidence copied into an ordinary test fixture or new authoritative source.

- `acura/`: eight existing protected copies verified byte-identical.
- `acura/unverified-tracked-copy/ACURA BOA FEB(in).csv`: preserved with **unverified provenance**; never promoted to authoritative acceptance.
- `hurst/`: five distinct source/workpaper evidence files preserved. The service Dealertrack copy maps to the same source CSV, not a second authoritative source.
- `hurst/golden_dataset.csv`: one protected authentic clerk-classified dataset, byte-identical to both former tracked copies.
- `hurst/clerk-contract-detail.json`: original inline workpaper input, preserving its original HTML checksum.
- `hurst/historical-ground-truth-analysis.md`: original detailed historical report.
- `hurst/2026-10-14-preservation-manifest.json`: local hashes/provenance. The tracked metadata-only counterpart is `docs/development/client-evidence-inventory.json`.

All 19 preservation mappings were rehashed successfully: zero mismatches. Hash equality establishes byte preservation, not independent source provenance.

## Historical acceptance and ordinary dependencies

Before: two ordinary tests read the raw Hurst service fixture; engine/presenter/CLI tests and the CLI default read the authentic golden copies. Discovery copies and inline examples also retained client identifiers. Ordinary Acura integration imported a module containing protected-evidence readers.

After: ordinary tests/CLI use invented files; there are no references to protected readers from ordinary executable code. The 27 pure Acura comparison functions moved unchanged to `server/src/testUtils/acuraSemantics.ts`. Protected `ACURA_EVIDENCE_DIR` acceptance remains explicitly opt-in. New Hurst acceptance uses explicit `HURST_EVIDENCE_DIR`, verifies authentic file hashes, and has no missing-root/synthetic/discovery fallback.

Preserved Hurst acceptance includes all three historical match/exception populations, source totals/deltas, split amount-mismatch pairs, presenter section populations/totals, zero final variance, serialized amounts/formulas and disk exports. Original workpaper SHA-256 `fd2f02b03ec1d62eece7d509e1d055a80f3eb1170938abe8c1cd6896192e9ebb` remains asserted against protected data. Source delta and final workpaper variance remain distinct. The six existing Hurst/Acura compatibility hash assertions were not refreshed.

New tests: `server/src/acceptance/hurstReconciliation.acceptance.test.ts`, `hurstPresenter.acceptance.test.ts`, `hurstCli.acceptance.test.ts`, and `evidenceBoundary.test.ts`. Updated existing tests:

- `server/src/acuraReconciliation.integration.test.ts`
- `server/src/app.test.ts`
- `server/src/cli/generateHurstFpRecExport.test.ts`
- `server/src/cli/runFloorplanRecon.test.ts`
- `server/src/domain/vin6.test.ts`
- `server/src/presenters/hurstFpRec.test.ts`
- `server/src/presenters/mergedFloorplan.test.ts`
- `server/src/services/preprocessing/dealertrackPreprocessor.test.ts`
- `server/src/services/preprocessing/index.test.ts`
- `server/src/services/reconciliationEngine.test.ts`
- `server/src/services/reconciliationEngineTiers.test.ts`
- `server/src/services/reconciliationGoldenFixtures.test.ts`
- `server/src/services/reconciliationReplay.test.ts`
- `server/src/services/runComparisonAnalytics.test.ts`
- `server/src/services/runIdentity.test.ts`
- `server/src/services/transactionNormalizer.test.ts`

## Executed verification

Logs are local at `/private/tmp/evidence-cleanup-20261014/`; no execution artifacts are committed.

| Verification | Result |
| --- | --- |
| Baseline server with listener permission | 618 passed, 38 conditional skips |
| CLI default RED | Expected historical 238-match output failed the invented two-match expectation |
| Initial boundary RED | Rejected legacy paths, ordinary protected-reader import and known client identities |
| Synthetic fixture/recovery refinement | Corrected invented stock labels to preserve the existing M-number grammar; no production parser change |
| Protected historical Hurst | 10 passed; also included in final full suite |
| Final full server, serial, PostgreSQL + protected evidence enabled | **673 passed, 58 files, no skips** |
| Included PostgreSQL checks | Migrations 10, persistence 22, shared VIN SQL 6, Acura integration 3, Fort Worth integration 16; all passed |
| Included API/preprocessing | App 115 and preprocessing routing 14 passed, including explicit recovery counts/amounts |
| Protected Acura | 13 passed |
| Fort Worth Gate A | 10-test acceptance file passed with explicit original mode and protected directory; original April gate evaluated |
| Fort Worth Gate B | Required synthetic correction behavior passed in full server/SQL, frontend and browser suites |
| Hurst/Acura compatibility | Six unchanged frozen-output tests passed |
| Frontend | Lint, 41 tests, build passed |
| Browser | Four Chromium workflows passed: Acura period/workflow, FW correction/exports, Hurst/Acura stale correction forms and legacy downloads |
| Server | Lint, typecheck and build passed |
| Final fixture-format/boundary follow-up | 54 tests passed across five affected suites after explicit BOM/header assertions and LF normalization; BOM and padded header preserved |
| Review regression | Template-string guard bypass reproduced RED; corrected GREEN, all six boundary tests passed |
| Evidence/current-tree scans | 19 hashes match; no known full VIN, 16-character prefix, eight-character tail or source stock-control overlap in current tracked text; legacy paths absent |
| Test database cleanup | Zero disposable test databases remained; unused task-created alternate-port container removed |

Verification exceptions are disclosed rather than counted as success: the first baseline attempt was denied HTTP listeners by the sandbox; an offline frontend install lacked a cached locked package, so exact locked packages were installed with network access and audit disabled; frontend commands before successful install could not run. An initial SQL invocation was refused by the exact local-URL guard (wrong alternate port/base name), before disposable migrations. A subsequent combined run passed 672 tests but Gate A correctly rejected its missing explicit evidence directory. The final correctly configured full run passed all 673. The staged whitespace check caught CRLF line endings in new CSVs; they were normalized to LF and all five affected suites passed again. Initial synthetic fixture failures and synthetic-identity checksum changes were resolved without weakening assertions; the authentic checksum stayed unchanged in protected acceptance.

## Independent review

Two independent reviews found no historical acceptance weakening, evidence leakage in new tracked inputs, or accounting-production change. Review confirmed all 27 moved Acura comparison function bodies are unchanged. One actionable recurrence-guard finding (template-string fragments were not scanned) was reproduced, fixed and independently confirmed resolved. No actionable findings remain. The execution ledger stayed outside the commit.

## Remaining boundaries

Gate A and Gate B remain required and passed. Gate C remains conditional/nonblocking; independent historical VIN-correction substantiation is still absent, and corrected historical acceptance is not claimed.

Microsoft Excel smoke test: **NOT PERFORMED — Microsoft Excel unavailable**, nonblocking. No other application is represented as Excel verification.

The deferred csv-parse major-version/advisory work and production PostgreSQL idle-pool error-handling follow-up remain separate risks. Dependencies and production pool handling were not changed. Known-identity fingerprints and path/import safeguards are bounded recurrence protection, not universal detection of arbitrary new client data. Historical Git commits and the preserved original checkout may still contain old evidence; this cleanup concerns the feature branch's current tracked tree.

Push/PR readiness is not merge/deployment authorization or a fresh remote-main conflict assessment. Fort Worth enablement remains separately unauthorized and disabled.
