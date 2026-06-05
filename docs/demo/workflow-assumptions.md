# Workflow Assumptions

**Purpose:** Every assumption currently embedded in the product. Each item should be presented to the Hiley clerk during the demo and explicitly validated or invalidated. Mark each one as the meeting progresses.

Status options: `✅ Confirmed` | `❌ Invalidated` | `⚠️ Partially true` | `? Unknown`

---

## Matching Logic Assumptions

### A1. VIN6 is the primary matching key
**What the product assumes:** The first 6 characters of the 17-digit VIN are sufficient to uniquely identify a vehicle within a single month's flooring period. Two transactions that share a VIN6 and an absolute dollar amount are treated as a confirmed match.

**Why it exists:** The Hiley clerk's manual workbook uses VIN6 in the left-hand column as the vehicle identifier. The golden dataset confirms this approach reproduces her counts for Feb/Mar/Apr 2026.

**Risk:** VIN6 collisions are theoretically possible across manufacturers. At low volumes (200–260 vehicles/month), this has not been observed, but at higher volumes or across multiple rooftops, it could produce false matches.

**Validate by asking:** How do you currently identify a vehicle in your reconciliation? Do you use the full VIN, VIN6, or stock number?

Status: ?

---

### A2. Absolute dollar amount confirms a match
**What the product assumes:** Two transactions with the same VIN6 and the same absolute dollar amount (sign is ignored) represent the same vehicle. BOA shows the balance as a positive debit; Dealertrack/GL shows it as a negative credit to account 2100.

**Why it exists:** BOA and Dealertrack represent the same floor balance with opposite signs. The engine normalizes to absolute values before comparing.

**Risk:** Curtailment payments can reduce a balance to a non-original amount, creating a case where VIN6 matches but amounts differ. The engine handles this as a Needs Review exception.

**Validate by asking:** Have you ever seen two different vehicles that had exactly the same VIN6 characters AND the same dollar amount on the floor at the same time?

Status: ?

---

### A3. Full VIN is preferred over VIN6 when available on both sides
**What the product assumes:** If both sides carry a full 17-character VIN and those VINs agree, that is a stronger match signal than VIN6 alone. Full-VIN matches are assigned confidence 1.0; VIN6 matches are assigned 0.97.

**Why it exists:** VIN6 is a 6-character prefix that can collide. A full 17-character VIN is cryptographically unlikely to collide.

**Validate by asking:** Does the BOA file always include the full VIN? Does the Dealertrack export always include the full VIN?

Status: ?

---

### A4. VIN can be extracted from the description field
**What the product assumes:** When a VIN is not in a dedicated column, it can be extracted from the transaction description using a regex for 17-character alphanumeric strings (excluding I, O, Q). This is common on the Dealertrack side, where the description often reads: `CUSTOMER NAME   DATE   VIN17`.

**Why it exists:** The Dealertrack XML export frequently embeds the VIN in the description rather than a dedicated VIN column.

**Risk:** If the description format changes, VIN extraction will silently fail and those rows will produce `missing_in_boa` / `missing_in_dealertrack` exceptions instead of matches.

**Validate by asking:** Does the Dealertrack description format ever change? Is the VIN always at the end of the description?

Status: ?

---

### A5. Stock/control number is a secondary key (not primary)
**What the product assumes:** The Dealertrack stock/control number (e.g. `M20148`) is informational — it helps identify a vehicle in the workpaper but is not used alone to confirm a match. It is used as a Tier 4 explanatory link when VIN agreement is absent and amounts match.

**Why it exists:** BOA does not consistently carry a matching stock number, and different rooftops use different stock number formats. Relying on it as a primary key would break across stores.

**Validate by asking:** Does the BOA file include a stock number? Is it the same format as Dealertrack's control number?

Status: ?

---

### A6. A non-zero Difference means the reconciliation is not closed
**What the product assumes:** The "Difference" row in the Reconciliation Summary should be $0.00 for a reconciled month. Any non-zero value represents items that need to be resolved before the workpaper is final.

**Validate by asking:** Is it ever acceptable to submit a workpaper with a non-zero Difference? Are there timing differences at month-end that you close manually?

Status: ?

---

## Preprocessing Assumptions

### A7. Straightline rows should be removed
**What the product assumes:** Any row in the BOA file containing the word "Straightline" or "Straight Line" is a depreciation/amortization entry, not a floor payable, and should be excluded from reconciliation.

**Why it exists:** The Hiley BOA export includes Straightline entries in the same account section as floor payables. The clerk removes them manually before reconciling.

**Risk:** If the client has a legitimate vehicle or transaction described as "straight line" (e.g. a note field), it would be incorrectly removed.

**Validate by asking:** Do you always remove Straightline rows? Are there any Straightline rows that should stay in the reconciliation?

Status: ?

---

### A8. Zero-balance rows should be removed
**What the product assumes:** Rows with a $0.00 balance (or $0.00 in the Dealertrack GL column) represent closed or inactive positions and should be excluded from reconciliation. They would never appear in the exception output.

