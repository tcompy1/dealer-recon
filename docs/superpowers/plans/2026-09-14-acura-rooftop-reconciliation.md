# Acura Rooftop Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver an Acura month-end reconciliation vertical slice that validates an operator-selected accounting month, uses a versioned Acura rooftop profile, persists truthful parser/preprocessor provenance, produces the approved merged and FP REC outputs, and leaves Hurst behavior unchanged.

**Architecture:** Keep the existing Express upload/reconcile APIs, PostgreSQL and in-memory repository boundary, reconciliation kernel, and download workflow. Add an explicit `RooftopProfile` and `AccountingMonth` boundary ahead of preprocessing; persist the selected period and versioned provenance on immutable source files and runs; build all required artifacts from the stored run detail through the profile-selected presenters; and expose the same contract to the React workflow. The shared kernel remains store-agnostic, and every Acura variation lives in the profile, a source-period validator, or a presenter policy—never a hidden store-name branch.

**Tech Stack:** TypeScript, Node 20, Express, PostgreSQL 16, node-pg-migrate, Vitest, React 18, Vite 5, Playwright Chromium, `csv-parse`, and `exceljs` as a test-only semantic reader for the approved `.xlsx` goal workbook.

**Spec:** `docs/superpowers/specs/2026-09-14-acura-rooftop-reconciliation-design.md`

## Global Constraints

- Read repository-root `AGENTS.md` and `docs/development/testing-policy.md` before starting, then follow RED -> GREEN -> REFACTOR for every production behavior change.
- Do not implement a production-code step until Task 1's Acura characterization report is complete and its stop gate passes.
- Never add, stage, or commit anything under `docs/discovery/hiley-artifacts/`; add the protection rule before creating any implementation commit.
- Preserve the existing Hurst counts, totals, ordering, artifact names, compact FP REC workpaper, and download behavior. Run the named Hurst regressions after every shared-code task.
- Keep money in integer cents. Keep `reconcileTransactionSets()` in `server/src/services/reconciliationEngine.ts` free of rooftop-name logic.
- Treat the selected accounting month as authoritative. Use `YYYY-MM` as the canonical machine value, `MMM YYYY` as the operator label, and the concrete pattern `ACURA · Apr 2026 · Run #42` as the visible run identity.
- Acura's raw inputs are CSV. Do not add native `.xlsx` upload support; the approved `.xlsx` file is a test-only output reference.
- Reuse a healthy immutable source file only when store, source type, accounting month, SHA-256, parser name/version, and preprocessor name/version all match. A later manual reconciliation creates a new run referencing those immutable inputs; it does not return an old run.
- Generate FP REC from the stored `ReconciliationRunDetail`; never call a second matcher from a presenter.
- A run may transition from `artifact_pending` to `completed`/`completed_auto` only after one atomic artifact batch contains every profile-required artifact. A failed batch leaves no partial artifacts and sets `artifact_failed`.
- Do not rewrite Git history to purge already-tracked Acura-looking fixtures without separate authorization. Replace their working-tree use with sanitized fixtures and record the history concern.
- Do not begin Task 1 until this reviewed plan is committed and clean at `docs/superpowers/plans/2026-09-14-acura-rooftop-reconciliation.md` under the pre-execution gate below.

## Evidence Decisions and Stop Gate

The implementation uses the approved evidence hierarchy and these explicit resolutions:

- April 2026 is the canonical end-to-end acceptance month because it is the latest month with raw BOA CSV, raw Dealertrack CSV, a completed merged CSV, and an `APR26` sheet in `Acura FP Rec.xlsx`. March 2026 is the second complete raw/merged regression month.
- The approved merged CSV defines the eight-column detail worksheet: `ACURA`, `Serial No/VIN`, `VIN6`, `Ending Balance`, `324`, `VIN6`, `Description`, `Control`.
- The goal workbook defines FP REC as the compact four-column accounting workpaper. Older Hurst-oriented documentation describing an A-H FP REC detail sheet does not override Acura's goal workbook; the A-H detail belongs in `MERGED_FLOORPLAN`.
- Dealertrack CSV has no explicit statement-period banner. Its transaction-description dates are supporting evidence: a date later than the selected month is a contradiction; dates at or before the selected month are compatible but may be incomplete. Filename month tokens are hints only and must never override file content or operator selection.
- BOA's `Dealer Billing Statement for: <Month> <Year>` banner is hard period evidence. A different banner month is a blocking mismatch.
- Existing Acura tests contain byte-identical copies of client CSVs, and the discovery directory lacks the raw February BOA file present in those tracked fixtures. Tests must move to sanitized fixtures; February remains characterization-only unless an authoritative discovery copy is supplied.
- The goal workbook and recording include May 2026 work, but the discovery directory has no May BOA, Dealertrack, or completed merged input set. May is an output/recording cross-check, not the vertical-slice acceptance input.

**Mandatory stop:** If Task 1 finds that April is not the approved monthly example, that account `324` is not exclusive, that FP REC is not the compact four-column workpaper, or that a manual transformation changes the recorded counts/totals below, stop before Task 3 and obtain a product/accounting decision. Do not silently substitute a rule.

## Pre-execution Gate

This gate is deliberately outside the implementation tasks. The plan reviewer or repository owner must approve the final plan, then commit only the plan before Task 1 begins. This revision session must not perform that commit.

- [ ] Confirm the reviewed plan has no staged or unstaged edits:

```bash
git diff --exit-code -- docs/superpowers/plans/2026-09-14-acura-rooftop-reconciliation.md
git diff --cached --exit-code -- docs/superpowers/plans/2026-09-14-acura-rooftop-reconciliation.md
```

- [ ] Confirm the plan is tracked and identify the commit that introduced it:

```bash
git ls-files --error-unmatch docs/superpowers/plans/2026-09-14-acura-rooftop-reconciliation.md
git log -1 --format='%H %s' -- docs/superpowers/plans/2026-09-14-acura-rooftop-reconciliation.md
PLAN_COMMIT=$(git log -1 --format='%H' -- docs/superpowers/plans/2026-09-14-acura-rooftop-reconciliation.md)
git diff-tree --no-commit-id --name-only -r "$PLAN_COMMIT"
```

Expected: `git ls-files` prints the exact plan path, both diff commands exit 0, `git log` prints a non-empty commit hash and reviewed plan commit subject, and `git diff-tree` prints only `docs/superpowers/plans/2026-09-14-acura-rooftop-reconciliation.md`. If any check fails, stop before Task 1.

---

### Task 1: Protect and characterize the Acura evidence before production changes

**Files:**

- Modify: `.gitignore`
- Create: `docs/superpowers/characterizations/2026-09-14-acura-rooftop-reconciliation.md`
- Read only: `docs/discovery/hiley-artifacts/acura/`
- Read only: `docs/discovery/hiley-artifacts/acura/Acura FP Rec.xlsx`
- Read only: `docs/discovery/hiley-artifacts/acura/ACURA SCREEN RECORD.mp4`

**Interfaces:**

- Consumes: approved contract `docs/superpowers/specs/2026-09-14-acura-rooftop-reconciliation-design.md`; existing `detectFileFormat(buffer: Buffer, originalFilename?: string | null): FileFormatDetection`; existing `parseCsvToTable(buffer: Buffer | string, headerMode: "with_header" | "no_header"): ParsedTable`; existing `preprocessBoa(parsed: ParsedTable, options?: BoaPreprocessOptions): PreprocessingResult`; existing `preprocessDealertrack(parsed: ParsedTable, options?: DealertrackPreprocessOptions): PreprocessingResult`; the eleven read-only files currently inventoried under `docs/discovery/hiley-artifacts/acura/`.
- Produces: `.gitignore` rule `docs/discovery/hiley-artifacts/`; characterization document `docs/superpowers/characterizations/2026-09-14-acura-rooftop-reconciliation.md` with exact `Evidence inventory`, `Period evidence`, `Transformations`, `Counts and totals`, `Merged contract`, `FP REC contract`, `Conflicts`, and `Gate verdict` sections; the April 2026 baseline consumed by Tasks 2, 4, 8, 10, and 12.

- [ ] **Step 1: Re-inventory all five rooftop directories without opening a write path**

Run from the repository root:

```bash
find docs/discovery/hiley-artifacts/acura -maxdepth 1 -type f -print | sort
find docs/discovery/hiley-artifacts/burleson -maxdepth 1 -type f -print | sort
find docs/discovery/hiley-artifacts/fw -maxdepth 1 -type f -print | sort
find docs/discovery/hiley-artifacts/hsv -maxdepth 1 -type f -print | sort
find docs/discovery/hiley-artifacts/west -maxdepth 1 -type f -print | sort
git status --short
```

Expected: all five directories exist; the Acura directory contains eight CSVs, one `.xlsx`, one `.mp4`, and `.DS_Store`; every discovery artifact remains untracked/unstaged.

- [ ] **Step 2: Add the repository protection rule before any implementation commit**

Append this exact rule to `.gitignore`:

```gitignore
# Local Hiley rooftop evidence contains client data and recordings.
docs/discovery/hiley-artifacts/
```

Verify:

```bash
git check-ignore -v docs/discovery/hiley-artifacts/acura/Acura\ FP\ Rec.xlsx
git check-ignore -v docs/discovery/hiley-artifacts/acura/ACURA\ SCREEN\ RECORD.mp4
git status --short
```

Expected: both files resolve to the new `.gitignore` rule and no discovery artifact appears in status.

- [ ] **Step 3: Write the characterization report from aggregate and structural evidence**

The report must identify every Acura file by evidence type and include these currently observed baselines, rechecked against the local originals:

| Month | BOA accepted | Dealertrack accepted | Matched | BOA-only | DT-only | BOA cents | DT cents | FP REC difference cents |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Feb 2026 | 114 | 129 | 114 | 0 | 15 | 546981440 | -618816030 | -71834590 |
| Mar 2026 | 204 | 213 | 204 | 0 | 9 | 980937310 | -1027649870 | -46712560 |
| Apr 2026 | 199 | 208 | 199 | 0 | 9 | 1005665140 | -1039411200 | -33746060 |

Also record:

- BOA row removal for March: 278 scanned, 70 zero-balance, 1 Straight Line, 3 banner/header/total, 204 accepted.
- BOA row removal for April: 291 scanned, 88 zero-balance, 1 Straight Line, 3 banner/header/total, 199 accepted.
- Dealertrack filtering: account column `324`, one non-detail/unknown row removed in March and April, no excluded account columns.
- BOA amount rule: `Ending Balance`, with auditable `Original Amount` fallback only when the ending-balance cell is unavailable under a characterized structure.
- Dealertrack sign rule: imported GL amounts remain negative; matching uses exact absolute cents.
- BOA VIN comes from the serial/VIN field; Dealertrack VIN is extracted from `Description`; both derive VIN6 through existing `computeVin6()`.
- Merged ordering and exception placement from the completed CSV, including duplicate and same-VIN6/different-amount examples if present.
- FP REC formulas: `Difference = Outstanding STMT + Total GL`, `Net adjustments = schedule-only subtotal + statement-only subtotal`, `Variance = Net adjustments - Difference`; April's final variance is zero.
- Goal sheets `FEB 26`, `MAR 26`, `APR26`, `MAY26`; recent goal sheets use four visible columns and print area A:D.
- Each conflict listed in “Evidence Decisions and Stop Gate,” including the missing February raw BOA and missing May raw pair.

