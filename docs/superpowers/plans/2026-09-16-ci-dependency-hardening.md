# CI and Dependency Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace mutable official GitHub Actions tags with verified immutable release commits and remove the currently reported Critical/High advisories from the server and frontend dependency trees using the smallest Node 20-compatible changes.

**Architecture:** Keep the work split into three independently revertible changes: workflow pins, server dependency hardening, and frontend dependency hardening. Existing direct dependencies move only to the exact minimum secure version; vulnerable transitive versions are constrained with root-package `overrides`; npm regenerates only the corresponding package lock. No production TypeScript, application behavior, framework architecture, rooftop configuration, or client evidence changes are in scope.

**Tech Stack:** GitHub Actions, Node.js 20, npm lockfile v3, TypeScript, Vitest, Vite, PostCSS, React 18, Express, PostgreSQL 16, Docker Compose, and Playwright Chromium.

**Spec:** User-approved CI and dependency-hardening scope dated 2026-09-16.

## Global Constraints

- Execute only in `/private/tmp/dealer-recon-ci-dependency-hardening` on branch `chore/ci-dependency-hardening`, based on merge commit `174f1f016fe7a2d7afdee0cad8353084f8a9e32b`.
- This is dependency and CI maintenance, not another rooftop workflow. Do not add or enable a rooftop profile and do not change reconciliation, API, database, presenter, or UI production code.
- Do not modify, stage, commit, copy, move, enumerate, or expose anything under `docs/discovery/hiley-artifacts/`. The single protected Acura acceptance command may receive the already-established evidence root through `ACURA_EVIDENCE_DIR`; do not print filenames, raw rows, or VINs.
- Preserve the original checkout's three pre-existing untracked files exactly: `/Users/tcompy/Developer/dealer-recon/AGENTS.md`, `/Users/tcompy/Developer/dealer-recon/docs/development/testing-policy.md`, and `/Users/tcompy/Developer/dealer-recon/package-lock.json`. They must never be copied into this worktree or staged.
- Use Node 20 for lockfile regeneration and all npm verification. The current shell defaults to Node 24, so activate Node 20 explicitly before running npm mutation or verification commands.
- Never use npm's automatic audit remediation, including force mode, a broad dependency upgrade, or a framework migration. Apply only the declared manifest constraints and regenerate locks with `npm install --package-lock-only --ignore-scripts`.
- Configuration/dependency metadata is exempt from production-code test-first changes, but the registry audit is the security RED/GREEN gate: capture the failing baseline before edits, then prove the named advisories are absent afterward. If an unexpected test failure occurs, use `superpowers:systematic-debugging` before proposing any compatibility change.
- No test, source, or configuration compatibility edits beyond the files named in this plan are pre-authorized. If Vite 6 or Vitest 3 requires such an edit, stop, identify the exact incompatibility, and revise the plan before changing that file.
- Preserve all Hurst golden behavior and the approved April Acura acceptance results. A skipped database or protected-evidence test is a failure of the completion gate.
- Do not push, merge, deploy, or remove the worktree under this plan without separate authorization.

## Mandatory Stop Conditions

Stop before staging, committing, or beginning the next task if any of these occurs:

- either production-only audit reports a new runtime Critical or High advisory, or either full-tree audit still reports any Critical or High advisory after its dependency task;
- any previously passing server, frontend, Hurst, Acura acceptance, or Playwright test regresses;
- any migration, PostgreSQL persistence, or PostgreSQL integration test fails or is skipped;
- Node is not major version 20, a target rejects Node 20, or npm reports an engine, peer-dependency, `EOVERRIDE`, or resolution incompatibility;
- an official action release tag no longer resolves to the recorded commit, a protected-file hash changes, or a client-evidence isolation predicate fails.

Diagnosis may continue read-only. Any remediation outside `.github/workflows/ci.yml`, the two package manifests, and their two package locks requires a revised plan and explicit approval before editing.

## Current Evidence and Upgrade Constraints

### Workflow inventory and verified official action commits

The repository has one workflow, `.github/workflows/ci.yml`. Its `server`, `frontend`, and `browser` jobs each use both mutable references, for six replacements total.

