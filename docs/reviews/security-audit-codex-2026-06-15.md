Security Audit Report
Confirmed Findings
Known demo credentials are seeded by migration
Severity: Critical. Status: Confirmed.
Evidence: [1778151600000_add_local_auth_user.cjs (line 22)](/home/trent/workspace/dealer-recon-clean/server/src/db/migrations/1778151600000_add_local_auth_user.cjs:22) inserts demo@dealer-recon.local; lines 31-42 set the known demo hash on the demo user and any empty password.
Why it matters: A production DB migrated with this file gets a known accounting user that can upload, reconcile, and download FP REC artifacts.
Recommended fix: Move demo seeding behind an explicit dev/test-only seed command; remove the migration behavior; rotate any affected hashes.
Suggested regression test: Production migration run must not create demo@dealer-recon.local or assign known hashes.

Auth fallback can silently grant platform admin access
Severity: High. Status: Confirmed.
Evidence: [app.ts (line 155)](/home/trent/workspace/dealer-recon-clean/server/src/app.ts:155) enables fallback when no auth repository is supplied; lines 231-239 create a platform_admin fallback user. index.ts disables it, but createApp itself fails open.
Why it matters: Any alternate entrypoint, test-derived deployment, or misconfigured server instantiation can bypass login for all authenticated routes.
Recommended fix: Require explicit local-only fallback and throw when NODE_ENV is not development/test.
Suggested regression test: createApp(..., { nodeEnv: "production" }) without authRepository must throw or return 401 on protected routes.

Store authorization treats null store scope as globally accessible
Severity: High. Status: Confirmed.
Evidence: [storeAccess.ts (line 20)](/home/trent/workspace/dealer-recon-clean/server/src/access/storeAccess.ts:20) returns true for storeId === null. Event routes such as [app.ts (line 384)](/home/trent/workspace/dealer-recon-clean/server/src/app.ts:384) and [app.ts (line 408)](/home/trent/workspace/dealer-recon-clean/server/src/app.ts:408) allow missing store_id and then list dealership-wide events without filtering. Artifact rows also allow nullable store IDs in [1781222400000_add_reconciliation_artifacts.cjs (line 31)](/home/trent/workspace/dealer-recon-clean/server/src/db/migrations/1781222400000_add_reconciliation_artifacts.cjs:31).
Why it matters: Store-scoped users can see all-store event metadata, and any null-store source/run/artifact becomes broadly accessible inside the dealership.
Recommended fix: Deny null-store access for store-bound roles; require Hurst store association for v1 artifacts; filter all event/account/report responses by store access.
Suggested regression test: A user assigned only to store 1 cannot read store 2 events or download a null-store artifact.

Stored FP REC can diverge from reviewed reconciliation results
Severity: High. Status: Confirmed.
Evidence: [reconciliationArtifacts.ts (line 66)](/home/trent/workspace/dealer-recon-clean/server/src/services/reconciliationArtifacts.ts:66) builds stored merged/FP REC artifacts from raw transactions. [mergedFloorplanExport.ts (line 28)](/home/trent/workspace/dealer-recon-clean/server/src/services/mergedFloorplanExport.ts:28) uses buildMergedFloorplanWorkbook, whose presenter matcher in [mergedFloorplan.ts (line 172)](/home/trent/workspace/dealer-recon-clean/server/src/presenters/mergedFloorplan.ts:172) re-matches cleaned rows. It permits stock/control or VIN-prefix fallback at [mergedFloorplan.ts (line 325)](/home/trent/workspace/dealer-recon-clean/server/src/presenters/mergedFloorplan.ts:325), contradicting the documented VIN6-plus-amount rule.
Why it matters: The output of record can classify rows differently from the exception review the clerk just completed.
Recommended fix: Generate stored merged and FP REC artifacts from ReconciliationRunDetail only; remove or quarantine the parallel cleaned-record matcher for v1.
Suggested regression test: A Dealertrack row with matching amount/control but missing VIN6 must remain an exception in the stored FP REC.

