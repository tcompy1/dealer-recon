# Dealer-Recon Ground Truth Reverse Engineering Report
**Source:** Hiley Mazda of Hurst — FEB26, MAR26, APRIL26 manually reconciled workbooks  
**Date:** 2026-06-03  
**Purpose:** Reverse-engineer the clerk's reconciliation methodology to define the exact business logic dealer-recon must reproduce and generate golden validation fixtures.

---

## Executive Summary

Three months of final reconciled floorplan workbooks were analyzed. Each workbook contains a single sheet representing the clerk's completed Hurst FP Rec output after cleaning both sources, aligning records, and resolving exceptions.

**Key findings:**

| Month | Total VINs | Matched | BOA Only | DT Only | BOA Total | DT Total | Variance |
|-------|-----------|---------|----------|---------|-----------|----------|---------|
| FEB26 | 254 | 238 (93.7%) | 0 | 16 | $9,088,877 | -$9,662,045 | -$573,168 |
| MAR26 | 233 | 217 (93.1%) | 10 | 6 | $8,606,561 | -$8,470,803 | +$135,758 |
| APR26 | 205 | 199 (97.1%) | 4 | 2 | $7,949,383 | -$7,877,160 | +$72,223 |

**Primary matching key: VIN6 (last 6 characters of the 17-digit VIN).**  
**Secondary confirmation: exact absolute amount equality.**  
The matching success rate of 93–97% represents genuinely matched records. The remaining exceptions are real unreconciled items, not data quality failures.

The overall variance is non-zero intentionally — it equals the net of BOA-only and DT-only exception amounts. The workbook does not force the variance to zero. The clerk's job is to identify and surface the exception, not to hide it.

---

## Section 1: Workbook Structure Analysis

### Column Layout (identical across all three months)

| Col | Header | Type | Formula | Description |
|-----|--------|------|---------|-------------|
| A | HURST | String/Manual | None | BOA vehicle description (model name, year, trim). Manual or copy-paste from BOA export. |
| B | Serial No/VIN | String | None | Full 17-digit VIN from BOA export. |
| C | VIN6 | String | `=RIGHT(B{n},6)` | Last 6 digits of BOA VIN. Computed helper column. |
| D | Ending Balance | Number | None (data rows) / `=SUM(D2:D{last})` on final row | BOA floorplan ending balance. Always **positive**. |
| E | 2100 | Number | None (data rows) / `=SUM(E2:E{last})` on final row | Dealertrack GL 2100 entry amount. Always **negative** (credit entry). FEB header says "VIN", MAR/APR say "VIN6" — this is a header label inconsistency only; the data is the same. |
| F | VIN6 (DT) | String | `=RIGHT(G{n},6)` | VIN6 extracted from the end of the Dealertrack description. Computed helper column used to visually confirm the VIN6 link. |
| G | Description | String | None | Raw Dealertrack 2100 description field. Format: `"DESCRIPTION_TEXT   MM/DD/YY  VIN17"`. VIN always appears as the final token. |
| H | Control | String | None | Dealertrack control/reference number (e.g., `M21244`). Format: `M` + 5 digits. |

### Formula Inventory

| Formula | Column | Count (FEB/MAR/APR) | Purpose |
|---------|--------|--------------------|-|
| `=RIGHT(B{n},6)` | C | 239 / 228 / 204 | BOA VIN6 helper |
| `=RIGHT(G{n},6)` | F | 251 / 224 / 202 | DT VIN6 helper (covers DT-only rows too) |
| `=SUM(D2:D{last})` | D, final row | 1 / 1 / 1 | BOA total |
| `=SUM(E2:E{last})` | E, final row | 1 / 0 / 0 | DT total (MAR/APR use hardcoded value in final row — manual entry) |

**Note on MAR/APR totals row:** The MAR and APR final row has a formula artifact — `=RIGHT(B{n},6)` in col C of the total row references a row outside the data range (B239 in a 235-row sheet, B209 in a 207-row sheet), returning `None`. This is a clerk copy-paste error on the total row only. It has no effect on the data.

### Manual vs Formula Fields

