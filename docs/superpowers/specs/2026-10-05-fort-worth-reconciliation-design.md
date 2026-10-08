# Fort Worth reconciliation and shared VIN correction specification

**Status:** Implementation correction authorized 2026-10-08. Fort Worth remains disabled. The 2026-10-08 decision supersedes the earlier native-XLSX approval. Earlier investigation/review records below describe their original dates, not current verification.
**Inspected baseline:** `main`, `721e76cc8e690437f60cbdf4713a27572cadc92f`; no subsequent commits or tracked/staged changes.
**Plan:** `../plans/2026-10-05-fort-worth-reconciliation.md`.

## 1. Purpose, authority and evidence status

Dealer-recon imports and reconciles Fort Worth source data and exports two operational HTML-based `.xls` files through the shared export architecture. Clerks complete exception research, description edits, supporting references, follow-up notes and final workpaper completion in Excel. The app preserves source descriptions and blank clerk-entry cells; export does not mean accounting sign-off.

The user's latest attached request approves all product choices below and supersedes previous FW-only correction protections, mandatory reference/reason policies, conflicting-VIN rejection, HTML-XLS proposal and historical-parity release gate. Those questions are settled. Engineering choices are specified here without additional approval questions. Implementation, cleanup, branching, staging, commits, PRs, deployment and enablement are not actions authorized by this documentation turn.

Read `AGENTS.md`, `docs/development/testing-policy.md`, `docs/development/rooftop-onboarding.md` and both `2026-09-18-fort-worth-*` characterization documents. Characterizations remain unchanged. Protected originals stay read-only at `docs/discovery/hiley-artifacts/fw`. Goal/completed output is an assertion oracle, never a runtime VIN lookup or enrichment input.

Current investigation inspected shared correction form/API/validator, lineage and audit records, transaction repositories, snapshots/replay, artifact/download paths, profile/preprocessing/presenters, existing tests, ExcelJS package/type/documentation and production Docker dependency installation. Installed ExcelJS is 4.4.0, currently dev-only; production image uses `npm ci --omit=dev`. Artifact storage is BYTEA and already carries MIME/filename. No library evaluation run, application test, database query/migration or native Excel execution occurred.

April calculations, workbook inspection and recording findings are inherited from characterization and user acceptance criteria, not freshly rerun. Independent evidence for the historical April correction is still absent. Seven untracked files exist: these two documents, both characterizations, `AGENTS.md`, testing policy and root lockfile. Preservation checks cover the five pre-existing non-target documents/files, 19 tracked evidence copies and 12 protected-directory files.

## 2. Approved decisions and bounded design

| Area | Settled decision | Technical consequence |
| --- | --- | --- |
| Shared VIN verification/correction | Across rooftops, operators may correct any vehicle VIN, including a valid conflicting full VIN; display old/proposed values and require confirmation. No supervisor, mandatory source/reference or narrative. | Shared BOA/Dealertrack workflow and atomic revision/audit implementation, not FW-only enforcement. Existing fields optional; no fabricated field values. |
| Spreadsheet completion | Research, descriptions, references and final notes/sign-off happen after export. Unresolved entries may be exported. | Preserve source descriptions; leave C:D notes blank. No annotation/approval subsystem or requirement to correct all VINs before export. |
| FW contents/format | Selected month's merged detail and FP REC only, each a shared HTML-based `.xls`. No historical sheets, auxiliary sheet or status legend. | Two one-sheet HTML-XLS artifacts; Hurst/Acura remain existing export formats. |
| FW input | Evidenced CSV; require BOA Ending Balance and DT `2100`,`2101`,`2101S`; blank DT account cells zero, missing headers/malformed required nonblank amounts block processing. | Scoped preprocessor policies; other rooftop formats/accounts unchanged. |
| Offsetting rows | Retain nonzero included components that sum to zero once as flagged unmatched review rows; label `Offsetting account balances—review.` and show components. | FW adapter excludes those rows from matching. Components visibly rendered outside clerk-note cells; balances unchanged. |
| Maturity | Retain on/before-month-end and missing dates; flag on/before and unparseable dates. | Warnings never remove balances or alter eligibility. |
| Fidelity | Correct labels/formulas/sections, interleaving, deterministic ties, editable notes, readable print; FP REC A:D working area/A:F portrait span. | Shared presenters and an explicit FW Excel usability gate; exact historical page breaks/spaces/note merges unnecessary. |
| Initial release | A original April + B shared correction + Excel usability and all applicable quality gates qualify; C historical correction remains conditional and disclosed. | Missing C does not block implementation completion or initial-release eligibility. Actual enablement remains separate. |
| Evidence cleanup | Replace references with invented fixtures; remove exactly the inventoried 19 tracked copies from current tree. | Approved future implementation boundary, not executed now; preserve originals and Git history. |