Spreadsheet formula injection is not neutralized
Severity: High. Status: Confirmed.
Evidence: FP REC HTML writes source text through escapeHtml only in [hurstFpRec.ts (line 501)](/home/trent/workspace/dealer-recon-clean/server/src/presenters/hurstFpRec.ts:501). Merged XLS HTML does the same in [mergedFloorplan.ts (line 360)](/home/trent/workspace/dealer-recon-clean/server/src/presenters/mergedFloorplan.ts:360). CSV exports quote only comma/quote/newline characters in [csv.ts (line 131)](/home/trent/workspace/dealer-recon-clean/server/src/presenters/csv.ts:131) and [reconciliationArtifacts.ts (line 211)](/home/trent/workspace/dealer-recon-clean/server/src/services/reconciliationArtifacts.ts:211).
Why it matters: Source descriptions, controls, stock numbers, or notes beginning with =, +, -, or @ can execute as formulas when opened in Excel.
Recommended fix: Centralize spreadsheet text neutralization for CSV and HTML-as-XLS text cells; preserve numeric cells separately.
Suggested regression test: Upload a description like =HYPERLINK("http://example.test","x"); every exported artifact must render it as inert text.

Dealertrack SpreadsheetML parser allows memory exhaustion via ss:Index
Severity: High. Status: Confirmed.
Evidence: [dealertrackXmlParser.ts (line 147)](/home/trent/workspace/dealer-recon-clean/server/src/services/parsers/dealertrackXmlParser.ts:147) parses arbitrary cell index values, then lines 151-153 push empty cells until that index.
Why it matters: A small XML file can request a massive column index and exhaust memory despite the 5 MB upload limit.
Recommended fix: Cap maximum cell index/columns per row and return a validation error when exceeded.
Suggested regression test: XML containing <Cell ss:Index="1000000000"> returns 422 and does not allocate a large array.

Month boundary is not enforced
Severity: Medium. Status: Confirmed.
Evidence: Source files and runs have store IDs but no accounting-month field in [1778065200000_initial_schema.cjs (line 70)](/home/trent/workspace/dealer-recon-clean/server/src/db/migrations/1778065200000_initial_schema.cjs:70) and [1778065200000_initial_schema.cjs (line 110)](/home/trent/workspace/dealer-recon-clean/server/src/db/migrations/1778065200000_initial_schema.cjs:110). /reconcile checks dealership, store, and source type but not month at [app.ts (line 827)](/home/trent/workspace/dealer-recon-clean/server/src/app.ts:827). Automation pairs latest files by source type only in [reconciliationAutomation.ts (line 368)](/home/trent/workspace/dealer-recon-clean/server/src/services/reconciliationAutomation.ts:368).
Why it matters: The v1 workflow is one Hurst accounting month per run; mismatched-month uploads can produce a valid-looking FP REC.
Recommended fix: Capture accounting month at upload/reconcile, require both source files to match, and scope duplicate/automation pairing by month.
Suggested regression test: BOA September plus Dealertrack October must fail before reconciliation and create no FP REC artifact.

Sensitive raw data is stored without retention or immutable output controls
Severity: Medium. Status: Confirmed.
Evidence: Raw uploads and artifacts are stored as BYTEA in [1781222400000_add_reconciliation_artifacts.cjs (line 16)](/home/trent/workspace/dealer-recon-clean/server/src/db/migrations/1781222400000_add_reconciliation_artifacts.cjs:16). Preprocessors persist raw_row_snapshot in [boaPreprocessor.ts (line 496)](/home/trent/workspace/dealer-recon-clean/server/src/services/preprocessing/boaPreprocessor.ts:496) and [dealertrackPreprocessor.ts (line 370)](/home/trent/workspace/dealer-recon-clean/server/src/services/preprocessing/dealertrackPreprocessor.ts:370). Artifact writes overwrite on (run, artifact_type) conflict in [postgresTransactionRepository.ts (line 1132)](/home/trent/workspace/dealer-recon-clean/server/src/repositories/postgresTransactionRepository.ts:1132).
Why it matters: VINs, stock/control numbers, amounts, dates, and names if present remain in DB indefinitely, and the FP REC output of record can be replaced without version history.
Recommended fix: Define retention/deletion, encryption-at-rest expectations, artifact hashing, immutable versions, and audit records for replacements.
Suggested regression test: Re-persisting FP REC creates a new version or explicit audit trail; stored artifacts include a stable content hash.

