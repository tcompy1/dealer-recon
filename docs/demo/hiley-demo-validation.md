# Hiley Demo Validation Guide

**Purpose:** Step-by-step validation walkthrough for the Hiley demo. Follow this in sequence during the meeting to confirm the system is behaving correctly and to surface any gaps in real-world workflow coverage.

**Product:** Dealer Recon — Monthly Floorplan Reconciliation Workpaper Generator  
**Audience:** Hiley accounting staff (office manager / flooring clerk)

---

## 1. Upload Validation

### What to do
1. Navigate to the store's upload screen
2. Upload the BOA file (HTML `.xls` export)
3. Upload the Dealertrack file (XML `.xls` export)

### What should happen immediately after each upload

| Signal | Expected behavior |
|---|---|
| Upload banner / toast | Success confirmation with filename displayed |
| Detected format | Should read `html_table_xls` (BOA) and `xml_spreadsheet` (Dealertrack) |
| Transaction count | Should appear and be plausible (e.g. "238 transactions ingested") |
| Validation errors | None expected for a valid export; if shown, note the message verbatim |
| Removed Rows Audit panel | Should appear below the upload area, listing each removed row with its reason and source row number |

### Questions to ask
- Is this the same file you would normally export from BOA?
- Is this the same file you would normally export from Dealertrack?
- Do the transaction counts look right to you for this month?

---

## 2. Removed Rows Validation

### What rows should appear

The Removed Rows Audit panel shows every row the system excluded before reconciliation. These are presented as a table with columns: Source, Row #, Reason, and key values (Stock #, note).

### Expected removal reasons

**BOA side:**
| Reason label | What it means |
|---|---|
| Header row detected | The column header row — always present, always removed |
| Zero balance — excluded from reconciliation | A line item with a $0.00 ending balance — no open floor position |
| Straightline row — excluded from reconciliation | A depreciation/straight-line amortization entry — not a floor payable |
| Banner/header/subtotal row | A subtotal or section separator row — not a transaction |
| No valid amount found | A row with text but no parseable dollar amount |
| Unrecognized row structure | A row that doesn't match any expected BOA structure |

**Dealertrack side:**
| Reason label | What it means |
|---|---|
| Header row detected | The column header row — always present |
| Zero-amount Dealertrack row excluded | A GL line for a stock number with no balance in the 2100 account this period |
| Unrecognized row structure | A row that doesn't match the expected Dealertrack layout |

### What to verify
- [ ] At least one "Header row detected" entry appears for each source
- [ ] Zero-balance rows are listed (not silently dropped)
- [ ] Row numbers in the panel correspond to the actual source file (row 1 = first row of the file)
- [ ] No legitimate floor vehicles appear in the removed rows list

### Questions to ask
- Do you recognize these removed rows?
- Are there any vehicles here that you would expect to see in the reconciliation?
- Is there anything in this list that surprises you?
- In your current process, do you manually remove these rows before reconciling, or does the export already exclude them?

---

## 3. Reconciliation Validation

### What constitutes a successful run

1. Reconciliation completes without error
2. Match count is shown and appears plausible (>90% of vehicles should match on a clean month)
3. The Reconciliation Summary table shows:
   - **Outstanding per stmt** — total BOA floorplan balance
   - **2100** — total GL account 2100 balance (shown negative)
   - **Difference** — the gap between the two sides; ideally `$0.00`
4. The workpaper sections are populated:
   - "On schedule-not on statement" — vehicles the GL has that BOA does not (positive to dealer)
   - "On statement-not on GL" — vehicles BOA has that the GL does not (BOA balance not posted yet)
   - "Needs Review" — items where VIN, amount, or stock number conflict

### Signals that indicate a problem

| Signal | Likely cause |
|---|---|
| Difference ≠ $0.00 | There are unresolved exceptions changing the totals |
| Match count much lower than expected | File format detection failed, or VINs are missing from one side |
| Empty sections where exceptions are expected | BOA and Dealertrack files may be from different months |
| Needs Review count > 0 | Amount discrepancies exist that the engine cannot auto-resolve |

### Questions to ask
- Does this match count look right to you?
- What would you normally do with a non-zero Difference?
- Do you recognize the vehicles in the "On schedule-not on statement" section?
- In your current manual process, how long does it typically take to arrive at the same result?