Do not copy VINs, raw rows, or binary artifacts into the report.

- [ ] **Step 4: Execute the characterization stop gate**

Compare the report against:

```bash
sed -n '1,340p' docs/superpowers/specs/2026-09-14-acura-rooftop-reconciliation-design.md
sed -n '1,260p' docs/implementation/fp-rec-output-fidelity.md
```

Expected: every conflict has an explicit evidence-authority resolution. If any mandatory-stop condition remains unresolved, stop here and report it; Tasks 3-12 are not authorized by a merely partial characterization.

- [ ] **Step 5: Commit only the protection rule and characterization report**

```bash
git add .gitignore docs/superpowers/characterizations/2026-09-14-acura-rooftop-reconciliation.md
git diff --cached --check
git diff --cached --name-only
git commit -m "docs: characterize Acura reconciliation evidence"
```

Expected staged names: only `.gitignore` and the characterization report.

### Task 2: Replace client-like test inputs with sanitized structural fixtures

**Files:**

- Delete: `server/src/presenters/__fixtures__/acura/ACURA BOA FEB(in).csv`
- Delete: `server/src/presenters/__fixtures__/acura/ACURA BOA MARCH(in).csv`
- Delete: `server/src/presenters/__fixtures__/acura/ACURA BOA APRIL(in).csv`
- Delete: `server/src/presenters/__fixtures__/acura/ACURA DT FEB(in).csv`
- Delete: `server/src/presenters/__fixtures__/acura/ACURA DT MARCH(in).csv`
- Delete: `server/src/presenters/__fixtures__/acura/ACURA DT APRIL(in).csv`
- Delete: `server/src/presenters/__fixtures__/acura/ACURA FEB MERGED(BillingStatementFebruary2026).csv`
- Delete: `server/src/presenters/__fixtures__/acura/ACURA MARCH MERGED(BillingStatementMarch2026).csv`
- Delete: `server/src/presenters/__fixtures__/acura/ACURA APRIL MERGED(BillingStatementApril2026).csv`
- Create: `server/src/testFixtures/acura/boa-april-2026-sanitized.csv`
- Create: `server/src/testFixtures/acura/dealertrack-april-2026-sanitized.csv`
- Create: `server/src/testFixtures/acura/merged-april-2026-sanitized.csv`
- Create: `server/src/testFixtures/acura/acura-april-2026-contract.json`
- Create: `server/src/testFixtures/acura/index.ts`
- Modify: `server/src/services/reconciliationEngine.test.ts`
- Modify: `server/src/presenters/mergedFloorplan.test.ts`
- Modify: `server/src/presenters/hurstFpRec.test.ts`

**Interfaces:**

- Consumes: Task 1's approved characterization report and its `Gate verdict: PASS`; existing `parseCsvToTable()`, `preprocessBoa()`, `preprocessDealertrack()`, `buildMergedFloorplanWorkbook()`, `buildHurstFpRecWorkbook()`, and their existing Hurst regression fixtures.
- Produces: `SANITIZED_ACURA_FIXTURE_ROOT: string`; `ACURA_SANITIZED_FIXTURE_PATHS: Readonly<{ boaCsv: string; dealertrackCsv: string; mergedCsv: string; contractJson: string }>` containing normalized absolute paths; `AcuraSanitizedContract`; `loadAcuraSanitizedContract(): AcuraSanitizedContract`; four sanitized fixtures consumed by Tasks 3, 4, 8, 10, and 11. `AcuraSanitizedContract` contains `profileId: "acura-v1"`, `accountingMonth: "2026-04"`, synthetic `counts`, integer-cent `totals`, `rowOrder`, `mergedHeaders`, and `fpRec` labels/formula semantics.

```ts
export type AcuraSanitizedContract = {
  profileId: "acura-v1";
  accountingMonth: "2026-04";
  counts: {
    boaAccepted: number;
    dealertrackAccepted: number;
    matched: number;
    boaOnly: number;
    dealertrackOnly: number;
    duplicateCandidates: number;
    amountMismatchRows: number;
  };
  totals: {
    boaCents: number;
    dealertrackCents: number;
    differenceCents: number;
    netAdjustmentsCents: number;
    varianceCents: number;
  };
  rowOrder: string[];
  mergedHeaders: ["ACURA", "Serial No/VIN", "VIN6", "Ending Balance", "324", "VIN6", "Description", "Control"];
  fpRec: {
    statementLabel: "Outstanding STMT";
    glLabel: "Total GL";
    differenceFormula: "statement_plus_gl";
    netAdjustmentsFormula: "schedule_only_plus_statement_only";
    varianceFormula: "net_adjustments_minus_difference";
  };
};
```

- [ ] **Step 1: Write fixture-safety assertions before changing fixtures**

In `server/src/presenters/mergedFloorplan.test.ts`, build `actualAcuraFixturePaths` from the same `fixtureDir` and `ACURA_MERGED_FIXTURE_CASES` filename fields that the parser/presenter tests actually pass to `readFileSync()`. Add this path-containment test; do not inspect the test file's source text:

```ts
test("uses only sanitized Acura fixtures", () => {
  const absoluteRoot = resolve(presenterDir, "..", "testFixtures", "acura");
  const rootPrefix = `${absoluteRoot}${sep}`;
  const actualAcuraFixturePaths = ACURA_MERGED_FIXTURE_CASES.flatMap((fixtureCase) => [
    join(fixtureDir, fixtureCase.rawBoaFilename),
    join(fixtureDir, fixtureCase.rawDealertrackFilename),
    join(fixtureDir, fixtureCase.mergedFilename),
  ]);
  for (const fixturePath of actualAcuraFixturePaths) {
    const absoluteFixture = realpathSync(fixturePath);
    expect(isAbsolute(absoluteFixture)).toBe(true);
    expect(absoluteFixture.startsWith(rootPrefix)).toBe(true);
  }
});
```

Import `realpathSync` from `node:fs` and `isAbsolute`, `resolve`, and `sep` from `node:path`; reuse the existing `join`. Comparing each real imported fixture path to the normalized absolute sanitized root prevents `..`, symlink, and sibling-prefix escapes. This test contains no assertion about forbidden text literals.

Run:

```bash
cd server
npm test -- src/presenters/mergedFloorplan.test.ts src/presenters/hurstFpRec.test.ts
```

Expected RED: the current fixture paths resolve outside the absolute sanitized-fixture root.

- [ ] **Step 2: Create a compact synthetic contract fixture**

In `server/src/testFixtures/acura/index.ts`, resolve all four sanitized fixture paths from `dirname(fileURLToPath(import.meta.url))` and export the interfaces above. Use invented VINs, stock numbers, descriptions, and amounts. Include at least:

- one exact VIN6 + absolute-amount match;
- one BOA-only row;
- one Dealertrack-only account-324 row;
- one duplicate VIN6 candidate;
- one same-VIN6 amount mismatch split into two exception rows;
- one BOA zero-balance row;
- one BOA Straight Line row;
- one BOA row using the approved Original Amount fallback;
- one Dealertrack non-324 column that must not contribute;
- one missing-VIN warning row.

`acura-april-2026-contract.json` must contain only expected synthetic counts, integer-cent totals, row order, merged headers, FP REC labels/formulas, and the profile/period values `acura-v1` and `2026-04`.

- [ ] **Step 3: Repoint and tighten the presenter tests**

Replace the current full-client-data fixture loops with table-driven assertions over the sanitized CSVs and JSON. Keep the April aggregate client values only in the characterization/conditional acceptance path added in Task 8, not in raw committed rows.

Import `ACURA_SANITIZED_FIXTURE_PATHS` and `loadAcuraSanitizedContract()` from `server/src/testFixtures/acura/index.ts`. Pass those exact exported paths to every `readFileSync()` call. Update `actualAcuraFixturePaths` to `Object.values(ACURA_SANITIZED_FIXTURE_PATHS)` so the final safety assertion covers every fixture the tests import, including the JSON contract.

Add table-driven `reconcileTransactionSets()` assertions in `server/src/services/reconciliationEngine.test.ts` for the sanitized exact match, duplicate candidate, same-VIN6 amount mismatch, BOA-only, Dealertrack-only, integer-cent totals, and deterministic order. These characterize the shared kernel; do not add Acura logic to the engine.

Run:

```bash
cd server
npm test -- src/services/reconciliationEngine.test.ts src/presenters/mergedFloorplan.test.ts src/presenters/hurstFpRec.test.ts
```

Expected GREEN: synthetic Acura parser/preprocessor/presenter coverage passes and all pre-existing Hurst tests in those files remain green.

- [ ] **Step 4: Confirm no committed code or test reads local evidence**

```bash
rg -l "hiley-artifacts|presenters/__fixtures__/acura" . --hidden --glob '!.git/**' --glob '!docs/superpowers/plans/**' --glob '!docs/superpowers/characterizations/**' | sort
git status --short
```

Expected `rg` output: only `.gitignore` and `docs/superpowers/specs/2026-09-14-acura-rooftop-reconciliation-design.md`. No runtime/test file is allowed. The plan and characterization documents are excluded because they intentionally document those paths. Git status shows the removed tracked fixtures and new sanitized fixtures as the only fixture changes.

- [ ] **Step 5: Commit the fixture safety change**

```bash
git add server/src/presenters/__fixtures__/acura server/src/testFixtures/acura server/src/services/reconciliationEngine.test.ts server/src/presenters/mergedFloorplan.test.ts server/src/presenters/hurstFpRec.test.ts
git diff --cached --check
git commit -m "test: sanitize Acura reconciliation fixtures"
```

### Task 3: Introduce a typed, versioned rooftop profile and unsupported-store gate

**Files:**

- Modify: `server/src/config/storeWorkflowConfig.ts`
- Create: `server/src/config/rooftopProfile.test.ts`
- Modify: `server/src/domain/types.ts`
- Create: `server/src/services/rooftopValidation.ts`
- Create: `server/src/services/rooftopValidation.test.ts`
- Modify: `server/src/app.ts`
- Modify: `server/src/app.test.ts`
- Modify: `frontend/src/types/store.ts`

**Interfaces:**

- Consumes: Task 2's `AcuraSanitizedContract`, `ACURA_SANITIZED_FIXTURE_PATHS`, and existing `DetectedFileFormat`, `ReconciliationArtifactType`, `StoreWorkflowConfig`, `DealershipStore`, `STORE_KEYS`, `getStoreWorkflowConfig()`, and `resolveStoreWorkflowConfigFromStoreName()` contracts.
- Produces: `RooftopProfileId`, `ParserIdentity`, `PreprocessorIdentity`, and `RooftopProfile`; `ROOFTOP_PROFILES: Record<StoreKey, RooftopProfile>`; `getRooftopProfile(storeKey: StoreKey): RooftopProfile`; `resolveRooftopProfileFromStoreName(storeName: string | null | undefined): RooftopProfile | null`; `resolveEnabledRooftopProfileFromStoreName(storeName: string | null | undefined): RooftopProfile | null`; `REQUIRED_RECONCILIATION_ARTIFACT_TYPES: readonly ReconciliationArtifactType[]`; `RooftopFailureDetails`; `rooftopValidationError(code: string, message: string, details: RooftopFailureDetails): HttpValidationError`; server/frontend `DealershipStoreWithRooftopSupport`; `GET /stores -> DealershipStoreWithRooftopSupport[]`; `withRooftopSupport(store: DealershipStore): DealershipStoreWithRooftopSupport` inside `app.ts`. Tasks 4-12 consume these exact names.