Removed-row and preprocessing metadata expose sensitive business data
Severity: Medium. Status: Confirmed.
Evidence: Upload responses include full preprocessing metadata at [app.ts (line 780)](/home/trent/workspace/dealer-recon-clean/server/src/app.ts:780). Unsupported-format errors return preprocessing details at [app.ts (line 697)](/home/trent/workspace/dealer-recon-clean/server/src/app.ts:697). Removed-row audit includes stock, VIN6, diagnostic details, and messages at [app.ts (line 1798)](/home/trent/workspace/dealer-recon-clean/server/src/app.ts:1798). Ingestion events store metadata at [postgresTransactionRepository.ts (line 541)](/home/trent/workspace/dealer-recon-clean/server/src/repositories/postgresTransactionRepository.ts:541).
Why it matters: Audit data is useful, but it can reveal VIN6, stock numbers, maturity dates, amount totals, filenames, and parser diagnostics beyond the minimum needed.
Recommended fix: Define a redacted audit schema; gate full diagnostics to write/admin roles; store only counts and non-sensitive summaries in broad event feeds.
Suggested regression test: Read-only users see removed-row counts/reasons but not VIN6, stock numbers, or raw diagnostic details.

Accepted file-format contract is inconsistent and partly extension-driven
Severity: Medium. Status: Confirmed.
Evidence: Upload filtering allows only .csv, .xls, .xml, .html in [app.ts (line 112)](/home/trent/workspace/dealer-recon-clean/server/src/app.ts:112), so real .xlsx files are rejected before OOXML detection. Detection also accepts .csv by extension alone at [fileFormatDetector.ts (line 101)](/home/trent/workspace/dealer-recon-clean/server/src/services/fileFormatDetector.ts:101), even when content sniffing failed.
Why it matters: Users get different errors for the same OOXML content depending on filename, and malformed/binary .csv files can enter parser paths unnecessarily.
Recommended fix: Make content detection authoritative; allow .xlsx to reach detector and return the documented unsupported-format response; reject low-confidence CSV extension fallback for binary content.
Suggested regression test: A binary renamed .csv is rejected; a true .xlsx with .xlsx extension returns the same unsupported-format contract as OOXML renamed .xls.

Download headers and filename handling are incomplete
Severity: Low. Status: Confirmed.
Evidence: Raw upload content type is persisted from client MIME at [app.ts (line 723)](/home/trent/workspace/dealer-recon-clean/server/src/app.ts:723). Stored downloads reuse artifact content type and minimally sanitize only CR/LF/quotes at [app.ts (line 1609)](/home/trent/workspace/dealer-recon-clean/server/src/app.ts:1609). Regenerated merged downloads set artifact.filename directly at [app.ts (line 1239)](/home/trent/workspace/dealer-recon-clean/server/src/app.ts:1239).
Why it matters: Header safety is mostly controlled by attachment, but filenames/content types should not depend on client input, and downloads should prevent sniffing.
Recommended fix: Add X-Content-Type-Options: nosniff, robust filename encoding, fixed content types by artifact type, and one shared header builder.
Suggested regression test: Malicious filenames and text/html uploads produce safe Content-Disposition, fixed download behavior, and nosniff.