| Current reference | Occurrences | Verified immutable release | Readable pinned form | Verification source |
|---|---:|---|---|---|
| `actions/checkout@v4` | 3 | `11d5960a326750d5838078e36cf38b85af677262` | `actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0` | `git ls-remote https://github.com/actions/checkout.git refs/tags/v4 refs/tags/v4.4.0`; both refs resolved to this SHA on 2026-09-16 |
| `actions/setup-node@v4` | 3 | `49933ea5288caeca8642d1e84afbd3f7d6820020` | `actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0` | `git ls-remote https://github.com/actions/setup-node.git refs/tags/v4 refs/tags/v4.4.0`; both refs resolved to this SHA on 2026-09-16 |

Re-resolve both official repositories immediately before editing. If either release tag no longer matches the recorded SHA, stop and update this plan from the official tag evidence rather than silently selecting a different commit.

### Audit baseline captured on 2026-09-16

| Package tree | Full audit | `--omit=dev` audit | Critical/High packages in requested scope |
|---|---:|---:|---|
| `server` | 14 total: 1 Critical, 5 High, 8 Moderate | 5 total: 0 Critical, 1 High, 4 Moderate | Vitest, Vite, PostCSS, nanoid, js-yaml, brace-expansion |
| `frontend` | 11 total: 1 Critical, 6 High, 3 Moderate, 1 Low | 6 total: 0 Critical, 4 High, 2 Moderate | Vitest, Vite, PostCSS, browserslist, nanoid, js-yaml, brace-expansion |

The completion target is zero Critical and zero High findings in both full audits and both production-only audits. Moderate/Low advisories outside the named scope are not silently expanded into this change; record their final package, chain, exposure, and disposition. If a new Critical/High advisory appears during execution, stop and amend the plan rather than broadening a task opportunistically.

### Exact dependency treatment

| Package | Current resolved version(s) and chain | Secure constraint | Treatment |
|---|---|---|---|
| `brace-expansion` | Server: `eslint -> minimatch -> 1.1.14`; `node-pg-migrate -> glob -> minimatch -> 5.0.6`. Frontend: `eslint -> minimatch -> 1.1.14`; `typescript-eslint -> @typescript-eslint/typescript-estree -> minimatch -> 5.0.6`. | `1.1.18` for vulnerable 1.x; `5.0.9` for vulnerable 3.x-5.0.8. `5.0.9` declares Node `20 || >=22`. | Transitive `overrides`, with separate range-qualified entries so the safe 1.x and 5.x lines are not collapsed into one incompatible major. |
| `js-yaml` | `eslint -> @eslint/eslintrc -> 4.2.0` in both trees. | `4.3.2` | Exact transitive `override`. |
| `nanoid` | Server: `vitest -> vite -> postcss -> 3.3.12`. Frontend: `postcss -> 3.3.12`. | `3.3.18` | Exact transitive `override`; frontend's direct PostCSS floor also carries it. |
| `browserslist` | Frontend: `@vitejs/plugin-react -> @babel/core -> @babel/helper-compilation-targets -> 4.28.2`; `autoprefixer -> 4.28.2`. | `4.28.7` | Frontend-only exact transitive `override`. |
| `postcss` | Server: `vitest -> vite -> 8.5.13`. Frontend: direct `8.5.14`, shared by Vite/Autoprefixer/Tailwind plugins. | `8.5.23` because the incomplete-fix advisory affects `<=8.5.22`. | Server exact transitive `override`; frontend exact direct upgrade from `^8.4.41` to `8.5.23`. |
| `vite` | Server: `vitest -> 5.4.21`. Frontend: direct `5.4.21`; `@vitejs/plugin-react@4.7.0` accepts Vite 6. | `6.4.3`; its engine is `^18 || ^20 || >=22`. | Server exact tree-wide transitive `override` so Vitest's broad Vite 5/6/7 range cannot select Vite 7; frontend exact direct major upgrade from `^5.4.2` to `6.4.3`. Do not accept npm's suggested Vite 8 upgrade. |
| `vitest` | Direct development dependency resolved to `1.6.1` in both trees. | `3.2.6`; its engine is `^18 || ^20 || >=22` and its Vite peer range accepts Vite 6. | Exact direct development-dependency upgrade to `3.2.6` in both manifests. Do not accept npm's suggested Vitest 5 upgrade. |