Established accounting evidence remains unchanged: BOA Ending Balance after characterized removals; signed DT `2100 + 2101 + 2101S`, excluding `2110`, displayed as logical `2100`; exact absolute-cent matching under existing identity tiers; split same-VIN/different-amount exceptions; distinct duplicate transactions; April aggregates in §7. No shared matching-engine rewrite, new rooftop or other-rooftop format conversion is included.

Engineering choices: deterministic tie tuple; explicit revision preconditions; one revision column and existing audit/lineage storage; shared HTML serialization; conditional review columns and wrapped descriptor lines for offsetting rows; bounded print ranges spanning A:F. No product choices remain open in this specification.

## 3. Shared VIN verification, correction and compatibility

### What the app can establish

Apply to vehicle-bearing BOA and Dealertrack transactions across Hurst, Acura, Fort Worth and future profiles using the shared workflow. Existing authorization/store boundaries apply. Other non-vehicle source types do not gain arbitrary editable identifiers.

Expose assessments from current normalized identity and source evidence: `missing` (no identity token), `incomplete` (identifiable short token, not arbitrary prose), `invalid` (nonblank claimed VIN fails current 17-character/no-I/O/Q format), `conflicting` (distinct valid full VINs in structured VIN and extracted description of the same source record). Missing/invalid extraction evidence must not be guessed from an unrelated number. Amount agreement, reused controls, short-prefix similarity or cross-source disagreement alone cannot establish the correct identity; present only the observable discrepancy/ambiguity. Do not claim external VIN registry validation or checksum verification. A valid VIN can still be edited; action availability is not limited to flagged rows.

After operator confirmation, normalized identity is authoritative for future runs; preserved raw disagreement remains history, not an instruction to restore the raw value. Existing matching behavior must consume that corrected normalized identity rather than letting an older description token override it; regression tests establish that priority without changing matching tiers/accounts. Assessment does not auto-confirm, change matching thresholds or block export of unresolved exceptions.

### Existing capability and revised API

Currently POST accepts Dealertrack only, requires `source` and nonblank `reason`, and permits optional `dms_reference`; UI requires source/reason and is exposed only for repair diagnostics. Update and audit happen separately. GET returns no revision. These are gaps to implement, not existing guarantees.

Keep `POST /transactions/:transactionId/vin-enrichment` and `GET /source-files/:sourceFileId/transactions`. Add authorized `GET /transactions/:transactionId/vin-verification` for exact-ID review, including historical-run actions targeting the current source transaction. Both reads return current VIN, `vin_enrichment_revision`, assessment, source-file/store identity and original source-row number where known. Do not expose unrestricted raw lineage or audit narratives on list responses.

New write contract: `{vin:string, expected_revision:number, confirmed:true, source?:existingSourceEnum|null, reason?:string|null, dms_reference?:string|null}`. Valid full VIN normalization uses the existing syntax rule. Optional blank strings normalize to null; omitted/null optional fields accepted. A supplied unknown source or wrong-type optional field is rejected, never replaced with an invented value. The new form has no mandatory source dropdown, narrative or reference; it may omit all three. Existing clients' valid supplied optional fields are retained in the existing audit/provenance trail. Server origin `manual_enrichment` records the factual operation when no user source is provided, not an invented DMS verification claim; distinguish this internal operation origin from nullable `operator_source`. Never manufacture a reason/reference or send placeholder text to satisfy old validation.