Future-scope routes and source types remain active
Severity: Low. Status: Confirmed.
Evidence: Source types include bank, dms, gl, and oem in [types.ts (line 1)](/home/trent/workspace/dealer-recon-clean/server/src/domain/types.ts:1). Active routes include analytics, automation, accounts, reports, snapshots, and replay at [app.ts (line 297)](/home/trent/workspace/dealer-recon-clean/server/src/app.ts:297), [app.ts (line 301)](/home/trent/workspace/dealer-recon-clean/server/src/app.ts:301), [app.ts (line 489)](/home/trent/workspace/dealer-recon-clean/server/src/app.ts:489), and [app.ts (line 963)](/home/trent/workspace/dealer-recon-clean/server/src/app.ts:963).
Why it matters: v1 is not a generic dashboard; future-scope surfaces expand the security review and some lack v1 store/month constraints.
Recommended fix: Feature-flag or remove non-v1 routes/source types from production v1.
Suggested regression test: In v1 mode, future-scope endpoints return 404/403 and non-BOA/Dealertrack uploads are rejected.

Speculative Risks
CSRF protection relies on SameSite=Lax cookies and CORS; no explicit CSRF token was found. This is acceptable only if deployment stays same-site and tightly origin-scoped.
No malware scanning was found for raw uploaded artifacts. This matters if users download and reopen raw BOA/Dealertrack files from the app.
No upload/login rate limiter was found. The 5 MB upload limit helps parser load, but brute force and repeated malformed upload throttling should be decided before internet exposure.
Parser debug logging can print accepted sample rows when PARSER_DEBUG=true, but it is suppressed in production by [transactionNormalizer.ts (line 746)](/home/trent/workspace/dealer-recon-clean/server/src/services/transactionNormalizer.ts:746).
Production Launch Blockers
Remove production exposure to seeded demo credentials.
Make auth fallback fail closed outside local test/dev.
Fix null-store/all-store authorization behavior.
Generate FP REC from reviewed reconciliation detail only.
Neutralize spreadsheet formula injection in all Excel/CSV exports.
Cap SpreadsheetML cell indexes to prevent parser DoS.
Define artifact retention, immutability, and sensitive-data handling before real Hurst data is stored.
Missing Security Docs
Upload threat model and accepted file-format contract.
Parser invariants, parser limits, and malformed-input behavior.
Store/month access-control matrix.
Removed-row audit data classification and redaction policy.
Artifact retention, encryption, backup, deletion, and immutability policy.
Spreadsheet export injection and filename/header safety checklist.
Production data-handling policy for VINs, stock numbers, control numbers, amounts, dates, and names.
Production deployment checklist separating local Docker/demo defaults from production requirements.
Safe To Defer
Full CSRF token implementation if v1 remains same-site, origin-restricted, and not publicly embedded.
Parser debug logging cleanup, provided PARSER_DEBUG stays disabled outside local development.
Malware scanning for raw artifacts if raw artifact downloads are admin-only and pilot deployment is private.
Broader route removal can be staged, but future-scope routes should be disabled before any production pilot.
Prioritized Remediation Plan
P0: Remove demo credential migration behavior; harden auth fallback; rotate affected users.
P0: Enforce store/month boundaries and deny null-store access for store-scoped roles.
P1: Rebuild FP REC and merged artifacts from persisted reconciliation detail, not a parallel matcher.
P1: Add spreadsheet injection neutralization across FP REC, merged XLS, exceptions CSV, cleaned CSV, and reports CSV.
P1: Add parser abuse caps for SpreadsheetML cell index/column count.
P2: Formalize artifact storage controls: retention, hashes, immutability/versioning, encryption expectations, and download audit.
P2: Tighten accepted file-format behavior and add regression fixtures for malformed CSV/XML/HTML/XLS.
P3: Disable or feature-flag future-scope routes and source types for the Hurst FP REC v1 pilot.
