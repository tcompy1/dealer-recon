# Dealer Group Accounting Automation Project

## Current Product Thesis

Build a reconciliation and close automation platform for auto dealer groups using Dealertrack and related systems.

The first wedge is accounting/data processing, not service/BDC.

Validated CFO pain areas:
1. Month-end reconciliations/reporting
2. OEM receivables and statement reconciliation
3. Manual data entry between DMS, lender, bank, and OEM systems

Validated statement:
Dealertrack-based dealerships lose time and accuracy on daily bank reconciliation and month-end close because cash activity must be manually matched across DMS, bank, and GL systems.

Answer from CFO: true.

## Target Customer

Multi-rooftop auto dealer groups.

Initial buyer:
- CFO

Workflow users:
- Corporate controller
- Store controller
- Accounting manager
- AP/AR staff
- OEM receivables/warranty admin

## Product Direction

Do not build generic AI accounting software.

Build a dealership-specific reconciliation layer that ingests data from:
- Dealertrack/DMS exports
- Bank exports
- OEM statements
- Lender/funding reports
- GL/accounting reports
- Spreadsheets

Core function:
Turn manual reconciliation into exception review.

## MVP Scope

### MVP 1: Daily Bank/Cash Reconciliation

Inputs:
- Bank transaction CSV
- Dealertrack/DMS cash receipt export CSV
- GL/accounting export CSV

Outputs:
- Auto-matched transactions
- Unmatched bank transactions
- Unmatched DMS/GL transactions
- Amount/date/reference discrepancies
- Exception report
- Reconciliation summary

### MVP 2: Month-End Close Support

Inputs:
- Month-end GL balances
- supporting schedules
- reconciliation exports

Outputs:
- close checklist
- unresolved exception queue
- account-level reconciliation status
- exportable month-end report

### MVP 3: OEM Receivables Reconciliation

Inputs:
- OEM statement export
- expected receivables/internal schedule
- payment deposits

Outputs:
- matched payments
- missing payments
- underpayments
- duplicate payments
- timing differences

## Initial Technical Strategy

Start with CSV/manual upload.

Do not integrate directly with Dealertrack on day one.

Reason:
- Faster validation
- Lower integration friction
- Real accounting teams already export reports
- Easier to demo

Later:
- API integrations
- secure SFTP ingestion
- scheduled imports
- bank feed integrations
- OEM portal extraction

## Suggested Stack

The initial brief suggested a Python/FastAPI/SQLAlchemy backend. The prototype
was built and is maintained on a TypeScript/Express/`node-pg-migrate` backend
instead; see the root README for the implemented stack. The original
suggestion is kept here for historical context only.

Backend (implemented):
- TypeScript
- Node.js / Express
- PostgreSQL
- `node-pg-migrate`

Frontend:
- React
- Tailwind
- simple dashboard

Auth:
- Clerk or Supabase Auth

Storage:
- S3-compatible file storage later
- local storage for prototype

Deployment:
- Docker
- Render/Fly.io/Railway initially

## Core Data Models

### SourceFile
- id
- filename
- source_type: bank, dms, gl, oem, lender
- uploaded_at
- parsed_status

### Transaction
- id
- source_file_id
- source_type
- transaction_date
- post_date
- amount
- reference_number
- description
- account
- store_id
- raw_data

### MatchGroup
- id
- match_status: matched, partial, exception
- confidence_score
- created_at

### MatchItem
- id
- match_group_id
- transaction_id

### Exception
- id
- exception_type
- severity
- description
- suggested_action
- status
- assigned_to
- created_at
- resolved_at

## Matching Logic V1

Match transactions using:
1. exact amount + exact date
2. exact amount + date within tolerance
3. reference/check/deposit number match
4. description similarity
5. grouped deposit matching
6. confidence scoring

Exception types:
- missing_in_bank
- missing_in_dms
- missing_in_gl
- amount_mismatch
- date_mismatch
- duplicate_transaction
- possible_grouped_deposit
- unresolved

## First Engineering Tasks for Codex

1. Create repo scaffold:
   - TypeScript/Express backend (originally proposed as FastAPI; see Suggested Stack)
   - React frontend
   - Docker compose
   - PostgreSQL service

2. Build CSV upload endpoint:
   - upload source file
   - classify source type
   - parse into normalized transactions table

3. Build reconciliation engine:
   - compare bank transactions against DMS/GL transactions
   - return matched/unmatched/exception groups

4. Build exception dashboard:
   - upload files
   - view reconciliation summary
   - view exception queue
   - filter by source, amount, date, status

5. Add sample data:
   - bank_transactions_sample.csv
   - dealertrack_cash_receipts_sample.csv
   - gl_activity_sample.csv
   - oem_statement_sample.csv

6. Add README:
   - product purpose
   - setup instructions
   - sample workflow

## Product Principle

The user should not manually reconcile every line.

The user should only review exceptions.

## Current Discovery Status

Known:
- CFO validated pain in month-end close, OEM receivables, and manual data entry.
- Dealer group uses Dealertrack and VinSolutions.
- VinSolutions is not central to phase 1.
- Dealertrack/DMS, bank, OEM, lender, and GL data fragmentation is central.

Unknown:
- Which exact account reconciliation consumes the most time
- Whether daily cash, OEM receivables, or month-end close is the best first wedge
- What file formats they can export from Dealertrack
- Whether their accounting GL is fully inside Dealertrack or another system
- Volume of transactions per store/month
- Current spreadsheet process
- Current close timeline
- Current exception categories

## Next Discovery Questions

Ask the CFO/controller:

1. Which reconciliation consumes the most manual effort today?
   - daily cash/bank
   - OEM receivables
   - lender funding/CIT
   - warranty receivables
   - another area

2. What reports are exported today from Dealertrack, bank portals, OEM portals, and GL?

3. Can we review anonymized sample exports?

4. What does the current reconciliation spreadsheet look like?

5. How many stores are involved?

6. How many hours per month are spent on this?

7. What causes the most exceptions?

8. What does “done” mean during month-end close?

## Do Not Build Yet

Do not build:
- chatbot
- generic AP automation
- broad AI dealership assistant
- VinSolutions CRM integration
- direct Dealertrack integration before validating export-based workflow

Build first:
- upload-based reconciliation prototype
- exception detection
- month-end reporting dashboard
