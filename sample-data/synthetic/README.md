# Synthetic real-export fixtures

These fixtures are shape-preserving stand-ins for the real exports observed in
the Hiley floorplan workflow. They are committed so parser tests can run in
CI without copying real customer data into the repository.

Rules:

- No real VINs, dollar amounts, account numbers, employee names, customer
  data, or row-level comments appear in any fixture in this directory.
- VIN-shaped tokens (17 alphanumeric characters, no `I`/`O`/`Q`) are fake
  identifiers, not real-world VINs.
- Dollar amounts and dates are arbitrary and round.
- The fixtures preserve the structural quirks that drive parser behavior:
  banner rows above the header for BOA, `ss:Index` gaps and one deliberately
  unclosed `<Row>` for Dealertrack SpreadsheetML, embedded-VIN tokens in
  description text.

Real exports stay in `/home/user/workspace/` outside the repository.