Explicit confirmation displays existing full VIN (or missing/invalid value) beside proposed full VIN and requires a fresh unchecked confirmation control. Changing proposed VIN clears confirmation. Replacing a valid full VIN is permitted with the same authenticated write authority; no supervisor or conflicting-VIN rejection. Successful correction returns current transaction, incremented revision, `audit_event_id`, `requires_rerun:true`, and legacy response fields; no same-run mutation. Same normalized VIN at current revision returns `VIN_NO_CHANGE` without an audit/mutation.

### Revision, old clients and atomicity

Add canonical `transactions.vin_revision INTEGER NOT NULL DEFAULT 0 CHECK (vin_revision >= 0)` (max 2,147,483,647; reject increment exhaustion safely). Migration establishes a new concurrency baseline of 0 for older transactions, **not** a claim that no historical correction occurred. Preserve all prior audit/lineage records. No destructive audit rewrite or new approval/history table. New lineage may carry optional `vin_revision`; when present it must be a valid integer agreeing with the canonical column. Migration preflight fails closed on any unexpected pre-existing revision-bearing lineage/history, including valid zero or positive values as well as malformed values; report aggregate diagnostics and require a separately reviewed data-preserving migration amendment. Do not silently seed canonical 0 over existing revision metadata. Ordinary legacy audit/transformations without revision fields remain supported. Older lineage with no revision remains valid; current-row revision >0 requires coherent new provenance/audit linkage. Malformed present revision state fails `VIN_REVISION_STATE_INVALID`, with no mutation; missing legacy fields and corrupted fields are different cases.

The UI loads the authorized current transaction, displays identity/revision, and freezes `{transactionId, expectedRevision}` as the reviewed baseline. Clear baseline and confirmation on open/source/transaction change. No client fallback to 0; no pre-submit refresh that silently updates the reviewed version. POST carries that revision unchanged. Server resolves actor, time, authorization and source scope from authenticated/persisted data; none comes from client authority fields.

Under a single transaction-row lock, compare client expected revision with current persisted revision **before** same-VIN/no-change handling. On mismatch return 409 `VIN_ENRICHMENT_REVISION_CONFLICT`; do not mutate identity, lineage, revision or audit. UI disables submit, invalidates baseline and offers explicit refresh/review. Refresh loads current identity/revision, clears proposed VIN/confirmation and any attempted optional text; there is no automatic resubmit. Both overlapping requests at revision 0 and a form at 0 submitted after another commit at 1 must produce only one successful mutation/audit and a conflict for the stale request.

Old API clients may continue reading and supplying source/reason/reference; they must adopt the additive `expected_revision` and `confirmed` preconditions to write. An unversioned write returns 428 `VIN_ENRICHMENT_REVISION_REQUIRED`, directing the client to GET and explicitly reconfirm; missing/false confirmation returns 400 `VIN_CONFIRMATION_REQUIRED`. No server-sampled revision fallback can safely preserve the operator-reviewed baseline. This is a deliberate fail-closed compatibility response, not silent acceptance or fabricated consent. Coordinate form/client rollout with the server contract; old writes are never allowed to bypass stale-edit protection. Unknown optional revision types/ranges fail validation.

Atomic repository operation loads/locks the current transaction and source, verifies scope/preconditions, builds normalized identity and lineage from that locked row, increments revision and writes the existing `vin_enrichment_applied` audit on the same SQL client. Audit contains server actor/time, old/new normalized identity, old/new revision, source linkage, and only optional user fields actually supplied. Existing source bytes, raw snapshot/description, amounts and prior audits remain unchanged. An audit/provenance failure rolls back everything. Memory implementation validates the entire operation before swapping state. Source-less legacy transactions cannot be safely scoped to a store and return an explicit scope-unavailable response; no guessed default store.

### Historical identities and reruns, all rooftops