- [ ] **Step 1: Write profile contract tests**

Add tests for the exact public interface:

```ts
export type RooftopProfileId = "hurst-v1" | "acura-v1" | "fw-v0";

export type ParserIdentity = {
  name: "boa-csv" | "boa-html-xls" | "dealertrack-csv" | "dealertrack-spreadsheetml";
  version: string;
  format: DetectedFileFormat;
};

export type PreprocessorIdentity = {
  name: "boa-floorplan" | "dealertrack-floorplan";
  version: string;
};

export type RooftopProfile = StoreWorkflowConfig & {
  profileId: RooftopProfileId;
  profileVersion: string;
  enabled: boolean;
  supportedSourceFormats: Record<"boa" | "dealertrack", readonly DetectedFileFormat[]>;
  parserIdentities: Record<"boa" | "dealertrack", readonly ParserIdentity[]>;
  preprocessorIdentities: Record<"boa" | "dealertrack", PreprocessorIdentity>;
  requiredArtifactTypes: readonly ReconciliationArtifactType[];
  presenterId: "hurst-fp-rec-v1" | "acura-fp-rec-v1";
  goldenFixtureIds: readonly string[];
};
```

Assert:

- `acura` resolves to enabled `profileId: "acura-v1"`, profile version `"1"`, BOA/Dealertrack CSV, account `324`, no exclusion columns, presenter `acura-fp-rec-v1`, and all six artifact types.
- `hurst` retains account `2100`, excluded `2110`, `after_boa_rows`, and presenter `hurst-fp-rec-v1`.
- `fw` remains disabled (`profileId: "fw-v0"`) for this slice even though its parsing configuration exists.
- Arlington, Burleson, HSV, West, and unknown names resolve to no enabled profile.

Run:

```bash
cd server
npm test -- src/config/rooftopProfile.test.ts
```

Expected RED: `RooftopProfile` and its versioned/gating fields do not exist.

- [ ] **Step 2: Implement the profile without store-name branches downstream**

In `server/src/config/storeWorkflowConfig.ts`:

- keep `STORE_KEYS`, `getStoreWorkflowConfig()`, and `resolveStoreWorkflowConfigFromStoreName()` as compatibility wrappers;
- add `ROOFTOP_PROFILES`, `getRooftopProfile(storeKey)`, `resolveRooftopProfileFromStoreName(storeName)`, and `resolveEnabledRooftopProfileFromStoreName(storeName)`;
- define shared `REQUIRED_RECONCILIATION_ARTIFACT_TYPES` once and reference it from Hurst and Acura;
- keep aliases in this boundary only.

Run the focused test and the existing store-aware presenters:

```bash
cd server
npm test -- src/config/rooftopProfile.test.ts src/presenters/mergedFloorplan.test.ts src/presenters/hurstFpRec.test.ts
```

Expected GREEN.

- [ ] **Step 3: Expose profile support on `GET /stores`**

Add this response-only type to `server/src/domain/types.ts` and mirror it in `frontend/src/types/store.ts`:

```ts
export type DealershipStoreWithRooftopSupport = DealershipStore & {
  rooftop_profile: {
    id: RooftopProfileId;
    version: string;
    enabled: boolean;
  } | null;
};
```

Map `GET /stores` through a pure helper `withRooftopSupport(store)` in `server/src/app.ts`. Add an `app.test.ts` assertion that Hiley Acura is enabled and Arlington is unsupported. Do not change authorization filtering.

- [ ] **Step 4: Fail before upload/reconciliation work for unsupported rooftops**

Define the initial shared error contract in `server/src/services/rooftopValidation.ts`:

```ts
export type RooftopFailureDetails = {
  source: "boa" | "dealertrack" | null;
  accounting_month: string | null;
  rooftop_profile_id: string | null;
  evidence?: Record<string, string | number | boolean | null>;
  recovery: string;
};

export function rooftopValidationError(
  code: string,
  message: string,
  details: RooftopFailureDetails,
): HttpValidationError;
```

Import `ValidationError as HttpValidationError` from `server/src/errors/HttpError.ts` so this return type cannot be confused with the row-level `ValidationError` type in `server/src/domain/types.ts`.

Add app tests asserting `POST /upload` and `POST /reconcile` return 422 with:

```json
{
  "error": {
    "code": "ROOFTOP_PROFILE_UNSUPPORTED",
    "message": "The selected store is not enabled for floorplan reconciliation.",
    "details": {
      "source": null,
      "accounting_month": "2026-04",
      "rooftop_profile_id": null,
      "recovery": "Select an enabled rooftop or complete that rooftop's evidence onboarding."
    }
  }
}
```

At this step, parse `accounting_month` only as a non-empty string; Task 4 adds strict semantics. Assert no source file, transaction, run, or artifact is created.

Run:

```bash
cd server
npm test -- src/app.test.ts src/config/rooftopProfile.test.ts src/services/rooftopValidation.test.ts
```

Expected RED before gating; GREEN after using `resolveEnabledRooftopProfileFromStoreName()` at both entry points.

- [ ] **Step 5: Commit**

```bash
git add server/src/config/storeWorkflowConfig.ts server/src/config/rooftopProfile.test.ts server/src/domain/types.ts server/src/services/rooftopValidation.ts server/src/services/rooftopValidation.test.ts server/src/app.ts server/src/app.test.ts frontend/src/types/store.ts
git diff --cached --check
git commit -m "feat: gate reconciliation by rooftop profile"
```

### Task 4: Define accounting-month and source-period evidence semantics

**Files:**

- Create: `server/src/domain/accountingMonth.ts`
- Create: `server/src/domain/accountingMonth.test.ts`
- Create: `server/src/services/sourcePeriodEvidence.ts`
- Create: `server/src/services/sourcePeriodEvidence.test.ts`
- Modify: `server/src/services/parsers/sourceParserRouter.test.ts`
- Modify: `server/src/services/parsers/csvTableParser.test.ts`
- Modify: `server/src/services/preprocessing/types.ts`
- Modify: `server/src/services/preprocessing/index.ts`
- Modify: `server/src/services/preprocessing/boaPreprocessor.ts`
- Modify: `server/src/services/preprocessing/boaPreprocessor.test.ts`
- Modify: `server/src/services/preprocessing/dealertrackPreprocessor.test.ts`

**Interfaces:**

- Consumes: Task 3's `ParserIdentity`, `PreprocessorIdentity`, and enabled `RooftopProfile`; Task 2's `ACURA_SANITIZED_FIXTURE_PATHS`; existing `ParsedTable`, `PreprocessingResult`, `PreprocessingSummary`, `preprocessUpload()`, `preprocessBoa()`, and `preprocessDealertrack()`.
- Produces: branded `AccountingMonth`; `parseAccountingMonth(value: unknown): AccountingMonth | null`; `formatAccountingMonth(month: AccountingMonth): string`; `accountingMonthEndDate(month: AccountingMonth): string`; `SourcePeriodEvidence`; `SourcePeriodValidation`; `deriveBoaPeriodEvidence(parsed: ParsedTable, filename: string | null, selectedMonth: AccountingMonth): SourcePeriodValidation`; `deriveDealertrackPeriodEvidence(parsed: ParsedTable, filename: string | null, selectedMonth: AccountingMonth): SourcePeriodValidation`; `PreprocessUploadOptions`; `BoaPreprocessOptions`; extended `DealertrackPreprocessOptions`; `preprocessUpload(buffer: Buffer, sourceType: SourceType, originalFilename: string | null, options: PreprocessUploadOptions): PreprocessingOrchestrationDecision`; `preprocessBoa(parsed: ParsedTable, options: BoaPreprocessOptions): PreprocessingResult`; `preprocessDealertrack(parsed: ParsedTable, options: DealertrackPreprocessOptions): PreprocessingResult`; exported `RemovedRow` and `UploadPreprocessingMetadata`; truthful `PreprocessingSummary.parser_name`, `.parser_version`, `.preprocessor_name`, `.preprocessor_version`, and `.period_evidence`. Tasks 5-12 consume these exact contracts.

- [ ] **Step 1: Write RED tests for the canonical value and label**

Define:

```ts
export type AccountingMonth = string & { readonly __accountingMonth: unique symbol };
export function parseAccountingMonth(value: unknown): AccountingMonth | null;
export function formatAccountingMonth(month: AccountingMonth): string;
export function accountingMonthEndDate(month: AccountingMonth): string;
```

Tests must accept `2026-04`, render `Apr 2026`, return `2026-04-30`, handle leap-year February, and reject non-zero-padded, impossible, or timestamp values.

Run:

```bash
cd server
npm test -- src/domain/accountingMonth.test.ts
```

Expected RED: module absent.

- [ ] **Step 2: Implement the smallest UTC-independent month helpers**

Use regex/range validation and an explicit English month-name array; do not parse `YYYY-MM` through local-time `Date` construction.

Run the focused test; expected GREEN.

- [ ] **Step 3: Write RED source-period tests**

Define:

```ts
export type SourcePeriodEvidence = {
  source: "boa" | "dealertrack";
  selectedMonth: AccountingMonth;
  explicitMonths: AccountingMonth[];
  observedDateRange: { min: string; max: string } | null;
  filenameHint: AccountingMonth | null;
  status: "confirmed" | "compatible_incomplete" | "contradictory";
  safeEvidence: Record<string, string | number | boolean | null>;
};

export type SourcePeriodValidation =
  | { ok: true; evidence: SourcePeriodEvidence; warnings: string[] }
  | { ok: false; code: "SOURCE_PERIOD_MISMATCH" | "SOURCE_PERIOD_CONTRADICTORY"; evidence: SourcePeriodEvidence; recovery: string };

export function deriveBoaPeriodEvidence(
  parsed: ParsedTable,
  filename: string | null,
  selectedMonth: AccountingMonth,
): SourcePeriodValidation;

export function deriveDealertrackPeriodEvidence(
  parsed: ParsedTable,
  filename: string | null,
  selectedMonth: AccountingMonth,
): SourcePeriodValidation;
```

Cases:

- April BOA banner + selected April => confirmed;
- March BOA banner + selected April => `SOURCE_PERIOD_MISMATCH`;
- two conflicting BOA banners => `SOURCE_PERIOD_CONTRADICTORY`;
- Dealertrack dates no later than April + selected April => compatible/incomplete warning;
- Dealertrack date in May + selected April => contradiction;
- filename says March but BOA banner says April => banner wins and filename mismatch is a safe warning;
- no usable date evidence => compatible/incomplete warning, never fabricated confirmation.

Add parser tests using Task 2's sanitized CSVs to prove BOA's banner/header shape and Dealertrack's `Control`, `Description`, and `324` columns. Add malformed CSV and missing-required-column cases; parser tests assert structural parsing/warnings, while Task 6 asserts the API's blocking error codes.

