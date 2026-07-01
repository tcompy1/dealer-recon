/**
 * Tolerant Dealertrack SpreadsheetML parser.
 *
 * Real Dealertrack `.XLS` exports are SpreadsheetML XML files that are often
 * malformed enough that strict XML/DOM parsers reject the document or treat
 * it as empty. This module scans the document with a small state machine
 * over `<Row>` / `<Cell>` / `<Data>` tags so usable rows are still recovered
 * even when the file is not strictly well-formed.
 *
 * Returns only structural information (header, rows, warning counts/kinds).
 * Never logs raw cell content.
 */

import { MAX_PARSED_ROWS, type ParsedTable, type ParserWarning } from "./types.js";

const ROW_OPEN_RE = /<(?:[A-Za-z][\w-]*:)?Row\b([^>]*)>/g;
const ROW_CLOSE_RE = /<\/(?:[A-Za-z][\w-]*:)?Row\s*>/;
const CELL_OPEN_RE = /<(?:[A-Za-z][\w-]*:)?Cell\b([^>]*)\/?>/g;
const CELL_SELF_CLOSE_RE = /\/\s*>$/;
const CELL_INDEX_RE = /(?:[A-Za-z][\w-]*:)?Index\s*=\s*"(\d+)"/;
const DATA_TAG_RE =
  /<(?:[A-Za-z][\w-]*:)?Data\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z][\w-]*:)?Data\s*>/;

const XML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

const HEADER_HEURISTIC_MIN_TEXT_CELLS = 2;
export const MAX_SPREADSHEETML_COLUMNS = 256;

export type DealertrackParseOptions = {
  maxRows?: number;
  maxColumns?: number;
};

