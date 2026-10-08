# Fort Worth pre-release remediation — 2026-10-08

## Outcome and boundaries

Ready to proceed to release integration (push/PR and review/merge subject to normal integration checks). The two approved remediation scopes are implemented, independently reviewed and verified. This is not deployment or production-enablement authorization, nor a claim of a clean, freshly downloaded global advisory database. No push, PR, merge, deployment or enablement was performed.

Fort Worth remains disabled. Reconciliation/accounting logic, presenters, exports, artifact persistence, VIN correction, production pool handling, application database schema and frontend production code are unchanged from `7d1195e6fdcb9458ae0df784e6e04a2cc67b1f31`. No existing application database was migrated. PostgreSQL verification used uniquely named disposable test databases on the local test service.

Gate A and Gate B remain required and passed. Gate C remains conditional/nonblocking, with independent April correction evidence still missing; it was not rerun or represented as passed. The acceptance contract is unchanged. Microsoft Excel smoke testing remains `NOT PERFORMED — Microsoft Excel unavailable`, nonblocking; no substitute application or structural check is represented as Excel verification.

## Exact remediation commits

- `fcc15782f98028557f95eb158e176104dba5d395` — test-only PostgreSQL lifecycle fix.
- `c3d7966bd15a5edf714a7e6896727f237946b50d` — narrowly scoped runtime dependency patches.

Lifecycle files:

- `server/src/testUtils/testPostgresPool.ts` (new)
- `server/src/testUtils/testPostgresPool.test.ts` (new)
- `server/src/testUtils/disposablePostgresDatabase.ts`
- `server/src/testUtils/disposablePostgresDatabase.test.ts`
- `server/src/testUtils/databaseTestLock.ts`
- `server/src/db/migrate.test.ts`
- `server/src/db/demoAuth.test.ts`
- `server/src/repositories/reconciliationPersistence.test.ts`
- `server/src/acuraReconciliation.integration.test.ts`
- `server/src/fortWorthReconciliation.integration.test.ts`
- `server/src/sharedVinCorrection.integration.test.ts`

Dependency files: `server/package.json`, `server/package-lock.json`. This handoff is a separate documentation record.

## PostgreSQL lifecycle

Installed pg-pool can resolve `pool.end()` before idle client shutdown finishes. The former immediate forced database drop could terminate a still-closing client and emit an uncaught pool error. The new test-only factory waits for each connected client's actual `end` event after native pool shutdown. All affected SQL test pools, including the advisory-lock helper, use it. Production `createPool` is unchanged.

Normal disposable cleanup checks for remaining sessions and uses ordinary `DROP DATABASE`, without FORCE. A leak fails cleanup and leaves the disposable database for investigation; it is not silently terminated. Simultaneous operation and cleanup failures are preserved in an `AggregateError`, with the original operation as its cause and first error. Pool errors are neither swallowed nor special-cased; no sleeps/retries or assertion weakening were added.

The deterministic delayed-client regression failed before the implementation (premature completion). The three cleanup regressions also failed as expected (missed leak, FORCE present, original operation error masked). They passed after the change. Independent review found no actionable issues, including a subsequent one-line factory substitution in the database-lock helper.

The new serial and parallel combined runs both passed with zero `57P01` occurrences and no unhandled-error section. A final read-only database inventory found zero `dealer_recon_task10_` disposable databases. These results support the lifecycle fix; they do not claim every possible PostgreSQL interruption is eliminated. The original failed run remains preserved under `/private/tmp/fw-html-correction-20261008/server-full.log`.

## Dependencies and local audit

| Runtime package | Before | After |
| --- | --- | --- |
| express | 4.22.2 | 4.22.3 |
| body-parser | 1.20.5 | 1.20.6 |
| proxy-addr | 2.0.7 | 2.0.8 |
| qs, both Express and body-parser paths | 6.15.2 | 6.16.0, deduplicated |
| runtime brace-expansion | 5.0.9 | 5.0.12, hoisted |
| side-channel, required by patched qs | 1.1.0 | 1.1.1 |
| node-pg-migrate / glob / minimatch | 8.0.4 / 11.1.0 / 10.2.5 | unchanged |
| csv-parse | 5.6.0 | unchanged, deferred |

The exact manifest/lock diff was inspected before install and independently reviewed. No unrelated locked version changes occurred. The body-parser qs override intentionally exceeds its declared `~6.15.1` range; the full API/browser suite passed with that approved override. Development-only legacy brace branches were not upgraded. No blanket/forced audit fix was used.

Before: the retained runtime audit reported nine affected package entries (1 critical, 4 high, 4 moderate), representing eight underlying advisories.

After: a fresh local comparison of the current production lockfile against those eight retained advisory records finds only **one known affected package: csv-parse, moderate**. All seven other underlying advisories are outside their affected ranges. The production image independently verified the approved versions and both qs resolution paths.