Run:

```bash
cd server
npm test -- src/services/sourcePeriodEvidence.test.ts src/services/parsers/sourceParserRouter.test.ts src/services/parsers/csvTableParser.test.ts
```

Expected RED.

- [ ] **Step 4: Attach evidence and real parser identity to preprocessing**

Define the preprocessing options with these exact fields:

```ts
export type PreprocessUploadOptions = {
  accountingMonth: AccountingMonth;
  rooftopProfile: RooftopProfile;
};

export type BoaPreprocessOptions = {
  accountingMonth: AccountingMonth;
  parserIdentity: ParserIdentity;
  preprocessorIdentity: PreprocessorIdentity;
};

export type DealertrackPreprocessOptions = {
  accountingMonth: AccountingMonth;
  parserIdentity: ParserIdentity;
  preprocessorIdentity: PreprocessorIdentity;
  amountColumns?: string[];
  accountColumn?: string;
  accountLabel?: string;
  excludedAccountColumns?: string[];
  removedAccountColumns?: string[];
};
```

Keep the existing `preprocessUpload(buffer, sourceType, originalFilename, options)` parameters. After `resolveParserRoute()`, select the matching `ParserIdentity` from `options.rooftopProfile`; construct `BoaPreprocessOptions` or `DealertrackPreprocessOptions` from that identity, the profile's source preprocessor identity, the selected month, and the profile's Dealertrack account fields. Extend `PreprocessingSummary` with `parser_name`, `parser_version`, `preprocessor_name`, `preprocessor_version`, and `period_evidence`; do not hard-code HTML/XML provenance for CSV routes.

Move the existing app-local `RemovedRow` and `UploadPreprocessingMetadata` declarations to `server/src/services/preprocessing/types.ts`, export them there, and import those single server definitions in `app.ts` and Task 5 persistence types. Task 9 mirrors their JSON shapes in the frontend. Do not maintain duplicate server definitions.

Replace BOA's `BoaPreprocessOptions.now` production decision with `accountingMonth`. Migrate every caller in this task, remove `now` from `BoaPreprocessOptions` before GREEN, and make maturity flags compare with the selected accounting month rather than wall-clock time.

Extend the direct preprocessor tests with the sanitized rows and assert exact reason codes/counts for BOA banner removal, zero-balance removal, Straight Line removal, Ending Balance selection, Original Amount fallback warning, VIN/VIN6 derivation, maturity comparison against `2026-04`, Dealertrack account-324 selection, non-324 exclusion, missing-VIN warning, malformed-row rejection, and deterministic amount/VIN6 sorting.

Run:

```bash
cd server
npm test -- src/domain/accountingMonth.test.ts src/services/sourcePeriodEvidence.test.ts src/services/parsers/sourceParserRouter.test.ts src/services/parsers/csvTableParser.test.ts src/services/preprocessing/index.test.ts src/services/preprocessing/boaPreprocessor.test.ts src/services/preprocessing/dealertrackPreprocessor.test.ts
```

Expected GREEN; a BOA CSV summary says parser `boa-csv`, and a Dealertrack CSV summary says `dealertrack-csv`.

- [ ] **Step 5: Run Hurst preprocessing regression and commit**

```bash
cd server
npm test -- src/services/reconciliationGoldenFixtures.test.ts src/presenters/mergedFloorplan.test.ts src/presenters/hurstFpRec.test.ts
git add src/domain/accountingMonth.ts src/domain/accountingMonth.test.ts src/services/sourcePeriodEvidence.ts src/services/sourcePeriodEvidence.test.ts src/services/preprocessing
git diff --cached --check
git commit -m "feat: validate reconciliation accounting months"
```

### Task 5: Persist accounting month, profile identity, provenance, and reusable receipts

**Files:**

- Create: `server/src/db/migrations/1789344000000_add_rooftop_run_identity.cjs`
- Modify: `server/src/db/migrate.test.ts`
- Modify: `server/src/domain/types.ts`
- Modify: `server/src/repositories/transactionRepository.ts`
- Modify: `server/src/repositories/postgresTransactionRepository.ts`
- Modify: `server/src/repositories/reconciliationPersistence.test.ts`

**Interfaces:**

- Consumes: Task 3's `RooftopProfileId`; Task 4's `AccountingMonth`, `PreprocessingSummary`, and period/provenance metadata; existing `SourceFile`, `NewSourceFile`, `SourceFileSummary`, `ReconciliationRun`, `PersistReconciliationRunInput`, `TransactionRepository`, `MemoryTransactionRepository`, and `PostgresTransactionRepository`.
- Produces: persisted source fields `accounting_month`, `rooftop_profile_id`, `rooftop_profile_version`, `parser_name`, `parser_version`, `preprocessor_name`, `preprocessor_version`, and `preprocessing_metadata`; persisted run fields `accounting_month`, `rooftop_profile_id`, and `rooftop_profile_version`; `SourceProcessingIdentity`; `ProfiledNewSourceFile`; `getReusableSourceFile(dealershipId: number, dealershipStoreId: number, sourceType: SourceType, fileHash: string, identity: SourceProcessingIdentity): Promise<SourceFile | null>` on both repositories; migration rollback error text `Cannot roll back 1789344000000_add_rooftop_run_identity: source_files contains identities that the legacy uniqueness constraint cannot represent.` Tasks 6-12 consume these exact fields and method.

- [ ] **Step 1: Write migration RED tests**

The migration must add nullable legacy-compatible columns:

```text
source_files.accounting_month TEXT
source_files.rooftop_profile_id TEXT
source_files.rooftop_profile_version TEXT
source_files.parser_name TEXT
source_files.parser_version TEXT
source_files.preprocessor_name TEXT
source_files.preprocessor_version TEXT
source_files.preprocessing_metadata JSONB
reconciliation_runs.accounting_month TEXT
reconciliation_runs.rooftop_profile_id TEXT
reconciliation_runs.rooftop_profile_version TEXT
```

Add `YYYY-MM` check constraints for non-null months. Drop `ux_source_files_dealership_source_type_file_hash`; create `ux_source_files_reusable_identity` over dealership, store, source type, accounting month, checksum, parser name/version, and preprocessor name/version. Leave legacy rows nullable rather than inferring months from upload timestamps.

The down migration is conditional, not unrestricted. Before dropping any new column or index, query for two or more rows sharing the legacy identity `(dealership_id, dealership_store_id, source_type, file_hash)`. If any collision exists, throw this exact error and leave the migration applied:

```text
Cannot roll back 1789344000000_add_rooftop_run_identity: source_files contains identities that the legacy uniqueness constraint cannot represent.
```

Only when no collision exists may down drop the new index/constraints/columns and restore `ux_source_files_dealership_source_type_file_hash`. Never delete, merge, or silently choose among differentiated source rows to make rollback succeed.

Run against PostgreSQL:

```bash
docker compose up -d db
cd server
DATABASE_URL=postgresql://dealer_recon:dealer_recon@localhost:5433/dealer_recon npm test -- src/db/migrate.test.ts
```

Expected RED: columns/index absent.

- [ ] **Step 2: Implement and verify representable rollback**

Use this rollback guard before registering destructive down operations:

```js
exports.down = async (pgm) => {
  const collisions = await pgm.db.select(`
    SELECT dealership_id, dealership_store_id, source_type, file_hash
    FROM source_files
    GROUP BY dealership_id, dealership_store_id, source_type, file_hash
    HAVING COUNT(*) > 1
    LIMIT 1
  `);
  if (collisions.length > 0) {
    throw new Error(
      "Cannot roll back 1789344000000_add_rooftop_run_identity: source_files contains identities that the legacy uniqueness constraint cannot represent.",
    );
  }
  pgm.sql(`
    DROP INDEX IF EXISTS ux_source_files_reusable_identity;
    ALTER TABLE source_files DROP CONSTRAINT IF EXISTS source_files_accounting_month_check;
    ALTER TABLE reconciliation_runs DROP CONSTRAINT IF EXISTS reconciliation_runs_accounting_month_check;
    ALTER TABLE source_files
      DROP COLUMN IF EXISTS accounting_month,
      DROP COLUMN IF EXISTS rooftop_profile_id,
      DROP COLUMN IF EXISTS rooftop_profile_version,
      DROP COLUMN IF EXISTS parser_name,
      DROP COLUMN IF EXISTS parser_version,
      DROP COLUMN IF EXISTS preprocessor_name,
      DROP COLUMN IF EXISTS preprocessor_version,
      DROP COLUMN IF EXISTS preprocessing_metadata;
    ALTER TABLE reconciliation_runs
      DROP COLUMN IF EXISTS accounting_month,
      DROP COLUMN IF EXISTS rooftop_profile_id,
      DROP COLUMN IF EXISTS rooftop_profile_version;
    CREATE UNIQUE INDEX ux_source_files_dealership_source_type_file_hash
      ON source_files (dealership_id, dealership_store_id, source_type, file_hash);
  `);
};
```

Run the same test; expected GREEN. With no differentiated collision rows, run down/up once:

```bash
cd server
DATABASE_URL=postgresql://dealer_recon:dealer_recon@localhost:5433/dealer_recon npm run migrate:down
DATABASE_URL=postgresql://dealer_recon:dealer_recon@localhost:5433/dealer_recon npm run migrate
```

- [ ] **Step 3: Prove rollback fails safely after differentiated rows exist**

In `server/src/db/migrate.test.ts`, define `class MigrationCommandError extends Error { stderr: string }` and `runMigrationDownCapturingOutput(databaseUrl: string): Promise<void>` around `execFile()`. Migrate up, insert two valid `source_files` rows with the same dealership/store/source/checksum: the first uses `accounting_month = '2026-04'`, `parser_version = '1'`, `preprocessor_version = '1'`; the second uses `accounting_month = '2026-05'`, `parser_version = '2'`, `preprocessor_version = '2'`. Invoke the helper so stderr is captured. Assert:

```ts
await expect(runMigrationDownCapturingOutput(databaseUrl)).rejects.toMatchObject({
  stderr: expect.stringContaining(
    "Cannot roll back 1789344000000_add_rooftop_run_identity: source_files contains identities that the legacy uniqueness constraint cannot represent.",
  ),
});
```

After rejection, query both rows and the new columns/index to prove the failed rollback preserved data and left the migration applied. Clean up the test rows, then run down/up to restore the suite's expected schema.

Run:

```bash
cd server
DATABASE_URL=postgresql://dealer_recon:dealer_recon@localhost:5433/dealer_recon npm test -- src/db/migrate.test.ts
```

Expected RED until the collision guard exists; GREEN when the explicit failure and preserved state are observed.

- [ ] **Step 4: Extend domain/repository contracts**

Add a reusable value type:

```ts
export type SourceProcessingIdentity = {
  accounting_month: AccountingMonth;
  rooftop_profile_id: RooftopProfileId;
  rooftop_profile_version: string;
  parser_name: string;
  parser_version: string;
  preprocessor_name: string;
  preprocessor_version: string;
};

export type ProfiledNewSourceFile = NewSourceFile & SourceProcessingIdentity & {
  preprocessing_metadata: UploadPreprocessingMetadata;
};
```

