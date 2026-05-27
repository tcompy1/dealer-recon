/**
 * Dealertrack floorplan preprocessing.
 *
 * Mirrors the Hiley office-manager Excel preprocessing pass for Dealertrack
 * 2100 floorplan schedules:
 *
 *   - prefer the `2100` four-digit account column as the canonical amount.
 *     If 2100 exists but is zero, fall back to the next non-zero four-digit
 *     account column and record the fall-through in diagnostics.
 *   - extract VIN from the Description, compute VIN6, normalize stock/control
 *   - surface dirty / missing / untrusted VIN rows as manual_enrichment_required
 *   - sort retained rows by 2100 amount descending, then VIN6 ascending
 *
 * As with BOA preprocessing, every transformation is captured in the
 * per-row lineage and the file-level diagnostics list.
 */

import { parseAmountToCents } from "../../domain/money.js";
import type { NewTransaction, ValidationError } from "../../domain/types.js";
import { computeVin6, extractVin6FromDescription } from "../../domain/vin6.js";
import type { ParsedTable } from "../parsers/types.js";
import {
  LINEAGE_RAW_DATA_KEY,
  PREPROCESSING_VERSION,
  type PreprocessingDiagnostic,
  type PreprocessingResult,
  type PreprocessingSummary,
  type RawDataLineage,
  type RowLineageEntry,
  type VinProvenance,
} from "./types.js";

const VIN_FULL_RE = /\b(?=[A-HJ-NPR-Z0-9]{17}\b)(?=[A-HJ-NPR-Z0-9]*[A-Z])(?=[A-HJ-NPR-Z0-9]*\d)[A-HJ-NPR-Z0-9]{17}\b/i;
const STOCK_RE = /\bM\d{3,6}\b/i;
const CANONICAL_2100 = "2100";
const FOUR_DIGIT_RE = /^\d{4}$/;

const CONTROL_ALIASES = ["control", "control#", "controlnumber", "stock", "stocknumber", "stockcontrol"];
const DESCRIPTION_ALIASES = ["description", "memo", "details", "vehicle"];
const VIN_ALIASES = ["vin", "vehicleidentificationnumber", "serial"];

type DealertrackWorkingRow = {
  sourceRowNumber: number;
  cells: string[];
  rawSnapshot: Record<string, string>;
  amountCents: number;
  amountSource: string;
  vin: string | null;
  vin6: string | null;
  vinProvenance: VinProvenance;
  stockNumber: string;
  description: string | null;
  lineage: RowLineageEntry[];
};

