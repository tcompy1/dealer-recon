Steps for cleaning BOA Floorplan Export

- Remove Headers
- Remove columns location, manufacturer name, plant name, invoice date, invoice number, interest start date

- sort by maturity date
- if three are any current month on Maturity date column, they get tracked down to be paid off.
- if nothing current delete maturity date column
- current = actuual month not reconciliation month
- remove columns: type, model #, stock/lease #, original amount, beginning balance, advances, last advance date, principal payments, principal adjustments
- keep ending balance
- remove all columns after ending balance
- highlight table, sort, custom sort, data has headers, sort by ending balance smallest to largest, then by VIN6 A to Z.
- remove zero balances
- remove straight line
- auto sum total of ending balance