Add `accounting_month: AccountingMonth | null`, `rooftop_profile_id: RooftopProfileId | null`, `rooftop_profile_version: string | null`, `parser_name: string | null`, `parser_version: string | null`, `preprocessor_name: string | null`, `preprocessor_version: string | null`, and `preprocessing_metadata: UploadPreprocessingMetadata | null` to `SourceFile` and `SourceFileSummary`. Permit those fields as optional legacy-compatible inputs on `NewSourceFile`, but require `ProfiledNewSourceFile` in the profiled `/upload` path. Add `accounting_month: AccountingMonth | null`, `rooftop_profile_id: RooftopProfileId | null`, and `rooftop_profile_version: string | null` to `ReconciliationRun`, `ReconciliationRunListItem`, `ReconciliationRunDetail`, and `PersistReconciliationRunInput`. Replace:

```ts
getSourceFileByHash(dealershipId, storeId, sourceType, fileHash)
```

with:

```ts
getReusableSourceFile(
  dealershipId: number,
  dealershipStoreId: number,
  sourceType: SourceType,
  fileHash: string,
  identity: SourceProcessingIdentity,
): Promise<SourceFile | null>;
```

Retain `getSourceFileByHash()` during Task 5 so this persistence commit remains independently compatible. Task 6 must migrate `/upload` and its tests, verify `rg -n "getSourceFileByHash" server/src` finds only the interface/repository declarations, then remove the method from the interface and both repository implementations before Task 6 reaches GREEN.

- [ ] **Step 5: Write RED repository tests for exact reuse and round-trip**

For both `MemoryTransactionRepository` and `PostgresTransactionRepository`, assert:

- every field round-trips on source files and runs;
- equal checksum with a different month creates a distinct source file;
- equal checksum with a different parser/preprocessor version creates a distinct source file;
- an exact identity returns the original immutable source and its full preprocessing metadata, including removed-row evidence;
- legacy nullable rows remain readable but are never selected by `getReusableSourceFile()`.

Run:

```bash
cd server
npm test -- src/repositories/reconciliationPersistence.test.ts
DATABASE_URL=postgresql://dealer_recon:dealer_recon@localhost:5433/dealer_recon npm test -- src/repositories/reconciliationPersistence.test.ts
npm test -- src/services/reconciliationGoldenFixtures.test.ts src/presenters/mergedFloorplan.test.ts src/presenters/hurstFpRec.test.ts
```

Expected RED before repository changes; GREEN afterward in both modes.

- [ ] **Step 6: Commit**

```bash
git add server/src/db/migrations/1789344000000_add_rooftop_run_identity.cjs server/src/db/migrate.test.ts server/src/domain/types.ts server/src/repositories/transactionRepository.ts server/src/repositories/postgresTransactionRepository.ts server/src/repositories/reconciliationPersistence.test.ts
git diff --cached --check
git commit -m "feat: persist rooftop reconciliation identity"
```

### Task 6: Wire validated period/profile/provenance through upload and duplicate reuse

**Files:**

- Modify: `server/src/services/rooftopValidation.ts`
- Modify: `server/src/services/rooftopValidation.test.ts`
- Modify: `server/src/app.ts`
- Modify: `server/src/app.test.ts`
- Modify: `server/src/services/preprocessing/index.ts`
- Modify: `server/src/services/reconciliationAutomation.ts`
- Modify: `server/src/services/reconciliationAutomation.test.ts`

**Interfaces:**

- Consumes: Task 3's `resolveEnabledRooftopProfileFromStoreName()`, `RooftopProfile`, `RooftopFailureDetails`, and `rooftopValidationError()`; Task 4's `parseAccountingMonth()`, `SourcePeriodValidation`, extended `preprocessUpload(buffer: Buffer, sourceType: SourceType, originalFilename: string | null, options: PreprocessUploadOptions): PreprocessingOrchestrationDecision`; Task 5's persisted source identity fields and `getReusableSourceFile()`.
- Produces: the full stable error-code coverage on the Task 3 error contract; `POST /upload` request fields `file`, `source_type`, `store_id`, `accounting_month`; upload response fields `accounting_month`, `rooftop_profile_id`, `rooftop_profile_version`, `parser_name`, `parser_version`, `preprocessor_name`, `preprocessor_version`, and non-null `preprocessing`; period/profile-safe `findLatestSourceFilePair(repository: TransactionRepository, dealershipId: number, dealershipStoreId: number | null, accountingMonth: AccountingMonth, rooftopProfileId: RooftopProfileId, rooftopProfileVersion: string): Promise<{ boa: SourceFileSummary; dealertrack: SourceFileSummary } | null>`. Tasks 7, 9, 10, and 11 consume these exact contracts.

Add these exact properties to the existing server `UploadResponse`; retain its current properties unchanged. Task 9 adds the same JSON field names and types to the frontend `UploadResponse`:

```ts
accounting_month: AccountingMonth;
rooftop_profile_id: RooftopProfileId;
rooftop_profile_version: string;
parser_name: string;
parser_version: string;
preprocessor_name: string;
preprocessor_version: string;
preprocessing: UploadPreprocessingMetadata;
```

- [ ] **Step 1: Extend stable error details in RED tests**

Use the Task 3 contract unchanged:

```ts
export type RooftopFailureDetails = {
  source: "boa" | "dealertrack" | null;
  accounting_month: string | null;
  rooftop_profile_id: string | null;
  evidence?: Record<string, string | number | boolean | null>;
  recovery: string;
};

export function rooftopValidationError(
  code: string,
  message: string,
  details: RooftopFailureDetails,
): HttpValidationError;
```

Test exact codes for `ACCOUNTING_MONTH_REQUIRED`, `INVALID_ACCOUNTING_MONTH`, `ROOFTOP_PROFILE_UNSUPPORTED`, `SOURCE_FORMAT_UNSUPPORTED`, `SOURCE_TYPE_UNCERTAIN`, `SOURCE_PERIOD_MISMATCH`, `SOURCE_PERIOD_CONTRADICTORY`, `REQUIRED_COLUMNS_MISSING`, `ACURA_ACCOUNT_324_EMPTY`, and `STRUCTURALLY_INVALID_TRANSACTIONS`.

- [ ] **Step 2: Write upload-route RED cases**

In `server/src/app.test.ts`, cover:

- missing/invalid `accounting_month`;
- April BOA selected as March;
- unsupported format;
- missing BOA required columns;
- Dealertrack without usable account `324` rows;
- accepted Acura upload returning period, profile, real parser/preprocessor identities, warnings, diagnostics, and removed rows;
- exact duplicate returning `reused_existing_file: true` and the same non-null preprocessing receipt;
- same bytes with a new month or processing version not being reused;
- rejected upload creating an ingestion event with safe metadata but no source file/transaction.

Run:

```bash
cd server
npm test -- src/services/rooftopValidation.test.ts src/app.test.ts
```

Expected RED.

- [ ] **Step 3: Refactor `/upload` into parse-first, identity-second, persist-last flow**

Use this sequence in the existing `POST /upload` handler:

1. parse `accounting_month`;
2. resolve store and enabled profile;
3. call `preprocessUpload(buffer, sourceType, originalFilename, { accountingMonth, rooftopProfile })`, which sniffs the format, resolves the actual `ParserIdentity`, parses/preprocesses, and derives period evidence;
4. read the actual parser/preprocessor identities from the preprocessing output;
5. return/audit any blocking validation error;
6. construct `SourceProcessingIdentity` from actual route and profile;
7. query `getReusableSourceFile()`;
8. reuse a healthy exact source with stored metadata, otherwise persist source + raw bytes + normalized transactions + metadata atomically through existing repository transaction methods.

Do not query duplicates before parser/preprocessor identity and selected month are known. Do not return `preprocessing: null` for a reused source.

- [ ] **Step 4: Make automated pairing period/profile-safe without adding automation UI**

Change `findLatestSourceFilePair()`/`evaluateAutoRunAfterUpload()` in `reconciliationAutomation.ts` to pair only BOA and Dealertrack files with identical non-null `accounting_month`, `rooftop_profile_id`, and `rooftop_profile_version`. Existing legacy files must not auto-pair into a new profiled run.

Export and use this exact signature:

```ts
export async function findLatestSourceFilePair(
  repository: TransactionRepository,
  dealershipId: number,
  dealershipStoreId: number | null,
  accountingMonth: AccountingMonth,
  rooftopProfileId: RooftopProfileId,
  rooftopProfileVersion: string,
): Promise<{ boa: SourceFileSummary; dealertrack: SourceFileSummary } | null>;
```

After migrating the upload path, run `rg -n "getSourceFileByHash" server/src`; expected output is empty after removing that obsolete method and its implementations.

Run:

```bash
cd server
npm test -- src/app.test.ts src/services/reconciliationAutomation.test.ts src/services/preprocessing/index.test.ts src/services/reconciliationGoldenFixtures.test.ts src/presenters/mergedFloorplan.test.ts src/presenters/hurstFpRec.test.ts
```

Expected GREEN.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/rooftopValidation.ts server/src/services/rooftopValidation.test.ts server/src/app.ts server/src/app.test.ts server/src/services/preprocessing/index.ts server/src/services/reconciliationAutomation.ts server/src/services/reconciliationAutomation.test.ts
git diff --cached --check
git commit -m "feat: ingest versioned Acura source files"
```

### Task 7: Make reconciliation identity explicit and artifact persistence all-or-none

**Files:**

- Modify: `server/src/domain/types.ts`
- Modify: `server/src/app.ts`
- Modify: `server/src/app.test.ts`
- Modify: `server/src/services/reconciliationAutomation.ts`
- Modify: `server/src/services/reconciliationAutomation.test.ts`
- Modify: `server/src/services/reconciliationArtifacts.ts`
- Modify: `server/src/repositories/transactionRepository.ts`
- Modify: `server/src/repositories/postgresTransactionRepository.ts`
- Modify: `server/src/repositories/reconciliationPersistence.test.ts`

**Interfaces:**

- Consumes: Task 3's `RooftopProfile` and `requiredArtifactTypes`; Task 4's `AccountingMonth`; Task 5's source/run provenance fields; Task 6's `RooftopFailureDetails`, upload response contract, and period/profile-safe source pairing; existing `reconcileTransactionSets()`, `ReconciliationRunDetail`, and artifact presenter functions.
- Produces: `ReconciliationRequest.accounting_month`; `CreateReconciliationRunFromSourceFilesInput`; `createReconciliationRunFromSourceFiles(input: CreateReconciliationRunFromSourceFilesInput): Promise<{ run: ReconciliationRun; result: ReconciliationResponse; duration_ms: number }>`; `createReconciliationArtifactBatch(dealershipId: number, artifacts: NewReconciliationArtifact[]): Promise<ReconciliationArtifactMetadata[]>` on both repositories; run input snapshots populated from stored source provenance; `persistReconciliationRunArtifacts(input: PersistReconciliationRunArtifactsInput): Promise<ReconciliationArtifactMetadata[]>` using stored run month/profile and one atomic batch. Tasks 8-12 consume these exact contracts.

Extend the existing route DTOs with these exact JSON fields; route validation converts the request's `unknown` value to the branded domain value before calling the service:

```ts
export type ReconciliationRequest = {
  boa_source_file_id?: unknown;
  dealertrack_source_file_id?: unknown;
  dealership_store_id?: unknown;
  accounting_month?: unknown;
};

