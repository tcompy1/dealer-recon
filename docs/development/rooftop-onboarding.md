# Rooftop Reconciliation Onboarding Gate

## Purpose

Acura is a proven vertical slice, not a default policy for another store. Every later rooftop must pass its own evidence, implementation, regression, persistence, and browser gates before its profile can be enabled.

The planned onboarding order is:

1. Fort Worth (`fw`)
2. Burleson (`burleson`)
3. Huntsville (`hsv`)
4. West (`west`)

This Acura slice does not enable any of those rooftops. Fort Worth remains a disabled profile, and the other listed stores have no enabled profile from this work.

## Required sequence

Complete the phases in order. A passing phase authorizes only the next phase for the rooftop being onboarded.

### 1. Protect the evidence

- Keep the complete client evidence package in the repository's ignored local evidence area.
- Add or verify the ignore rule before creating implementation changes.
- Confirm no evidence file is tracked, staged, copied into the feature worktree, or printed in test/review output.
- Treat recordings and financial exports as read-only inputs.

### 2. Characterize every supplied file and recording

- Inventory every file by role without assuming filenames are authoritative.
- Record formats, sheets/columns, period evidence, row-removal rules, account inclusion/exclusion, amount signs, normalized counts, match/exception counts, totals, formulas, ordering, and operationally meaningful formatting.
- Record aggregate and structural facts only. Do not reproduce raw rows or VIN values.
- Identify complete monthly source/merged/goal sets and select the latest complete approved month for acceptance.

### 3. Resolve evidence conflicts

Use this authority order:

1. approved goal output;
2. completed merged reconciliation;
3. recorded clerk workflow;
4. raw BOA and Dealertrack exports;
5. existing automated tests;
6. current implementation; and
7. existing documentation.

Document each conflict and its ruling. Stop if account selection, supported input shape, manual transformations, counts, totals, output semantics, or the acceptance month remains unresolved.

### 4. Add a disabled profile

- Give the rooftop a stable profile ID and explicit version.
- Keep `enabled: false` while implementation and acceptance are incomplete.
- Declare supported formats, parser identities, preprocessor identities, account rules, presenter policy, required artifacts, and sanitized golden-fixture IDs.
- Keep aliases at the profile/configuration boundary. Do not add store-name conditionals to the shared reconciliation kernel.

### 5. Sanitize fixtures

- Build compact synthetic fixtures with invented identifiers, descriptions, and amounts.
- Preserve the characterized source structure and cover exact match, source-only rows, duplicate candidates, amount mismatches, removals, fallback rules, and missing-identifier warnings.
- Resolve every imported fixture path to a normalized absolute path and prove that it remains within the sanitized-fixture root.
- Keep aggregate client baselines only in the protected conditional acceptance path and characterization record.

### 6. Implement test-first parser through output behavior

Follow `RED -> GREEN -> REFACTOR` for production-impacting changes:

1. parser and format-detection tests;
2. preprocessor and removed-row receipt tests;
3. accounting-period evidence tests;
4. reconciliation and deterministic-order tests;
5. merged-output semantic tests; and
6. profile-selected FP REC semantic tests.

Money remains integer cents. Matching remains exact by approved identifiers and absolute amount. Rooftop differences belong in the profile, period validator, preprocessing policy, or presenter policy.

### 7. Prove persistence and the browser workflow

- Use PostgreSQL tests to prove source/run identity, immutable duplicate reuse, receipt round-trip, artifact atomicity, replay, download authorization, and migration behavior.
- Prove that a repeated manual reconcile creates a new run referencing the same immutable source pair.
- Exercise the real operator sequence in Chromium: select store, select task, select accounting month, upload both sources, run, and download both final outputs.
- Include a browser failure path for accounting-period mismatch and confirm no final download is offered.

### 8. Enable only after acceptance

Before changing the profile to `enabled: true`, require all of the following:

- the protected monthly acceptance comparison passes without a conditional skip;
- expected matches, source-only counts, totals, adjustment semantics, and variance agree with approved artifacts;
- stored and regenerated artifacts agree;
- all previously supported rooftop golden tests remain unchanged;
- PostgreSQL migration, persistence, and vertical-slice tests pass;
- backend lint, typecheck, build, and full tests pass;
- frontend lint, unit tests, build, and Playwright pass; and
- whole-branch code and security reviews have no unresolved blocking finding.

Record the profile-enablement change as a separate, reviewable step. A passing Acura gate does not authorize enabling Fort Worth, Burleson, Huntsville, or West.

## Verification isolation

Set the conditional acceptance suite's evidence-directory environment variable to the absolute protected rooftop directory only for the test process. Tests may read that directory but must not copy its contents or include raw data in logs, snapshots, diffs, or failure messages. Acceptance failures must report only safe counts, totals, labels, formulas, and other structural differences.

Run repository-configured commands rather than guessed equivalents. At minimum, every onboarding must cover server lint/typecheck/build/full tests, database migration and persistence tests against the isolated local test database, protected-evidence acceptance, frontend lint/unit/build, browser E2E, prior-rooftop golden regressions, a final diff check, and explicit tracked/staged discovery-artifact checks.