| Field | Source |
|-------|--------|
| Col A (model description) | Manual entry / copy-paste from BOA |
| Col B (VIN) | Manual entry / copy-paste from BOA |
| Col D (ending balance) | Manual entry / copy-paste from BOA |
| Col E (2100 amount) | Manual entry / copy-paste from Dealertrack |
| Col G (DT description) | Manual entry / copy-paste from Dealertrack |
| Col H (control number) | Manual entry / copy-paste from Dealertrack |
| Col C (VIN6 BOA) | **Formula** — `=RIGHT(B,6)` |
| Col F (VIN6 DT) | **Formula** — `=RIGHT(G,6)` |

---

## Section 2: Matching Logic Reconstruction

### Reconstructed Matching Algorithm

```
FOR each BOA record (identified by VIN in col B):
  COMPUTE boa_vin6 = RIGHT(vin, 6)
  
  SEARCH DT records WHERE:
    RIGHT(dt_description_last_token, 6) == boa_vin6    [PRIMARY KEY]
  
  IF exactly one DT record found:
    IF ABS(boa_ending_balance) == ABS(dt_2100_amount):  [CONFIRMATION]
      CLASSIFY as MATCHED
      PLACE on same row: BOA cols (A,B,C,D) + DT cols (E,F,G,H)
    ELSE:
      CLASSIFY as AMOUNT_MISMATCH (VIN6 match but different balance)
  
  IF no DT record found:
    CLASSIFY as BOA_ONLY
    PLACE BOA data in cols A,B,C,D — leave E,F,G,H empty
  
  IF DT record has no BOA counterpart:
    CLASSIFY as DT_ONLY
    PLACE DT data in cols E,F,G,H — leave A,B,C,D empty

SORT all rows BY col D (BOA Ending Balance) ASCENDING
```

### Matching Key Hierarchy

| Priority | Key | Verified Against Data |
|---------|-----|----------------------|
| 1 (Primary) | **VIN6** — last 6 chars of VIN | 238/238 FEB, 217/217 MAR, 199/199 APR matched rows all have col C == col F |
| 2 (Confirmation) | **Absolute amount equality** — `ABS(D) == ABS(E)` | All matched rows satisfy this; amount equality is a confirmation, not the key |
| 3 (Source for DT VIN6) | **VIN extracted from end of DT description** | DT description always ends with 17-char VIN; `RIGHT(G,6)` extracts last 6 |
| — (NOT used) | Full VIN match | Not required — VIN6 is sufficient and is the actual key |
| — (NOT used) | Control number | Not used for matching — informational only |
| — (NOT used) | Row position | Not used — sorting is applied after matching |

### VIN Extraction from DT Description

The Dealertrack description field (col G) has this structure:
```
"DESCRIPTION_TEXT   MM/DD/YY  VIN17"
```
Examples:
- `"2026 MAZDA MAZDA3 SED   3/14/26  JM1BPAAL7T1869826"` → VIN6 = `869826`
- `"DUNCAN, WILLIAM RAYMO   3/11/26  JM1BPAAL7T1870555"` → VIN6 = `870555`
- `"HILEY MAZDA OF ARLING   2/17/26  JM1BPAAL8T1866286"` → VIN6 = `866286`

The description prefix can be: vehicle model name, customer last name, or dealer name (for transfers). The VIN is always the **last space-delimited token**, always 17 characters.

### Sort Order

All three workbooks are sorted **ascending by BOA Ending Balance (col D)**. This is the clerk's working sort — applied after matching, used to visually scan and review exceptions in a consistent order. dealer-recon must reproduce this sort in its workbook export.

---

## Section 3: Exception Taxonomy

### Complete Exception Taxonomy

#### Type 1: MATCHED
- Both BOA and DT have a record for this VIN6
- `ABS(boa_ending_balance) == ABS(dt_2100_amount)`
- Row fully populated (cols A–H)
- **Counts:** FEB=238, MAR=217, APR=199

#### Type 2: BOA_ONLY
- BOA has a record; no matching DT record found by VIN6
- Cols A–D populated; E–H empty
- **Cause:** Vehicle on floorplan per bank, but no matching DT entry. Usually indicates:
  - Vehicle floorpaid this month but DT curtailment not posted yet
  - New unit floored late in the month
  - DT entry posted to different period
- **Counts:** FEB=0, MAR=10, APR=4