Correction creates no reconciliation automatically. Explicit rerun uses the corrected current normalized identity and records a new immutable input snapshot. Old result grouping, snapshot identities and stored artifact bytes remain unchanged. Duplicate source reuse does not reset corrections.

Make run-detail assembly and exception categorization snapshot-backed for **all rooftops**, using saved transactions by ID, not current `transactions` rows. New snapshots retain revision; old snapshots lacking revision retain their saved identities unchanged, with revision reported as unknown/not-recorded if needed—not synthesized as 0 and not backfilled. Profile/accounting/format handling stays rooftop-specific. New revision-bearing snapshots carry a validated `operator_confirmed_vin` marker in safe summary metadata, derived only from saved revision >0 with coherent saved correction provenance. Shared merged and FP REC presenters must use that saved normalized full VIN for identifier fields and workpaper VIN tails when marked, even if the unchanged source description contains another VIN. Carry the marked full VIN through intermediate clerk-row models so description-based eight-character tails cannot override it. Unmarked historical Hurst/Acura snapshots retain their previous presentation rules; never infer this marker from today’s live transaction. Source descriptions remain unchanged in every case.

Some legacy runs may have no usable snapshot; current data cannot establish their historical identity. Return 409 `HISTORICAL_IDENTITY_UNAVAILABLE` for regeneration/replay/detail requiring absent or malformed snapshots; never infer original identity from today's row or silently rewrite history. Existing authorized stored artifact downloads still work: download handlers authorize using run metadata and prefer existing artifacts before loading identity detail. No byte conversion/backfill of previous artifacts, including historical `.xls`. This per-run limitation is explicit, not a blocker to planning or a claim that unknown identities were recovered.

For concurrent run creation/correction, snapshot exactly the transaction objects read for that run and build artifacts from that snapshot. The run may consistently reflect before or after a particular correction; it must never match using one identity and export using another. Future rerun sees the committed revision. No global locking/engine rewrite is required.

## 4. Fort Worth import, matching and ordering

Use disabled `fw-v1`, version `1`, presenter `fw-fp-rec-v1`; retain v0 in type unions without reinterpreting v0 sources/runs as v1. FW supports evidenced CSV only: BOA 32 columns, two banners then header; DT six columns with trimmed header lookup. Require an explicit month/store, BOA month-banner agreement and existing DT open-item period evidence (older dates retained, contradictory later dates rejected). No filename overrides or reuse across full processing identity.

BOA Ending Balance is required, with no Original Amount/generic-currency fallback. Remove characterized banners/footer, zero balances and Straight Line. Missing/invalid required amounts block processing with safe row/field diagnostics and no partial import. DT requires all three included account headers, rejects ambiguous duplicate headers and malformed nonblank included amounts; blanks in individual account cells are zero. Exclude `2110` from the signed sum. Distinguish excluded-only/non-detail/all-zero rows from nonzero included components offsetting to zero. Keep receipts/raw row lineage for removals. Other profiles retain current formats, accounts and rules.

Retain current/overdue maturities and flag dates on/before month-end; flag unparseable dates, retain missing dates. Neither warnings nor corrected VINs alter financial values. Do not infer payoff. Missing/incomplete/invalid/conflicting identities can remain visible exceptions and be exported.

For ordinary rows use the existing shared reconciliation tiers and exact absolute cents. Preserve every physical transaction, duplicate, same-VIN/different-amount split exception and sign; no amount-only/prefix auto-confirmation, netting or forced equality. FW offsetting rows are a narrow adapter boundary: keep every such DT row once with zero total and account components, exclude it from auto-matching, and append a DT-only review exception using existing exception storage. Replay uses the same FW adapter policy. User approval, not a demonstrated client example, establishes this boundary; synthetic tests are required.