export function preprocessDealertrack(parsed: ParsedTable): PreprocessingResult {
  const diagnostics: PreprocessingDiagnostic[] = [];
  const validationErrors: ValidationError[] = [];
  let rowsScanned = 0;
  let rowsRemovedZero = 0;
  let rowsSkippedUnknown = 0;
  let rowsRequiringEnrichment = 0;

  for (const warning of parsed.warnings) {
    diagnostics.push({
      kind: "parser_warning",
      message: warning.message,
      source_row_number: null,
      details: warning.count !== undefined ? { count: warning.count, kind: warning.kind } : { kind: warning.kind },
    });
  }

  const header = parsed.header;
  const headerLookup = header ? buildHeaderLookup(header) : null;
  const fourDigitColumns = header ? findFourDigitColumns(header) : [];
  const has2100 = fourDigitColumns.some(({ name }) => name === CANONICAL_2100);

  if (header) {
    diagnostics.push({
      kind: "header_row_detected",
      message: has2100
        ? "Header row detected; 2100 account column present."
        : "Header row detected; no 2100 column present.",
      source_row_number: 1,
      details: { has_2100: has2100, four_digit_columns: fourDigitColumns.length },
    });
  }

  const acceptedRows: DealertrackWorkingRow[] = [];

  parsed.rows.forEach((rawRow, index) => {
    rowsScanned += 1;
    const sourceRowNumber = index + (header ? 2 : 1);
    const cleaned = rawRow.map(cleanCell);
    if (cleaned.every((cell) => cell.length === 0)) {
      rowsSkippedUnknown += 1;
      diagnostics.push({
        kind: "row_skipped_unknown_structure",
        message: "Empty row encountered.",
        source_row_number: sourceRowNumber,
      });
      return;
    }

    const rawSnapshot = buildRawSnapshot(cleaned, header);
    const lineage: RowLineageEntry[] = [{ stage: "raw_parsed" }];

    const control = headerLookup
      ? findCellByAliases(cleaned, headerLookup, CONTROL_ALIASES)
      : cleaned[0] ?? "";
    const stockNumber = normalizeStock(control);
    if (!stockNumber) {
      rowsSkippedUnknown += 1;
      diagnostics.push({
        kind: "row_skipped_unknown_structure",
        message: "Row removed: no recognizable stock/control number.",
        source_row_number: sourceRowNumber,
      });
      return;
    }
    lineage.push({ stage: "stock_normalized", detail: stockNumber });

    const amountInfo = resolveDealertrackAmount(cleaned, header, fourDigitColumns);
    if (amountInfo === null) {
      rowsSkippedUnknown += 1;
      diagnostics.push({
        kind: "missing_amount",
        message: "Row removed: no Dealertrack amount could be located.",
        source_row_number: sourceRowNumber,
        stock_number: stockNumber,
      });
      validationErrors.push({
        row: sourceRowNumber,
        field: "amount",
        message: "Dealertrack amount is missing or invalid.",
      });
      return;
    }
    if (amountInfo.amountCents === 0) {
      rowsRemovedZero += 1;
      diagnostics.push({
        kind: "zero_balance_row_removed",
        message: "Zero-amount Dealertrack row removed.",
        source_row_number: sourceRowNumber,
        stock_number: stockNumber,
      });
      return;
    }
    lineage.push({ stage: "amount_resolved", detail: amountInfo.source });
    if (amountInfo.source !== CANONICAL_2100 && has2100) {
      diagnostics.push({
        kind: "ambiguous_amount_column",
        message: `2100 column was zero/blank — used ${amountInfo.source} column instead.`,
        source_row_number: sourceRowNumber,
        stock_number: stockNumber,
      });
    }

    const description = headerLookup
      ? findCellByAliases(cleaned, headerLookup, DESCRIPTION_ALIASES)
      : cleaned[1] ?? null;

    const vinFromColumn = headerLookup ? findCellByAliases(cleaned, headerLookup, VIN_ALIASES) : null;
    const vinMatch =
      (vinFromColumn && vinFromColumn.match(VIN_FULL_RE)?.[0]) ??
      (description ? description.match(VIN_FULL_RE)?.[0] : null) ??
      findPatternValue(cleaned, VIN_FULL_RE);

    let vin: string | null = null;
    let vin6: string | null = null;
    let vinProvenance: VinProvenance;

    if (vinMatch) {
      vin = vinMatch.toUpperCase();
      vin6 = computeVin6(vin);
      vinProvenance = {
        source: vinFromColumn ? "raw_vin_column" : "description_extraction",
        vin,
        vin6,
        trusted: true,
        note: null,
      };
      lineage.push({ stage: "vin_extracted", detail: vinProvenance.source });
    } else {
      const descVin6 = extractVin6FromDescription(description);
      if (descVin6) {
        vin6 = descVin6;
        vinProvenance = {
          source: "description_extraction",
          vin: null,
          vin6: descVin6,
          trusted: false,
          note: "Partial VIN — only 17-character substring matched; treated as untrusted.",
        };
        rowsRequiringEnrichment += 1;
        diagnostics.push({
          kind: "untrusted_vin",
          message: "Dealertrack VIN6 reconstructed from description; manual enrichment recommended.",
          source_row_number: sourceRowNumber,
          stock_number: stockNumber,
          vin6: descVin6,
        });
        lineage.push({ stage: "vin_extracted", detail: "description_extraction_untrusted" });
      } else {
        vinProvenance = {
          source: "untrusted",
          vin: null,
          vin6: null,
          trusted: false,
          note: "No VIN parsed from row; row requires DMS-assisted reconstruction.",
        };
        rowsRequiringEnrichment += 1;
        diagnostics.push({
          kind: "manual_enrichment_required",
          message: "Dealertrack row has no parseable VIN; requires DMS-assisted reconstruction.",
          source_row_number: sourceRowNumber,
          stock_number: stockNumber,
        });
        lineage.push({ stage: "vin_enrichment_required" });
      }
    }

    if (vin6) {
      lineage.push({ stage: "vin6_computed", detail: vin6 });
    }

    acceptedRows.push({
      sourceRowNumber,
      cells: cleaned,
      rawSnapshot,
      amountCents: amountInfo.amountCents,
      amountSource: amountInfo.source,
      vin,
      vin6,
      vinProvenance,
      stockNumber,
      description,
      lineage,
    });
  });

  // duplicate VIN6 detection
  const vin6Counts = new Map<string, number>();
  for (const row of acceptedRows) {
    if (row.vin6) {
      vin6Counts.set(row.vin6, (vin6Counts.get(row.vin6) ?? 0) + 1);
    }
  }
  let duplicateVin6Count = 0;
  for (const [vin6, count] of vin6Counts) {
    if (count > 1) {
      duplicateVin6Count += 1;
      diagnostics.push({
        kind: "duplicate_vin",
        message: `Duplicate VIN6 observed: ${vin6} appears ${count} times.`,
        source_row_number: null,
        vin6,
        details: { count },
      });
      for (const row of acceptedRows) {
        if (row.vin6 === vin6) {
          row.lineage.push({ stage: "duplicate_vin_observed", detail: `count=${count}` });
        }
      }
    }
  }

  // deterministic sort: amount desc, vin6 asc
  acceptedRows.sort((a, b) => {
    if (a.amountCents !== b.amountCents) {
      return b.amountCents - a.amountCents;
    }
    const va = a.vin6 ?? "";
    const vb = b.vin6 ?? "";
    if (va !== vb) {
      return va < vb ? -1 : 1;
    }
    return a.sourceRowNumber - b.sourceRowNumber;
  });
  for (const row of acceptedRows) {
    row.lineage.push({ stage: "sorted", detail: "amount_desc_then_vin6_asc" });
  }
  diagnostics.push({
    kind: "sort_applied",
    message: "Rows sorted descending by 2100 amount, then VIN6 ascending.",
    source_row_number: null,
  });

  const transactions: NewTransaction[] = acceptedRows.map((row) => {
    const lineage: RawDataLineage = {
      source_kind: "dealertrack",
      preprocessing_version: PREPROCESSING_VERSION,
      source_row_number: row.sourceRowNumber,
      raw_row_snapshot: row.rawSnapshot,
      transformations: row.lineage,
      retained_reason: "non_zero_amount",
      vin_provenance: row.vinProvenance,
      maturity_date: null,
    };
    return {
      source_file_id: null,
      source_type: "dealertrack",
      transaction_date: null,
      post_date: null,
      amount_cents: row.amountCents,
      reference_number: null,
      description: row.description,
      account: null,
      account_type: "floorplan",
      account_identifier: "floorplan",
      stock_number: row.stockNumber,
      vin: row.vin,
      raw_data: {
        ...row.rawSnapshot,
        [LINEAGE_RAW_DATA_KEY]: lineage,
      },
    };
  });

  const summary: PreprocessingSummary = {
    source_kind: "dealertrack",
    preprocessing_version: PREPROCESSING_VERSION,
    parser_version: "dealertrack-xml-v1",
    parser_format: "xml_spreadsheet",
    rows_scanned: rowsScanned,
    rows_accepted: transactions.length,
    rows_removed_zero_balance: rowsRemovedZero,
    rows_removed_straightline: 0,
    rows_removed_banner: 0,
    rows_skipped_unknown: rowsSkippedUnknown,
    rows_requiring_manual_enrichment: rowsRequiringEnrichment,
    duplicate_vin6_count: duplicateVin6Count,
    preprocessed_at: new Date().toISOString(),
  };

  return { transactions, validationErrors, diagnostics, summary };
}

