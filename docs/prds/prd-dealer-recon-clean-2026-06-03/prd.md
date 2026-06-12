---
title: Dealer Recon - Automotive Dealership Reconciliation Platform
status: draft
created: 2026-06-03
updated: 2026-06-03
---

# Product Requirements Document: Dealer Recon

> Historical status: this PRD predates the Hiley pilot reset. It contains broader SaaS, dashboard, analytics, review workflow, and month-end reporting concepts that are not part of the current pilot acceptance scope. The active product scope is the store/month four-step floorplan workflow documented in `README.md`, `docs/implementation/hiley-four-step-workflow-gap-analysis.md`, and `docs/implementation/store-workflow-matrix.md`.

## Executive Summary

**Dealer Recon** is a production SaaS platform that automates floorplan reconciliation and month-end financial reporting for multi-rooftop automotive dealer groups. The system reduces manual reconciliation time from hours to minutes by automatically matching bank statements against dealership inventory records using VIN-anchored matching algorithms.

**Current Status:** Active production deployment with live dealership client, 7+ releases shipped

**Target Market:** Multi-rooftop automotive dealer groups using Dealertrack DMS and Bank of America floorplan financing

**Core Value Proposition:** Transform manual, error-prone reconciliation spreadsheets into automated exception review workflows

---

## Problem Statement

### The Pain

Automotive dealerships manage floorplan financing across dozens or hundreds of vehicles simultaneously. Reconciling internal records (Dealertrack DMS) against bank statements (Bank of America, lender reports) is a manual, error-prone process that routinely consumes **hours per day** of accounting staff time using disconnected spreadsheets.

**Specific Pain Points:**
- Manual line-by-line matching across multiple data sources (DMS, bank, GL, OEM)
- Mistakes go undetected until month-end close
- Exception review with CFO becomes a fire drill
- No audit trail or carry-forward tracking of unresolved items
- Spreadsheet-based workflows don't scale across multiple rooftops

### Validated Customer Insight

**Source:** Direct onsite discovery sessions with dealership accounting staff

**Validated Statement:** "Dealertrack-based dealerships lose time and accuracy on daily bank reconciliation and month-end close because cash activity must be manually matched across DMS, bank, and GL systems."

**CFO Response:** True

**Quantified Impact:** Reconciliation prep time reduced from hours to minutes in production deployment

---

## Target Users

### Primary Buyer
- **CFO** - Budget authority, cares about month-end close accuracy and staff efficiency

### Daily Users

| Role | Responsibilities | Key Needs |
|------|-----------------|-----------|
| **Corporate Controller** | Multi-store oversight, month-end consolidation | Cross-store visibility, exception prioritization |
| **Store Controller** | Single-location reconciliation | Fast exception resolution, audit trail |
| **Accounting Manager** | Day-to-day reconciliation execution | Efficient upload workflow, clear exception categorization |
| **AP/AR Staff** | Transaction-level research | Drill-down to source documents, review notes |
| **OEM Receivables Admin** | OEM statement reconciliation | [ASSUMPTION: OEM reconciliation not yet implemented] |

### User Hierarchy
- **Dealership** (top-level tenant) → **Dealer Group** (organizational grouping) → **Store** (individual location)
- Role-based access control with store-level assignments
- Read-only auditor role for compliance review

---

## Product Vision & Strategy

### Vision
Become the system of record for dealership financial reconciliation across all data sources (bank, DMS, GL, OEM, lender), eliminating manual spreadsheet workflows entirely.

### Current Wedge
**Floorplan reconciliation** (Bank of America + Dealertrack) - the highest-frequency, highest-pain reconciliation workflow

### Strategic Principles

**Do Not Build:**
- Generic AI accounting software
- Chatbot interfaces
- Broad AI dealership assistant
- VinSolutions CRM integration (not central to reconciliation)
- Direct Dealertrack API integration before validating export-based workflow