#### Type 3: DEALERTRACK_ONLY
- DT has a record; no matching BOA record found by VIN6
- Cols A–D empty; E–H populated
- **Cause:** DT shows a floorplan credit, but BOA has no corresponding ending balance. Usually indicates:
  - Vehicle sold/paid off — DT posted payoff but BOA ending balance is zero/closed
  - Vehicle transferred to another rooftop — shows as DT-only at the sending store
  - Timing difference — DT posts at end of month, BOA cuts statement before posting
- **Counts:** FEB=16, MAR=6, APR=2

**FEB26 has 16 DT-only records — the largest exception set.** All 16 have VINs in the DT description that do not appear anywhere in the BOA VIN column for that month. They are genuine timing differences — the DT entries posted in February but the BOA floorplan balance had already closed.

#### Type 4: AMOUNT_MISMATCH (VIN6 match, amount differs)
- Identified in April rows 40–43: Two VINs (JM1BPBLL0T1870612 and JM1BPBLL1T1871235) appear as **both** BOA_ONLY (amount $32,283) AND DT_ONLY (amount $31,771) simultaneously.
- The clerk **did not combine them onto one row** — they are left as separate BOA_ONLY and DT_ONLY rows.
- This is the clerk's explicit treatment: when VIN6 matches but amounts differ, the records are **not merged** — they are each presented as independent exceptions.
- The amount difference ($512 per unit) represents a rate/curtailment delta.
- **True count:** FEB=0, MAR=0, APR=2 VIN pairs (4 rows total)

#### Type 5: SAME-MODEL DUPLICATE VIN6 AMBIGUITY
- Not observed in these three months, but structurally possible when two vehicles have the same last 6 VIN digits (collision). The VIN6 space is 36^6 ≈ 2.17 billion; within a single dealer's inventory of ~200–250 units, collision is unlikely but theoretically possible.

#### Exception Frequency Pattern

| Exception Type | FEB | MAR | APR |
|---------------|-----|-----|-----|
| BOA Only | 0 | 10 | 4 |
| DT Only | 16 | 6 | 2 |
| Amount Mismatch Pairs | 0 | 0 | 2 |
| **Total Exceptions** | **16** | **16** | **8** |

**Observation:** Total exception count is declining month over month (16 → 16 → 8). This aligns with the inventory pattern — FEB had the most pending payoffs (all DT-only, vehicles paid off), MAR had the most new floorings not yet reflected in DT, APR is the cleanest.

---

## Section 4: Reconciliation Pattern Mining

### What Makes a Record Reconcile Successfully
1. VIN6 of BOA record matches VIN6 extracted from end of DT description
2. `ABS(boa_ending_balance) == ABS(dt_2100_amount)` — amounts agree exactly
3. Both records exist in the same statement period

### What Causes Records to Fail Reconciliation

| Cause | Exception Type | Pattern |
|-------|---------------|---------|
| Vehicle paid off in DT but BOA already closed | DT_ONLY | Common in high-turnover months |
| New unit floored in BOA but DT credit not posted yet | BOA_ONLY | Common in month-end floor additions |
| VIN6 matches but amount differs (rate change/curtailment) | Both BOA_ONLY + DT_ONLY separately | April rows 40–43 pattern |
| Vehicle at a different Hiley rooftop in DT | DT_ONLY | Desc shows "HILEY MAZDA OF ARLING", "HILEY MAZDA OF BURLES", etc. |
| Transfer/loaner unit with separate accounting | DT_ONLY | Desc shows "HILEY SERVICE LOANER" |

### Carry-Forward Pattern

| Metric | Value |
|--------|-------|
| FEB→MAR carry-forward VINs | 137 |
| MAR→APR carry-forward VINs | 136 |
| All 3 months (long-floor units) | 85 |

Approximately 60% of inventory carries forward each month. Long-aged units (85 VINs present all 3 months) are likely aged/slow-moving inventory. This is critical for dealer-recon's timing-state logic — these are not errors, they are persistent floorplan positions.

---

## Section 5: Golden Dataset

File: `golden_dataset.csv` — 692 rows across all three months.

### Schema