// Add these properties to the existing ReconciliationResponse declaration:
reconciliation_run_id: number;
accounting_month: AccountingMonth;
rooftop_profile_id: RooftopProfileId;
rooftop_profile_version: string;
```

- [ ] **Step 1: Write RED reconciliation-boundary tests**

Extend `ReconciliationRequest` with `accounting_month`. Assert `/reconcile` rejects before `reconcileTransactionSets()` when:

- either source month differs from the selected month;
- source profile/version differs;
- selected store differs;
- either source is missing or wrong type;
- the profile is disabled.

Each response must use `RooftopFailureDetails`. Assert an accepted run persists `accounting_month`, `rooftop_profile_id`, and `rooftop_profile_version`, and its input snapshot uses each source's stored parser/preprocessor provenance rather than `TRANSACTION_NORMALIZER_VERSION`.

Run:

```bash
cd server
npm test -- src/app.test.ts src/services/reconciliationAutomation.test.ts
```

Expected RED.

- [ ] **Step 2: Extend `createReconciliationRunFromSourceFiles()`**

Define and use this exact input:

```ts
export type CreateReconciliationRunFromSourceFilesInput = {
  repository: TransactionRepository;
  dealershipId: number;
  boaSourceFile: SourceFile;
  dealertrackSourceFile: SourceFile;
  accountingMonth: AccountingMonth;
  rooftopProfile: RooftopProfile;
  automated: boolean;
  uploadedByUserId?: number | null;
};

export function createReconciliationRunFromSourceFiles(
  input: CreateReconciliationRunFromSourceFilesInput,
): Promise<{ run: ReconciliationRun; result: ReconciliationResponse; duration_ms: number }>;
```

Validate source identities at the service boundary even though the route already validates. Populate `PersistReconciliationRunInput` and `ReconciliationRunInputSnapshot.inputs[].parser_metadata` from persisted source fields, including `preprocessor_name`, `preprocessor_version`, `accounting_month`, profile identity, and preprocessing receipt.

- [ ] **Step 3: Write RED batch-artifact persistence tests**

Add this repository method:

```ts
createReconciliationArtifactBatch(
  dealershipId: number,
  artifacts: NewReconciliationArtifact[],
): Promise<ReconciliationArtifactMetadata[]>;
```

Tests must prove:

- six artifacts insert atomically;
- duplicate type/run or an injected insert failure leaves zero artifacts from the attempted batch;
- run remains `artifact_pending` until the batch returns;
- failure changes status to `artifact_failed` and no download metadata is exposed as completed;
- success changes status only after all profile-required types are returned.

Run in memory and PostgreSQL modes:

```bash
cd server
npm test -- src/repositories/reconciliationPersistence.test.ts src/services/reconciliationAutomation.test.ts
DATABASE_URL=postgresql://dealer_recon:dealer_recon@localhost:5433/dealer_recon npm test -- src/repositories/reconciliationPersistence.test.ts
```

Expected RED.

- [ ] **Step 4: Build first, persist once, then complete**

In `persistReconciliationRunArtifacts()`:

```ts
export type PersistReconciliationRunArtifactsInput = {
  repository: TransactionRepository;
  dealershipId: number;
  run: ReconciliationRun;
  rooftopProfile: RooftopProfile;
  boaSourceFile: SourceFile;
  dealertrackSourceFile: SourceFile;
  boaTransactions: Transaction[];
  dealertrackTransactions: Transaction[];
  uploadedByUserId: number | null;
};

export function persistReconciliationRunArtifacts(
  input: PersistReconciliationRunArtifactsInput,
): Promise<ReconciliationArtifactMetadata[]>;
```

- use `run.accounting_month`, never `resolveAccountingMonth(transactions, run.created_at)`;
- use the persisted run profile identity, never infer output semantics from transaction dates;
- require the exact `rooftopProfile.requiredArtifactTypes`;
- build all raw, cleaned, merged, and FP REC buffers in memory;
- call `createReconciliationArtifactBatch()` once;
- import Task 3's single `REQUIRED_RECONCILIATION_ARTIFACT_TYPES` definition from `server/src/config/storeWorkflowConfig.ts`, remove the duplicate service-local required-types array, and export `const REQUIRED_HURST_V1_ARTIFACT_TYPES = REQUIRED_RECONCILIATION_ARTIFACT_TYPES` as a compatibility alias so existing Hurst imports remain valid;
- remove the `storeConfig !== undefined` null bug and fail closed when the run profile cannot be resolved.

Implement the PostgreSQL method with one client transaction and the memory method by validating/cloning the full batch before mutating its array.

- [ ] **Step 5: Verify replay and Hurst remain unchanged**

```bash
cd server
npm test -- src/services/reconciliationReplay.test.ts src/services/reconciliationGoldenFixtures.test.ts src/presenters/mergedFloorplan.test.ts src/presenters/hurstFpRec.test.ts src/services/reconciliationAutomation.test.ts
```

Expected GREEN.

- [ ] **Step 6: Commit**

```bash
git add server/src/domain/types.ts server/src/app.ts server/src/app.test.ts server/src/services/reconciliationAutomation.ts server/src/services/reconciliationAutomation.test.ts server/src/services/reconciliationArtifacts.ts server/src/repositories/transactionRepository.ts server/src/repositories/postgresTransactionRepository.ts server/src/repositories/reconciliationPersistence.test.ts
git diff --cached --check
git commit -m "feat: persist complete rooftop run packages"
```

### Task 8: Prove Acura merged and FP REC semantics against approved artifacts

**Files:**

- Create: `server/src/presenters/fpRec.ts`
- Modify: `server/src/presenters/hurstFpRec.ts`
- Modify: `server/src/presenters/hurstFpRec.test.ts`
- Modify: `server/src/presenters/mergedFloorplan.ts`
- Modify: `server/src/presenters/mergedFloorplan.test.ts`
- Create: `server/src/acceptance/acuraEvidence.ts`
- Create: `server/src/acceptance/acuraEvidence.acceptance.test.ts`
- Modify: `server/src/services/reconciliationArtifacts.ts`
- Modify: `server/package.json`
- Modify: `server/package-lock.json`

**Interfaces:**

- Consumes: Task 1's April evidence baseline; Task 2's `ACURA_SANITIZED_FIXTURE_PATHS`/`AcuraSanitizedContract`; Task 3's `RooftopProfile.presenterId`; Task 4's `AccountingMonth`; Task 7's stored `ReconciliationRunDetail`, atomic artifact batch, and six required artifact types; existing `MergedFloorplanWorkbook` and Hurst presenter exports.
- Produces: `FpRecWorkbook`; `buildFpRecWorkbook(detail: ReconciliationRunDetail, profile: RooftopProfile): FpRecWorkbook`; `buildFpRecWorkbookFromMergedFloorplan(merged: MergedFloorplanWorkbook, profile: RooftopProfile): FpRecWorkbook`; `toFpRecXlsHtml(workbook: FpRecWorkbook): string`; `toFpRecFilename(workbook: FpRecWorkbook): string`; compatibility Hurst exports with their existing signatures; `AcuraEvidencePaths`, `ExpectedMergedSemantics`, `ExpectedFpRecSemantics`, `resolveAprilAcuraEvidence()`, `readExpectedMergedSemantics()`, `readExpectedFpRecSemantics()`, `buildAcuraArtifactsFromEvidence()`, `compareMergedSemantics()`, and `compareFpRecSemantics()` for Tasks 10 and 12.

- [ ] **Step 1: Add the test-only workbook reader**

```bash
cd server
npm install --save-dev exceljs
```

Use it only under `server/src/acceptance/`; production presenters must not depend on `exceljs` or parse the goal workbook.

- [ ] **Step 2: Write RED semantic acceptance helpers**

In `acuraEvidence.ts`, define:

```ts
export type ExpectedMergedSemantics = {
  headers: string[];
  rows: Array<{
    classification: "matched" | "boa_only" | "dealertrack_only";
    boaVin6: string;
    endingBalanceCents: number | null;
    dealertrackCents: number | null;
    dealertrackVin6: string;
    control: string;
  }>;
  totals: { boaCents: number; dealertrackCents: number };
};

export type ExpectedFpRecSemantics = {
  sheetName: "APR26";
  visibleColumnCount: 4;
  printArea: "A:D";
  summary: {
    outstandingStatementCents: number;
    totalGlCents: number;
    differenceCents: number;
    netAdjustmentsCents: number;
    varianceCents: number;
  };
  scheduleOnly: Array<{ unitReference: string; amountCents: number }>;
  statementOnly: Array<{ unitReference: string; amountCents: number }>;
  formulas: {
    difference: "statement_plus_gl";
    netAdjustments: "schedule_only_plus_statement_only";
    variance: "net_adjustments_minus_difference";
  };
};

export type AcuraEvidencePaths = {
  boaCsv: string;
  dealertrackCsv: string;
  mergedCsv: string;
  goalWorkbook: string;
  goalSheet: "APR26";
};