**Do Build:**
- Dealership-specific reconciliation layer
- Upload-based workflow (faster validation, lower integration friction)
- Exception detection and carry-forward tracking
- CFO-ready reporting in expected formats

### Future Expansion [ASSUMPTION]
1. **Phase 2:** OEM receivables reconciliation
2. **Phase 3:** Lender funding/CIT reconciliation
3. **Phase 4:** Warranty receivables
4. **Phase 5:** API integrations (Dealertrack, bank feeds, OEM portals)

---

## Success Metrics

### Primary Metrics
- **Time Savings:** Reconciliation prep time (baseline: hours → target: minutes)
- **Exception Resolution Rate:** % of exceptions resolved within 48 hours
- **Month-End Close Time:** Days to close (baseline: [ASSUMPTION: 5-7 days] → target: [ASSUMPTION: 2-3 days])
- **Error Detection Rate:** Discrepancies caught before month-end vs. after

### Operational Metrics
- **Upload Success Rate:** % of files parsed without validation errors
- **Match Rate:** % of transactions auto-matched (target: >85%)
- **Exception Carry-Forward Rate:** % of exceptions persisting >30 days
- **User Adoption:** Active users per dealership, daily active usage

### Business Metrics
- **Customer Retention:** Churn rate, NPS
- **Expansion:** Stores per dealership, dealerships per dealer group
- **Revenue:** MRR, ARR, expansion revenue

### Counter-Metrics
- **False Positive Match Rate:** Incorrect auto-matches requiring manual correction
- **Data Loss Incidents:** Zero tolerance (7+ releases with zero data loss achieved)
- **Support Ticket Volume:** Tickets per active user per month

---

## Core Features

### FR-1: Multi-Format File Ingestion

**Capability:** Parse and normalize data from multiple source formats into unified schema

**Supported Formats:**
- FR-1.1: Bank of America HTML/XLS billing statements
- FR-1.2: Dealertrack XML exports
- FR-1.3: Dealertrack XLS exports
- FR-1.4: Generic CSV files (bank transactions, GL activity, cash receipts)

**Workflow:**
1. User uploads file via web interface
2. System detects format automatically (`fileFormatDetector`)
3. Parser routes to appropriate handler (`sourceParserRouter`)
4. Transactions normalized into `transactions` table
5. Source file metadata stored in `source_files` table with SHA-256 hash for deduplication

**Validation:**
- File hash prevents duplicate uploads
- Row count validation
- Required field presence checks
- Amount non-zero constraint
- Date format validation

**Acceptance Criteria:**
- AC-1.1: BOA HTML/XLS files parse with >95% success rate
- AC-1.2: Dealertrack XML files parse with >95% success rate
- AC-1.3: Duplicate file uploads rejected with clear error message
- AC-1.4: Validation errors surfaced with row-level detail

---

### FR-2: VIN-Anchored Reconciliation Engine

**Capability:** Match bank transactions to dealership inventory records using multi-tier matching algorithm

**Matching Tiers:**
1. **Tier 1:** Exact VIN6 + exact amount match (highest confidence)
2. **Tier 2:** Fuzzy VIN6 + exact amount match (handles OCR errors)
3. **Tier 3:** Stock number + exact amount match (fallback when VIN unavailable)
4. **Tier 4:** Amount-only match with confidence scoring (lowest confidence)

**VIN6 Extraction:**
- Extract first 6 characters of VIN (manufacturer + model identifier)
- Normalize case and whitespace
- Handle partial VINs and stock numbers

**Match Group Structure:**
- Each match creates a `reconciliation_match_group`
- Links BOA transaction(s) to Dealertrack transaction(s)
- Stores match type, confidence score, and reason
- Supports one-to-one, one-to-many, and many-to-one matches