Lockfile changes may include the transitive packages required by these constraints, such as `vite-node`, `esbuild`, Rollup platform packages, and dependency metadata. Review every unrelated lockfile delta; if npm introduces packages not reachable from the declared direct upgrades or overrides, stop and investigate before staging the lockfile.

## Pre-Execution Approval Gate

Implementation must not begin until this plan is reviewed, approved, and committed by itself.

The four commit boundaries are fixed and independently reviewable:

| Boundary | Files | Commit message |
|---:|---|---|
| 1 | `docs/superpowers/plans/2026-09-16-ci-dependency-hardening.md` | `docs: add CI dependency hardening plan` |
| 2 | `.github/workflows/ci.yml` | `ci: pin official actions to immutable releases` |
| 3 | `server/package.json`, `server/package-lock.json` | `chore(server): harden dependency versions` |
| 4 | `frontend/package.json`, `frontend/package-lock.json` | `chore(frontend): harden dependency versions` |

```bash
cd /private/tmp/dealer-recon-ci-dependency-hardening
test "$(git branch --show-current)" = "chore/ci-dependency-hardening"
git merge-base --is-ancestor 174f1f016fe7a2d7afdee0cad8353084f8a9e32b HEAD
git status --short
test ! -e package-lock.json
printf '%s  %s\n' '50706f49ef63dd18706a1dd10a355c96e12b7550e05250022a2f1fedccedbca3' '/Users/tcompy/Developer/dealer-recon/AGENTS.md' '4c5e856472acd0e7b53a4126e117980ecbc9a4433d52fcb8c2d01386b1baac88' '/Users/tcompy/Developer/dealer-recon/docs/development/testing-policy.md' 'b2bc5e3fe8cff6ed543521ce30c02da0742d47834ed09e65ff2267a4e1208aee' '/Users/tcompy/Developer/dealer-recon/package-lock.json' | shasum -a 256 -c -
git add docs/superpowers/plans/2026-09-16-ci-dependency-hardening.md
test "$(git diff --cached --name-only)" = "docs/superpowers/plans/2026-09-16-ci-dependency-hardening.md"
git diff --cached --check
git commit -m "docs: add CI dependency hardening plan"
git status --short
```

Expected before the commit: only the plan is untracked. Expected after the commit: the worktree is clean. Then confirm the original checkout still reports exactly the protected untracked files and nothing else:

```bash
git -C /Users/tcompy/Developer/dealer-recon status --short
```

Expected output:

```text
?? AGENTS.md
?? docs/development/testing-policy.md
?? package-lock.json
```

---

### Task 1: Pin every official GitHub Action to its immutable v4.4.0 commit

**Files:**

- Modify: `.github/workflows/ci.yml:19-20`
- Modify: `.github/workflows/ci.yml:38-39`
- Modify: `.github/workflows/ci.yml:54-55`

**Interfaces:**

- Consumes: all six current `uses:` contracts in `.github/workflows/ci.yml`; official `actions/checkout` refs `v4` and `v4.4.0`; official `actions/setup-node` refs `v4` and `v4.4.0`; existing Node 20/cache inputs for all three jobs.
- Produces: three exact checkout references `actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0`; three exact setup-node references `actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0`; otherwise byte-equivalent job steps and inputs for later verification.

- [ ] **Step 1: Re-verify the official release tag identities**

```bash
cd /private/tmp/dealer-recon-ci-dependency-hardening
git ls-remote https://github.com/actions/checkout.git refs/tags/v4 refs/tags/v4.4.0
git ls-remote https://github.com/actions/setup-node.git refs/tags/v4 refs/tags/v4.4.0
```

Expected: each repository prints the same recorded SHA for both refs. Treat any mismatch as a stop condition.

- [ ] **Step 2: Replace only the six mutable references**