| Field | Type | Description |
|-------|------|-------------|
| month | string | FEB26 / MAR26 / APRIL26 |
| row | integer | Original spreadsheet row number |
| classification | enum | matched / boa_only / dealertrack_only |
| boa_description | string | Col A — vehicle model |
| vin | string | Full 17-digit VIN (from BOA col B, or extracted from DT desc) |
| vin6 | string | Last 6 chars of VIN |
| boa_ending_balance | float | Col D — positive dollar amount from BOA |
| dt_2100_amount | float | Col E — negative dollar amount from DT |
| dt_vin6 | string | Col F — VIN6 extracted from DT description |
| dt_description | string | Col G — raw DT description |
| dt_vin_extracted | string | Full VIN parsed from end of DT description |
| dt_date | string | Date parsed from DT description (MM/DD/YY) |
| control_number | string | Col H — DT control number (M-series) |

---

## Section 6: Dealer-Recon Gap Analysis

### A. What dealer-recon Already Appears Capable of Reproducing

- VIN6 extraction from BOA VINs (`=RIGHT(VIN, 6)`)
- VIN6 extraction from Dealertrack description via `=RIGHT(description, 6)`
- Matched record classification when VIN6 and amount agree
- BOA-only and DT-only exception classification
- Workbook export with the 8-column layout
- Column D (BOA) positive, column E (DT) negative sign convention
- SUM totals on final row

### B. Manual Clerk Behaviors NOT Currently Represented

1. **Amount-mismatch exception pair handling** — When VIN6 matches but amounts differ, the clerk keeps them as two separate exception rows (one BOA_ONLY, one DT_ONLY). dealer-recon likely tries to merge them or may classify them incorrectly.

2. **DT VIN extraction from description trailing token** — The full parsing logic: description ends with a 17-char VIN, always the last space-delimited token. Intermediate tokens include dates and partial names. The current `RIGHT(G,6)` formula works because the VIN is the last token, but dealer-recon's parser must not be confused by customer last names or dealer transfer names that appear as description prefixes.

3. **Sort by BOA Ending Balance ascending** — Export must sort by col D ascending. The current dealer-recon export sort order is unverified against this requirement.

4. **Final variance is intentional and non-zero** — The workbook's final row shows BOA total and DT total as separate cells. The variance (BOA + DT, where DT is negative) equals the net exception delta, not zero. dealer-recon must not treat a non-zero final variance as an error — it is the expected output when exceptions exist.

5. **Col A model description** — This is the BOA vehicle description, not a computed field. dealer-recon must preserve and export the raw model description string from the BOA source.

### C. Missing Business Rules

| Rule | Description |
|------|-------------|
| Amount-mismatch = two rows, not one | VIN6 match + amount difference → do NOT merge; emit both as separate exceptions |
| VIN6 collision handling | If two different full VINs share the same VIN6, the matching is ambiguous; clerk would resolve manually — dealer-recon has no handling for this |
| DT description prefix variability | Prefixes include model name, customer name, and dealer name — only the trailing VIN token is reliable for matching |
| Control number is informational only | `M21xxx` control numbers are not used for matching, only for human audit trail |
| Carry-forward is normal | A VIN appearing in multiple consecutive months is not a duplicate — it is a persistent floorplan position |

### D. Missing Matching Rules

| Gap | Current State | Required |
|-----|-------------|---------|
| Full-VIN exact match fallback | Unknown | If VIN6 is ambiguous (collision), fall back to full-VIN match |
| Amount-mismatch as separate exception type | Unknown | Emit both BOA_ONLY and DT_ONLY rows when VIN6 matches but amount differs |
| Multi-rooftop DT description filtering | Unknown | DT descriptions prefixed with "HILEY MAZDA OF ARLING" etc. are still valid matches — the VIN in the trailing token is the match key regardless of prefix |

### E. Missing Exception Categories

| Missing Category | Evidence |
|-----------------|---------|
| `amount_mismatch` (VIN6 match, different amount) | April rows 40–43: same VIN6, $31,771 DT vs $32,283 BOA |
| `inter_rooftop_transfer` (DT-only for transferred unit) | FEB rows 8, 160 show "HILEY MAZDA OF ARLING/BURLES/FORT W" |
| `service_loaner` | FEB row 249 "HILEY SERVICE LOANER", MAR row 39 |