**Acceptance Criteria:**
- AC-2.1: Tier 1 matches achieve >90% of total matches
- AC-2.2: Confidence scores accurately predict manual review outcomes
- AC-2.3: Match groups preserve full audit trail (which transactions, which algorithm, when)
- AC-2.4: Reconciliation completes in <30 seconds for 500 transactions

---

### FR-3: Exception Detection & Categorization

**Capability:** Automatically categorize unmatched transactions and flag discrepancies

**Exception Types:**
- **Missing in BOA:** Transaction in Dealertrack but not in bank statement
- **Missing in Dealertrack:** Transaction in bank statement but not in DMS
- **Amount Mismatch:** VIN6 match but different amounts
- **Sign Mismatch:** VIN6 match but opposite signs (debit vs. credit)
- **Duplicate/One-to-Many:** Single transaction matching multiple records
- **Date Mismatch:** VIN6 + amount match but dates differ beyond tolerance

**Categorization Logic:**
- Automated via `exceptionCategorizer` service
- Rule-based classification
- Severity scoring (critical, high, medium, low)
- Suggested actions for each exception type

**Acceptance Criteria:**
- AC-3.1: Exception types cover >95% of real-world scenarios
- AC-3.2: Categorization accuracy >90% (validated against manual review)
- AC-3.3: Suggested actions provided for all exception types
- AC-3.4: Exception reasons are human-readable and actionable

---

### FR-4: Exception Carry-Forward & Review Workflow

**Capability:** Track unresolved exceptions across reconciliation runs with clerk review workflow

**Carry-Forward Logic:**
- Unresolved exceptions persist across runs
- Track first seen date and occurrence count
- Link to original reconciliation run
- Preserve full history even when resolved

**Review Workflow States:**
- **Unreviewed:** New exception, not yet assigned
- **Investigating:** Assigned to reviewer, research in progress
- **Resolved:** Root cause identified, corrective action taken
- **Ignored:** Determined to be non-issue (e.g., timing difference)

**Review Features:**
- Assign exceptions to specific users
- Add review notes (separate from legacy notes field)
- Timestamp all status changes
- Audit trail of all reviewer actions

**Acceptance Criteria:**
- AC-4.1: Exceptions carry forward automatically when unresolved
- AC-4.2: First seen date and count accurately tracked
- AC-4.3: Review status changes logged to `audit_events`
- AC-4.4: Reviewers can filter exceptions by status, assignee, age, amount

---

### FR-5: Reconciliation Replay Capability

**Capability:** Re-run historical reconciliations with current engine to detect improvements or regressions

**Immutable Snapshots:**
- Full transaction state captured at reconciliation time
- Stored in `reconciliation_run_inputs` and `reconciliation_run_input_transactions`
- Includes parser version, engine version, and metadata
- Enforced immutability via database triggers

**Replay Workflow:**
1. Select historical reconciliation run
2. Load original input transactions from snapshot
3. Re-run with current reconciliation engine
4. Compare results (match count, exception count, match types)
5. Surface differences for analysis

**Use Cases:**
- Validate engine improvements (did new algorithm catch more matches?)
- Detect regressions (did code change break existing matches?)
- Audit compliance (prove reconciliation results are reproducible)

**Acceptance Criteria:**
- AC-5.1: Replay produces identical results when engine unchanged
- AC-5.2: Replay surfaces differences when engine improved
- AC-5.3: Snapshot immutability enforced (cannot modify historical data)
- AC-5.4: Replay completes in <60 seconds for 500 transactions

---

### FR-6: VIN Enrichment Workflow

**Capability:** Manually enhance transaction data when VIN is missing or incomplete

**Enrichment Sources:**
- Manual entry by accounting staff
- DMS-assisted reconstruction (lookup by stock number)
- Stock number cross-reference
- Historical transaction patterns

**Lineage Tracking:**
- Full audit trail in `raw_data` JSONB column
- Track: enriched_at, enriched_by, source, note, previous_vin, new_vin
- Provenance flag: `original`, `manual_enrichment`, `dms_assisted_reconstruction`, `stock_number_lookup`