export function resolveAprilAcuraEvidence(root: string): AcuraEvidencePaths;
export function readExpectedMergedSemantics(path: string): ExpectedMergedSemantics;
export async function readExpectedFpRecSemantics(path: string, sheet: "APR26"): Promise<ExpectedFpRecSemantics>;
export async function buildAcuraArtifactsFromEvidence(paths: AcuraEvidencePaths): Promise<{
  merged: MergedFloorplanWorkbook;
  fpRec: FpRecWorkbook;
}>;
export function compareMergedSemantics(actual: MergedFloorplanWorkbook, expected: ExpectedMergedSemantics): string[];
export function compareFpRecSemantics(actual: FpRecWorkbook, expected: ExpectedFpRecSemantics): string[];
```

Comparisons must ignore workbook creator/timestamps/internal IDs, but compare visible sheet/workpaper identity, columns/order, row classifications/order, integer cents, labels, formula meanings, adjustment sections, and zero final variance.

`buildAcuraArtifactsFromEvidence()` must create actual output only from `paths.boaCsv` and `paths.dealertrackCsv` through the production parser/preprocessor/reconciliation/presenter path. It must not read `paths.mergedCsv` or `paths.goalWorkbook`; those are read only by the expected-semantics functions in the assertions.

The acceptance suite must be conditional:

```ts
const evidenceRoot = process.env.ACURA_EVIDENCE_DIR;
describe.runIf(Boolean(evidenceRoot))("approved Acura April evidence", () => {
  test("matches merged and FP REC business semantics", async () => {
    const paths = resolveAprilAcuraEvidence(evidenceRoot as string);
    const actual = await buildAcuraArtifactsFromEvidence(paths);
    expect(compareMergedSemantics(actual.merged, readExpectedMergedSemantics(paths.mergedCsv))).toEqual([]);
    expect(compareFpRecSemantics(actual.fpRec, await readExpectedFpRecSemantics(paths.goalWorkbook, "APR26"))).toEqual([]);
  });
});
```

Run against the protected evidence:

```bash
cd server
ACURA_EVIDENCE_DIR=/Users/tcompy/Developer/dealer-recon/docs/discovery/hiley-artifacts/acura npm test -- src/acceptance/acuraEvidence.acceptance.test.ts
```

Expected RED before presenter/profile corrections. The failure diff must contain only safe aggregate/structural facts, never raw rows or VINs.

- [ ] **Step 3: Extract a generic FP REC presenter while preserving Hurst exports**

Move shared types/functions to `server/src/presenters/fpRec.ts`:

```ts
export type FpRecWorkbook = HurstFpRecWorkbook;
export function buildFpRecWorkbook(
  detail: ReconciliationRunDetail,
  profile: RooftopProfile,
): FpRecWorkbook;
export function buildFpRecWorkbookFromMergedFloorplan(
  merged: MergedFloorplanWorkbook,
  profile: RooftopProfile,
): FpRecWorkbook;
export function toFpRecXlsHtml(workbook: FpRecWorkbook): string;
export function toFpRecFilename(workbook: FpRecWorkbook): string;
```

Keep `buildHurstFpRecWorkbook`, `buildFpRecWorkbookFromMergedFloorplan`, `toHurstFpRecXlsHtml`, and `toHurstFpRecFilename` in `hurstFpRec.ts` as compatibility wrappers/re-exports so existing Hurst callers and tests keep their observable output.

Preserve these exact compatibility signatures:

```ts
export function buildHurstFpRecWorkbook(
  detail: ReconciliationRunDetail,
  storeConfig?: StoreWorkflowConfig,
): HurstFpRecWorkbook;
export function buildFpRecWorkbookFromMergedFloorplan(
  mergedWorkbook: MergedFloorplanWorkbook,
): HurstFpRecWorkbook;
export function toHurstFpRecXlsHtml(workbook: HurstFpRecWorkbook): string;
export function toHurstFpRecFilename(workbook: HurstFpRecWorkbook): string;
```

Profile policy selects labels/account column and presenter ID. Acura uses account `324`, `interleave_by_amount` for merged detail, and compact four-column FP REC sections. Do not add `if (storeName.includes("Acura"))`.

- [ ] **Step 4: Drive both artifacts from stored detail**

In `reconciliationArtifacts.ts`, select the presenter by `profile.presenterId`, pass the stored `ReconciliationRunDetail`, and use the run accounting-month label in filenames/workbook month labels. The merged presenter and FP REC presenter must consume the same stored detail object.

- [ ] **Step 5: Turn Acura acceptance GREEN**

```bash
cd server
ACURA_EVIDENCE_DIR=/Users/tcompy/Developer/dealer-recon/docs/discovery/hiley-artifacts/acura npm test -- src/acceptance/acuraEvidence.acceptance.test.ts
npm test -- src/presenters/mergedFloorplan.test.ts src/presenters/hurstFpRec.test.ts src/services/reconciliationGoldenFixtures.test.ts
```

Expected:

- April: 199 matches, 0 BOA-only, 9 Dealertrack-only, BOA `1005665140` cents, Dealertrack `-1039411200` cents, FP REC difference `-33746060` cents, variance zero.
- Hurst's existing golden counts/totals/order/artifacts are unchanged.

- [ ] **Step 6: Commit**

```bash
git add server/src/presenters/fpRec.ts server/src/presenters/hurstFpRec.ts server/src/presenters/hurstFpRec.test.ts server/src/presenters/mergedFloorplan.ts server/src/presenters/mergedFloorplan.test.ts server/src/acceptance/acuraEvidence.ts server/src/acceptance/acuraEvidence.acceptance.test.ts server/src/services/reconciliationArtifacts.ts server/package.json server/package-lock.json
git diff --cached --check
git commit -m "feat: generate approved Acura reconciliation artifacts"
```

### Task 9: Add the accounting-month/profile contract to the React workflow

**Files:**

- Create: `frontend/src/utils/accountingMonth.ts`
- Create: `frontend/src/utils/accountingMonth.test.ts`
- Modify: `frontend/src/utils/formatRunId.ts`
- Modify: `frontend/src/types/store.ts`
- Modify: `frontend/src/types/sourceFile.ts`
- Modify: `frontend/src/types/reconciliation.ts`
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/api/errorMessage.ts`
- Modify: `frontend/src/api/errorMessage.test.ts`
- Modify: `frontend/src/api/uploads.ts`
- Modify: `frontend/src/api/reconciliation.ts`
- Modify: `frontend/src/components/WorkflowDashboard.tsx`
- Create: `frontend/src/components/WorkflowDashboard.test.tsx`
- Create: `frontend/src/test/setup.ts`
- Modify: `frontend/vite.config.ts`
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json`

**Interfaces:**

- Consumes: Task 3's JSON `GET /stores -> DealershipStoreWithRooftopSupport[]`; Task 6's `POST /upload` request/response and `RooftopFailureDetails`; Task 7's `POST /reconcile` period-aware response/run fields; Task 8's persisted merged/FP REC artifact download endpoints.
- Produces: frontend `isAccountingMonth(value: string): boolean`; `formatAccountingMonth(value: string): string`; `formatRunIdentity(profileId: string, accountingMonth: string, runId: number): string`; frontend `RooftopFailureDetails`; `ApiError`; `readApiError(response: Response, fallback: string): Promise<ApiError>`; `UploadSourceFileInput`; `ReconcileSourceFilesInput`; `uploadSourceFile(input: UploadSourceFileInput): Promise<UploadResponse>`; `reconcileSourceFiles(input: ReconcileSourceFilesInput): Promise<ReconciliationResponse>`; dashboard state `selectedAccountingMonth: string`; rendered accounting-month selector, profile gate, structured recovery error, selected-month run identity, and final download controls consumed by Task 11.

- [ ] **Step 1: Install the existing-stack test utilities**

```bash
cd frontend
npm install --save-dev @testing-library/react @testing-library/jest-dom jsdom
```

Modify `frontend/vite.config.ts` to set `test.environment` to `"jsdom"` and load `@testing-library/jest-dom/vitest` from a new `frontend/src/test/setup.ts`. Add `frontend/vite.config.ts` and `frontend/src/test/setup.ts` to this task's files and commit list.

- [ ] **Step 2: Write RED month-format tests**

Mirror the server contract with:

```ts
export function isAccountingMonth(value: string): boolean;
export function formatAccountingMonth(value: string): string;
export function formatRunIdentity(profileId: string, accountingMonth: string, runId: number): string;
```

Assert `formatRunIdentity("acura-v1", "2026-04", 42)` is `ACURA · Apr 2026 · Run #42`. Stop using `created_at` for run identity; retain `formatRunId()` only as a legacy wrapper for any non-rooftop screen not migrated here.

- [ ] **Step 3: Write RED dashboard behavior tests**

Test:

- store list distinguishes enabled Hurst/Acura from unsupported stores;
- selecting Acura exposes a required `<input type="month" aria-label="Accounting month">`;
- upload buttons and Run Workflow stay disabled without a valid month/profile;
- changing store or month clears both selected uploads and active run;
- uploads receive `accountingMonth` and reconcile receives the same value;
- mismatch errors display server explanation plus recovery instruction;
- accepted run renders the `ACURA · Apr 2026 · Run #42` pattern using the returned numeric run id and shows both final downloads.
- selecting Hurst still exposes its enabled profile, accepts an accounting month, and preserves the existing Hurst task/upload/output labels.

Run:

```bash
cd frontend
npm test -- src/utils/accountingMonth.test.ts src/components/WorkflowDashboard.test.tsx
```

Expected RED.

- [ ] **Step 4: Extend frontend API/types**

Change inputs to:

```ts
export type UploadSourceFileInput = {
  sourceType: SourceType;
  file: File;
  dealershipStoreId: number;
  accountingMonth: string;
};

export type ReconcileSourceFilesInput = {
  boaSourceFileId: number;
  dealertrackSourceFileId: number;
  dealershipStoreId: number;
  accountingMonth: string;
};
```

Append `accounting_month` to `FormData` and reconcile JSON. Mirror profile/period/provenance fields in `UploadResponse`, `SourceFileSummary`, `ReconciliationResponse`, `ReconciliationRunListItem`, and `ReconciliationRunDetail`.

Define the matching frontend error contract in `frontend/src/types/sourceFile.ts`:

```ts
export type RooftopFailureDetails = {
  source: "boa" | "dealertrack" | null;
  accounting_month: string | null;
  rooftop_profile_id: string | null;
  evidence?: Record<string, string | number | boolean | null>;
  recovery: string;
};
```

In `frontend/src/api/errorMessage.ts`, export `class ApiError extends Error` with readonly `status: number`, `code: string | null`, and `details: RooftopFailureDetails | null`, plus `readApiError(response: Response, fallback: string): Promise<ApiError>`. Import those into `frontend/src/api/client.ts` and replace `getErrorMessage()` use in `apiGet()`, `apiPost()`, and `apiPatch()`. Make `UploadError extends ApiError`, retaining readonly `preprocessing: UploadPreprocessingMetadata | null`. Add exact structured and legacy-response tests in `frontend/src/api/errorMessage.test.ts`. The dashboard must render `error.message` and `error.details?.recovery`; it must not parse message strings.

- [ ] **Step 5: Implement the UI state transition**

Add `selectedAccountingMonth` beside `selectedStoreId`. Reset uploads/results when either changes. Use `store.rooftop_profile?.enabled` for gating. Keep the existing operator sequence and headings; insert Accounting Month between Task and Upload Inputs. Preserve accessibility and current responsive layout.

Run:

```bash
cd frontend
npm test -- src/utils/accountingMonth.test.ts src/components/WorkflowDashboard.test.tsx
npm run build
```

Expected GREEN. There is no separate frontend `typecheck` script; `npm run build` executes `tsc -b` before Vite.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/utils/accountingMonth.ts frontend/src/utils/accountingMonth.test.ts frontend/src/utils/formatRunId.ts frontend/src/types frontend/src/api/client.ts frontend/src/api/errorMessage.ts frontend/src/api/errorMessage.test.ts frontend/src/api/uploads.ts frontend/src/api/reconciliation.ts frontend/src/components/WorkflowDashboard.tsx frontend/src/components/WorkflowDashboard.test.tsx frontend/src/test/setup.ts frontend/vite.config.ts frontend/package.json frontend/package-lock.json
git diff --cached --check
git commit -m "feat: select reconciliation accounting month"
```

### Task 10: Add database-backed vertical-slice integration coverage

**Files:**

- Create: `server/src/acuraReconciliation.integration.test.ts`
- Modify: `server/src/repositories/reconciliationPersistence.test.ts`
- Modify: `server/src/app.test.ts`

**Interfaces:**

- Consumes: Task 2's `ACURA_SANITIZED_FIXTURE_PATHS`; Task 3's enabled Acura profile; Task 4's `AccountingMonth`/period evidence; Task 5's persisted fields and `getReusableSourceFile()`; Task 6's upload contract; Task 7's reconciliation/atomic artifact contracts; Task 8's semantic comparator functions.
- Produces: PostgreSQL-backed proof for the complete API/persistence boundary in `server/src/acuraReconciliation.integration.test.ts`; no new production interface. Task 12 consumes the exact command `DATABASE_URL=postgresql://dealer_recon:dealer_recon@localhost:5433/dealer_recon npm test -- src/acuraReconciliation.integration.test.ts` as a mandatory completion check.