Merged core columns A:H: `FORT WORTH`, `Serial No/VIN`, `VIN6`, `Ending Balance`, `2100`, `VIN6`, `Description`, `Control`; historical `FW` remains an alias. BOA-only A:D, DT-only E:H, matched both. Source descriptions are preserved as literal text. Default interleaving key is populated BOA signed amount, else absolute DT amount. Equal-amount tuple uses deterministic code-point comparison: BOA normalized full VIN or empty; DT normalized full VIN or empty; DT control or empty; classification rank matched=0/BOA-only=1/DT-only=2; original BOA row ordinal (absent=-1); original DT row ordinal (absent=-1). Missing required provenance fails safely. One fixed source pair makes file hashes redundant for tie comparison, but source hashes remain audit identity. Ties never determine matches and may differ from undocumented clerk ties.

Generate FW exports from persisted outcomes/snapshots only. Reject the legacy cleaned-record FW presenter entry point that applies stock/prefix fallback; preserve its non-FW behavior. FP REC sections filter this same merged sequence. Monetary totals use integer cents independently of display/formula caches.

### Visible offsetting-row explanation

Keep the exact label `Offsetting account balances—review.` In merged output, when any offsetting rows exist, append columns I:L: `Review`, `2100 component`, `2101 component`, `2101S component`. For flagged rows, I holds that label and J:L are signed numeric values (blank source component renders numeric 0); nonflagged rows leave I:L blank. Without offsetting rows, retain the eight-column layout. G retains the exact source description; source rows are not duplicated for explanations.

FP REC retains A:D: append wrapped lines in the existing row's A descriptor after its original unit reference: the label and all three named component amounts. B remains numeric zero; C:D remain blank editable clerk cells; E:F contain no business values. No extra monetary/detail row or generated note entry. Auto-sized-by-content row heights must expose every line in print. Labels/components remain derived export explanation, never a rewritten source description. Tests prove unchanged totals but increased physical exception counts and shifted formula ranges.

## 5. Shared HTML-XLS construction and artifact contract — superseding decision 2026-10-08

The user explicitly superseded the earlier approved native-XLSX requirement. Research, descriptions/references, follow-up notes and final completion in Excel are shared rooftop workflows, not a Fort Worth-specific technology requirement. Use the established shared HTML-based `.xls` architecture, extending presentation policies only for the FW contract. This is HTML understood by Excel, not BIFF or OOXML; never label it `.xlsx`.

Keep two selected-period outputs: `fw-merged-floorplan-YYYY-MM.xls` and `fw-fp-rec-YYYY-MM.xls`, MIME `application/vnd.ms-excel`, worksheets `MERGED` and uppercase `MMMYY`. Omit historical/auxiliary/legend sheets. Preserve every accounting, identity, ordering and offset rule in §§4/6/7. Shared source-description handling must escape HTML and neutralize formula-like text without changing the underlying model. Identifiers and controls remain text, including leading zeros; money uses numeric cells and controlled `x:fmla` formulas with displayed values independently computed from integer cents. No user-controlled formula attributes.

Merged header is row1, data rows2…N+1, totals N+2, with D/E SUM formulas (empty input uses `=0`); G totals label is `Final Totals:`. No extra variance/detail row. Core A:H plus conditional I:L review components remain as §4. Use readable wrapped descriptions and landscape, fit-to-width print A:H/A:L; repeat the header. FP REC uses §6 exactly, including empty sections; A:D working cells, blank E:F portrait print span through variance, readable wrapped offset explanations and blank unprotected C:D clerk-entry cells. Retain operational labels, borders, accounting display and no yellow highlights. Exact historic pagination, incidental spacing and manual note merges remain unnecessary. Selected month-end is displayed as mm/dd/yyyy using the full selected year. Native date objects, OOXML caches and native freeze-pane encoding are no longer acceptance requirements.

Retain `buildFloorplanExports`' asynchronous Buffer interface, six existing artifact types, atomic batch persistence, snapshot-backed regeneration and authorization. New FW HTML uses the same shared presenter entry points as Hurst/Acura with narrowly scoped policies; their output remains unchanged. Remove the unused FW native writer. Return ExcelJS 4.4.0 to development/test dependencies without changing resolved package versions; it remains available to read protected goal workbooks in tests.

