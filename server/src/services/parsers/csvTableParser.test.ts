import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import { ACURA_SANITIZED_FIXTURE_PATHS } from "../../testFixtures/acura/index.js";
import { CsvNormalizationError } from "../transactionNormalizer.js";

import { parseCsvToTable } from "./csvTableParser.js";

describe("parseCsvToTable", () => {
  test("returns no-header table preserving banner rows", () => {
    const csv = "Banner Line 1,,,\nLocation,VIN,Stock,Ending Balance\nstoreA,1FAKEVN0000A0001X,M0001,$1,234.00\n";
    const table = parseCsvToTable(csv, "no_header");
    expect(table.header).toBeNull();
    expect(table.rows.length).toBe(3);
    expect(table.rows[0][0]).toBe("Banner Line 1");
    expect(table.rows[1][0]).toBe("Location");
  });

  test("returns with-header table promoting the first non-empty row", () => {
    const csv = "Control,Description,2100,2110\nM10001,FLOORPLAN ADV 1FAKEVN0000A0001X,-25000,0\n";
    const table = parseCsvToTable(csv, "with_header");
    expect(table.header).toEqual(["Control", "Description", "2100", "2110"]);
    expect(table.rows[0]).toEqual(["M10001", "FLOORPLAN ADV 1FAKEVN0000A0001X", "-25000", "0"]);
  });

  test("strips UTF-8 BOM", () => {
    const csv = "﻿Control,Description,2100\nM1,FOO,-100\n";
    const table = parseCsvToTable(csv, "with_header");
    expect(table.header?.[0]).toBe("Control");
  });

  test("returns empty warning for blank input", () => {
    const table = parseCsvToTable("", "with_header");
    expect(table.warnings[0]?.kind).toBe("empty_document");
    expect(table.rows).toEqual([]);
  });

  test("parses both sanitized Acura source fixtures without raw-evidence access", () => {
    const boa = parseCsvToTable(
      readFileSync(ACURA_SANITIZED_FIXTURE_PATHS.boaCsv),
      "no_header",
    );
    const dealertrack = parseCsvToTable(
      readFileSync(ACURA_SANITIZED_FIXTURE_PATHS.dealertrackCsv),
      "with_header",
    );

    expect(boa.rows[0]).toEqual(["Synthetic Acura BOA April 2026"]);
    expect(boa.rows[2]?.slice(0, 3)).toEqual([
      "Serial No/VIN",
      "Stock/Lease No",
      "Description",
    ]);
    expect(dealertrack.header).toEqual(["Control", "Description", "324", "999"]);
  });

  test("rejects a malformed CSV with an unclosed quoted field", () => {
    expect(() => parseCsvToTable('Control,Description,324\nM50001,"unterminated,-100.00\n', "with_header"))
      .toThrow(CsvNormalizationError);
  });

  test("returns the parsed header so missing required source columns remain structural evidence", () => {
    const parsed = parseCsvToTable(
      "Control,Description,999\nM50001,Synthetic row,-100.00\n",
      "with_header",
    );

    expect(parsed.header).toEqual(["Control", "Description", "999"]);
    expect(parsed.header).not.toContain("324");
    expect(parsed.warnings).toEqual([]);
  });
});
