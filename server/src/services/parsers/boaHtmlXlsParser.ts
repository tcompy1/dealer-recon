/**
 * Bank of America billing-statement parser for HTML-tables-saved-as-XLS.
 *
 * BOA exports `.xls` files whose contents are actually one or more HTML
 * `<table>` elements with banner rows above the real header. This parser:
 *   - finds the largest `<table>` in the document
 *   - locates the header row by column-name fingerprint, not by row index
 *   - returns header + data rows + warnings
 *
 * No external HTML parser dependency is used; we run a small `<tag>` scanner
 * scoped to the table body so the supply-chain surface does not grow.
 * Warnings carry counts and kinds only; never raw cell content.
 */

import { MAX_PARSED_ROWS, type ParsedTable, type ParserWarning } from "./types.js";

const TABLE_OPEN_RE = /<table\b[^>]*>/gi;
const TABLE_CLOSE_RE = /<\/table\s*>/i;
const TR_OPEN_RE = /<tr\b[^>]*>/gi;
const TR_CLOSE_RE = /<\/tr\s*>/i;
const CELL_OPEN_RE = /<(t[dh])\b[^>]*>/gi;
const CELL_CLOSE_RE = /<\/(?:td|th)\s*>/i;
const HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/**
 * BOA header column "fingerprints". A header row is identified as the row
 * that contains at least HEADER_MIN_FINGERPRINT_HITS of these tokens. This
 * is intentionally a loose match — bank portals reorder and rename columns,
 * so we look for evidence rather than exact column lists.
 */
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
];
const HEADER_MIN_FINGERPRINT_HITS = 3;
const MAX_HEADER_SEARCH_ROWS = 25;

export type BoaParseOptions = {
  maxRows?: number;
};

export function parseBoaHtmlXls(
  input: Buffer | string,
  options: BoaParseOptions = {},
): ParsedTable {
  const text = Buffer.isBuffer(input) ? input.toString("utf8") : input;
  const warnings: ParserWarning[] = [];
  const maxRows = options.maxRows ?? MAX_PARSED_ROWS;

  if (!text.trim()) {
    return {
      header: null,
      rows: [],
      warnings: [{ kind: "empty_document", message: "Input was empty." }],
    };
  }

  const tableSpans = collectTableSpans(text, warnings);
  if (tableSpans.length === 0) {
    return {
      header: null,
      rows: [],
      warnings: [
        ...warnings,
        { kind: "empty_document", message: "No <table> elements were found." },
      ],
    };
  }

  // Pick the table with the most rows. BOA exports typically wrap the
  // statement in a single large table preceded by tiny banner tables.
  let chosenRows: string[][] = [];
  for (const span of tableSpans) {
    const rows = collectRows(span, warnings, maxRows);
    if (rows.length > chosenRows.length) {
      chosenRows = rows;
    }
  }

  if (chosenRows.length === 0) {
    return {
      header: null,
      rows: [],
      warnings: [
        ...warnings,
        { kind: "empty_document", message: "Largest table had no rows." },
      ],
    };
  }

  const headerInfo = locateHeaderByFingerprint(chosenRows);
  let header: string[] | null = null;
  let dataRows: string[][];
  if (headerInfo) {
    header = headerInfo.header;
    dataRows = chosenRows.slice(headerInfo.index + 1);
  } else {
    warnings.push({
      kind: "header_not_detected",
      message:
        "BOA header fingerprint not located; returning positional rows so caller can inspect.",
    });
    dataRows = chosenRows;
  }

  const skipped = dataRows.filter((row) => row.every((cell) => cell.length === 0)).length;
  if (skipped > 0) {
    warnings.push({
      kind: "row_skipped",
      message: "Empty rows were skipped.",
      count: skipped,
    });
  }
  const usefulRows = dataRows.filter((row) => row.some((cell) => cell.length > 0));
  return { header, rows: usefulRows, warnings };
}