Use the exact readable forms above. Do not alter job names, permissions, events, runner labels, Node version, cache paths, commands, or timeouts.

- [ ] **Step 3: Validate YAML syntax, pin completeness, and scope**

```bash
ruby -e 'require "yaml"; Dir[".github/workflows/*.{yml,yaml}"].sort.each { |path| YAML.parse_file(path); puts "parsed #{path}" }'
test "$(rg -c 'actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4\.4\.0' .github/workflows/ci.yml)" -eq 3
test "$(rg -c 'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4\.4\.0' .github/workflows/ci.yml)" -eq 3
if rg -n 'uses:\s+actions/(checkout|setup-node)@v[0-9]+' .github/workflows; then exit 1; fi
git diff --check
git diff -- .github/workflows/ci.yml
```

Expected: the workflow parses, each immutable reference occurs exactly three times, no mutable official tag remains, and the diff contains only the six `uses:` lines.

- [ ] **Step 4: Commit the isolated workflow change**

```bash
git add .github/workflows/ci.yml
test "$(git diff --cached --name-only)" = ".github/workflows/ci.yml"
git diff --cached --check
git commit -m "ci: pin official actions to immutable releases"
```

**Rollback point:** Revert this commit alone to restore the mutable references without touching dependencies. Do not rewrite history or force-push.

**Acceptance criteria:** Exactly six official action references are pinned to the verified v4.4.0 commits with readable comments; YAML parses; all workflow behavior and inputs remain unchanged.

---

### Task 2: Harden the server dependency tree

**Files:**

- Modify: `server/package.json:33-49`
- Modify: `server/package-lock.json`

**Interfaces:**

- Consumes: `server` npm scripts `lint`, `typecheck`, `build`, and `test`; direct `vitest` development dependency; transitive chains from ESLint, node-pg-migrate, and Vitest/Vite/PostCSS; npm lockfile v3; Node 20.
- Produces: `devDependencies.vitest = "3.2.6"`; root `overrides` for vulnerable brace-expansion 1.x and 3.x-5.0.8 lines plus exact tree-wide js-yaml 4.3.2, nanoid 3.3.18, PostCSS 8.5.23, and Vite 6.4.3 constraints; a regenerated `server/package-lock.json` consumed by CI and Task 4.

- [ ] **Step 1: Establish the server security RED under Node 20**

```bash
cd /private/tmp/dealer-recon-ci-dependency-hardening
fnm install 20
fnm exec --using=20 node -e 'if (Number(process.versions.node.split(".")[0]) !== 20) process.exit(1); console.log(process.version)'
cd server
fnm exec --using=20 npm audit --audit-level=high --json
fnm exec --using=20 npm audit --omit=dev --audit-level=high --json
fnm exec --using=20 npm ls --package-lock-only --all brace-expansion js-yaml nanoid postcss vite vitest
```

Expected RED: full audit is 1 Critical/5 High/8 Moderate and production-only is 1 High/4 Moderate; the listed vulnerable versions match the evidence table. Both baseline audit commands exit 1 because they meet the High threshold.

- [ ] **Step 2: Add the direct Vitest floor and scoped transitive overrides**

Set the existing Vitest declaration to:

```json
"vitest": "3.2.6"
```

Add this root-level object after `devDependencies`:

```json
"overrides": {
  "brace-expansion@<=1.1.17": "1.1.18",
  "brace-expansion@>=3.0.0 <5.0.9": "5.0.9",
  "js-yaml": "4.3.2",
  "nanoid": "3.3.18",
  "postcss": "8.5.23",
  "vite": "6.4.3"
}
```

Do not add Vite, PostCSS, nanoid, js-yaml, or brace-expansion as direct server dependencies.

- [ ] **Step 3: Regenerate only the server lockfile and inspect transitive movement**

```bash
fnm exec --using=20 npm install --package-lock-only --ignore-scripts
fnm exec --using=20 npm ci
fnm exec --using=20 npm ls --all brace-expansion js-yaml nanoid postcss vite vitest
git diff --check -- package.json package-lock.json
git diff -- package.json
git diff --stat -- package-lock.json
```