Default and explicit `xls` requests generate shared HTML-XLS. `json` remains the semantic model. Explicit `xlsx` may download an existing native XLSX artifact with its original bytes/name/MIME; otherwise return 422 `UNSUPPORTED_EXPORT_FORMAT`, never HTML. Authorize and validate store overrides before artifact access. Stored-artifact precedence continues for default/xls downloads even when the stored file is native XLSX; do not convert or relabel it. Hurst/Acura explicit xlsx stays unsupported. A missing legacy identity still blocks regeneration, not authorized stored downloads. No artifact/schema migration, new rooftop, shared-engine rewrite or production enablement.

Serialized-output tests must inspect actual HTML cells, numeric values, formulas, logical coordinates, labels, row order, print metadata, literal text safety and blank clerk cells. Independently compare expected cents and membership; do not substitute model-only assertions. Keep immutability and failed-serialization/batch atomicity tests. Native ZIP/OOXML/cache/runtime-ExcelJS gates are removed. Actual Excel open, recalculation, clerk edit, save/reopen and print inspection remains required for the resulting FW `.xls`; unavailable Excel is explicitly `BLOCKED_EXCEL_UNAVAILABLE`. Do not require or claim retrospective Hurst/Acura Excel usability verification.

## 6. FP REC rows and dynamic formulas

A labels/descriptors, B signed money, C:D manual entries; E:F blank print span. Fixed rows: A1 `Floorplan Reconciliation - Hiley Cars Fort Worth`; A2 selected month-end; A3 `Outstanding on STMT`/B3 BOA total; A4 `GL Balances`; A5 `2100`/B5 combined GL; A6 `Total GL`/B6 `=SUM(B5)`; A7 `Difference`/B7 `=B6+B3`; row 8 `On schedule-not on statement`, C8 `GL FLOORED`, D8 `BOA FLOORED`.

Let n = DT-only physical rows, m = BOA-only physical rows, including split/duplicate/offset exceptions. Preserve one reserved blank row per section, no Acura minimum padding:

| Element | Row/formula |
| --- | --- |
| Schedule detail | 9 through 8+n |
| Schedule reserved blank | 9+n |
| Schedule subtotal s | 10+n; `B{s}=SUM(B9:B{s-1})` |
| Statement header | s+1; `On statement-not on GL`, C `BOA FLOORED`, D `GL FLOORED` |
| Statement detail | s+2 through s+1+m |
| Statement reserved blank | s+2+m |
| Statement subtotal t | s+3+m; `B{t}=SUM(B{s+2}:B{t-1})` |
| Net adjustments | t+1; `=B{t}+B{s}` |
| Variance | t+2; `=B{t+1}-B7` |

Empty sections give subtotal rows 10/13 and variance 15. Corrected April n=38,m=107 gives 48/158/159/160 and exact SUM ranges B9:B47 and B50:B157. Original April n=39,m=108 gives 49/160/161/162. Verify formula text, serialized numeric values and independent cents. Preserve source-based unit descriptors, no guessed floor dates, no researched description substitutions. Manual C:D remain blank even for flagged zero-sum/maturity/VIN exceptions.

## 7. Acceptance, release and known limitations

| Outcome | Required proof | Effect on completion/release |
| --- | --- | --- |
| A: original April | Raw inputs: 686 matches, 147 physical exception rows; independently verified identities/membership, totals, formulas/order/layout. | Required for implementation completion and initial-release eligibility. Prior characterization is baseline, not an executed new acceptance pass. |
| B: shared correction | Across Hurst/Acura/FW and both vehicle sources: explicit confirmation, optional fields, valid-VIN replacement, revision conflicts, atomic audit, reruns, old snapshots/downloads/regeneration. | Required alongside regression/DB/browser/code/security review. Synthetic evidence suffices; no historical April proof needed. |
| C: corrected April | Independent historical correction evidence plus supported correction flow: 687 matches,107 BOA-only,38 DT-only and membership/accounting proof. | Currently `BLOCKED_EVIDENCE_MISSING`. Conditional; does not block completion or initial-release eligibility. Never passed by a silent skip or manufactured correction. |
| Excel usability | Resulting FW `.xls` opens, recalculates, permits clerk edits/save/reopen and readable printing. | Required; report `BLOCKED_EXCEL_UNAVAILABLE` if unavailable. Serialized tests do not substitute. No retrospective Hurst/Acura Excel gate. |