**Workflow:**
1. User identifies transaction with missing/incomplete VIN
2. System suggests potential matches from DMS data
3. User selects correct VIN or enters manually
4. System updates transaction and logs enrichment history
5. Re-run reconciliation to incorporate enriched data

**Acceptance Criteria:**
- AC-6.1: Enrichment history preserved in immutable audit trail
- AC-6.2: Enriched transactions clearly marked in UI
- AC-6.3: Enrichment suggestions achieve >70% accuracy
- AC-6.4: Enrichment workflow completes in <30 seconds per transaction

---

### FR-7: Automated Reconciliation Scheduling

**Capability:** Schedule reconciliations to run automatically on cadence or trigger

**Scheduling Options:**
- **Daily:** Run every day at specified time
- **Weekly:** Run every week on specified day
- **Monthly:** Run every month on specified day
- **On File Pair Upload:** Auto-run when both BOA and Dealertrack files uploaded

**Configuration:**
- Per-store or dealership-wide
- Enable/disable toggle
- Expected source types (BOA + Dealertrack)
- Next run time calculated automatically

**Monitoring:**
- Operational events logged for each auto-run
- Stale store detection (no uploads in >30 days)
- Failed run notifications

**Acceptance Criteria:**
- AC-7.1: Scheduled jobs execute within 5 minutes of target time
- AC-7.2: Auto-run triggers within 1 minute of file pair upload
- AC-7.3: Failed runs generate operational events with error details
- AC-7.4: Users can view next scheduled run time in UI

---

### FR-8: Multi-Tenancy & Access Control

**Capability:** Isolate data by dealership with role-based access control

**Tenant Hierarchy:**
- **Dealership** (top-level tenant, data isolation boundary)
- **Dealer Group** (organizational grouping within dealership)
- **Store** (individual location, reconciliation scope)

**Roles:**
- **Platform Admin:** Full system access, cross-dealership
- **Dealer Group Admin:** Full access within dealer group
- **Store Manager:** Full access to assigned stores
- **Accounting User:** Read/write access to assigned stores
- **Read-Only Auditor:** Read-only access for compliance review

**Access Control:**
- Store-level assignments via `user_store_assignments`
- Row-level security enforced in queries
- All data scoped to `dealership_id`

**Acceptance Criteria:**
- AC-8.1: Users cannot access data outside assigned dealership
- AC-8.2: Store-level users cannot access other stores' data
- AC-8.3: Read-only auditors cannot modify any data
- AC-8.4: Role changes logged to `audit_events`

---

### FR-9: CFO-Ready Reporting & Exports

**Capability:** Generate month-end reports and exports in formats dealership leadership expects

**Export Formats:**
- **Hurst FP Rec XLS:** Industry-standard floorplan reconciliation format
- **Exception CSV:** Filterable exception report for review
- **Month-End Report CSV:** Account-level reconciliation summary

**Report Contents:**
- Matched transaction summary
- Exception queue by category
- Account-level balances
- Variance analysis
- Carry-forward exceptions

**Acceptance Criteria:**
- AC-9.1: Hurst FP Rec export matches expected format (validated by CFO)
- AC-9.2: Exports complete in <10 seconds for 1000 transactions
- AC-9.3: All exports include timestamp and run metadata
- AC-9.4: Exception CSV includes all filterable fields

---

### FR-10: Real-Time Dashboard

**Capability:** Live reconciliation status and exception queue accessible from any browser

**Dashboard Views:**
- **Reconciliation Summary:** Match count, exception count, duplicate count
- **Exception Queue:** Filterable list of unresolved exceptions
- **Account Summary:** Account-level reconciliation status
- **Run History:** Historical reconciliation runs with diff tracking

**Filtering & Search:**
- Filter by: status, source type, amount range, date range, assignee
- Search by: VIN, stock number, reference number, description
- Sort by: date, amount, status, age