### F. Potential False Positives (dealer-recon incorrectly classifies as matched)

- VIN6 collision: two different units with same last 6 VIN digits — dealer-recon would match the wrong pair
- DT description truncation: if description parsing fails and extracts wrong 6 chars, false VIN6 match
- Curtailment entry on a closed unit: DT 2100 credit for payoff could accidentally VIN6-match an active unit with the same suffix

### G. Potential False Negatives (dealer-recon fails to match a real pair)

- DT description contains special characters or extra whitespace that breaks the trailing-token VIN extraction
- DT entry posted as a correction (negative of a negative) — sign would differ from expected pattern
- BOA export VIN field has extra whitespace or leading zeros causing `RIGHT(VIN,6)` to extract wrong characters

---

## Section 7: Acceptance Test Specification

### FEB26 Acceptance Tests

```yaml
month: FEB26
source_files:
  boa: FEB26_BOA_raw.csv
  dealertrack: FEB26_DT_raw.csv

expected_output:
  total_data_rows: 254
  matched_count: 238
  boa_only_count: 0
  dealertrack_only_count: 16
  
  boa_grand_total: 9088877.00
  dt_grand_total: -9662045.00
  variance: -573168.00
  
  matched_boa_sum: 9088877.00
  matched_dt_sum: -9088877.00
  boa_only_sum: 0.00
  dt_only_sum: -573168.00
  
  sort_order: ascending_by_boa_ending_balance
  
  dealertrack_only_vins:
    - JM1BPABL0T1867950   # control M21317
    - JM1BPACL2T1868807   # control M21313
    - 3MVDMBBL5TM140456   # control M21444
    - 3MVDMBCL5TM139404   # control M21408
    - 3MVDMBXL0TM139417   # control M21406
    - 7MMVABAL9TN478464   # control M21371
    - 7MMVABBL2TN479163   # control M21369
    - 7MMVABXL0TN479039   # control M21367
    - 7MMVABXL8TN479046   # control M21368
    - 7MMVAABW5TN161123   # control M21379
    - 7MMVABCY8TN475306   # control M21376
    - 7MMVABCYXTN478207   # control M21373
    - 7MMVABCY1TN478886   # control M21374
    - 7MMVAADW1TN163030   # control M21380
    - JM3KKBHD6T1376715   # control M21266
    - JM3KJDHC4T1205046   # control M21265 (also appears MAR as matched)
```

### MAR26 Acceptance Tests

```yaml
month: MAR26

expected_output:
  total_data_rows: 233
  matched_count: 217
  boa_only_count: 10
  dealertrack_only_count: 6
  
  boa_grand_total: 8606561.00
  dt_grand_total: -8470803.00
  variance: 135758.00
  
  matched_boa_sum: 8246045.00
  matched_dt_sum: -8246045.00
  boa_only_sum: 360516.00
  dt_only_sum: -224758.00
  
  boa_only_vins:
    - JM1BPAAL1T1872804   # $25,895 — in FEB as DT_ONLY candidate, now BOA_ONLY
    - JM1BPACL5T1873144   # $27,968
    - JM3KMCHA2T0108661   # $35,469
    - JM3KMCHA3T0108989   # $35,807
    - JM1NDAD74T0701460   # $37,816
    - JM1NDAD71T0702467   # $37,816
    - JM1NDAM71T0701528   # $39,571
    - JM1NDAM73T0702471   # $39,571
    - JM1NDAM70T0701892   # $39,829
    - JM1NDAM70T0701455   # $40,774
    
  dealertrack_only_vins:
    - 7MMVABALXTN487349   # control M21517
    - 7MMVABDL6TN486632   # control M21515
    - JM1NDAD70T0700998   # control M21366
    - JM1NDAM71T0700847   # control M21350
    - JM1NDAM76T0700438   # control M21349
    - JM1NDAM72T0702171   # control M21348
```

### APR26 Acceptance Tests

