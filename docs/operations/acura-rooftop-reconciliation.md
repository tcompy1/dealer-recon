# Acura Rooftop Reconciliation Operating Contract

## Support boundary

Acura floorplan reconciliation is enabled by rooftop profile `acura-v1`, profile version `1`. One run represents one operator-selected accounting month.

The supported raw inputs are:

- one BOA Dealer Billing Statement CSV with `Serial No/VIN` and `Ending Balance` fields; and
- one Dealertrack CSV whose included floorplan amount column is account `324`.

Select the accounting month in canonical `YYYY-MM` form before either upload. Native `.xlsx` is not an accepted raw input. The approved Acura `.xlsx` workbook is a goal-output reference used by the conditional acceptance test, not an upload format.

## Operator workflow

1. Select Hiley Acura and Floorplan Reconciliation.
2. Select the accounting month.
3. Upload the BOA CSV as BOA.
4. Upload the Dealertrack CSV as Dealertrack.
5. Review upload warnings and confirm that both accepted uploads show the same month and `acura-v1` profile.
6. Run the workflow.
7. Review the run identity and exception totals.
8. Download the merged floorplan and FP REC outputs from the completed run.

The visible run identity is `ACURA · <MMM YYYY> · Run #<id>`; for example, `ACURA · Apr 2026 · Run #42`. The selected accounting month, not the execution timestamp, controls this identity and the artifact period labels.

## Accounting-period evidence

The selected month is authoritative, while source dates validate that choice:

- A BOA `Dealer Billing Statement for: <Month> <Year>` banner confirms the statement month. A different banner month blocks the upload. Multiple distinct banner months are contradictory and also block it.
- Dealertrack description dates are supporting evidence. Any date after the selected month-end blocks the upload. Dates at or before month-end are compatible but do not prove that the export is complete.
- Filename month tokens are hints only. They may generate a warning but cannot override source content or the selected month.
- Missing usable date evidence is an allowed incomplete-evidence warning; it is never converted into a fabricated confirmation.

Both accepted sources must have the same store, accounting month, rooftop profile ID and version, source types, and stored parser/preprocessor provenance. Reconciliation rejects a pair that does not share that identity.

## Allowed warnings and auditable transformations

These conditions may continue when the remaining structure is valid and the warning or removal is recorded:

- a row has no usable VIN and needs manual enrichment;
- BOA uses `Original Amount` because the characterized structure has no available `Ending Balance` cell for that row;
- zero-balance, `Straight Line`, banner/header/total, empty, or non-detail rows are removed under a recorded reason;
- duplicate VIN6 candidates require deterministic classification or review;
- Dealertrack period evidence is compatible but incomplete; or
- a filename month hint differs from authoritative content or the selected month.

Warnings do not relax the matching rule. A match still requires equal VIN6 and exact absolute amount in integer cents. Same-VIN6 amount mismatches remain two source-side exceptions rather than one merged match.

## Blocking failures and recovery

Validation errors use this response shape:

```json
{
  "error": {
    "code": "SOURCE_PERIOD_MISMATCH",
    "message": "The BOA statement period does not match the selected accounting month.",
    "details": {
      "source": "boa",
      "accounting_month": "2026-04",
      "rooftop_profile_id": "acura-v1",
      "recovery": "Select the statement month or upload the BOA statement for the selected month."
    }
  }
}
```

The actual response can also contain safe aggregate evidence. It must not contain raw rows or VIN values.

