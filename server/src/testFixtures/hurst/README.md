# Invented Hurst test data

The reprocessing CSV was authored from a two-row test specification, not anonymized from client transactions. It contains -123456 and -20000 cents, distinct invented full identifiers, consistent VIN6 values, invented controls/descriptions, and the BOM/quoted account-header shape under test.

The shared `sample-data/hurst-synthetic.csv` is independently invented: FEB26 has 2 matches and 1 DT-only row; MAR26 has 1 match and one exception on each side; APRIL26 has 1 match, 2 exceptions on each side, and 1 amount-mismatch pair. Ordinary tests assert their own exact amounts. Historical population checks live only in explicitly enabled protected Hurst acceptance.