**Real-Time Updates:**
- Dashboard refreshes on reconciliation completion
- Exception status changes reflected immediately
- No page reload required

**Acceptance Criteria:**
- AC-10.1: Dashboard loads in <2 seconds
- AC-10.2: Filters apply in <500ms
- AC-10.3: Search returns results in <1 second
- AC-10.4: Dashboard accessible on desktop and tablet

---

## Non-Functional Requirements

### NFR-1: Performance
- **Upload Processing:** Parse and normalize 500 transactions in <30 seconds
- **Reconciliation Execution:** Complete reconciliation of 500 transactions in <30 seconds
- **Dashboard Load Time:** <2 seconds for initial load
- **Export Generation:** <10 seconds for 1000 transactions
- **API Response Time:** <500ms for 95th percentile

### NFR-2: Reliability
- **Uptime:** 99.5% availability (excluding planned maintenance)
- **Data Durability:** Zero data loss (7+ releases achieved)
- **Transaction Integrity:** ACID compliance via PostgreSQL
- **Backup:** Daily automated backups with 30-day retention

### NFR-3: Security
- **Authentication:** Bcrypt password hashing, session-based auth
- **Authorization:** Role-based access control, row-level security
- **Data Isolation:** Tenant-level data isolation enforced at query level
- **Audit Trail:** All user actions logged to immutable `audit_events` table
- **File Storage:** Secure local storage (S3-compatible planned for future)

### NFR-4: Scalability
- **Concurrent Users:** Support 50 concurrent users per dealership
- **Transaction Volume:** Handle 10,000 transactions per reconciliation run
- **Multi-Tenancy:** Support 100+ dealerships on single instance
- **Database Growth:** Plan for 10M+ transactions over 2 years

### NFR-5: Maintainability
- **Code Quality:** TypeScript throughout, strict mode enabled
- **Testing:** Unit tests for all services, parsers, domain logic (Vitest)
- **Migrations:** Versioned schema migrations via node-pg-migrate
- **Documentation:** Inline code comments, API documentation, architecture docs

### NFR-6: Usability
- **Learning Curve:** New users productive within 30 minutes
- **Error Messages:** Human-readable, actionable error messages
- **Responsive Design:** Functional on desktop and tablet (mobile not required)
- **Accessibility:** [ASSUMPTION: WCAG 2.1 AA compliance target]

### NFR-7: Compliance
- **Audit Trail:** Immutable audit log of all user actions
- **Data Retention:** [ASSUMPTION: 7-year retention for financial records]
- **Reproducibility:** Reconciliation results reproducible via replay capability
- **Change Tracking:** All schema changes versioned and reversible

---

## Technical Architecture

### Technology Stack

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| **Frontend** | React | 18.3.1 | UI component library |
| **Build Tool** | Vite | 5.4.2 | Fast dev server and bundler |
| **Styling** | Tailwind CSS | 3.4.10 | Utility-first CSS |
| **Backend** | Express | 4.18.3 | Web application framework |
| **Runtime** | Node.js | 18+ | JavaScript runtime |
| **Language** | TypeScript | 5.4.3 (backend), 5.5.3 (frontend) | Type-safe JavaScript |
| **Database** | PostgreSQL | 16 | Relational database |
| **Migrations** | node-pg-migrate | 8.0.4 | Schema versioning |
| **Testing** | Vitest | 1.4.0 | Unit testing framework |
| **Infrastructure** | Docker Compose | - | Local development |

### Architecture Pattern

**Backend:** Layered architecture
- **Routes** (`app.ts`) → **Services** → **Repositories** → **Database**
- **Domain** layer for business logic (`domain/`)
- **Presenters** for output formatting (`presenters/`)

**Frontend:** Component-based
- **Pages** → **Components** → **API Client** → **Backend**
- Type-safe with TypeScript throughout

