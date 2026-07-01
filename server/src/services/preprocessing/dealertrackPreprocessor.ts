/**
 * Dealertrack floorplan preprocessing.
 *
 * Mirrors the Hiley office-manager Excel preprocessing pass for Dealertrack
 * 2100 floorplan schedules:
 *
 *   - use the configured account amount column or columns as the canonical GL
 *     amount (`2100` by default for Hurst, `324` for Acura, and
 *     `2100 + 2101 + 2101S` for FW).
 *     Excluded account columns such as 2110 are removed from the working
 *     output and are never used as fallback amounts.
 *   - remove Straightline rows
 *   - extract VIN from the Description, compute VIN6, normalize stock/control
 *   - surface dirty / missing / untrusted VIN rows as manual_enrichment_required
 *   - sort retained rows by largest configured-account balance, then VIN6 ascending
 *   - retain worksheet helper columns matching the manual DT workflow
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
const DEFAULT_CANONICAL_ACCOUNT = "2100";
const DEFAULT_REMOVED_ACCOUNT = "2110";
const FOUR_DIGIT_RE = /^\d{4}$/;
const STRAIGHTLINE_TOKENS = ["straightline", "straight line"];

const CONTROL_ALIASES = ["control", "control#", "controlnumber", "stock", "stocknumber", "stockcontrol"];
const DESCRIPTION_ALIASES = ["description", "memo", "details", "vehicle"];
const VIN_ALIASES = ["vin", "vehicleidentificationnumber", "serial"];

type DealertrackAmountInfo = {
  amountCents: number;
  source: string;
  accountAmountCents: number;
  removedAccountCents: number;
};

type DealertrackWorkingRow = {
  sourceRowNumber: number;
  cells: string[];
  rawSnapshot: Record<string, string>;
  amountCents: number;
  amountSource: string;
  accountColumn: string;
  accountLabel: string;
  accountAmountCents: number;
  removedAccountCents: number;
  vin: string | null;
  vin6: string | null;
  vinProvenance: VinProvenance;
  stockNumber: string;
  description: string | null;
  lineage: RowLineageEntry[];
};

export type DealertrackPreprocessOptions = {
  amountColumns?: string[];
  accountColumn?: string;
  accountLabel?: string;
  excludedAccountColumns?: string[];
  removedAccountColumns?: string[];
};

export function preprocessDealertrack(
  parsed: ParsedTable,
  options: DealertrackPreprocessOptions = {},
): PreprocessingResult {
  const requestedAmountColumns =
    options.amountColumns && options.amountColumns.length > 0
      ? options.amountColumns
      : [options.accountColumn ?? DEFAULT_CANONICAL_ACCOUNT];
  const amountColumns = uniqueNormalizedAccountColumns(requestedAmountColumns);
  const amountSource = requestedAmountColumns.map((column) => cleanCell(column)).join("+");
  const accountColumn = normalizeAccountHeaderName(
    options.accountColumn ?? requestedAmountColumns[0] ?? DEFAULT_CANONICAL_ACCOUNT,
  );
  const accountLabel =
    options.accountLabel?.trim() || cleanCell(options.accountColumn ?? requestedAmountColumns[0]);
  const removedAccountColumns = new Set(
    (
      options.excludedAccountColumns ??
      options.removedAccountColumns ??
      defaultRemovedAccountColumns(amountColumns)
    )
      .map(normalizeAccountHeaderName),
  );
  const diagnostics: PreprocessingDiagnostic[] = [];
  const validationErrors: ValidationError[] = [];
  let rowsScanned = 0;
  let rowsRemovedZero = 0;
  let rowsRemovedStraightline = 0;
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
  const accountColumns = header ? findAccountColumns(header, amountColumns, removedAccountColumns) : [];
  const missingAmountColumns = amountColumns.filter(
    (amountColumn) => !accountColumns.some(({ name }) => name === amountColumn),
  );
  const hasConfiguredAccount = missingAmountColumns.length === 0;
  const removedColumnsPresent = accountColumns.filter(({ name }) => removedAccountColumns.has(name));

  if (header) {
    diagnostics.push({
      kind: "header_row_detected",
      message: hasConfiguredAccount
        ? `Header row detected; ${amountSource} account amount column(s) present.`
        : `Header row detected; missing account amount column(s): ${missingAmountColumns.join(", ")}.`,
      source_row_number: 1,
      details: {
        account_column: accountColumn,
        amount_columns: amountColumns.join(","),
        has_account_column: hasConfiguredAccount,
        has_amount_columns: hasConfiguredAccount,
        missing_amount_columns: missingAmountColumns.join(","),
        removed_account_columns_present: removedColumnsPresent.length,
        account_columns: accountColumns.length,
        four_digit_columns: accountColumns.filter(({ name }) => FOUR_DIGIT_RE.test(name)).length,
      },
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
    const rowText = cleaned.join(" ").toLowerCase();

    if (STRAIGHTLINE_TOKENS.some((token) => rowText.includes(token))) {
      rowsRemovedStraightline += 1;
      diagnostics.push({
        kind: "straightline_row_removed",
        message: "Straightline Dealertrack row removed.",
        source_row_number: sourceRowNumber,
      });
      return;
    }

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

    const amountInfo = resolveDealertrackAmount(
      cleaned,
      header,
      accountColumns,
      amountColumns,
      amountSource,
      removedAccountColumns,
    );
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
      accountColumn: accountLabel,
      accountLabel,
      accountAmountCents: amountInfo.accountAmountCents,
      removedAccountCents: amountInfo.removedAccountCents,
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

  // deterministic sort: largest balance first, vin6 asc
  acceptedRows.sort((a, b) => {
    const magnitudeDelta = Math.abs(b.amountCents) - Math.abs(a.amountCents);
    if (magnitudeDelta !== 0) {
      return magnitudeDelta;
    }
    const va = a.vin6 ?? "";
    const vb = b.vin6 ?? "";
    if (va !== vb) {
      return va < vb ? -1 : 1;
    }
    return a.sourceRowNumber - b.sourceRowNumber;
  });
  for (const row of acceptedRows) {
    row.lineage.push({ stage: "sorted", detail: `largest_${amountSource}_then_vin6_asc` });
  }
  diagnostics.push({
    kind: "sort_applied",
    message: `Rows sorted largest-to-smallest by ${amountSource} balance, then VIN6 ascending.`,
    source_row_number: null,
  });

  const transactions: NewTransaction[] = acceptedRows.map((row, index) => {
    row.lineage.push({
      stage: "working_columns_pruned",
      detail: `hiley_dealertrack_${row.accountLabel}_from_${row.amountSource}_without_removed_accounts`,
    });
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
      account: row.accountColumn,
      account_type: "floorplan",
      account_identifier: "floorplan",
      stock_number: row.stockNumber,
      vin: row.vin,
      raw_data: {
        ...buildWorkingOutputSnapshot(row, index + 2),
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
    rows_removed_straightline: rowsRemovedStraightline,
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

function findAccountColumns(
  header: string[],
  amountColumns: string[],
  removedAccountColumns: Set<string>,
): Array<{ name: string; index: number }> {
  const amountColumnSet = new Set(amountColumns);
  return header
    .map((name, index) => ({ name: normalizeAccountHeaderName(name), index }))
    .filter(
      ({ name }) =>
        FOUR_DIGIT_RE.test(name) ||
        amountColumnSet.has(name) ||
        removedAccountColumns.has(name),
    );
}

function normalizeAccountHeaderName(value: string): string {
  const numeric = cleanCell(value).replace(/[$,\s]/g, "");
  if (/^\d+(?:\.0+)?$/.test(numeric)) {
    return numeric.replace(/\.0+$/, "");
  }
  return normalizeHeaderName(value);
}

function uniqueNormalizedAccountColumns(values: string[]): string[] {
  const columns: string[] = [];
  for (const value of values) {
    const normalized = normalizeAccountHeaderName(value);
    if (normalized && !columns.includes(normalized)) {
      columns.push(normalized);
    }
  }
  return columns.length > 0 ? columns : [DEFAULT_CANONICAL_ACCOUNT];
}

function defaultRemovedAccountColumns(amountColumns: string[]): string[] {
  return amountColumns.includes(DEFAULT_CANONICAL_ACCOUNT) ? [DEFAULT_REMOVED_ACCOUNT] : [];
}

function resolveDealertrackAmount(
  cells: string[],
  header: string[] | null,
  accountColumns: Array<{ name: string; index: number }>,
  amountColumns: string[],
  amountSource: string,
  removedAccountColumns: Set<string>,
): DealertrackAmountInfo | null {
  if (header && accountColumns.length > 0) {
    const amountColumnIndexes: number[] = [];
    for (const amountColumn of amountColumns) {
      const amountColumnIndex = accountColumns.find(({ name }) => name === amountColumn)?.index;
      if (amountColumnIndex === undefined) {
        return null;
      }
      amountColumnIndexes.push(amountColumnIndex);
    }

    let accountAmountCents = 0;
    for (const accountIndex of amountColumnIndexes) {
      const amount = parseRequiredAccountAmount(cells[accountIndex]);
      if (amount === null) {
        return null;
      }
      accountAmountCents += amount;
    }

    const removedAccountCents = accountColumns
      .filter(({ name }) => removedAccountColumns.has(name))
      .reduce((total, { index }) => total + parseOptionalAccountAmount(cells[index]), 0);
    return {
      amountCents: accountAmountCents,
      source: amountSource,
      accountAmountCents,
      removedAccountCents,
    };
  }

  // positional fallback: legacy DT CSV with no header
  const amountCents = parseAmountToCents(cells[2]);
  if (amountCents !== null) {
    return {
      amountCents,
      source: "positional_col_3",
      accountAmountCents: amountCents,
      removedAccountCents: parseOptionalAccountAmount(cells[3]),
    };
  }
  return null;
}

function parseRequiredAccountAmount(value: string | undefined): number | null {
  const cleaned = cleanCell(value);
  if (!cleaned) {
    return 0;
  }
  return parseAmountToCents(cleaned);
}

function parseOptionalAccountAmount(value: string | undefined): number {
  const cents = parseAmountToCents(cleanCell(value));
  return cents ?? 0;
}

function buildWorkingOutputSnapshot(
  row: DealertrackWorkingRow,
  workingRowNumber: number,
): Record<string, string> {
  return {
    Control: row.stockNumber,
    [row.accountLabel]: formatAccountingCents(row.accountAmountCents),
    "DT total helper": `=D${workingRowNumber} + E${workingRowNumber}`,
    "VIN6 description variance/helper": `=C${workingRowNumber} - F${workingRowNumber}`,
    VIN6: row.vin6 ?? "",
    Description: row.description ?? "",
  };
}

function formatAccountingCents(amountCents: number): string {
  const absCents = Math.abs(amountCents);
  const dollars = Math.floor(absCents / 100);
  const cents = String(absCents % 100).padStart(2, "0");
  const dollarsWithCommas = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (amountCents < 0) {
    return `(${dollarsWithCommas}.${cents})`;
  }
  return `${dollarsWithCommas}.${cents}`;
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