function collectTableSpans(text: string, warnings: ParserWarning[]): string[] {
  const spans: string[] = [];
  TABLE_OPEN_RE.lastIndex = 0;
  let openMatch: RegExpExecArray | null;
  let truncated = 0;
  while ((openMatch = TABLE_OPEN_RE.exec(text)) !== null) {
    const start = openMatch.index + openMatch[0].length;
    const closeRel = text.slice(start).search(TABLE_CLOSE_RE);
    if (closeRel === -1) {
      truncated += 1;
      continue;
    }
    spans.push(text.slice(start, start + closeRel));
    TABLE_OPEN_RE.lastIndex = start + closeRel;
  }
  if (truncated > 0) {
    warnings.push({
      kind: "row_truncated",
      message: "Unclosed <table> tags were ignored.",
      count: truncated,
    });
  }
  return spans;
}

function collectRows(tableSpan: string, warnings: ParserWarning[], maxRows: number): string[][] {
  const rows: string[][] = [];
  TR_OPEN_RE.lastIndex = 0;
  let openMatch: RegExpExecArray | null;
  let truncated = 0;
  let limitTriggered = false;
  while ((openMatch = TR_OPEN_RE.exec(tableSpan)) !== null) {
    if (rows.length >= maxRows) {
      limitTriggered = true;
      break;
    }
    const start = openMatch.index + openMatch[0].length;
    const closeRel = tableSpan.slice(start).search(TR_CLOSE_RE);
    if (closeRel === -1) {
      truncated += 1;
      continue;
    }
    const rowText = tableSpan.slice(start, start + closeRel);
    rows.push(extractCells(rowText));
    TR_OPEN_RE.lastIndex = start + closeRel;
  }
  if (truncated > 0) {
    warnings.push({
      kind: "row_truncated",
      message: "Unclosed <tr> tags were ignored.",
      count: truncated,
    });
  }
  if (limitTriggered) {
    warnings.push({
      kind: "row_limit_exceeded",
      message: "Row limit reached during HTML parse.",
    });
  }
  return rows;
}

function extractCells(rowText: string): string[] {
  const cells: string[] = [];
  CELL_OPEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CELL_OPEN_RE.exec(rowText)) !== null) {
    const start = match.index + match[0].length;
    const closeRel = rowText.slice(start).search(CELL_CLOSE_RE);
    if (closeRel === -1) {
      cells.push(decodeHtmlText(rowText.slice(start)));
      break;
    }
    cells.push(decodeHtmlText(rowText.slice(start, start + closeRel)));
    CELL_OPEN_RE.lastIndex = start + closeRel;
  }
  return cells;
}

function decodeHtmlText(input: string): string {
  return input
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x?[0-9A-Fa-f]+|[A-Za-z]+);/g, (whole, body: string) => {
      if (body.startsWith("#x") || body.startsWith("#X")) {
        const code = Number.parseInt(body.slice(2), 16);
        return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
      }
      if (body.startsWith("#")) {
        const code = Number.parseInt(body.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
      }
      const replacement = HTML_ENTITIES[body.toLowerCase()];
      return replacement !== undefined ? replacement : whole;
    })
    .replace(/\s+/g, " ")
    .trim();
}

function locateHeaderByFingerprint(rows: string[][]): { index: number; header: string[] } | null {
  const upper = HEADER_FINGERPRINT_TOKENS.map((token) => token.toLowerCase());
  const searchLimit = Math.min(rows.length, MAX_HEADER_SEARCH_ROWS);
  for (let i = 0; i < searchLimit; i += 1) {
    const row = rows[i] ?? [];
    if (row.length < HEADER_MIN_FINGERPRINT_HITS) {
      continue;
    }
    let hits = 0;
    for (const cell of row) {
      const lowered = cell.toLowerCase();
      if (upper.some((token) => lowered.includes(token))) {
        hits += 1;
      }
    }
    if (hits >= HEADER_MIN_FINGERPRINT_HITS) {
      return { index: i, header: row.map((cell) => cell.trim()) };
    }
  }
  return null;
}