### Data Model Summary

**18 Tables:**
- **Tenancy:** `dealerships`, `dealer_groups`, `dealership_stores`
- **Users:** `users`, `user_store_assignments`
- **Source Data:** `source_files`, `transactions`
- **Reconciliation:** `reconciliation_runs`, `reconciliation_match_groups`, `reconciliation_match_group_transactions`, `reconciliation_exceptions`
- **Snapshots (Immutable):** `reconciliation_run_inputs`, `reconciliation_run_input_transactions`
- **Automation:** `scheduled_reconciliation_jobs`
- **Events:** `ingestion_events`, `operational_events`, `audit_events` (immutable)

**Key Design Decisions:**
- Multi-tenant with dealership-level isolation
- Immutable audit trail and reconciliation snapshots
- JSONB for raw data and lineage tracking
- Foreign key cascades for data integrity

### Deployment Architecture

**Current:** Docker Compose (local development)

**Production:** [ASSUMPTION: Render/Fly.io/Railway]

**Environment Variables:**
- `DATABASE_URL`: PostgreSQL connection string
- `PORT`: Backend server port (default: 8000)
- `NODE_ENV`: Environment mode (development/production)
- `BACKEND_CORS_ORIGINS`: Allowed frontend origins
- `SESSION_SECRET`: Session encryption key
- `DEFAULT_DEALERSHIP_ID`: Default tenant for demo

---

## User Journeys

### UJ-1: Daily Reconciliation - Sarah, Store Controller

**Context:** Sarah manages accounting for Hiley Mazda of Hurst. Every morning, she downloads the previous day's bank statement from BOA and the cash receipts report from Dealertrack. Before Dealer Recon, this took 2-3 hours of manual spreadsheet work.

**Journey:**

1. **Upload Files** (2 minutes)
   - Sarah logs into Dealer Recon at 8:00 AM
   - Navigates to "Upload" page
   - Drags BOA statement (HTML/XLS) into upload zone
   - Drags Dealertrack cash receipts (XML) into upload zone
   - System validates both files, shows "Ready to reconcile"

2. **Run Reconciliation** (30 seconds)
   - Sarah clicks "Run Reconciliation"
   - Progress bar shows parsing → matching → categorizing
   - Dashboard updates with results: 47 matched, 3 exceptions

3. **Review Exceptions** (10 minutes)
   - Sarah clicks "View Exceptions" (3 items)
   - **Exception 1:** "Missing in BOA" - $15,234.50 for VIN 1HGBH41
     - Sarah recognizes this as a weekend sale that won't post until Monday
     - Marks as "Investigating", adds note: "Weekend sale, expect Monday post"
   - **Exception 2:** "Amount Mismatch" - BOA shows $18,500, DT shows $18,750
     - Sarah drills into transaction details, sees $250 doc fee discrepancy
     - Marks as "Resolved", adds note: "Doc fee not included in DT export, expected"
   - **Exception 3:** "Missing in Dealertrack" - $2,100 bank charge
     - Sarah doesn't recognize this, assigns to AP clerk for research
     - Marks as "Investigating", assigns to "John"

4. **Export for CFO** (1 minute)
   - Sarah clicks "Export Hurst FP Rec"
   - Downloads XLS file
   - Emails to CFO with summary: "47 matched, 2 investigating, 1 resolved"

**Outcome:** Sarah completes daily reconciliation in 15 minutes instead of 2-3 hours. CFO has report before 9:00 AM instead of end of day.

---

### UJ-2: Month-End Close - David, Corporate Controller

**Context:** David oversees 5 stores in the Hiley dealer group. Month-end close used to take 5-7 days of back-and-forth with store controllers to resolve exceptions and compile reports.

**Journey:**