---

## 4. Exception Validation

### What exception types should appear

Exceptions fall into three workpaper sections:

**On schedule-not on statement** (category: `missing_in_boa`)
- Dealertrack/GL has a vehicle; BOA statement does not reflect it
- Common cause: vehicle purchased late in the month, BOA hasn't posted the floor yet
- The clerk typically notes: "floored [date], not yet on statement"

**On statement-not on GL** (category: `missing_in_dealertrack`)
- BOA statement has a vehicle; Dealertrack/GL does not
- Common cause: vehicle sold/paid off, GL already cleared it, BOA still shows balance
- The clerk typically notes: "paid off [date]" or "sold"

**Needs Review** (multiple categories)
- `vin6_match_amount_mismatch` — VIN6 agrees but dollar amounts differ; a partial curtailment may have been posted to one side only
- `amount_only_review` — same dollar amount on both sides but no VIN agreement; clerk must identify the vehicle manually
- `duplicate_or_one_to_many` — same vehicle appears multiple times on one side
- `amount_mismatch` — VIN agrees, amounts differ, and no timing signal explains it
- `possible_timing_issue` — amounts differ, but transaction dates are within 45 days (possible cut-off item)

### What to verify
- [ ] Exception categories match what the clerk would expect from the period
- [ ] Each exception row shows: Descriptor, Stock #, VIN6, VIN, Amount, GL Floored date, BOA Floored date
- [ ] BOA Notes and GL Notes fields are editable inline (BOA-side exceptions write BOA Notes; GL-side exceptions write GL Notes)
- [ ] Review Status is editable per row
- [ ] The total exception count in the UI matches the section row counts in the workbook export

### Questions to ask
- What would you do next with this exception?
- Is the information shown on each row enough for you to make a decision?
- Is this how you would expect to see this information laid out?
- For a "Needs Review" item — what additional information would help you resolve it?
- How do you currently record your notes for exceptions like this?

---

## 5. Workbook Validation

### What the generated workbook should contain

Open the downloaded `.xls` file in Excel and verify each section:

| Section | Present? | Notes |
|---|---|---|
| Reconciliation Summary table | Yes | Period, BOA file, Dealertrack file, Outstanding per stmt, 2100, Total GL, Difference (yellow) |
| On schedule-not on statement | Yes | All `missing_in_boa` exceptions; amounts shown negative |
| On statement-not on GL | Yes | All `missing_in_dealertrack` exceptions; amounts shown positive |
| Net Adjustments / Final Variance row | Yes | Between the two exception sections |
| Needs Review | Yes | All categorized exception types requiring clerk judgment |
| Prepared by / Reviewed by sign-off | Yes | Blank signature lines at the bottom |

### Column-level verification (all three exception sections)

| Column | What to verify |
|---|---|
| Descriptor | Vehicle description from the source file |
| Stock # | `M`-prefixed number from Dealertrack, or blank if BOA-only |
| VIN6 | First 6 characters of the 17-digit VIN (or derived from description) |
| VIN | Full 17-digit VIN if present |
| Amount | Dollar amount in accounting format; negatives shown in parentheses |
| GL Floored | Date the vehicle was floored per Dealertrack |
| BOA Floored | Date the vehicle appears on the BOA statement |
| GL Notes | Notes entered by the clerk for this GL-side row |
| BOA Notes | Notes entered by the clerk for this BOA-side row |
| Review Status | Clerk-entered status (e.g. "confirmed", "paid off", "pending") |

### Questions to ask
- Is this the format you would expect to see for your monthly reconciliation workpaper?
- Is this something you could hand to your auditor?
- What still requires manual work after you receive this workbook?
- What part of your monthly process happens after this?
- What would you change about this output?

---

## Closing Questions

These are open-ended and intended to surface workflow gaps that the demo cannot predict:

- Walk me through what you do the first time you see an exception you don't recognize.
- How do you communicate open items to the flooring rep or manufacturer?
- Who reviews the completed workpaper — is it just you, or does it go to a controller?
- How long does the current manual process take start to finish?
- What is the biggest source of errors in your current process?
- If this tool handled 80% of the reconciliation automatically, what would you do with the remaining 20%?