```yaml
month: APR26

expected_output:
  total_data_rows: 205
  matched_count: 199
  boa_only_count: 4
  dealertrack_only_count: 2
  amount_mismatch_pairs: 1  # JM1BPBLL0T1870612 and JM1BPBLL1T1871235
  
  boa_grand_total: 7949383.00
  dt_grand_total: -7877160.00
  variance: 72223.00
  
  matched_boa_sum: 7813618.00
  matched_dt_sum: -7813618.00
  boa_only_sum: 135765.00
  dt_only_sum: -63542.00
  
  # Amount mismatch pair — VIN6 matches, amounts differ
  # Clerk left these as 4 separate rows (2 DT_ONLY + 2 BOA_ONLY)
  amount_mismatch_detail:
    - vin: JM1BPBLL0T1870612
      vin6: "870612"
      dt_amount: -31771    # control M21326, date 3/11/26
      boa_amount: 32283    # no DT match found
      delta: 512
    - vin: JM1BPBLL1T1871235
      vin6: "871235"
      dt_amount: -31771    # control M21327, date 3/11/26
      boa_amount: 32283
      delta: 512
  
  boa_only_vins:
    - JM1BPBLL0T1870612   # $32,283 — also DT_ONLY at $31,771 (mismatch pair)
    - JM1BPBLL1T1871235   # $32,283 — also DT_ONLY at $31,771 (mismatch pair)
    - JM3KJDHD4S1130761   # $35,200 — no DT match at all
    - JM3KMCHA6T0126368   # $35,999 — no DT match at all
    
  dealertrack_only_vins:
    - JM1BPBLL0T1870612   # -$31,771 control M21326 (mismatch pair)
    - JM1BPBLL1T1871235   # -$31,771 control M21327 (mismatch pair)
```

### Cross-Month Acceptance Tests

```yaml
carry_forward:
  feb_to_mar_shared_vins: 137
  mar_to_apr_shared_vins: 136
  all_three_months: 85
  
  assertion: A VIN appearing in multiple months MUST be treated as a 
             persistent floorplan position, not a duplicate error.
  
  sample_all_three_vins:
    - 3MVDMBBL0TM111043
    - 3MVDMBCL3TM107499
    - 3MVDMBCL3TM111438
    - 3MVDMBCL4TM100464
    - 3MVDMBCL5TM100523
```

---

## Section 8: Reconstructed Reconciliation Algorithm (Pseudocode)

```python
def reconcile_month(boa_records: list[BOARecord], dt_records: list[DTRecord]) -> ReconciliationResult:
    
    # Step 1: Index DT records by VIN6
    dt_by_vin6: dict[str, list[DTRecord]] = defaultdict(list)
    for dt_rec in dt_records:
        vin = extract_trailing_17char_vin(dt_rec.description)
        if vin:
            vin6 = vin[-6:]
            dt_by_vin6[vin6].append(dt_rec)
    
    matched_rows = []
    boa_only_rows = []
    unmatched_dt = set(dt_records)
    
    # Step 2: For each BOA record, attempt VIN6 match
    for boa_rec in boa_records:
        boa_vin6 = boa_rec.vin[-6:]
        candidates = dt_by_vin6.get(boa_vin6, [])
        
        if len(candidates) == 0:
            boa_only_rows.append(BOAOnlyRow(boa_rec))
            
        elif len(candidates) == 1:
            dt_rec = candidates[0]
            
            if abs(boa_rec.ending_balance) == abs(dt_rec.amount_2100):
                # Perfect match
                matched_rows.append(MatchedRow(boa_rec, dt_rec))
                unmatched_dt.discard(dt_rec)
            else:
                # VIN6 match but amount mismatch — emit BOTH as separate exceptions
                boa_only_rows.append(BOAOnlyRow(boa_rec))
                # dt_rec stays in unmatched_dt → becomes DT_ONLY
                
        else:
            # Multiple DT records with same VIN6 (unusual — handle as ambiguous)
            # Current clerk behavior: unknown — not observed in these months
            raise AmbiguousVIN6Match(boa_vin6, candidates)
    
    # Step 3: Remaining DT records with no BOA match are DT-only
    dt_only_rows = [DTOnlyRow(dt_rec) for dt_rec in unmatched_dt]
    
    # Step 4: Combine all rows
    all_rows = matched_rows + boa_only_rows + dt_only_rows
    
    # Step 5: Sort by BOA ending balance ascending
    # For exception rows: BOA_ONLY sort by boa_ending_balance
    # DT_ONLY sort by abs(dt_2100_amount) — placed at their amount position
    all_rows.sort(key=lambda r: r.sort_key_amount)
    
    # Step 6: Compute totals
    boa_total = sum(r.boa_ending_balance for r in all_rows if r.boa_ending_balance)
    dt_total = sum(r.dt_2100_amount for r in all_rows if r.dt_2100_amount)
    variance = boa_total + dt_total  # Expected to be non-zero when exceptions exist
    
    return ReconciliationResult(rows=all_rows, boa_total=boa_total, dt_total=dt_total, variance=variance)


def extract_trailing_17char_vin(description: str) -> str | None:
    """Extract VIN from end of DT description field.
    
    DT description format: 'DESCRIPTION_TEXT   MM/DD/YY  VIN17'
    The VIN is always the last space-delimited token and always 17 characters.
    """
    if not description:
        return None
    tokens = description.strip().split()
    if tokens and len(tokens[-1]) == 17:
        return tokens[-1]
    return None
```