export function parseDealertrackXml(
  input: Buffer | string,
  options: DealertrackParseOptions = {},
): ParsedTable {
  const text = Buffer.isBuffer(input) ? input.toString("utf8") : input;
  const warnings: ParserWarning[] = [];
  const maxRows = options.maxRows ?? MAX_PARSED_ROWS;
  const maxColumns = options.maxColumns ?? MAX_SPREADSHEETML_COLUMNS;

  if (!text.trim()) {
    return {
      header: null,
      rows: [],
      warnings: [{ kind: "empty_document", message: "Input was empty." }],
    };
  }

  const rowSpans = collectRowSpans(text, warnings);
  if (rowSpans.length === 0) {
    return {
      header: null,
      rows: [],
      warnings: [
        ...warnings,
        { kind: "empty_document", message: "No row tags were detected." },
      ],
    };
  }

  let rowLimitTriggered = false;
  const parsedRows: string[][] = [];
  for (const span of rowSpans) {
    if (parsedRows.length >= maxRows) {
      rowLimitTriggered = true;
      break;
    }
    const cells = extractRowCells(span, warnings, maxColumns);
    if (cells === null) {
      break;
    }
    parsedRows.push(cells);
  }
  if (rowLimitTriggered) {
    warnings.push({
      kind: "row_limit_exceeded",
      message: "Row limit reached during parse.",
      count: rowSpans.length - parsedRows.length,
    });
  }

  const headerInfo = detectHeader(parsedRows);
  let header: string[] | null = null;
  let dataRows: string[][];
  if (headerInfo) {
    header = headerInfo.header;
    dataRows = parsedRows.slice(headerInfo.index + 1);
  } else {
    warnings.push({
      kind: "header_not_detected",
      message: "Header row could not be located; returning positional rows.",
    });
    dataRows = parsedRows;
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

function collectRowSpans(text: string, warnings: ParserWarning[]): string[] {
  const spans: string[] = [];
  ROW_OPEN_RE.lastIndex = 0;
  let openMatch: RegExpExecArray | null;
  let truncated = 0;
  while ((openMatch = ROW_OPEN_RE.exec(text)) !== null) {
    const start = openMatch.index + openMatch[0].length;
    const closeRel = sliceFromIndex(text, start).search(ROW_CLOSE_RE);
    if (closeRel === -1) {
      truncated += 1;
      continue;
    }
    spans.push(text.slice(start, start + closeRel));
    ROW_OPEN_RE.lastIndex = start + closeRel;
  }
  if (truncated > 0) {
    warnings.push({
      kind: "row_truncated",
      message: "Row tags without matching close were ignored.",
      count: truncated,
    });
  }
  return spans;
}

function sliceFromIndex(text: string, index: number): string {
  return index === 0 ? text : text.slice(index);
}

function extractRowCells(
  rowSpan: string,
  warnings: ParserWarning[],
  maxColumns: number,
): string[] | null {
  const cells: string[] = [];
  CELL_OPEN_RE.lastIndex = 0;
  let nextIndex = 1;
  let match: RegExpExecArray | null;
  while ((match = CELL_OPEN_RE.exec(rowSpan)) !== null) {
    const tagFull = match[0];
    const attrs = match[1] ?? "";
    const indexAttr = attrs.match(CELL_INDEX_RE);
    if (indexAttr) {
      const target = Number.parseInt(indexAttr[1], 10);
      if (Number.isFinite(target) && target > 0) {
        if (target > maxColumns) {
          warnings.push({
            kind: "column_limit_exceeded",
            message: `SpreadsheetML cell index exceeds the maximum supported column count of ${maxColumns}.`,
            count: target,
            fatal: true,
          });
          return null;
        }
        while (cells.length < target - 1) {
          cells.push("");
        }
        nextIndex = target;
      }
    }
    if (nextIndex > maxColumns) {
      warnings.push({
        kind: "column_limit_exceeded",
        message: `SpreadsheetML row exceeds the maximum supported column count of ${maxColumns}.`,
        count: nextIndex,
        fatal: true,
      });
      return null;
    }
    let value = "";
    if (!CELL_SELF_CLOSE_RE.test(tagFull.trim())) {
      const afterTag = rowSpan.slice(match.index + tagFull.length);
      const dataMatch = afterTag.match(DATA_TAG_RE);
      if (dataMatch) {
        value = decodeXmlText(dataMatch[1]);
      }
    }
    cells[nextIndex - 1] = value;
    nextIndex += 1;
  }
  return cells.map((cell) => cell ?? "");
}

function decodeXmlText(input: string): string {
  return input
    .replace(/<\/?[A-Za-z][^>]*>/g, "")
    .replace(/&(#x?[0-9A-Fa-f]+|[A-Za-z]+);/g, (whole, body: string) => {
      if (body.startsWith("#x") || body.startsWith("#X")) {
        const code = Number.parseInt(body.slice(2), 16);
        return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
      }
      if (body.startsWith("#")) {
        const code = Number.parseInt(body.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
      }
      const replacement = XML_ENTITIES[body];
      return replacement !== undefined ? replacement : whole;
    })
    .trim();
}

function detectHeader(rows: string[][]): { index: number; header: string[] } | null {
  for (let i = 0; i < Math.min(rows.length, 5); i += 1) {
    const row = rows[i] ?? [];
    const textCells = row.filter((cell) => isHeaderLikeCell(cell));
    if (textCells.length >= HEADER_HEURISTIC_MIN_TEXT_CELLS) {
      return { index: i, header: row.map((cell) => cell.trim()) };
    }
  }
  return null;
}

function isHeaderLikeCell(cell: string): boolean {
  if (!cell) {
    return false;
  }
  const trimmed = cell.trim();
  if (!trimmed) {
    return false;
  }
  if (/^-?\d/.test(trimmed)) {
    return false;
  }
  return /[A-Za-z]/.test(trimmed);
}

const VIN_PATTERN =
  /\b(?=[A-Z0-9]{17}\b)(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\d)[A-HJ-NPR-Z0-9]{17}\b/g;

export function extractVinsFromText(text: string): string[] {
  if (!text) {
    return [];
  }
  const seen = new Set<string>();
  for (const match of text.toUpperCase().matchAll(VIN_PATTERN)) {
    seen.add(match[0]);
  }
  return [...seen];
}