1. **Review Cross-Store Status** (5 minutes)
   - David logs in on the 1st of the month
   - Dashboard shows reconciliation status for all 5 stores
   - 4 stores show "All exceptions resolved", 1 store shows "3 unresolved"
   - David filters to "Unresolved exceptions older than 7 days"

2. **Prioritize Exceptions** (10 minutes)
   - David sees 3 carry-forward exceptions from Hiley Buick:
     - $45,000 missing in BOA (first seen 15 days ago)
     - $12,500 amount mismatch (first seen 22 days ago)
     - $3,200 duplicate transaction (first seen 8 days ago)
   - David calls Hiley Buick controller to discuss
   - Controller explains $45K is a pending wire transfer, provides documentation
   - David marks as "Resolved", adds note with wire confirmation number

3. **Generate Month-End Report** (2 minutes)
   - David clicks "Month-End Report" for all stores
   - Selects date range: previous month
   - System generates consolidated report:
     - Total matched: 1,247 transactions
     - Total exceptions: 18 (15 resolved, 3 investigating)
     - Net variance: $2,100 (within tolerance)
   - David exports to CSV, imports into consolidation spreadsheet

4. **Audit Trail Review** (5 minutes)
   - CFO asks about specific exception from 2 weeks ago
   - David searches by VIN, finds exception in history
   - Reviews full audit trail: who reviewed, when, what notes, resolution
   - Provides CFO with screenshot and explanation

**Outcome:** David closes the month in 2 days instead of 5-7 days. All exceptions have documented resolution paths. CFO has confidence in the numbers.

---

### UJ-3: Exception Research - John, AP Clerk

**Context:** John is assigned an exception by Sarah (store controller) - a $2,100 bank charge that doesn't match any Dealertrack transaction. He needs to research the root cause.

**Journey:**

1. **Review Assignment** (1 minute)
   - John receives email notification: "Exception assigned to you"
   - Logs into Dealer Recon, navigates to "My Exceptions"
   - Sees exception: "Missing in Dealertrack - $2,100 bank charge"
   - Clicks to view details

2. **Drill Into Transaction** (3 minutes)
   - John sees full transaction details:
     - Date: 2026-05-28
     - Amount: $2,100.00
     - Description: "FLOORPLAN INTEREST CHARGE"
     - Reference: "BOA-FP-052826"
   - John clicks "View Source File" to see original BOA statement
   - Confirms this is a monthly interest charge, not a vehicle transaction

3. **Research & Document** (5 minutes)
   - John checks BOA portal, confirms interest charge is correct
   - John realizes this should be in GL, not Dealertrack
   - John adds review note: "Monthly floorplan interest charge. Should be recorded in GL, not DT. Not an exception, expected behavior."
   - John marks as "Resolved"

4. **Update Sarah** (1 minute)
   - Sarah receives notification: "Exception resolved by John"
   - Sarah reviews John's note, agrees with resolution
   - Sarah updates exception status to "Ignored" (not an error, just different account)

**Outcome:** John resolves exception in 10 minutes with full documentation. Sarah has confidence in the resolution. Audit trail preserved for future reference.

---

## Open Questions

1. **OEM Reconciliation Scope:** What is the priority and timeline for OEM receivables reconciliation? (mentioned in PROJECT_BRIEF but not implemented)

2. **API Integration Timeline:** When should we prioritize direct Dealertrack API integration vs. continuing with export-based workflow?

3. **Multi-Rooftop Expansion:** What is the target number of stores per dealership? Does this affect architecture decisions?

4. **Compliance Requirements:** Are there specific regulatory requirements (SOX, audit standards) we need to design for?

5. **Data Retention Policy:** What is the required retention period for financial records and audit trails?

6. **Accessibility Standards:** Should we target WCAG 2.1 AA compliance? What is the priority?

7. **Mobile Support:** Is mobile access required for any user roles? (Currently desktop/tablet only)

8. **Automated Bank Statement Ingestion:** What is the priority for email-based or SFTP-based automated file ingestion?

