# Acura Rooftop Reconciliation Vertical Slice Design

**Date:** 2026-09-14  
**Status:** Approved design; implementation planning pending  
**Product:** Dealer Recon  
**First expansion rooftop:** Acura

## 1. Purpose

Extend Dealer Recon from its Hurst-focused baseline to a supported Acura reconciliation workflow while establishing a controlled, repeatable pattern for later rooftops. The work must preserve Hurst behavior and retain the existing operator flow:

1. Select Store
2. Select Task
3. Upload Inputs
4. Run Workflow
5. Download Outputs

The Acura workflow must reproduce its approved merged reconciliation and goal output from the supplied raw exports. The approved Acura goal output is the authoritative golden artifact.

## 2. Scope

The vertical slice includes:

- Acura evidence characterization
- Explicit accounting-month selection and run identity
- Cross-file accounting-period validation
- Typed rooftop-profile selection
- Acura Dealertrack account `324` preprocessing
- Correct parser and preprocessor provenance
- Unsupported-rooftop gating
- Acura merged and FP REC artifact generation
- Golden-output verification
- Hurst regression protection
- Database-backed integration tests
- One end-to-end browser workflow test
- Acura operating-contract documentation

The vertical slice excludes:

- Dashboards, analytics, KPIs, or trends
- In-app exception editing
- Run-history or audit-history UI
- Automation administration
- Native XLSX support unless Acura's supplied raw input requires it
- React, Vite, Express, or other framework migrations
- Broad authorization restructuring
- Artifact-retention redesign
- Malware scanning
- Implementation of any additional rooftop

## 3. Evidence and authority

Codex must analyze Acura's complete evidence package before changing production behavior:

- Recorded clerk workflow
- Original BOA export
- Original Dealertrack export
- Completed merged reconciliation
- Goal FP REC output

All supplied rooftop workflow artifacts are located under:

`docs/discovery/hiley-artifacts/`

The authoritative rooftop directory mapping is:

| Rooftop | Repository directory |
| --- | --- |
| Acura | `docs/discovery/hiley-artifacts/acura/` |
| Burleson | `docs/discovery/hiley-artifacts/burleson/` |
| Fort Worth | `docs/discovery/hiley-artifacts/fw/` |
| Huntsville | `docs/discovery/hiley-artifacts/hsv/` |
| West | `docs/discovery/hiley-artifacts/west/` |

The Acura discovery phase must inventory and classify every file inside `docs/discovery/hiley-artifacts/acura/` before deciding which file represents each required evidence type.

When evidence conflicts, authority is:

1. Acura goal output
2. Acura completed merged reconciliation
3. Recorded clerk workflow
4. Raw BOA and Dealertrack exports
5. Existing automated tests
6. Current implementation
7. Existing documentation

The recording explains intent and manual operations. The completed reconciliation and goal output establish the required numerical and structural result. Conflicts must be documented and resolved explicitly; implementation must not silently choose a rule.

## 4. Characterization phase

Before production changes, produce an Acura discovery report that records:

- Exact source formats, sheets, and column structures
- Accounting month represented by each source
- Input row counts
- Every manual removal and transformation
- Dealertrack account inclusion and exclusion behavior
- Authoritative amount fields and sign conventions
- VIN source and extraction rules
- Cleaned row counts
- Matched, BOA-only, and Dealertrack-only counts
- Duplicate and same-VIN6 amount-mismatch examples
- Sorting behavior
- Expected BOA and Dealertrack totals
- Difference, adjustment, and variance semantics
- Required output sheets, columns, labels, formulas, and formatting
- Conflicts with Hurst behavior, existing tests, code, or documentation

No production behavior changes during characterization. Unresolved business-rule conflicts stop the implementation workflow.

Original client artifacts must be protected from accidental Git staging. Tests should use sanitized fixtures where practical while retaining sufficient structural fidelity to prove behavior.

## 5. Architecture