**Risk:** A vehicle that was paid off in error at $0.00 but should still be on floor would be silently excluded.

**Validate by asking:** Should a $0.00 balance row ever appear in your workpaper? Is there a case where a zero balance is meaningful to you?

Status: ?

---

### A9. The BOA export format is always an HTML table saved as `.xls`
**What the product assumes:** The BOA file will be detected as `html_table_xls` with high confidence. If a different BOA export format is used (e.g. a true `.xlsx`, a PDF, or a CSV download), the upload will either fail or fall back to the CSV normalizer with reduced precision.

**Validate by asking:** Is there only one way to export from BOA, or can you export in multiple formats? Is the `.xls` download always what you use?

Status: ?

---

### A10. The Dealertrack export format is always SpreadsheetML XML saved as `.XLS`
**What the product assumes:** The Dealertrack file will be detected as `xml_spreadsheet` with high confidence. The GL account column header is a 4-digit number (e.g. `2100`) and the Control column contains `M`-prefixed stock numbers.

**Validate by asking:** Is there only one way to export from Dealertrack for the floorplan? Does the export format ever change between months?

Status: ?

---

### A11. The header row is always the first row of each file
**What the product assumes:** Row 1 of each file is the column header. If the export includes preamble rows (store name, date, export timestamp) before the header, the normalizer may misclassify them as data rows.

**Validate by asking:** Does the BOA export have any rows above the column headers — like a store name or report title?

Status: ?

---

## Data Model Assumptions

### A12. One BOA file and one Dealertrack file per reconciliation run
**What the product assumes:** Each reconciliation run is scoped to exactly one BOA upload and one Dealertrack upload. There is no support for merging multiple BOA files or multiple Dealertrack exports within a single run.

**Risk:** Some stores receive multiple BOA statements per month (e.g. one per vehicle line) or export Dealertrack by rooftop separately.

**Validate by asking:** Do you ever need to combine multiple files from the same source for one month's reconciliation?

Status: ?

---

### A13. Carry-forward data from prior runs is unnecessary for demo workflow
**What the product assumes:** The demo workflow does not rely on carry-forward tracking from prior reconciliation runs. Historical exception data is retained in the database but is not surfaced in the current workpaper view.

**Why it exists:** Carry-forward columns were removed based on Hiley feedback that they added confusion rather than clarity in the current workflow stage.

**Risk:** For a month-over-month workflow, recurring items (e.g. a vehicle that was on the exception list last month and is still unresolved) would not be flagged automatically.

**Validate by asking:** When you come back the following month, do you manually check what was unresolved last month? Would it help to see last month's open items highlighted in this month's workpaper?

Status: ?

---

### A14. Notes are separated by side — BOA Notes for BOA-side exceptions, GL Notes for GL-side exceptions
**What the product assumes:** Each exception row has a source type (`boa` or `dealertrack`). The notes input shown is specific to that side — BOA-side rows show a "BOA Notes" field; GL-side rows show a "GL Notes" field.

**Validate by asking:** When you write a note for an exception, do you write it from the BOA perspective or the GL perspective? Would you ever need to write notes for both sides of the same vehicle?

Status: ?

---

### A15. Dealer is "Hiley Mazda of Hurst" — single rooftop, single store
**What the product assumes:** The demo uses a single store configuration. Multi-store or multi-rooftop scenarios are not exercised.

**Validate by asking:** Is the floorplan reconciliation done separately per rooftop, or is it consolidated across all Hiley locations?

Status: ?

---

## Workpaper / Output Assumptions

### A16. The workpaper structure matches the clerk's existing Excel template
**What the product assumes:** The three-section layout (On schedule-not on statement / On statement-not on GL / Needs Review) with a Reconciliation Summary at the top mirrors the clerk's manual Excel workbook format.

**Why it exists:** The workpaper structure was reverse-engineered from three months of Hiley Mazda of Hurst clerk output.

**Risk:** The clerk may have a different section order, different column names, or additional sections (e.g. a "Paid off this month" section) that the product doesn't reproduce.

**Validate by asking:** Does this layout match what you produce manually? What's missing?

Status: ?

---

### A17. Accounting sign convention — schedule section is negative, statement section is positive
**What the product assumes:** "On schedule-not on statement" amounts render as negative (the GL owes but BOA hasn't posted). "On statement-not on GL" amounts render as positive (BOA shows the asset, GL hasn't reflected it). This mirrors standard floorplan workpaper sign convention.

**Validate by asking:** Do the signs look correct to you? Is this how you present these amounts in your workpaper?

Status: ?

---

### A18. "Difference" = Outstanding per stmt + GL 2100
**What the product assumes:** The Difference row equals the sum of Outstanding per stmt (BOA total + statement-not-on-GL exceptions) plus GL 2100 (Dealertrack total + schedule-not-on-statement exceptions, rendered negative). A fully reconciled month produces $0.00.

**Validate by asking:** Is this how you compute the Difference? Does your current workpaper show the same formula?

Status: ?