function cleanCell(value: string | undefined): string {
  return (value ?? "").replace(/^\s+|\s+$/g, "").replace(/^"|"$/g, "").trim();
}

function buildRawSnapshot(cells: string[], header: string[] | null): Record<string, string> {
  const snap: Record<string, string> = {};
  cells.forEach((value, index) => {
    const key = header?.[index]?.trim() || `column_${index}`;
    snap[key] = value;
  });
  return snap;
}

function buildHeaderLookup(header: string[]): Map<string, number> {
  const lookup = new Map<string, number>();
  header.forEach((name, index) => {
    lookup.set(normalizeHeaderName(name), index);
  });
  return lookup;
}

function normalizeHeaderName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findCellByAliases(
  cells: string[],
  headerLookup: Map<string, number>,
  aliases: string[],
): string | null {
  for (const alias of aliases) {
    const idx = headerLookup.get(normalizeHeaderName(alias));
    if (idx === undefined) {
      continue;
    }
    const value = cleanCell(cells[idx]);
    if (value) {
      return value;
    }
  }
  return null;
}

function findFourDigitColumns(header: string[]): Array<{ name: string; index: number }> {
  return header
    .map((name, index) => ({ name: normalizeHeaderName(name), index }))
    .filter(({ name }) => FOUR_DIGIT_RE.test(name));
}

function resolveDealertrackAmount(
  cells: string[],
  header: string[] | null,
  fourDigitColumns: Array<{ name: string; index: number }>,
): { amountCents: number; source: string } | null {
  if (header && fourDigitColumns.length > 0) {
    const sorted = [...fourDigitColumns].sort((a, b) => {
      if (a.name === CANONICAL_2100) return -1;
      if (b.name === CANONICAL_2100) return 1;
      return a.name.localeCompare(b.name);
    });
    for (const { name, index } of sorted) {
      const cents = parseAmountToCents(cells[index]);
      if (cents !== null && cents !== 0) {
        return { amountCents: cents, source: name };
      }
    }
    for (const { name, index } of sorted) {
      const cents = parseAmountToCents(cells[index]);
      if (cents !== null) {
        return { amountCents: cents, source: name };
      }
    }
    return null;
  }

  // positional fallback: legacy DT CSV with no header
  const amountCents = parseAmountToCents(cells[2]);
  if (amountCents !== null) {
    return { amountCents, source: "positional_col_3" };
  }
  return null;
}

function findPatternValue(values: string[], pattern: RegExp): string | null {
  for (const value of values) {
    const m = value.match(pattern);
    if (m) {
      return m[0];
    }
  }
  return null;
}

function normalizeStock(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const cleaned = value.trim();
  if (!cleaned) {
    return null;
  }
  const match = cleaned.match(STOCK_RE);
  if (match) {
    return match[0].toUpperCase();
  }
  // Reject pure-letter offset rows like "BOA" / "BANK". Dealertrack vehicle
  // controls always contain at least one digit; alpha-only tokens are
  // statement offsets/headings, not stocks.
  if (/^[A-Z0-9]+$/i.test(cleaned) && /\d/.test(cleaned)) {
    return cleaned.toUpperCase();
  }
  return null;
}
