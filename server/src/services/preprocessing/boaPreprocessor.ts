/**
 * BOA floorplan preprocessing.
 *
 * Mirrors the Hiley office-manager Excel preprocessing pass for BOA billing
 * statements:
 *
 *   - locate the real header row (banner / account / period rows above it
 *     are recorded as banner_row_removed diagnostics, not silently dropped)
 *   - treat Ending Balance as the canonical BOA amount; do not let
 *     Original Amount win even if it appears first
 *   - drop zero-balance rows (recorded as zero_balance_row_removed)
 *   - drop Straightline rows (recorded as straightline_row_removed)
 *   - extract VIN, compute VIN6, evaluate maturity date against the actual
 *     current calendar month for payoff review
 *   - prune retained working columns to the Hiley worksheet shape
 *   - sort the retained rows by ending balance ascending, then VIN6 ascending
 *   - calculate the retained Ending Balance autosum
 *
 * Every transformation is recorded both in the per-row lineage attached to
 * raw_data and in the file-level diagnostics list returned to the caller.
 */

import { formatCents, parseAmountToCents } from "../../domain/money.js";
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
const STOCK_RE = /\bM\d{4,6}\b/i;
const STRAIGHTLINE_TOKENS = ["straightline", "straight line"];

const HEADER_FINGERPRINT_TOKENS = [
  "vin",
  "serial",
  "stock",
  "lease",
  "invoice",
  "original amount",
  "principal",
  "balance",
  "interest",
  "fee",
  "payment",
  "maturity",
];
const HEADER_MIN_HITS = 3;
const MAX_HEADER_SEARCH_ROWS = 25;

const ENDING_BALANCE_ALIASES = ["ending balance", "ending bal", "endbalance"];
const ORIGINAL_AMOUNT_ALIASES = [
  "original amount",
  "originalamount",
  "principal balance",
  "beginning balance",
  "amount",
];
const VIN_COLUMN_ALIASES = [
  "vin",
  "vin / serial number",
  "vinserialnumber",
  "serial",
  "serial number",
];
const STOCK_COLUMN_ALIASES = [
  "stock",
  "stock number",
  "stocknumber",
  "stock / lease number",
  "stockleasenumber",
  "stock #",
];
const DESCRIPTION_ALIASES = ["description", "memo", "details"];
const MATURITY_ALIASES = ["maturity date", "maturity", "matures"];
const TRANSACTION_DATE_ALIASES = ["invoice date", "transaction date", "date"];
const WORKING_OUTPUT_REMOVED_COLUMN_ALIASES = [
  "location",
  "manufacturer name",
  "manufacturer",
  "mfr name",
  "plant name",
  "plant",
  "invoice date",
  "invoice number",
  "invoice #",
  "interest start date",
  "type",
  "model #",
  "model number",
  "model no",
  "model",
  "stock/lease #",
  "stock / lease #",
  "stock/lease no",
  "stock / lease no",
  "stock/lease number",
  "stock / lease number",
  "stock number",
  "stock #",
  "original amount",
  "beginning balance",
  "advances",
  "last advance date",
  "principal payment",
  "principal payments",
  "principal adjustment",
  "principal adjustments",
];

export type BoaPreprocessOptions = {
  now?: Date;
};

type BoaWorkingRow = {
  sourceRowNumber: number;
  cells: string[];
  rawSnapshot: Record<string, string>;
  amountCents: number;
  endingBalanceCents: number | null;
  originalAmountCents: number | null;
  vin: string | null;
  vin6: string | null;
  vinProvenance: VinProvenance;
  stockNumber: string | null;
  description: string | null;
  transactionDate: string | null;
  maturityDate: string | null;
  lineage: RowLineageEntry[];
};

