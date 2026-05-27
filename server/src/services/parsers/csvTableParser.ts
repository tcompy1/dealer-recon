/**
 * CSV-to-ParsedTable adapter.
 *
 * Source-specific CSV uploads (BOA billing statement CSV, Dealertrack 2100
 * schedule CSV) historically bypassed the deterministic preprocessing layer
 * because the parser router only handled SpreadsheetML and HTML-as-XLS. This
 * adapter parses a CSV upload into the same `ParsedTable` shape the rest of
 * the parser pipeline already understands so the existing source-specific
 * preprocessors can be reused unchanged.
 *
 * Returns header=null for BOA so banner-row detection can run; for
 * Dealertrack the first non-empty row is used as the header so the existing
 * 2100/2110 column lookup works as it does for the SpreadsheetML route.
 *
 * Source row numbers downstream are aligned with the 1-based row index of
 * the parsed CSV so diagnostics can be traced back to the original file.
 */

import { parse } from "csv-parse/sync";

import { CsvNormalizationError, MAX_CSV_ROWS } from "../transactionNormalizer.js";
import { type ParsedTable, type ParserWarning } from "./types.js";

export type CsvTableMode = "with_header" | "no_header";

const UTF8_BOM = "﻿";

export function parseCsvToTable(
  input: Buffer | string,
  mode: CsvTableMode,
): ParsedTable {
  const raw = Buffer.isBuffer(input) ? input.toString("utf8") : input;
  const text = raw.startsWith(UTF8_BOM) ? raw.slice(1) : raw;

  const warnings: ParserWarning[] = [];

  if (!text.trim()) {
    return {
      header: null,
      rows: [],
      warnings: [{ kind: "empty_document", message: "CSV input was empty." }],
    };
  }

  const lineCount = text.split(/\r\n|\r|\n/).length;
  if (lineCount > MAX_CSV_ROWS) {
    throw new CsvNormalizationError(
      `CSV row limit exceeded. Maximum rows: ${MAX_CSV_ROWS}.`,
      413,
    );
  }

  let rows: string[][];
  try {
    rows = parse(text, {
      relax_column_count: true,
      relax_quotes: true,
      skip_empty_lines: false,
      ltrim: true,
      trim: false,
    }) as string[][];
  } catch {
    throw new CsvNormalizationError("Malformed CSV file.");
  }

  if (mode === "no_header") {
    return { header: null, rows, warnings };
  }

  const headerIndex = rows.findIndex((row) => row.some((cell) => cell.trim().length > 0));
  if (headerIndex < 0) {
    return {
      header: null,
      rows: [],
      warnings: [{ kind: "empty_document", message: "CSV had no non-empty rows." }],
    };
  }
  const header = rows[headerIndex].map((cell) => cell.trim());
  return {
    header,
    rows: rows.slice(headerIndex + 1),
    warnings,
  };
}
