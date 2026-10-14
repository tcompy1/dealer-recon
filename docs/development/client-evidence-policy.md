# Client evidence and synthetic fixtures

Ordinary tracked fixtures and CLI defaults must contain independently invented data. Authentic inputs, completed clerk workpapers, client-derived golden datasets and historical row examples belong in the ignored local `docs/discovery/hiley-artifacts/` evidence root, outside ordinary application/test dependencies. Git history is not rewritten by current-tree cleanup.

## Preservation and provenance

`client-evidence-inventory.json` records the baseline, original paths, protected relative paths, SHA-256 hashes and provenance. It contains no client rows or identifiers. Resolve protected paths beneath the original checkout's protected Hiley evidence root, not a new feature worktree. The original ignored preservation manifest is `hurst/2026-10-14-preservation-manifest.json`.

- Eight Acura discovery copies match the pre-existing protected originals byte for byte.
- February BOA is retained under `acura/unverified-tracked-copy/`; its provenance remains **unverified**, and it is not promoted into authoritative acceptance.
- The five distinct Hurst source/workpaper files are retained under `hurst/`.
- The former Hurst Dealertrack service fixture maps to the same protected source CSV; it is not a second authoritative source.
- Both historical golden CSVs map to `hurst/golden_dataset.csv`, a clerk-classified derived dataset, not a raw export.
- `hurst/clerk-contract-detail.json` preserves the old inline presenter example for its unchanged historical output checksum.
- `hurst/historical-ground-truth-analysis.md` preserves the original detailed report. Its tracked replacement records aggregate acceptance and the current evidence boundary.

Hash equality proves preservation, not independent provenance. No protected evidence is runtime enrichment. No completed workpaper is used to force matches.

## Ordinary data

`sample-data/hurst-synthetic.csv` is invented from a small scenario specification without transforming historical rows. Its counts and totals intentionally differ from historical acceptance. It replaces both old golden CSV copies with one canonical ordinary dataset. `npm run export:hurst-fp-rec` defaults to it; explicit `--golden-csv` remains available for a consciously supplied input.

`server/src/testFixtures/hurst/dealertrack-reprocessing-synthetic.csv` contains two invented signed transactions, a UTF-8 BOM, a quoted comma-formatted 2100 header, VIN6, padded Control and Description columns. Its format represents the parser case; its transaction contents are invented.

Existing Acura and Fort Worth synthetic fixtures remain in use. Ordinary inline examples now have invented identities/controls, preserving their behavioral cases. A synthetic-identity presenter checksum is distinct from the preserved historical checksum; the six existing Hurst/Acura serializer compatibility baselines are unchanged.

## Protected acceptance

Run from `server`, with explicit absolute paths to protected directories:

```sh
HURST_EVIDENCE_DIR=/absolute/protected/hurst npm test -- src/acceptance/hurstReconciliation.acceptance.test.ts src/acceptance/hurstPresenter.acceptance.test.ts src/acceptance/hurstCli.acceptance.test.ts
ACURA_EVIDENCE_DIR=/absolute/protected/acura npm test -- src/acceptance/acuraEvidence.acceptance.test.ts
```

Unset Hurst/Acura variables skip their protected suites. Explicit missing or invalid evidence fails; there is no fallback to discovery or synthetic files. Hurst authentic inputs are hash checked before reading. Historical engine reconciliation and clerk-preclassified presenter expectations are separate checks. Historical counts, totals, split mismatches, serialized formulas, section counts, final variance and the original workpaper byte checksum remain assertions.

Acura's comparison helpers are shared as pure functions in `server/src/testUtils/acuraSemantics.ts`; its ordinary synthetic integration test no longer imports the module that reads protected evidence. Comparison bodies and protected acceptance semantics are unchanged.

## Recurrence safeguards

`server/src/acceptance/evidenceBoundary.test.ts` runs in the ordinary suite without protected files. It rejects legacy evidence paths, ordinary executable references to protected acceptance/evidence, known client-identity fingerprints in tracked text, and missing-root/fallback acceptance behavior. It reports paths or aggregate diagnostics, never matching values. Ignore rules supplement these tests but are not the sole safeguard. Fingerprints are a bounded regression guard for known evidence, not a claim to discover arbitrary new client data.

Any new fixture needs an explicit invented provenance description and review. Never regenerate fixtures from client rows, retain real identifiers in examples, or refresh historical expectations merely to make tests pass.

## Verification and release boundary

Cleanup requires synthetic parser/recovery, reconciliation/presenter/CLI, SQL persistence, protected historical Hurst/Acura, Hurst/Acura compatibility, Fort Worth Gate A/B, full server, relevant frontend/browser, lint/typecheck/build, current-tree scans and preserved hashes. PostgreSQL checks use isolated disposable databases only.

Fort Worth remains disabled. Gate C stays conditional/nonblocking. Microsoft Excel smoke testing remains **NOT PERFORMED — Microsoft Excel unavailable**, nonblocking. Deferred csv-parse remediation and production idle-pool handling remain separate follow-ups. This policy does not authorize push, PR, merge, deployment, existing-database migration or rooftop enablement.