export function preprocessBoa(
  parsed: ParsedTable,
  options: BoaPreprocessOptions = {},
): PreprocessingResult {
  const diagnostics: PreprocessingDiagnostic[] = [];
  const validationErrors: ValidationError[] = [];
  const currentCalendarMonth = monthKey(options.now ?? new Date());
  let rowsScanned = 0;
  let rowsRemovedBanner = 0;
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

  let header = parsed.header;
  let dataStartIndex = 0;
  let bannerOffset = 0;

  if (!header) {
    const located = locateHeaderInRows(parsed.rows);
    if (located) {
      header = located.header;
      bannerOffset = located.index;
      for (let i = 0; i < located.index; i += 1) {
        rowsScanned += 1;
        rowsRemovedBanner += 1;
        diagnostics.push({
          kind: "banner_row_removed",
          message: "Banner row removed during header detection.",
          source_row_number: i + 1,
        });
      }
      diagnostics.push({
        kind: "header_row_detected",
        message: "Header row detected by fingerprint scan.",
        source_row_number: located.index + 1,
      });
      dataStartIndex = located.index + 1;
    }
  } else {
    diagnostics.push({
      kind: "header_row_detected",
      message: "Header row supplied by parser.",
      source_row_number: 1,
    });
  }

  const headerLookup = header ? buildHeaderLookup(header) : null;
  const dataRows = header ? parsed.rows.slice(dataStartIndex) : parsed.rows;

  const acceptedRows: BoaWorkingRow[] = [];

  dataRows.forEach((rawRow, index) => {
    const sourceRowNumber = bannerOffset + dataStartIndex + index + 1;
    rowsScanned += 1;

    const cleaned = rawRow.map(cleanCell);
    if (cleaned.every((cell) => cell.length === 0)) {
      // entirely empty row — silent skip but counted
      rowsSkippedUnknown += 1;
      diagnostics.push({
        kind: "row_skipped_unknown_structure",
        message: "Empty row encountered after header.",
        source_row_number: sourceRowNumber,
      });
      return;
    }

    const rawSnapshot = buildRawSnapshot(cleaned, header);
    const rowText = cleaned.join(" ").toLowerCase();
    const lineage: RowLineageEntry[] = [{ stage: "raw_parsed" }];

    if (looksLikeTotalsRow(rowText)) {
      rowsRemovedBanner += 1;
      diagnostics.push({
        kind: "banner_row_removed",
        message: "Subtotal/total row removed.",
        source_row_number: sourceRowNumber,
      });
      return;
    }

    if (STRAIGHTLINE_TOKENS.some((token) => rowText.includes(token))) {
      rowsRemovedStraightline += 1;
      diagnostics.push({
        kind: "straightline_row_removed",
        message: "Straightline row removed.",
        source_row_number: sourceRowNumber,
      });
      return;
    }

    const endingBalanceCents = headerLookup
      ? findAmountByAliases(cleaned, headerLookup, ENDING_BALANCE_ALIASES)
      : null;
    const originalAmountCents = headerLookup
      ? findAmountByAliases(cleaned, headerLookup, ORIGINAL_AMOUNT_ALIASES)
      : null;

    let amountCents: number | null;
    let amountProvenance: string;
    if (endingBalanceCents !== null) {
      amountCents = endingBalanceCents;
      amountProvenance = "ending_balance";
    } else if (originalAmountCents !== null) {
      amountCents = originalAmountCents;
      amountProvenance = "original_amount";
      diagnostics.push({
        kind: "ambiguous_amount_column",
        message: "Ending Balance column missing — fell back to Original Amount for this row.",
        source_row_number: sourceRowNumber,
      });
    } else {
      amountCents = findFirstCurrencyAmount(cleaned);
      amountProvenance = "currency_scan";
    }

    if (amountCents === null) {
      rowsSkippedUnknown += 1;
      diagnostics.push({
        kind: "missing_amount",
        message: "Row removed: no BOA amount could be located.",
        source_row_number: sourceRowNumber,
      });
      validationErrors.push({
        row: sourceRowNumber,
        field: "amount",
        message: "BOA amount is missing or invalid.",
      });
      return;
    }

    if (amountCents === 0) {
      rowsRemovedZero += 1;
      diagnostics.push({
        kind: "zero_balance_row_removed",
        message: "Zero-balance row removed.",
        source_row_number: sourceRowNumber,
      });
      return;
    }

    lineage.push({ stage: "amount_resolved", detail: amountProvenance });

    const description = headerLookup ? findCellByAliases(cleaned, headerLookup, DESCRIPTION_ALIASES) : null;
    const stockFromColumn = headerLookup
      ? findCellByAliases(cleaned, headerLookup, STOCK_COLUMN_ALIASES)
      : null;
    const stockNumber = normalizeStock(stockFromColumn ?? findPatternValue(cleaned, STOCK_RE));
    if (stockNumber) {
      lineage.push({ stage: "stock_normalized", detail: stockNumber });
    }

    const vinFromColumn = headerLookup
      ? findCellByAliases(cleaned, headerLookup, VIN_COLUMN_ALIASES)
      : null;
    const vinFromRow = findPatternValue(cleaned, VIN_FULL_RE);
    const rawVin = vinFromColumn && VIN_FULL_RE.test(vinFromColumn) ? vinFromColumn : vinFromRow;
    const vin = rawVin ? rawVin.toUpperCase() : null;
    let vin6 = computeVin6(vin);
    let vinProvenance: VinProvenance;
    if (vin) {
      vinProvenance = {
        source: "raw_vin_column",
        vin,
        vin6,
        trusted: true,
        note: null,
      };
      lineage.push({ stage: "vin_extracted", detail: "raw_vin_column" });
    } else {
      const descVin6 = extractVin6FromDescription(description);
      if (descVin6) {
        vin6 = descVin6;
        vinProvenance = {
          source: "description_extraction",
          vin: null,
          vin6: descVin6,
          trusted: false,
          note: "VIN6 reconstructed from description text only.",
        };
        lineage.push({ stage: "vin_extracted", detail: "description_extraction" });
      } else {
        vinProvenance = {
          source: "untrusted",
          vin: null,
          vin6: null,
          trusted: false,
          note: "No VIN/serial column or description match.",
        };
        rowsRequiringEnrichment += 1;
        diagnostics.push({
          kind: "manual_enrichment_required",
          message: "BOA row has no parseable VIN and requires manual enrichment.",
          source_row_number: sourceRowNumber,
          stock_number: stockNumber,
        });
        lineage.push({ stage: "vin_enrichment_required" });
      }
    }

    if (vin6) {
      lineage.push({ stage: "vin6_computed", detail: vin6 });
    }

    const maturityDate = headerLookup ? findCellByAliases(cleaned, headerLookup, MATURITY_ALIASES) : null;
    if (maturityDate) {
      lineage.push({ stage: "maturity_date_attached", detail: maturityDate });
      diagnostics.push({
        kind: "maturity_date_attached",
        message: "Maturity date metadata attached to row.",
        source_row_number: sourceRowNumber,
        details: { maturity_date: maturityDate },
      });
    }

    const rawTransactionDate =
      headerLookup ? findCellByAliases(cleaned, headerLookup, TRANSACTION_DATE_ALIASES) : null;
    const transactionDate =
      (rawTransactionDate ? normalizeIsoDate(rawTransactionDate) : null) ??
      findFirstDateLike(cleaned);

    acceptedRows.push({
      sourceRowNumber,
      cells: cleaned,
      rawSnapshot,
      amountCents,
      endingBalanceCents,
      originalAmountCents,
      vin,
      vin6,
      vinProvenance,
      stockNumber,
      description: buildDescription(description, cleaned),
      transactionDate,
      maturityDate,
      lineage,
    });
  });

  // duplicate vin6 detection
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

  let currentMonthMaturityCount = 0;
  if (acceptedRows.some((row) => row.maturityDate !== null)) {
    acceptedRows.sort(compareByMaturityDate);
    for (const row of acceptedRows) {
      row.lineage.push({ stage: "sorted", detail: "maturity_date_asc_for_payoff_review" });
      const normalizedMaturity = normalizeIsoDate(row.maturityDate ?? "");
      if (normalizedMaturity?.startsWith(currentCalendarMonth)) {
        currentMonthMaturityCount += 1;
        row.lineage.push({
          stage: "maturity_payoff_review_flagged",
          detail: row.maturityDate ?? normalizedMaturity,
        });
        diagnostics.push({
          kind: "current_month_maturity_payoff_review",
          message: "BOA row has a current-calendar-month maturity and requires payoff review.",
          source_row_number: row.sourceRowNumber,
          vin6: row.vin6,
          stock_number: row.stockNumber,
          details: {
            maturity_date: row.maturityDate,
            calendar_month: currentCalendarMonth,
          },
        });
      }
    }
    diagnostics.push({
      kind: "sort_applied",
      message: "Rows sorted ascending by maturity date for current-month payoff review.",
      source_row_number: null,
      details: { sort: "maturity_date_asc", calendar_month: currentCalendarMonth },
    });
  }

  // deterministic sort: ending balance ascending, then VIN6 ascending
  acceptedRows.sort((a, b) => {
    const balanceDelta =
      (a.endingBalanceCents ?? a.amountCents) - (b.endingBalanceCents ?? b.amountCents);
    if (balanceDelta !== 0) {
      return balanceDelta;
    }
    const va = a.vin6 ?? "";
    const vb = b.vin6 ?? "";
    if (va !== vb) {
      return va < vb ? -1 : 1;
    }
    return a.sourceRowNumber - b.sourceRowNumber;
  });
  for (const row of acceptedRows) {
    row.lineage.push({ stage: "sorted", detail: "amount_asc_then_vin6_asc" });
  }
  diagnostics.push({
    kind: "sort_applied",
    message: "Rows sorted ascending by ending balance, then VIN6.",
    source_row_number: null,
  });

  const endingBalanceAutosumCents = acceptedRows.reduce(
    (total, row) => total + row.amountCents,
    0,
  );
  diagnostics.push({
    kind: "ending_balance_autosum_applied",
    message: "Ending Balance autosum calculated for retained BOA rows.",
    source_row_number: null,
    details: {
      ending_balance_autosum_cents: endingBalanceAutosumCents,
      ending_balance_autosum_amount: formatCents(endingBalanceAutosumCents),
    },
  });

  const keepMaturityInWorkingOutput = currentMonthMaturityCount > 0;
  const transactions: NewTransaction[] = acceptedRows.map((row) => {
    row.lineage.push({
      stage: "working_columns_pruned",
      detail: keepMaturityInWorkingOutput
        ? "hiley_working_columns_with_payoff_review"
        : "hiley_working_columns_without_maturity_date",
    });
    const lineage: RawDataLineage = {
      source_kind: "boa",
      preprocessing_version: PREPROCESSING_VERSION,
      source_row_number: row.sourceRowNumber,
      raw_row_snapshot: row.rawSnapshot,
      transformations: row.lineage,
      retained_reason: "non_zero_non_straightline",
      vin_provenance: row.vinProvenance,
      maturity_date: row.maturityDate,
    };
    return {
      source_file_id: null,
      source_type: "boa",
      transaction_date: row.transactionDate,
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
        ...buildWorkingOutputSnapshot(row, header, keepMaturityInWorkingOutput),
        [LINEAGE_RAW_DATA_KEY]: lineage,
      },
    };
  });

  const summary: PreprocessingSummary = {
    source_kind: "boa",
    preprocessing_version: PREPROCESSING_VERSION,
    parser_version: "boa-html-xls-v1",
    parser_format: "html_table_xls",
    rows_scanned: rowsScanned,
    rows_accepted: transactions.length,
    rows_removed_zero_balance: rowsRemovedZero,
    rows_removed_straightline: rowsRemovedStraightline,
    rows_removed_banner: rowsRemovedBanner,
    rows_skipped_unknown: rowsSkippedUnknown,
    rows_requiring_manual_enrichment: rowsRequiringEnrichment,
    duplicate_vin6_count: duplicateVin6Count,
    current_month_maturity_count: currentMonthMaturityCount,
    ending_balance_autosum_cents: endingBalanceAutosumCents,
    ending_balance_autosum_amount: formatCents(endingBalanceAutosumCents),
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

function buildWorkingOutputSnapshot(
  row: BoaWorkingRow,
  header: string[] | null,
  keepMaturityDate: boolean,
): Record<string, string> {
  if (!header) {
    const fallback: Record<string, string> = {};
    if (row.vin) {
      fallback["VIN / Serial Number"] = row.vin;
    }
    if (keepMaturityDate && row.maturityDate) {
      fallback["Maturity Date"] = row.maturityDate;
    }
    fallback["Ending Balance"] = formatCents(row.amountCents);
    return fallback;
  }

  const endingBalanceIndex = findHeaderIndex(header, ENDING_BALANCE_ALIASES);
  const lastWorkingIndex = endingBalanceIndex ?? header.length - 1;
  const output: Record<string, string> = {};

  header.forEach((columnName, index) => {
    const cleanName = cleanCell(columnName);
    if (!cleanName || index > lastWorkingIndex) {
      return;
    }
    if (isWorkingOutputRemovedColumn(cleanName)) {
      return;
    }
    if (isHeaderAlias(cleanName, MATURITY_ALIASES) && !keepMaturityDate) {
      return;
    }

    const value = cleanCell(row.cells[index]);
    if (isHeaderAlias(cleanName, ENDING_BALANCE_ALIASES)) {
      output["Ending Balance"] = value || formatCents(row.amountCents);
      return;
    }
    if (isHeaderAlias(cleanName, MATURITY_ALIASES) && !value) {
      return;
    }
    output[cleanName] = value;
  });

  if (!Object.keys(output).some((key) => isHeaderAlias(key, ENDING_BALANCE_ALIASES))) {
    output["Ending Balance"] = formatCents(row.amountCents);
  }
  return output;
}

function findHeaderIndex(header: string[], aliases: string[]): number | null {
  for (let index = 0; index < header.length; index += 1) {
    if (isHeaderAlias(header[index] ?? "", aliases)) {
      return index;
    }
  }
  return null;
}

function isWorkingOutputRemovedColumn(columnName: string): boolean {
  return isHeaderAlias(columnName, WORKING_OUTPUT_REMOVED_COLUMN_ALIASES);
}

function isHeaderAlias(columnName: string, aliases: string[]): boolean {
  const normalized = normalizeHeaderName(columnName);
  return aliases.some((alias) => normalizeHeaderName(alias) === normalized);
}

function normalizeHeaderName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findAmountByAliases(
  cells: string[],
  headerLookup: Map<string, number>,
  aliases: string[],
): number | null {
  for (const alias of aliases) {
    const idx = headerLookup.get(normalizeHeaderName(alias));
    if (idx === undefined) {
      continue;
    }
    const cents = parseAmountToCents(cells[idx]);
    if (cents !== null) {
      return cents;
    }
  }
  return null;
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

function findFirstCurrencyAmount(cells: string[]): number | null {
  for (const cell of cells) {
    if (looksLikeMoney(cell)) {
      const cents = parseAmountToCents(cell);
      if (cents !== null) {
        return cents;
      }
    }
  }
  return null;
}

function looksLikeMoney(value: string): boolean {
  if (!value) {
    return false;
  }
  if (!value.includes("$") && !value.includes(",") && !/^-?\d+\.\d{2}$/.test(value)) {
    return false;
  }
  return parseAmountToCents(value) !== null;
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
  const match = value.match(STOCK_RE);
  if (!match) {
    return null;
  }
  return match[0].toUpperCase();
}

function looksLikeTotalsRow(rowText: string): boolean {
  return (
    rowText.startsWith("total") ||
    rowText.includes(" total ") ||
    rowText.startsWith("subtotal") ||
    rowText.includes(" subtotal ") ||
    rowText.includes("statement total") ||
    rowText.includes("grand total")
  );
}

function findFirstDateLike(cells: string[]): string | null {
  for (const cell of cells) {
    const iso = normalizeIsoDate(cell);
    if (iso) {
      return iso;
    }
  }
  return null;
}

function compareByMaturityDate(a: BoaWorkingRow, b: BoaWorkingRow): number {
  const maturityA = normalizeIsoDate(a.maturityDate ?? "") ?? "9999-12-31";
  const maturityB = normalizeIsoDate(b.maturityDate ?? "") ?? "9999-12-31";
  if (maturityA !== maturityB) {
    return maturityA < maturityB ? -1 : 1;
  }
  return a.sourceRowNumber - b.sourceRowNumber;
}

function monthKey(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function normalizeIsoDate(value: string): string | null {
  const v = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    return v;
  }
  const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${year}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  return null;
}

function buildDescription(columnDescription: string | null, cells: string[]): string | null {
  if (columnDescription) {
    return columnDescription;
  }
  const meaningful = cells.filter(
    (cell) => cell && !looksLikeMoney(cell) && !/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(cell),
  );
  return meaningful.slice(0, 6).join(" | ") || null;
}

function locateHeaderInRows(rows: string[][]): { index: number; header: string[] } | null {
  const limit = Math.min(rows.length, MAX_HEADER_SEARCH_ROWS);
  for (let i = 0; i < limit; i += 1) {
    const row = rows[i] ?? [];
    if (row.length < HEADER_MIN_HITS) {
      continue;
    }
    let hits = 0;
    for (const cell of row) {
      const lowered = cell.toLowerCase();
      if (HEADER_FINGERPRINT_TOKENS.some((token) => lowered.includes(token))) {
        hits += 1;
      }
    }
    if (hits >= HEADER_MIN_HITS) {
      return { index: i, header: row.map((c) => c.trim()) };
    }
  }
  return null;
}