- [ ] **Step 1: Write and run the PostgreSQL vertical-slice integration test**

Using the existing `DATABASE_URL` conditional pattern and `createApp()`, create an Acura store and upload the sanitized April BOA/Dealertrack fixtures through HTTP. Assert:

- both source rows store `2026-04`, `acura-v1`, real parser/preprocessor versions, source snapshots, diagnostics, and removed-row reasons;
- a duplicate upload reuses the immutable source and returns the identical stored receipt;
- reconciliation persists a new run with selected month/profile identity;
- submitting the same two source IDs and accounting month a second time creates a different manual run ID while both runs reference the same immutable source IDs;
- replay reads stored provenance;
- all six artifacts are present and downloadable only after completion;
- regenerated artifact semantics equal stored artifact semantics;
- a forced batch failure yields `artifact_failed` and zero partial artifacts;
- period mismatch and unsupported rooftop create no run;
- dealership/store authorization remains enforced for upload, run, and download.

Run:

```bash
docker compose up -d db
cd server
DATABASE_URL=postgresql://dealer_recon:dealer_recon@localhost:5433/dealer_recon npm test -- src/acuraReconciliation.integration.test.ts
```

Expected GREEN because Tasks 3-8 already established their RED/GREEN cycles. If this integration test fails, stop this task, identify the owning earlier task, add a focused regression test there, confirm RED, implement the smallest correction, and rerun that task's focused and Hurst suites before returning here.

- [ ] **Step 2: Run integration plus Hurst regression**

```bash
cd server
DATABASE_URL=postgresql://dealer_recon:dealer_recon@localhost:5433/dealer_recon npm test -- src/acuraReconciliation.integration.test.ts src/repositories/reconciliationPersistence.test.ts
npm test -- src/services/reconciliationGoldenFixtures.test.ts src/presenters/mergedFloorplan.test.ts src/presenters/hurstFpRec.test.ts
```

Expected GREEN.

- [ ] **Step 3: Commit**

```bash
git add server/src/acuraReconciliation.integration.test.ts server/src/repositories/reconciliationPersistence.test.ts server/src/app.test.ts
git diff --cached --check
git commit -m "test: cover Acura reconciliation persistence"
```

### Task 11: Add one real-browser Acura workflow test

**Files:**

- Create: `server/src/cli/startE2eServer.ts`
- Modify: `server/package.json`
- Create: `frontend/playwright.config.ts`
- Create: `frontend/e2e/acura-reconciliation.spec.ts`
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**

- Consumes: Task 2's sanitized BOA/Dealertrack fixture paths; Task 3's `Hiley Acura` enabled profile response; Task 6's upload/mismatch contracts; Task 7's reconciliation/artifact endpoints; Task 9's month selector, run identity, and download UI.
- Produces: `startE2eServer(): Promise<Server>`; server command `npm run dev:e2e` backed by `server/src/cli/startE2eServer.ts`; frontend commands `npm run test:e2e` and `npm run test:e2e:install`; Playwright base URL `http://127.0.0.1:5174`; isolated API URL `http://127.0.0.1:8001`; CI `browser` job and the required operator-path/mismatch test consumed by Task 12.

- [ ] **Step 1: Install Playwright and add scripts**

```bash
cd frontend
npm install --save-dev @playwright/test
```

Add frontend scripts:

```json
"test:e2e": "playwright test",
"test:e2e:install": "playwright install chromium"
```

Add server script:

```json
"dev:e2e": "tsx src/cli/startE2eServer.ts"
```

- [ ] **Step 2: Write the browser test and verify RED before creating its server**

Configure two Playwright `webServer` entries:

- backend: `npm run dev:e2e` with `cwd: ../server`, URL `http://127.0.0.1:8001/health`;
- frontend: `VITE_API_BASE_URL=http://127.0.0.1:8001 npm run dev -- --host 127.0.0.1 --port 5174`, URL `http://127.0.0.1:5174`.

Import `ACURA_SANITIZED_FIXTURE_PATHS` from `../../server/src/testFixtures/acura/index.ts` and use only its `boaCsv` and `dealertrackCsv` absolute paths. The test must:

1. select Hiley Acura;
2. select the floorplan reconciliation task;
3. select April 2026;
4. upload BOA and Dealertrack;
5. run the workflow;
6. assert the visible text matches `/ACURA · Apr 2026 · Run #\d+/`;
7. download and inspect non-empty merged and FP REC files;
8. start a second path with March selected and April BOA, then assert the visible period-mismatch explanation and recovery instruction and no download controls.

Run:

```bash
cd frontend
npm run test:e2e:install
npm run test:e2e
```

Expected RED: Playwright's backend `webServer` command exits because `server/src/cli/startE2eServer.ts` does not exist. Confirm that this missing test server—not a selector or application assertion—is the failure reason.

- [ ] **Step 3: Create the isolated in-memory E2E server and verify GREEN**

Import `Server` from `node:http` as a type and export `startE2eServer(): Promise<Server>` from `startE2eServer.ts`. It must create a new `MemoryTransactionRepository`, call `await repository.createDealershipStore(1, { name: "Hiley Acura", dealer_group_id: 1 })`, create the app with `createApp(repository, 1, { nodeEnv: "test", allowDevDealershipFallback: true })`, and listen on `127.0.0.1:8001`. The CLI entrypoint calls `startE2eServer()`. It must never connect to production or the developer's default PostgreSQL database.

Run:

```bash
cd frontend
npm run test:e2e
```

Expected GREEN: both the accepted April path and rejected March/April mismatch path pass in Chromium.

- [ ] **Step 4: Put frontend unit tests and E2E in CI**

Add `npm test` to the existing frontend CI job. Add a separate `browser` job with Node 20 that installs both package trees, runs `npx playwright install --with-deps chromium` from `frontend`, and runs `npm run test:e2e`. The E2E job uses the isolated memory server and requires no client artifacts or database credentials.

- [ ] **Step 5: Commit**

```bash
git add server/src/cli/startE2eServer.ts server/package.json frontend/playwright.config.ts frontend/e2e/acura-reconciliation.spec.ts frontend/package.json frontend/package-lock.json .github/workflows/ci.yml
git diff --cached --check
git commit -m "test: cover Acura browser workflow"
```

### Task 12: Document the operating contract and run the complete verification gate

**Files:**

- Create: `docs/operations/acura-rooftop-reconciliation.md`
- Create: `docs/development/rooftop-onboarding.md`
- Modify: `README.md`

**Interfaces:**

- Consumes: Task 1's characterization and conflict resolutions; Tasks 3-9's exact profile, month, validation, duplicate, provenance, run, presenter, API, and UI contracts; Task 10's PostgreSQL test command; Task 11's Playwright/CI commands; all existing Hurst regression commands.
- Produces: `docs/operations/acura-rooftop-reconciliation.md`; `docs/development/rooftop-onboarding.md`; README links; five separately reported Git change sets (`committed since specification`, `staged`, `unstaged`, `untracked`, and `tracked/staged discovery artifacts`); final verification evidence. No later implementation task consumes a new code interface.

- [ ] **Step 1: Document the Acura operating contract**

Include exact supported inputs (BOA CSV and Dealertrack account-324 CSV), `YYYY-MM` selection, period-evidence behavior, allowed warnings, blocking error codes/recovery, duplicate semantics, six required artifacts, run identity, download behavior, and how to interpret Difference/Net adjustments/Variance. State that `.xlsx` is a goal-output reference, not an accepted raw input.

- [ ] **Step 2: Document the later-rooftop gate**

Describe the sequence: protect evidence -> characterize all files/recording -> resolve conflicts by approved authority -> add disabled profile -> sanitize fixtures -> parser/preprocessor/reconciliation/output tests -> persistence/E2E -> enable profile. State the planned order `fw`, `burleson`, `hsv`, `west`; none becomes enabled by this slice.

- [ ] **Step 3: Run backend verification using configured commands**

```bash
cd /Users/tcompy/Developer/dealer-recon
docker compose ps
docker compose up -d db
cd server
npm run lint
npm run typecheck
npm run build
npm test
DATABASE_URL=postgresql://dealer_recon:dealer_recon@localhost:5433/dealer_recon npm test -- src/db/migrate.test.ts src/repositories/reconciliationPersistence.test.ts src/acuraReconciliation.integration.test.ts
ACURA_EVIDENCE_DIR=/Users/tcompy/Developer/dealer-recon/docs/discovery/hiley-artifacts/acura npm test -- src/acceptance/acuraEvidence.acceptance.test.ts
```

Record each command and exact result. A skipped conditional acceptance or database test does not satisfy the completion criteria.

- [ ] **Step 4: Run frontend and browser verification**

```bash
cd frontend
npm run lint
npm test
npm run build
npm run test:e2e
```

- [ ] **Step 5: Review security and final diff**

Run the gstack `/review` skill. Because uploads, client financial data, authorization, and downloads are in scope, run `/cso`. Report each Git category separately; do not use one aggregate status as a substitute:

```bash
cd /Users/tcompy/Developer/dealer-recon
git diff --check

printf 'COMMITTED SINCE SPECIFICATION\n'
git log --oneline 37894591c58d9e77eb42286d660c5ab56ac0db79..HEAD
git diff --name-status 37894591c58d9e77eb42286d660c5ab56ac0db79..HEAD

printf 'STAGED\n'
git diff --cached --name-status

printf 'UNSTAGED\n'
git diff --name-status

printf 'UNTRACKED\n'
git ls-files --others --exclude-standard

printf 'TRACKED DISCOVERY ARTIFACTS\n'
git ls-files docs/discovery/hiley-artifacts

printf 'STAGED DISCOVERY ARTIFACTS\n'
git diff --cached --name-only -- docs/discovery/hiley-artifacts

printf 'INTENTIONAL PATH REFERENCES OUTSIDE PLAN AND CHARACTERIZATION\n'
rg -l "hiley-artifacts|presenters/__fixtures__/acura" . --hidden --glob '!.git/**' --glob '!docs/superpowers/plans/**' --glob '!docs/superpowers/characterizations/**' | sort
```

Expected: committed changes list every implementation/documentation file since the specification commit; staged, unstaged, and untracked output is empty at the completion gate; both discovery-artifact commands are empty; the intentional-reference scan lists only `.gitignore` and the approved specification. No raw row/VIN is logged in an error, test diff, or document. If any category differs, report its exact output and do not claim completion.

- [ ] **Step 6: Commit documentation only after verification succeeds**

```bash
git add README.md docs/operations/acura-rooftop-reconciliation.md docs/development/rooftop-onboarding.md
git diff --cached --check
git commit -m "docs: add Acura reconciliation operating contract"
```

- [ ] **Step 7: Apply the completion gate**

Do not claim Acura support unless all of these are evidenced by successful commands: approved April semantic comparison, Hurst regression, PostgreSQL persistence/migration, server lint/typecheck/build/full test, frontend lint/test/build, Playwright success, code review, and security review. Report every skipped or failed command as remaining work.
