# V1 Validation Evidence

Status: validation evidence for the Issue #15 security and code review packet.
Date: 2026-06-17.
Branch: codex/issue-15-review-packet.
Base branch: integration-cleanup-2026-06-10.

## Scope Validated

This evidence covers the documentation-only v1 Security and Code Review Packet. No application code, reconciliation behavior, parser behavior, export behavior, or Batch 4 scope was changed for this packet.

The validated product boundary remains the single-store Hurst Mazda FP REC pilot. The FP REC export is the output of record. The dashboard guides the clerk workflow.

## Commands Run

| Command | Result | Evidence |
| --- | --- | --- |
| cd server && npm run typecheck | Passed | TypeScript completed with no errors. |
| cd server && npm test | Passed | 28 test files passed, 3 skipped. 332 tests passed, 7 skipped. |
| cd frontend && npm test -- --run | Passed | 1 test file passed. 6 tests passed. Rerun alone completed without warnings. |
| cd frontend && npm run build | Passed | TypeScript build and Vite production build completed. |
| git diff --check | Passed | No whitespace errors reported. |
| Markdown link sanity check | Passed | README.md, deployment readiness, and v1 review packet Markdown links resolve locally across 7 files. |

## Security Regression Evidence

Security-relevant coverage currently present in the test suite includes:

- Production migration behavior does not seed a demo user and dev/test demo seeding remains explicit: server/src/db/demoAuth.test.ts and server/src/db/migrate.test.ts are present but database-backed cases are skipped unless the test database is enabled.
- Auth fallback requires explicit local opt-in and protected routes fail closed without configured auth: server/src/app.test.ts.
- Dealertrack SpreadsheetML column expansion is capped while normal indexed gaps still parse: server/src/services/parsers/dealertrackXmlParser.test.ts.
- Spreadsheet formula-leading source text is neutralized in CSV and HTML-as-XLS presenter outputs: server/src/spreadsheetText.test.ts, server/src/presenters/hurstFpRec.test.ts, server/src/presenters/mergedFloorplan.test.ts, and server/src/presenters/csv.test.ts.
- Store-scoped users cannot access other-store or null-store artifacts, runs, source files, events, or reports; platform/dealership access remains explicit: server/src/app.test.ts.
- Frontend error parsing surfaces both detail responses and error.message responses: frontend/src/api/errorMessage.test.ts.

## Code Review Regression Evidence

Code-quality and workflow coverage currently present in the test suite includes:

- Reconciliation engine invariants for VIN6 and amount matching: server/src/services/reconciliationEngine.test.ts and server/src/services/reconciliationEngineTiers.test.ts.
- Golden fixture behavior for reviewed reconciliation outputs: server/src/services/reconciliationGoldenFixtures.test.ts.
- BOA and Dealertrack parser/preprocessor behavior: server/src/services/preprocessing/boaPreprocessor.test.ts, server/src/services/preprocessing/dealertrackPreprocessor.test.ts, server/src/services/parsers/boaHtmlXlsParser.test.ts, server/src/services/parsers/dealertrackXmlParser.test.ts, and server/src/services/parsers/sourceParserRouter.test.ts.
- Stored FP REC and merged artifact behavior from reviewed reconciliation detail, including download/regeneration agreement: server/src/app.test.ts, server/src/presenters/hurstFpRec.test.ts, and server/src/presenters/mergedFloorplan.test.ts.
- Exception taxonomy and exception carry-forward behavior: server/src/services/exceptionCategorizer.test.ts and server/src/services/exceptionCarryForward.test.ts.

## Documentation Evidence

Documentation updates in this packet:

- README.md links reviewers to the v1 Security and Code Review Packet.
- docs/reviews/v1-security-code-review-packet.md is the packet entry point.
- docs/reviews/v1-security-review.md documents the security review package.
- docs/reviews/v1-code-review.md documents the code review package.
- docs/operator/v1-deployment-readiness.md documents deployment, migration, backup, rollback, and production-default readiness.
- docs/reviews/v1-risk-register.md documents accepted and deferred risks.
- docs/reviews/v1-validation-evidence-2026-06-17.md records the validation evidence.

## Manual Validation Not Performed

The following were not performed in this documentation-only PR:

- Production deployment.
- Production database migration.
- Restore-from-backup test.
- Real Hurst source-file upload.
- Manual browser smoke test against a deployed environment.

These checks belong to deployment readiness, not Issue #15 documentation authoring.

## Remaining Review Risks

Remaining risks are tracked in [v1-risk-register.md](v1-risk-register.md). The most important owner decisions are artifact retention/hash/version policy, accounting-month enforcement, upload malware scanning, CSRF posture, rate limiting, and production infrastructure controls.