Acura uses the existing upload, persistence, reconciliation, artifact, and download workflow. An explicit rooftop profile selected by store identity defines the supported variation.

The profile contains:

- Stable rooftop identifier
- Enabled/supported status
- Supported BOA and Dealertrack source formats
- Account inclusion and exclusion rules
- Source-specific preprocessing rules
- Parser and preprocessor names and versions
- Required artifact types
- Output presenter or template identifier
- Golden fixture identifiers

The shared reconciliation kernel retains the common behavior unless approved Acura evidence proves a genuine business difference:

- Integer-cent monetary representation
- VIN and VIN6 normalization
- Exact absolute-amount matching
- Deterministic classification and ordering
- BOA-only and Dealertrack-only exception semantics
- Immutable source and normalized snapshots
- Auditable removed-row reasons
- Artifact persistence and replay

Acura-specific behavior must not alter Hurst output. A difference proven by Acura evidence must be expressed as an explicit rooftop policy or presenter rule, covered by tests, and documented. Hidden store-name conditionals are prohibited.

## 6. Data flow

1. The user selects Acura, the reconciliation task, and an explicit accounting month.
2. The backend resolves Acura's enabled rooftop profile.
3. BOA and Dealertrack uploads are persisted and parsed independently.
4. Derived source periods are compared with the selected accounting month.
5. Acura preprocessing filters Dealertrack account `324`, applies approved source-cleaning rules, and records row-level reasons.
6. Normalized transactions enter the shared reconciliation kernel.
7. The kernel creates deterministic matches and exceptions.
8. Acura's presenter generates the merged reconciliation and FP REC artifacts from the stored reconciliation result.
9. The complete run package is persisted with period, rooftop-profile version, parser versions, preprocessor versions, snapshots, results, and artifacts.
10. Downloads expose the final artifacts through the existing workflow.

The FP REC presenter must consume the stored reviewed reconciliation result. It must not execute a second independent matching process.

## 7. Accounting period and run identity

The accounting month selected by the user is authoritative. Dates derived from uploaded sources are validation evidence.

The run identity and artifact labels must use the selected accounting month rather than the execution date. The implementation plan must define one canonical machine representation and one operator-facing label consistent with the existing product conventions.

A run cannot proceed when:

- Either source proves a different accounting month
- The two sources prove different accounting months
- Available date evidence is internally contradictory

Incomplete dates may generate a warning only when all available evidence remains compatible with the selected month.

## 8. Validation and failure behavior

Reconciliation must stop before execution when:

- The selected store lacks an enabled rooftop profile
- A required BOA or Dealertrack file is missing
- A source format is unsupported
- The source type cannot be identified confidently
- A derived source period conflicts with the selected month
- Required columns or account data are absent
- Acura account `324` produces no usable Dealertrack records
- Parsing or preprocessing yields structurally invalid transactions

Warnings may permit continuation when:

- Some rows lack usable VINs
- Original Amount is used under an approved fallback because Ending Balance is unavailable
- Rows are removed under an approved, auditable rule
- Duplicate candidates require deterministic classification
- Date evidence is incomplete without contradicting the selected month

Every failure response must contain:

- Stable machine-readable error code
- Human-readable explanation
- Affected source
- Accounting period
- Rooftop profile identifier
- Safe row or column evidence when applicable
- Recovery instruction

Rejected uploads and failed runs remain auditable and cannot expose final downloads.

A run becomes successful only after all required artifacts have been generated and persisted. Partial artifact generation produces `artifact_failed`; it cannot appear as completed.

## 9. Duplicate uploads

Prior normalized data or artifacts may be reused only when all of these values match:

- Store
- Source type
- Accounting month
- Source checksum
- Parser name and version
- Preprocessor name and version

The implementation must define whether the existing run is returned or a new run references reusable immutable inputs. In either case, the behavior must be deterministic, auditable, and covered by database-backed tests. It must not return a preprocessing receipt that loses previously stored removed-row evidence.