Expected: npm accepts the override graph without `EOVERRIDE`/peer errors; Vitest resolves exactly to 3.2.6, Vite exactly to 6.4.3, PostCSS exactly to 8.5.23, and none of the audit-vulnerable versions remain. Any lockfile change must be reachable from the direct Vitest upgrade or one of the six overrides.

- [ ] **Step 4: Prove the server GREEN and behavior preservation**

```bash
fnm exec --using=20 npm run lint
fnm exec --using=20 npm run typecheck
fnm exec --using=20 npm run build
fnm exec --using=20 npm test
fnm exec --using=20 npm audit --audit-level=high --json
fnm exec --using=20 npm audit --omit=dev --audit-level=high --json
```

Expected: lint, typecheck, build, and full server tests pass; both audits contain zero Critical and zero High findings. Record remaining Moderate/Low advisories without expanding scope.

- [ ] **Step 5: Commit only the server manifest and lock**

```bash
cd /private/tmp/dealer-recon-ci-dependency-hardening
git add server/package.json server/package-lock.json
test "$(git diff --cached --name-only)" = $'server/package-lock.json\nserver/package.json'
git diff --cached --check
git commit -m "chore(server): harden dependency versions"
```

**Rollback point:** Revert this commit alone. The action-pin commit remains valid and the frontend tree remains untouched.

**Acceptance criteria:** Server package/lock changes are limited to the direct Vitest floor, declared overrides, and their reachable transitive lock entries; Node 20 install succeeds; full and production audits have zero Critical/High findings; no source or test file changes.

---

### Task 3: Harden the frontend dependency tree

**Files:**

- Modify: `frontend/package.json:15-39`
- Modify: `frontend/package-lock.json`

**Interfaces:**

- Consumes: frontend scripts `lint`, `test`, `build`, and `test:e2e`; direct Vite, PostCSS, and Vitest declarations; `@vitejs/plugin-react@4.7.0` Vite peer range `^4.2 || ^5 || ^6 || ^7`; transitive ESLint, typescript-eslint, Babel, Autoprefixer, and PostCSS chains; npm lockfile v3; Node 20.
- Produces: `dependencies.vite = "6.4.3"`; `devDependencies.postcss = "8.5.23"`; `devDependencies.vitest = "3.2.6"`; root transitive overrides for the two vulnerable brace-expansion lines, js-yaml, nanoid, and browserslist; a regenerated `frontend/package-lock.json` consumed by CI, Playwright, and Task 4.

- [ ] **Step 1: Establish the frontend security RED under Node 20**

```bash
cd /private/tmp/dealer-recon-ci-dependency-hardening/frontend
fnm exec --using=20 npm audit --audit-level=high --json
fnm exec --using=20 npm audit --omit=dev --audit-level=high --json
fnm exec --using=20 npm ls --package-lock-only --all brace-expansion js-yaml nanoid browserslist postcss vite vitest
```

Expected RED: full audit is 1 Critical/6 High/3 Moderate/1 Low and production-only is 4 High/2 Moderate; the vulnerable versions match the evidence table. Both baseline audit commands exit 1 because they meet the High threshold.

- [ ] **Step 2: Raise only the three direct floors and add four transitive package overrides**

Set the existing direct declarations to:

```json
"vite": "6.4.3",
"postcss": "8.5.23",
"vitest": "3.2.6"
```

Add this root-level object after `devDependencies`:

```json
"overrides": {
  "brace-expansion@<=1.1.17": "1.1.18",
  "brace-expansion@>=3.0.0 <5.0.9": "5.0.9",
  "browserslist": "4.28.7",
  "js-yaml": "4.3.2",
  "nanoid": "3.3.18"
}
```

Do not change React, TypeScript, Tailwind, Playwright, Testing Library, jsdom, or plugin-react declarations. Do not reclassify Vite between dependency groups.

- [ ] **Step 3: Regenerate only the frontend lockfile and inspect transitive movement**

```bash
fnm exec --using=20 npm install --package-lock-only --ignore-scripts
fnm exec --using=20 npm ci
fnm exec --using=20 npm ls --all brace-expansion js-yaml nanoid browserslist postcss vite vitest
git diff --check -- package.json package-lock.json
git diff -- package.json
git diff --stat -- package-lock.json
```

