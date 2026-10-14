# Hurst reconciliation characterization and evidence boundary

The historical reverse-engineering report and clerk-classified dataset are protected client evidence. The original report is retained outside Git as `hurst/historical-ground-truth-analysis.md` beneath the local protected Hiley evidence root. This tracked document is the current operational reference; it does not reproduce client rows, identifiers, descriptions, or clerk annotations.

## Historical acceptance contract

These are historical aggregate expectations, not synthetic demo populations:

| Period | Matches | BOA-only | Dealertrack-only | Amount-mismatch pairs | BOA total (dollars) | GL total (dollars) | Source delta (dollars) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| FEB26 | 238 | 0 | 16 | 0 | 9,088,877 | -9,662,045 | -573,168 |
| MAR26 | 217 | 10 | 6 | 0 | 8,606,561 | -8,470,803 | 135,758 |
| APRIL26 | 199 | 4 | 2 | 2 | 7,949,383 | -7,877,160 | 72,223 |

Mismatch rows remain separate exceptions. The nonzero source delta is distinct from final workpaper variance, which is zero after net adjustments. Historical assertions are preserved in `server/src/acceptance/hurstReconciliation.acceptance.test.ts`, `hurstPresenter.acceptance.test.ts`, and `hurstCli.acceptance.test.ts`. Run them only with an explicit absolute `HURST_EVIDENCE_DIR` pointing to the protected Hurst directory. Missing or altered evidence fails; there is no synthetic/discovery fallback.

## Ordinary examples

`sample-data/hurst-synthetic.csv` is independently invented and deliberately has different populations and amounts. It contains FEB26 (two matches, one DT-only), MAR26 (one match, one exception on each side), and APRIL26 (one match, two exceptions on each side including a split amount mismatch). Ordinary reconciliation, presenter and CLI tests use this data. It is not evidence of historical reconciliation parity.

The established Hurst behavior remains: signed account 2100, VIN/amount identity rules, distinct unmatched/mismatch rows, preserved descriptions, blank clerk-entry cells, deterministic ordering and shared HTML-XLS serialization. Production reconciliation and presenter implementations are unchanged by evidence cleanup.

See `docs/development/client-evidence-policy.md` for preservation, recurrence safeguards, and verification commands.