Audit limitation: `npm audit --omit=dev --offline --json` ran and exited 0 with an empty report. This is **not accepted as security clearance**, because the known CSV finding still exists. No refreshed registry-wide audit was available without external inventory submission, which prior automatic approval review rejected; no workaround submission was made. `local-audit.json` explicitly limits its conclusions to the retained 2026-10-08 advisory snapshot. No dependency inventory was transmitted by the remediation's install/audit commands. Installs used `--no-audit`; public package metadata and package downloads were permitted.

Deferred CSV work: GHSA-8cw4-87c7-c6xx / CVE-2026-85063 affects versions below 7.0.2. The current production parsers use array records, without `columns:true` or `group_columns_by_name:true`; the reported vulnerable combination is not reached. Keep a dedicated CSV 5-to-7 parser upgrade task, with malformed/duplicate-header tests and all rooftop membership, monetary and protected-evidence gates. This is an explicit non-reachability-based deferral, not a patched or clean result.

## Executed verification

Command records and full logs: `/private/tmp/fw-prerelease-20261008/commands.jsonl`. All rows below describe executed checks, not planned verification.

| Check | Result | Log |
| --- | --- | --- |
| Deterministic delayed client RED | Expected assertion failure | `teardown-red.log` |
| Cleanup regression RED | Three expected failures | `cleanup-red.log` |
| Lifecycle GREEN | 20 tests passed | `teardown-green.log` |
| Initial lifecycle SQL | 60 passed | `lifecycle-sql.log` |
| Initial lifecycle types/lint | Passed | `lifecycle-types.log`, `lifecycle-lint.log` |
| Final focused lifecycle/SQL, after patches | 80 passed across eight files | `final-focused-sql.log` |
| Combined full server/PostgreSQL, serial | 655 passed, one protected Acura skip; exit 0 | `server-full-serial.log` |
| Combined full server/PostgreSQL, default parallel | 655 passed, same skip; exit 0 | `server-full-parallel.log` |
| Protected Acura | 13 passed; resolves separately the conditional skip above | `protected-acura.log` |
| Gate A original April | 10 passed, required original-input comparison executed | `gate-a-unsandboxed.log` |
| Gate B shared correction | Passed in focused/full SQL, API, UI and browser suites | SQL/full/frontend/browser logs |
| Authentication/login throttling; request/query/body validation; upload/parser; persistence/migrations | Passed in full server suites (including 115 app tests and 11 request-parser tests) and focused SQL | full/focused logs |
| Hurst/Acura compatibility | Six frozen-output compatibility tests passed in both full runs | full logs |
| Frontend | Lint, 41 tests and build passed | `frontend.log` |
| Browser | Four Chromium scenarios passed | `browser.log` |
| Server static/build | Lint, typecheck, build passed | `server-static.log` |
| Production Docker build | Passed | `docker-build.log` |
| Production runtime | HTML exports, ExcelJS absent, exact approved dependencies, both qs paths, FW disabled passed | `runtime.log` |
| Runtime audit, offline | Executed; empty result not accepted as clearance | `audit-offline.log` |
| Local retained-advisory comparison | One known moderate CSV finding remains | `local-audit.json` |
| Final diff/scope | `git diff --check` passed; executable production source unchanged | `verified-state.json` and Git diff |

The Docker verification used a temporary copy of `Dockerfile.backend` whose only changes add `--no-audit` to npm installs. This prevents unapproved inventory transmission; the tracked Dockerfile is unchanged. Runtime smoke used `--network=none`, with no database or application volume.

Verification exceptions retained: the first Gate A attempt failed because the sandbox denied Supertest's local listener (`EPERM`); rerunning with listener permission passed. An initial regression invocation used an incorrect relative file path and found no test files; that was not counted as RED. The later recorded REDs are actual expected assertion failures. No failing PostgreSQL run was retried to obtain green output; the final focused, serial and parallel configurations each passed their predetermined invocation.

Protected evidence stayed at its authoritative original location and was accessed read-only by acceptance tests; no evidence was copied, staged or changed. Synthetic fixtures and prior rooftop assertions are unchanged. Existing discovery files outside this remediation are unchanged. The original checkout and its existing untracked files were preserved, as was the feature worktree's existing `frontend/test-results/` directory.

## Separate production pool-handling assessment

Production `createPool` has no idle-pool error listener. An unexpected administrator termination or connection failure can therefore become an uncaught process error. The disposable cleanup race is fixed in test infrastructure; it is not justification for claiming production connection-failure resilience. No production incident or reconciliation corruption was demonstrated, and no production pool behavior was changed. Track a separate operational review with injected idle and in-flight failures, explicit reporting/recovery policy, and shutdown behavior; do not suppress errors or blindly retry financial writes.

## Release integration recommendation

Proceed to release integration with this handoff and the explicit CSV/audit limitations. The approved fixes and required verification passed; independent lifecycle and dependency reviews have no unresolved findings. Hurst/Acura outputs and the Fort Worth accounting/acceptance contract remain unchanged.

Production deployment and Fort Worth enablement remain separate decisions. Fort Worth remains disabled. The deferred CSV advisory, bounded audit coverage and production pool-error-handling follow-up are not erased by successful tests, and Microsoft Excel smoke testing remains a separate nonblocking operational item.