Expected: npm accepts exact Vite 6.4.3 with plugin-react 4.7.0 and exact Vitest 3.2.6 without peer errors; PostCSS resolves exactly to 8.5.23; none of the audit-vulnerable versions remain; transitive movement is attributable to the three direct upgrades or the five override entries covering four transitive packages.

- [ ] **Step 4: Prove the frontend GREEN and production-build compatibility**

```bash
fnm exec --using=20 npm run lint
fnm exec --using=20 npm test
fnm exec --using=20 npm run build
fnm exec --using=20 npm audit --audit-level=high --json
fnm exec --using=20 npm audit --omit=dev --audit-level=high --json
```

Expected: lint and all frontend tests pass; TypeScript and the Vite 6 production build pass; both audits contain zero Critical and zero High findings. Treat any Vite/Vitest compatibility failure as a stop-and-replan condition, not authorization to modify application or test code.

- [ ] **Step 5: Commit only the frontend manifest and lock**

```bash
cd /private/tmp/dealer-recon-ci-dependency-hardening
git add frontend/package.json frontend/package-lock.json
test "$(git diff --cached --name-only)" = $'frontend/package-lock.json\nfrontend/package.json'
git diff --cached --check
git commit -m "chore(frontend): harden dependency versions"
```

**Rollback point:** Revert this commit alone to restore Vite 5/Vitest 1/PostCSS and the old frontend lock without disturbing server or workflow commits.

**Acceptance criteria:** Frontend package/lock changes are limited to the three direct floors, declared overrides, and reachable transitive lock entries; Node 20 lint/test/build pass; full and production audits have zero Critical/High findings; no frontend source, test, or configuration file changes.

---

### Task 4: Run the complete application, database, evidence, browser, audit, and CI validation gate

**Files:**

- Verify only: `.github/workflows/ci.yml`
- Verify only: `server/package.json`
- Verify only: `server/package-lock.json`
- Verify only: `frontend/package.json`
- Verify only: `frontend/package-lock.json`
- Read-only protected evidence root: `/Users/tcompy/Developer/dealer-recon/docs/discovery/hiley-artifacts/acura`

**Interfaces:**

- Consumes: Task 1's six immutable action references; Task 2's server manifest/lock and npm scripts; Task 3's frontend manifest/lock and npm/Playwright scripts; `DATABASE_URL=postgresql://dealer_recon:dealer_recon@localhost:5433/dealer_recon`; `ACURA_EVIDENCE_DIR=/Users/tcompy/Developer/dealer-recon/docs/discovery/hiley-artifacts/acura`; existing migration, PostgreSQL integration, Hurst golden, Acura acceptance, and Playwright contracts.
- Produces: command evidence for server lint/typecheck/build/full tests, PostgreSQL migration/persistence/integration, Hurst regressions, protected April Acura semantics, frontend lint/tests/build, Playwright Chromium, four registry audits, workflow YAML/pin validation, protected-artifact isolation, and a clean final branch. No code interface or committed artifact is produced.

- [ ] **Step 1: Confirm reproducible Node 20 installs from both committed locks**

```bash
cd /private/tmp/dealer-recon-ci-dependency-hardening/server
fnm exec --using=20 npm ci
cd ../frontend
fnm exec --using=20 npm ci
```

Expected: both clean installs succeed without peer-dependency or engine errors and do not modify either lockfile.

- [ ] **Step 2: Run the complete server and named Hurst regression gates**

```bash
cd /private/tmp/dealer-recon-ci-dependency-hardening/server
fnm exec --using=20 npm run lint
fnm exec --using=20 npm run typecheck
fnm exec --using=20 npm run build
fnm exec --using=20 npm test
fnm exec --using=20 npm test -- src/services/reconciliationGoldenFixtures.test.ts src/presenters/mergedFloorplan.test.ts src/presenters/hurstFpRec.test.ts src/cli/generateHurstFpRecExport.test.ts
```