Initial release may qualify on A+B plus FW Excel usability and all applicable quality gates. Update onboarding guidance accordingly during implementation. Actual production enablement stays separate; FW remains disabled through this plan. No unresolved product decision blocks planning. Execution authorization, future test results and native verification are outstanding; C is a disclosed historical evidence gap only.

| April measure | Original | Corrected, conditional |
| --- | ---: | ---: |
| BOA / DT retained | 794 / 725 | 794 / 725 |
| Matches | 686 | 687 |
| BOA-only / DT-only | 108 / 39 (verify physical membership) | 107 / 38 |
| Exception rows / merged rows | 147 / 833 | 145 / 832 |
| BOA cents | 4,034,820,196 | 4,034,820,196 |
| GL cents | -3,599,702,841 | -3,599,702,841 |
| Difference / net adjustments cents | 435,117,355 | 435,117,355 |
| Final variance cents | 0 | 0 |

Corrected section subtotals only: DT -168,956,209; BOA 604,073,564 cents. Original section subtotals are independently calculated, never borrowed from corrected output. Corrected mismatch expectation: 12 same-VIN/different-amount groups/24 split rows. Zero variance does not prove matching correctness.

**Independent A membership oracle:** read original CSV fields with CSV parsing only, independently apply characterized removals/signed account sums and decimal-to-cent arithmetic; extract complete VINs actually present in original BOA identifier/DT description. Group by normalized full VIN + absolute cents; pair unique rows on each side only. Incomplete identity, amount mismatch and same-key ambiguity stay unmatched with physical multiplicity preserved. The characterized repeated April VIN has distinct amounts. Unexpected ambiguity fails with a safe count rather than choosing a row to recover target counts. No production matching/preprocessing/normalizer calls, engine-result-derived expectations, corrected-goal identity or inferred missing correction. Compare private source-file-hash/row-ordinal pairs and exception-side multisets; only mismatch categories/counts leave memory. Synthetic equal-count/equal-total wrong-pair mutations must fail comparison.

For C, require a protected independently substantiated historical correction record tied to raw source hash/row. The harness authenticates an in-memory operator, GETs revision and POSTs confirmed correction; goal/merged remains assertion-only. Independent evidence is a historical test prerequisite, **not** a mandatory reference/narrative in the normal operator UI/API. Keep attestation/evidence out of Git and reports; never persist protected acceptance rows to an application DB.

Expected completed-goal differences: raw descriptions instead of 160 April DT edits; blank entries instead of 74 populated schedule-adjacent and 212 statement-adjacent note/date cells; omitted history/auxiliary/legend; deterministic engineering ties may differ within equal-amount groups; readable rather than identical page breaks/note merges. Original input also differs by the one unsubstantiated correction. These do not excuse identity/amount/membership/formula errors. Offset components are approved generated explanations outside source descriptions/manual notes.

## 8. Evidence-copy inventory and replacement boundary

Current scan found exactly 19 tracked paths. `D` = `docs/implementation/store-workflow-matrix.md` (directory reference line 27, goal reference line 92); no executable reader of the discovery copies found. `P-F/P-M/P-A` = February/March/April `FW_MERGED_FIXTURE_CASES` at `server/src/presenters/mergedFloorplan.test.ts:117`, loader `readFwFixture` at 871, golden/raw tests at 544/569. `U` = disabled-upload test at `server/src/app.test.ts:3603`, read at 3617. This is a bounded static path/name/loader search, not proof against every possible dynamic reader.