## 10. Output contract

Acura's supplied goal output is the golden artifact for its output layout and business semantics. The completed merged reconciliation is the golden artifact for intermediate reconciliation detail.

Characterization must settle:

- Official sheets or workpapers
- Visible columns and ordering
- Row ordering
- Labels and clerk terminology
- Formula and total behavior
- Difference and variance meanings
- Exception placement
- Formatting that carries operational meaning

Tests compare business-significant workbook structure and data without depending on unstable binary metadata such as generated timestamps or internal workbook identifiers.

## 11. Testing strategy

### 11.1 Parser tests

Prove that Acura's raw source structures become the expected source records, including malformed-row and missing-column behavior.

### 11.2 Preprocessor tests

Prove account `324` selection, every approved removal rule, amount selection, VIN derivation, normalized counts, and row-level reason codes.

### 11.3 Reconciliation tests

Prove exact expected pairings, match tiers, exception classifications, duplicate behavior, same-VIN6 amount mismatches, totals, and ordering.

### 11.4 Golden artifact tests

Generate the Acura merged reconciliation and FP REC outputs and compare them semantically with the approved artifacts.

### 11.5 Hurst regression tests

All existing Hurst golden counts, totals, ordering, and artifacts must remain unchanged unless a separate approved Hurst contract change explicitly authorizes a difference.

### 11.6 Persistence tests

Using PostgreSQL, prove persistence and retrieval of the accounting month, profile version, parser and preprocessor provenance, source snapshots, reconciliation results, removed-row evidence, and complete artifacts.

### 11.7 Browser workflow test

Prove the operator path:

`Select Acura -> Select Task -> Select Accounting Month -> Upload Inputs -> Run Workflow -> Download Outputs`

The test must verify clear failure presentation for a period mismatch and successful download availability for an accepted run.

## 12. Completion criteria

Acura is supported only when:

- Its approved monthly example matches exactly on business data
- Output differences are restricted to explicitly accepted nondeterministic metadata
- Accounting-month and cross-file validation pass
- Removed-row behavior agrees with the recorded workflow
- Match and exception counts agree with the completed reconciliation
- Totals and variance semantics agree with the goal output
- Stored and regenerated artifacts agree
- Duplicate submission behavior is verified
- Failed artifact generation cannot produce a completed run
- Unsupported rooftops cannot initiate reconciliation
- Existing Hurst regression tests pass unchanged
- Database-backed tests pass
- Backend and frontend production builds pass
- The Acura browser workflow passes

## 13. Delivery phases

### Phase 1: Discovery

- Protect original artifacts from accidental commits
- Analyze the Acura recording and files
- Produce the characterization report
- Stop on unresolved conflicts

### Phase 2: Shared prerequisites

- Add explicit accounting-period semantics
- Add rooftop support gating
- Correct parser and preprocessor provenance
- Preserve Hurst behavior

### Phase 3: Acura workflow

- Implement Acura behavior test-first
- Generate Acura artifacts from stored reconciliation results
- Connect the profile to the existing operator workflow

### Phase 4: Acceptance

- Compare generated outputs with approved Acura artifacts
- Run complete Hurst and Acura verification
- Verify persistence, regeneration, production builds, and browser behavior

### Phase 5: Pattern extraction

- Document shared components and Acura-specific policies
- Record the rooftop-onboarding procedure
- Use the proven boundary as the starting point for Fort Worth

## 14. Later rooftop rule

Acura is not the implicit default for other stores. Each later rooftop requires:

- Its own evidence characterization
- An explicit supported profile
- Sanitized fixtures
- Parser and preprocessing tests
- Reconciliation golden tests
- Output golden tests
- Hurst and previously supported rooftop regression tests
- An acceptance gate based on its approved output

The planned order after Acura is Fort Worth (`fw`), Burleson (`burleson`), Huntsville (`hsv`), and West (`west`), followed by rooftops whose complete evidence packages are not yet present.