| Code | Meaning | Recovery |
| --- | --- | --- |
| `ACCOUNTING_MONTH_REQUIRED` | No accounting month was supplied. | Select the month in `YYYY-MM` form, then upload or reconcile again. |
| `INVALID_ACCOUNTING_MONTH` | The value is not a valid zero-padded `YYYY-MM` month. | Correct the month selection and retry. |
| `ROOFTOP_PROFILE_UNSUPPORTED` | The selected store has no enabled reconciliation profile. | Select an enabled rooftop or complete evidence onboarding for that rooftop. |
| `SOURCE_FORMAT_UNSUPPORTED` | The detected format is not allowed by `acura-v1`. | Export the source as a supported CSV and upload it again. |
| `SOURCE_TYPE_UNCERTAIN` | The detected structure conflicts with the selected BOA/Dealertrack source type. | Select the matching source type or upload the correct export. |
| `SOURCE_PERIOD_MISMATCH` | A BOA statement banner proves a different month. | Select the banner month or upload the BOA statement for the selected month. |
| `SOURCE_PERIOD_CONTRADICTORY` | Source evidence contains conflicting BOA months or a Dealertrack date after month-end. | Export one consistent period, remove later-period Dealertrack rows when appropriate, or select the correct month. |
| `REQUIRED_COLUMNS_MISSING` | Required BOA or Dealertrack columns are absent. | Re-export with the required rooftop columns and upload again. |
| `ACURA_ACCOUNT_324_EMPTY` | No usable non-zero Dealertrack account-324 detail remains. | Re-export Dealertrack with account-324 detail rows and upload again. |
| `STRUCTURALLY_INVALID_TRANSACTIONS` | Parsing or preprocessing produced malformed or no valid transactions. | Correct the malformed/empty export and upload it again. |
| `RECONCILIATION_SOURCE_MISSING` | A selected source-file record does not exist. | Select an existing source for the store and month. |
| `RECONCILIATION_SOURCE_TYPE_MISMATCH` | The selected IDs are not one BOA and one Dealertrack source. | Put the BOA ID in `boa_source_file_id` and the Dealertrack ID in `dealertrack_source_file_id`. |
| `RECONCILIATION_STORE_MISMATCH` | The two sources do not belong to the selected store. | Select both sources from the same store. |
| `RECONCILIATION_SOURCE_IDENTITY_MISMATCH` | Month, profile identity/version, or stored processing provenance differs. | Select a matching source pair or re-upload both files under the selected month and current profile. |
| `RECONCILIATION_ARTIFACTS_UNAVAILABLE` | The run is not in `completed` or `completed_auto`. | Resolve the failed/pending run and create a successful complete run before downloading. |

Authorization failures such as `STORE_ACCESS_DENIED` or `DEALERSHIP_MISMATCH` are not recoverable by changing file contents. Use an account authorized for the selected store and dealership.

## Duplicate uploads and run identity

A healthy immutable source file is reused only when all processing identity fields match: dealership, store, source type, accounting month, rooftop profile ID/version, source SHA-256, parser name/version, and preprocessor name/version. The upload response sets `reused_existing_file: true` and returns the stored preprocessing receipt, including its removed-row audit.

The same bytes under a different month, profile version, parser version, or preprocessor version are a distinct source identity. A matching but unhealthy source is reprocessed instead of reused.

Starting reconciliation is different from uploading. Every manual reconciliation creates a new run ID, even when it references the same two immutable source files.

## Required artifacts and downloads

A successful Acura run persists exactly this six-artifact batch:

| Artifact type | Contents |
| --- | --- |
| `RAW_BOA` | Original accepted BOA upload bytes. |
| `RAW_DEALERTRACK` | Original accepted Dealertrack upload bytes. |
| `CLEANED_BOA` | Normalized BOA transactions after auditable removals. |
| `CLEANED_DEALERTRACK` | Normalized account-324 transactions after auditable removals. |
| `MERGED_FLOORPLAN` | Eight-column side-by-side reconciliation detail. |
| `FP_REC` | Compact four-column Acura accounting workpaper. |

Artifact generation is all-or-none. A run remains `artifact_pending` while the batch is built and becomes `completed` or `completed_auto` only after all six artifacts persist. A batch failure leaves no partial artifacts and sets `artifact_failed`.

Normal downloads use the stored artifacts. `GET /reconciliation-runs/:id/artifacts` lists metadata, and `GET /artifacts/:artifactId/download` returns authorized stored bytes. The run-specific `merged-floorplan` and `fp-rec` routes serve the corresponding stored outputs for a completed run. Pending and failed runs expose no final download.

## Reading the FP REC totals

- `Outstanding STMT` is the retained BOA ending-balance total.
- `Total GL` is the signed Dealertrack account-324 total. Imported GL values remain negative.
- `Difference = Outstanding STMT + Total GL`.
- `On schedule-not on statement` contains Dealertrack-only exceptions.
- `On statement-not on GL` contains BOA-only exceptions.
- `Net adjustments = schedule-only subtotal + statement-only subtotal`.
- `Variance = Net adjustments - Difference`.

A zero `Variance` means the source-side exceptions explain the statement/GL difference. It does not mean that there were no exceptions. Review each exception section and the removed-row receipt before treating the workpaper as operationally complete.