| # | Tracked path | References | Synthetic replacement |
| --- | --- | --- | --- |
| 1 | `docs/discovery/floorplan/FW/raw/FW BOA FEB.csv` | D | core BOA |
| 2 | `docs/discovery/floorplan/FW/raw/FW DT FEB.csv` | D | core DT |
| 3 | `docs/discovery/floorplan/FW/merged/FW FEB MERGED.csv` | D | core merged |
| 4 | `docs/discovery/floorplan/FW/raw/FW BOA MARCH.csv` | D | mismatch BOA |
| 5 | `docs/discovery/floorplan/FW/raw/FW DT MARCH.csv` | D | mismatch DT |
| 6 | `docs/discovery/floorplan/FW/merged/FW MARCH MERGED.csv` | D | mismatch merged |
| 7 | `docs/discovery/floorplan/FW/raw/FW BOA APRIL.csv` | D | enrichment BOA |
| 8 | `docs/discovery/floorplan/FW/raw/FW DT APRIL.csv` | D | enrichment DT |
| 9 | `docs/discovery/floorplan/FW/merged/FW APRIL MERGED.csv` | D | enrichment confirmed merged |
| 10 | `docs/discovery/floorplan/FW/fp-rec/FW FP Rec.xlsx` | D | `fp-rec-contract.json` |
| 11 | `server/src/presenters/__fixtures__/fw/FW BOA FEB.csv` | P-F, U | core BOA |
| 12 | `server/src/presenters/__fixtures__/fw/FW DT FEB.csv` | P-F | core DT |
| 13 | `server/src/presenters/__fixtures__/fw/FW FEB MERGED.csv` | P-F | core merged |
| 14 | `server/src/presenters/__fixtures__/fw/FW BOA MARCH.csv` | P-M | mismatch BOA |
| 15 | `server/src/presenters/__fixtures__/fw/FW DT MARCH.csv` | P-M | mismatch DT |
| 16 | `server/src/presenters/__fixtures__/fw/FW MARCH MERGED.csv` | P-M | mismatch merged |
| 17 | `server/src/presenters/__fixtures__/fw/FW BOA APRIL.csv` | P-A | enrichment BOA |
| 18 | `server/src/presenters/__fixtures__/fw/FW DT APRIL.csv` | P-A | enrichment DT |
| 19 | `server/src/presenters/__fixtures__/fw/FW APRIL MERGED.csv` | P-A | enrichment confirmed merged |

All future replacements live under `server/src/testFixtures/fw/`: `boa-core-sanitized.csv`, `dealertrack-core-sanitized.csv`, `merged-core-sanitized.csv`; analogous `*-mismatch-sanitized.csv`; `boa-enrichment-sanitized.csv`, `dealertrack-enrichment-sanitized.csv`, `merged-enrichment-confirmed-sanitized.csv`; `fp-rec-contract.json`; `index.ts`. Discovery copies need no duplicate replacements. Invent compact data independently, including values/dates/identifiers; do not scramble original rows or retain client counts/totals as ordinary fixtures. Confirmed synthetic merged data is assertion-only.

The user has approved future implementation Task 1 to replace references and remove exactly these 19 current-tree files. Execution waits until this document revision and review are complete and implementation is authorized. Protected originals stay in place. No history rewrite, deletion now, evidence copy to a worktree, or implied historical purge. Ordinary loaders must realpath actual imported files (including symlinks) and require containment under the synthetic root. Use the plan's in-place cleanup branch and authorized cleanup commit before creating a feature worktree; ordinary `git worktree add` today would reproduce them.


## 9. Review and execution boundary

The companion plan separates fixture cleanup, shared correction schema/API/UI/history, FW accounting/presentation, native XLSX transport and acceptance into reviewable tasks. All listed product decisions are approved; no repeated intermediate approval questions are needed for routine implementation choices. Production work still requires execution authorization. Independent review and its resolved findings are recorded in the plan. No implementation tests, native Excel verification, migrations, cleanup or profile changes are claimed by this document.


Independent review of this specification and its implementation plan completed on 2026-10-05. Shared VIN/history and XLSX/artifact/cleanup reviewers rechecked the resolved exported-identity, migration-preflight, empty-total and print-fit findings and found no remaining actionable gaps in their scopes. See the plan’s final review record for findings and actual documentation-only verification. No implementation or native Excel verification is claimed.
