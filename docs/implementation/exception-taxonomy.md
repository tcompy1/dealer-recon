# Exception Taxonomy

## Purpose

This document defines how reconciliation outcomes map to Hurst FP REC review lines. It supports step 3 of the canonical workflow in [../product/fp-rec-four-step-workflow.md](../product/fp-rec-four-step-workflow.md).

## Match Rule

A BOA row and Dealertrack row become a confirmed match only when:

- BOA VIN6 equals Dealertrack VIN6.
- Absolute BOA amount equals absolute Dealertrack amount in cents.
- Each source row is consumed by only one match.

Matched rows are excluded from exception sections.

## Taxonomy

| Outcome | Engine signal | FP REC placement | Required behavior |
| --- | --- | --- | --- |
| Matched | Match group | No exception section | Do not show in `On statement-not on GL` or `On schedule-not on statement`. |
| BOA-only | `missing_in_dealertrack` / `missing_in_dealertrack` category | `On statement-not on GL` | Show the BOA-side row for review. Dealertrack side is blank in side-by-side artifacts. |
| Dealertrack-only | `missing_in_boa` / `missing_in_boa` category | `On schedule-not on statement` | Show the Dealertrack-side row for review. BOA side is blank in side-by-side artifacts. |
| VIN6 amount mismatch | `needs_review_vin6_only` / `vin6_match_amount_mismatch` category | Side-specific review lines | Do not merge. Emit one BOA-side exception line and one Dealertrack-side exception line. |
| Duplicate or one-to-many | `duplicate_transaction` or `duplicate_or_one_to_many` category | Review only | Do not auto-merge unless a single pair still satisfies VIN6 plus exact amount. |
| Weak amount/reference review | `needs_review_amount_only`, `amount_only_review`, or similar category | Review only | Do not create a confirmed FP REC match without VIN6 plus exact amount. |

## FP REC Section Labels

For v1 Hurst FP REC:

- `On statement-not on GL` means the row exists on BOA but does not have an accepted Dealertrack/GL counterpart.
- `On schedule-not on statement` means the row exists in Dealertrack but does not have an accepted BOA statement counterpart.

These labels describe source-side placement. They are not generic analytics categories.

## Amount Mismatch Rule

VIN6 amount mismatches are reviewable exceptions, not matches.

Example:

| Source | VIN6 | Amount | Result |
| --- | --- | ---: | --- |
| BOA | `123456` | `25000.00` | BOA-side exception line |
| Dealertrack | `123456` | `24900.00` | Dealertrack-side exception line |

The two lines may share VIN6, but they must remain split because the amounts differ.

## Code Review Trace

Review these areas when changing exception behavior:

- Matching and mismatch creation: `server/src/services/reconciliationEngine.ts`.
- Category assignment: `server/src/services/exceptionCategorizer.ts`.
- Exception CSV labels: `server/src/presenters/csv.ts`.
- Merged artifact row placement: `server/src/presenters/mergedFloorplan.ts`.
- Hurst FP REC rendering: `server/src/presenters/hurstFpRec.ts`.
- Run detail and exception persistence: repository methods backing `reconciliation_runs`, `reconciliation_match_groups`, and `reconciliation_exceptions`.

## Acceptance Checks

- Matched rows do not appear in exception sections.
- BOA-only rows appear as `On statement-not on GL`.
- Dealertrack-only rows appear as `On schedule-not on statement`.
- VIN6 amount mismatches are represented as separate BOA-side and Dealertrack-side lines.
- Non-zero variance is allowed when exceptions remain.
