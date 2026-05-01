# Convert Dealertrack XLSX to CSV

The local reconciliation script reads CSV files. If Dealertrack provides an `.xlsx` export such as:

```text
FLOORPLAN RECON - 2026-04-30T144427.635.XLS.xlsx
```

convert it locally before running reconciliation.

## Install ssconvert

On Ubuntu/WSL:

```bash
sudo apt-get update
sudo apt-get install gnumeric
```

## Convert

From the directory containing the Dealertrack export:

```bash
ssconvert "FLOORPLAN RECON - 2026-04-30T144427.635.XLS.xlsx" dealertrack.csv
```

Then run the local reconciliation helper from the repo root:

```bash
python scripts/run_floorplan_recon.py \
  --boa-file "/path/to/BillingStatementMarch2026 (6).csv" \
  --dealertrack-file "/path/to/dealertrack.csv"
```

Keep real client files outside the repo. Do not commit exported BOA or Dealertrack files.
