# Demo Dataset Checklist

Use this checklist before the Hiley demo to verify that uploaded files and reconciliation results are behaving as expected. Check each item before the meeting starts.

---

## Expected Input Files

### BOA File

| Property | Expected value |
|---|---|
| Format | HTML table exported as `.xls` (BOA's native export format) |
| Content-based detection | `html_table_xls` with `high` confidence |
| Source type label | `boa` |
| VIN presence | 17-character VINs in the BOA description column (e.g. `JM1BPAJM3S1780956`) |
| Stock number pattern | Not present directly — VIN is the primary key |
| Amount column | "Ending Balance" column; values are dollar amounts with commas (e.g. `$25,746.00`) |
| Zero-balance rows | Present in the raw export; should be removed by preprocessing |
| Straightline rows | May or may not be present; should be removed if present |
| Header row | Present; should be detected and excluded |

**Known-good sample reference:** February 2026 BOA file — 238 matched rows + 0 BOA-only exceptions in the golden dataset.

---

### Dealertrack File

| Property | Expected value |
|---|---|
| Format | SpreadsheetML XML exported as `.XLS` (Dealertrack's native DMS export format) |
| Content-based detection | `xml_spreadsheet` with `high` confidence |
| Source type label | `dealertrack` |
| VIN presence | VIN embedded in the description field (e.g. `HILEY MAZDA OF ARLING   2/17/26  JM1BPAAL8T1866286`) |
| Stock/control number | `M`-prefixed 5–6 digit number (e.g. `M20148`, `M21244`) — parsed from the "Control" column |
| Amount column | GL account column — typically a 4-digit account number header (e.g. `2100`); values are credits (negative) |
| Zero-amount rows | Present for non-floored lines; should be excluded |
| Header row | Present; should be detected and excluded |

**Known-good sample reference:** February 2026 Dealertrack file — 238 matched + 16 GL-only exceptions.

---

## Upload Validation Expectations

After uploading each file, verify the following before running reconciliation:

### BOA Upload

- [ ] Upload succeeds with HTTP 200
- [ ] `detected_format` = `html_table_xls`
- [ ] `detection_confidence` = `high`
- [ ] Transaction count is plausible (typically 200–260 for a full month at Hiley)
- [ ] Removed rows panel appears and lists at least one removed row
- [ ] No validation errors shown in the UI

### Dealertrack Upload

- [ ] Upload succeeds with HTTP 200
- [ ] `detected_format` = `xml_spreadsheet`
- [ ] `detection_confidence` = `high`
- [ ] Transaction count is plausible (typically 200–260 for a full month at Hiley)
- [ ] Removed rows panel shows zero-balance rows excluded
- [ ] No validation errors shown in the UI

---

## Expected Removed-Row Counts

These are estimates based on the Hiley golden dataset. Exact counts vary by month.

### BOA

| Removal Reason | Typical presence |
|---|---|
| Header row detected | 1 (always — the column header row) |
| Zero balance — excluded from reconciliation | 0–5 (accounts with no activity) |
| Straightline row — excluded from reconciliation | 0–3 (depends on month) |
| Banner/header/subtotal row | 1–3 (section headers, subtotals) |
| No valid amount found | Rare |
| Unrecognized row structure | Rare |

### Dealertrack

| Removal Reason | Typical presence |
|---|---|
| Header row detected | 1 (always) |
| Zero-amount Dealertrack row excluded | 10–30+ (GL accounts with zero balance for that stock) |
| Unrecognized row structure | Rare |

---

## Expected Reconciliation Results

These numbers come directly from the engine's golden-fixture acceptance tests run against three months of Hiley Mazda of Hurst real data.

| Month | BOA rows | DT rows | Matched | On Schedule–Not on Stmt | On Stmt–Not on GL | Needs Review |
|---|---|---|---|---|---|---|
| Feb 2026 | 238 | 254 | 238 | 16 (GL-only) | 0 | 0 |
| Mar 2026 | 227 | 223 | 217 | 6 (GL-only) | 10 (BOA-only) | 0 |
| Apr 2026 | 203 | 201 | 199 | 2 (GL-only) | 4 (BOA-only) | 0 |

**What "good" looks like:**
- Match rate above 90%
- Variance (Difference row in Summary table) should be `$0.00` if both sides are truly reconciled — a non-zero Difference is the signal that something needs to be resolved
- Needs Review count of 0 means the engine found no VIN6-agrees-but-amount-differs pairs

---

## Expected Exception Counts (by type)

| Exception category | Meaning | Typical count |
|---|---|---|
| `missing_in_boa` ("On schedule–not on statement") | GL has the vehicle, BOA does not yet | 0–16 |
| `missing_in_dealertrack` ("On statement–not on GL") | BOA has the vehicle, GL does not | 0–10 |
| `vin6_match_amount_mismatch` ("Needs Review") | VIN agrees but dollar amounts differ — requires clerk judgment | 0 for clean months |
| `amount_only_review` ("Needs Review") | Same amount on both sides, no VIN agreement — clerk must verify | Rare |
| `duplicate_or_one_to_many` | Duplicate transaction detected | Rare |
| `amount_mismatch` | VIN present on both sides, amounts differ without a timing signal | Rare |
| `possible_timing_issue` | Amounts differ, dates are within 45 days — may be a cut-off timing item | Rare |

---

## Workbook Export Validation

Download the XLS workbook after a successful run and confirm:

- [ ] File opens in Excel without errors
- [ ] "Reconciliation Summary" table is present at the top
- [ ] "Outstanding per stmt" and "2100" rows are populated with dollar amounts
- [ ] "Difference" row is highlighted yellow
- [ ] "On schedule-not on statement" section is present
- [ ] "On statement-not on GL" section is present
- [ ] "Needs Review" section is present (may be empty for a clean month)
- [ ] Column widths are readable — GL Notes and BOA Notes columns are wide enough to show text
- [ ] "Prepared by" / "Reviewed by" sign-off rows appear at the bottom
- [ ] No `#REF!` or `#VALUE!` errors in any cell