Expected: every command passes with no Hurst golden count, total, ordering, filename, or byte-observable regression.

- [ ] **Step 3: Resolve the existing PostgreSQL owner before migration and integration verification**

```bash
cd /private/tmp/dealer-recon-ci-dependency-hardening
docker compose ps
CI_HARDENING_DB_COUNT="$(docker ps --filter publish=5433 --format '{{.ID}}' | wc -l | tr -d ' ')"
test "$CI_HARDENING_DB_COUNT" -le 1
if [ "$CI_HARDENING_DB_COUNT" -eq 0 ]; then
  docker compose up -d --wait db
else
  CI_HARDENING_DB_ID="$(docker ps --filter publish=5433 --format '{{.ID}}')"
  test "$(docker inspect --format '{{.Config.Image}}' "$CI_HARDENING_DB_ID")" = "postgres:16-alpine"
  test "$(docker inspect --format '{{.State.Health.Status}}' "$CI_HARDENING_DB_ID")" = "healthy"
  docker exec "$CI_HARDENING_DB_ID" pg_isready -U dealer_recon -d dealer_recon
fi
cd server
DATABASE_URL=postgresql://dealer_recon:dealer_recon@localhost:5433/dealer_recon fnm exec --using=20 node --input-type=module -e 'import pg from "pg"; const client = new pg.Client({ connectionString: process.env.DATABASE_URL }); try { await client.connect(); const result = await client.query("SELECT current_database() AS name"); if (result.rows[0]?.name !== "dealer_recon") throw new Error("unexpected database"); } finally { await client.end(); }'
DATABASE_URL=postgresql://dealer_recon:dealer_recon@localhost:5433/dealer_recon fnm exec --using=20 npm test -- src/db/migrate.test.ts src/repositories/reconciliationPersistence.test.ts src/acuraReconciliation.integration.test.ts
```

Expected: exactly zero or one container owns port 5433. With no owner, the worktree's PostgreSQL 16 service starts and becomes healthy. With one owner, it must already be healthy `postgres:16-alpine` and respond as database `dealer_recon`; the current known compatible owner is `dealer-recon-acura-rooftop-reconciliation-db-1`. Any count, image, health, readiness, credential, database-name, test-failure, or test-skip mismatch is a mandatory stop. Do not run destructive recovery, stop another container, or remove a volume.

- [ ] **Step 4: Run protected April Acura acceptance read-only**

```bash
cd /private/tmp/dealer-recon-ci-dependency-hardening/server
ACURA_EVIDENCE_DIR=/Users/tcompy/Developer/dealer-recon/docs/discovery/hiley-artifacts/acura fnm exec --using=20 npm test -- src/acceptance/acuraEvidence.acceptance.test.ts
```

Expected: the protected test runs rather than skips and preserves 199 matched, 0 BOA-only, 9 Dealertrack-only, BOA `1_005_665_140` cents, Dealertrack `-1_039_411_200` cents, Difference `-33_746_060` cents, Variance `0`, and the compact four-column FP REC contract. Do not redirect output to a committed file or print evidence filenames/rows/VINs.

- [ ] **Step 5: Run complete frontend and Playwright Chromium verification**

```bash
cd /private/tmp/dealer-recon-ci-dependency-hardening/frontend
fnm exec --using=20 npm run lint
fnm exec --using=20 npm test
fnm exec --using=20 npm run build
fnm exec --using=20 npm run test:e2e:install
fnm exec --using=20 npm run test:e2e
```

Expected: frontend lint/tests/build and the Acura operator-path Playwright test pass under Chromium. Playwright installation is local tooling state only and must not change tracked files.

- [ ] **Step 6: Re-run all four current registry audits and inspect exact trees**

```bash
cd /private/tmp/dealer-recon-ci-dependency-hardening/server
fnm exec --using=20 npm audit --audit-level=high --json
fnm exec --using=20 npm audit --omit=dev --audit-level=high --json
fnm exec --using=20 npm ls --all brace-expansion js-yaml nanoid postcss vite vitest
cd ../frontend
fnm exec --using=20 npm audit --audit-level=high --json
fnm exec --using=20 npm audit --omit=dev --audit-level=high --json
fnm exec --using=20 npm ls --all brace-expansion js-yaml nanoid browserslist postcss vite vitest
```