---

## Section 9: Recommended Engineering Roadmap

### Priority 1 — Critical for Workbook Fidelity (blocking acceptance tests)

| Item | Description | Effort |
|------|-------------|--------|
| Amount-mismatch exception type | When VIN6 matches but amounts differ, emit two rows (BOA_ONLY + DT_ONLY), not one merged row | S |
| VIN trailing-token extraction | Ensure DT description parser always extracts the last 17-char token as the VIN, regardless of description prefix | S |
| Sort by BOA ending balance ascending | Verify workbook export sorts col D ascending | S |
| Non-zero variance is valid | Do not treat non-zero final variance as a reconciliation error — it equals the net exception amount | S |

### Priority 2 — Exception Classification Completeness

| Item | Description | Effort |
|------|-------------|--------|
| `amount_mismatch` classification | Add as a distinct exception type with both the BOA and DT amounts surfaced | S |
| Inter-rooftop transfer tagging | When DT description prefix contains another Hiley location name, tag as `inter_rooftop_transfer` | M |
| Service loaner tagging | When DT description contains "HILEY SERVICE LOANER", tag as `service_loaner` | S |

### Priority 3 — Validation and Acceptance Testing

| Item | Description | Effort |
|------|-------------|--------|
| Golden fixture integration | Wire FEB26/MAR26/APR26 golden CSV into automated test suite | M |
| Per-month acceptance test suite | Test matched count, exception counts, totals, variance, and VIN lists against spec above | M |
| Amount mismatch pair test | Verify APR26 rows 40–43 produce exactly 2 BOA_ONLY + 2 DT_ONLY, not 2 matched | S |

### Priority 4 — Robustness

| Item | Description | Effort |
|------|-------------|--------|
| VIN6 collision detection | Detect when two BOA VINs produce the same VIN6 and surface as ambiguous | M |
| DT description parser robustness | Handle truncation, extra whitespace, and non-VIN trailing tokens | S |
| Whitespace normalization | Trim BOA VIN and DT description before VIN6 extraction | XS |

### Priority 5 — Not Yet (deferred)

- Multi-rooftop aggregation (out of scope for Hurst MVP)
- Historical trend analysis across months
- Automated exception resolution
- Sign-off and adjustment persistence (separate work stream, already identified)

---

## Appendix: Key Numbers Reference

| Metric | FEB26 | MAR26 | APR26 |
|--------|-------|-------|-------|
| Sheet name | BillingStatementFebruary2026 | BillingStatementMarch2026 | BillingStatementApril2026 |
| Total rows (incl. header + total) | 256 | 235 | 207 |
| Data rows | 254 | 233 | 205 |
| BOA Grand Total | $9,088,877 | $8,606,561 | $7,949,383 |
| DT Grand Total | -$9,662,045 | -$8,470,803 | -$7,877,160 |
| Variance (BOA+DT) | -$573,168 | +$135,758 | +$72,223 |
| Matched rows | 238 | 217 | 199 |
| BOA-only rows | 0 | 10 | 4 |
| DT-only rows | 16 | 6 | 2 |
| Amount-mismatch pairs | 0 | 0 | 1 |
| Carry-forward VINs (to next month) | 137 | 136 | — |