9. **Lender Integration:** Which lenders beyond BOA should we support? (Dealertrack, CIT, others?)

10. **Pricing Model:** How does pricing scale with number of stores, transaction volume, or users?

---

## Dependencies & Constraints

### External Dependencies
- **Bank of America:** Export format stability (HTML/XLS billing statements)
- **Dealertrack:** Export format stability (XML/XLS exports)
- **PostgreSQL:** Database availability and performance
- **Node.js:** Runtime compatibility (18+)

### Technical Constraints
- **Browser Support:** Modern browsers only (Chrome, Firefox, Safari, Edge - last 2 versions)
- **File Size Limits:** [ASSUMPTION: 10MB per upload]
- **Transaction Volume:** Tested up to 1000 transactions per run
- **Concurrent Users:** Tested up to 50 concurrent users

### Business Constraints
- **Single Dealership Focus:** Current deployment is single-tenant (one dealership)
- **BOA + Dealertrack Only:** No other bank or DMS integrations yet
- **Export-Based Workflow:** No direct API integrations yet
- **Manual Upload:** No automated file ingestion yet

### Known Limitations
- **No OEM Reconciliation:** Mentioned in brief but not implemented
- **No Lender Reconciliation:** CIT, other lenders not supported
- **No GL Integration:** GL data must be exported and uploaded manually
- **No Mobile App:** Web-only, responsive design for tablet but not optimized for phone

---

## Roadmap & Future Considerations

### Near-Term (Next 3-6 Months) [ASSUMPTION]
- **Multi-Rooftop Support:** Expand to support multiple stores per dealership
- **Role-Based Access Control Enhancements:** Granular permissions, store-level assignments
- **Automated Bank Statement Email Ingestion:** Parse statements from email attachments
- **Enhanced Exception Categorization:** Machine learning for exception classification
- **Performance Optimization:** Handle 5000+ transactions per run

### Mid-Term (6-12 Months) [ASSUMPTION]
- **OEM Receivables Reconciliation:** Add OEM statement parsing and matching
- **Lender Integration:** Support CIT and other floorplan lenders
- **GL Integration:** Direct integration with QuickBooks, Xero, or other GL systems
- **Advanced Analytics:** Trend analysis, variance reporting, predictive insights
- **Mobile App:** Native iOS/Android app for exception review on the go

### Long-Term (12+ Months) [ASSUMPTION]
- **Direct Dealertrack API Integration:** Real-time data sync, no manual exports
- **Bank Feed Integration:** Direct connection to BOA and other banks
- **OEM Portal Extraction:** Automated scraping of OEM portals
- **Multi-DMS Support:** Support for CDK, Reynolds & Reynolds, other DMS platforms
- **White-Label Solution:** Rebrandable platform for dealer group IT departments

---

## Appendix

### Glossary

- **BOA:** Bank of America
- **DMS:** Dealer Management System (e.g., Dealertrack, CDK, Reynolds & Reynolds)
- **Floorplan:** Financing arrangement where bank loans money to dealership to purchase inventory
- **VIN:** Vehicle Identification Number (17-character unique identifier)
- **VIN6:** First 6 characters of VIN (manufacturer + model identifier)
- **GL:** General Ledger
- **OEM:** Original Equipment Manufacturer (e.g., Ford, Toyota, Honda)
- **CFO:** Chief Financial Officer
- **AP/AR:** Accounts Payable / Accounts Receivable
- **Hurst FP Rec:** Industry-standard floorplan reconciliation report format

### References

- **PROJECT_BRIEF.md:** Original product thesis and MVP scope
- **README.md:** Project overview and setup instructions
- **analysis/index.md:** Comprehensive project documentation index
- **analysis/technology-stack.md:** Full tech stack analysis
- **analysis/data-models-backend.md:** Complete database schema documentation

### Change Log

- **2026-06-03:** Initial PRD draft created from existing documentation