Expected: all four audits report zero Critical and zero High findings; the exact trees show only secure versions satisfying the table. Record and explicitly defer any remaining Moderate/Low advisory outside the requested packages.

- [ ] **Step 7: Validate GitHub Actions YAML syntax and immutable references again before any separately authorized push**

```bash
cd /private/tmp/dealer-recon-ci-dependency-hardening
ruby -e 'require "yaml"; Dir[".github/workflows/*.{yml,yaml}"].sort.each { |path| YAML.parse_file(path); puts "parsed #{path}" }'
test "$(rg -c 'actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4\.4\.0' .github/workflows/ci.yml)" -eq 3
test "$(rg -c 'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4\.4\.0' .github/workflows/ci.yml)" -eq 3
if rg -n 'uses:\s+actions/(checkout|setup-node)@v[0-9]+' .github/workflows; then exit 1; fi
```

Expected: Ruby/Psych validates YAML syntax for every workflow and no mutable checkout/setup-node release tag remains. This is a syntax-and-pin gate, not a GitHub Actions schema validator. It must pass before any future separately authorized push; remote CI remains outside this local-only plan.

- [ ] **Step 8: Review the complete branch and prove scope/client isolation**

```bash
git diff --check 174f1f016fe7a2d7afdee0cad8353084f8a9e32b..HEAD
git log --oneline 174f1f016fe7a2d7afdee0cad8353084f8a9e32b..HEAD
git diff --name-status 174f1f016fe7a2d7afdee0cad8353084f8a9e32b..HEAD
git status --short
test ! -e package-lock.json
git diff --quiet 174f1f016fe7a2d7afdee0cad8353084f8a9e32b..HEAD -- package-lock.json
test -z "$(git ls-files -- docs/discovery/hiley-artifacts)"
git diff --quiet --cached -- docs/discovery/hiley-artifacts
git diff --quiet 174f1f016fe7a2d7afdee0cad8353084f8a9e32b..HEAD -- docs/discovery/hiley-artifacts
printf '%s  %s\n' '50706f49ef63dd18706a1dd10a355c96e12b7550e05250022a2f1fedccedbca3' '/Users/tcompy/Developer/dealer-recon/AGENTS.md' '4c5e856472acd0e7b53a4126e117980ecbc9a4433d52fcb8c2d01386b1baac88' '/Users/tcompy/Developer/dealer-recon/docs/development/testing-policy.md' 'b2bc5e3fe8cff6ed543521ce30c02da0742d47834ed09e65ff2267a4e1208aee' '/Users/tcompy/Developer/dealer-recon/package-lock.json' | shasum -a 256 -c -
git -C /Users/tcompy/Developer/dealer-recon status --short
```

Expected branch changes: the committed plan, `.github/workflows/ci.yml`, `server/package.json`, `server/package-lock.json`, `frontend/package.json`, and `frontend/package-lock.json` only. Feature-worktree status is clean. The worktree has no root lockfile change, every discovery-artifact predicate succeeds silently, all three protected original-checkout hashes match their pre-execution values, and the original checkout still reports exactly its three pre-existing untracked files.

If a final review finds an issue, return to the owning task, reproduce it, make the smallest in-scope correction, rerun that task's gate plus Task 4, and create an additive fix commit. Do not create a catch-all cleanup commit.

**Rollback point:** The three implementation commits are independently revertible in reverse order: frontend dependencies, server dependencies, then action pins. The plan commit may remain as an audit record. Use `git revert`; do not reset shared history.

**Acceptance criteria:** All application, database, acceptance, Hurst, browser, audit, and YAML gates pass under Node 20; all four audits have zero Critical/High findings; only the five declared implementation files plus this plan differ from the merge base; no client artifact is tracked, staged, copied, moved, logged, or exposed; no rooftop or production-code work occurred. Any new runtime Critical/High advisory, test regression, migration failure/skip, or Node 20 engine/peer incompatibility stops execution before staging, committing, or advancing tasks.
