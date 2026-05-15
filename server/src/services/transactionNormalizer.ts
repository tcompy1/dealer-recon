import { parse } from "csv-parse/sync";

import { parseAmountToCents } from "../domain/money.js";
import type { NewTransaction, SourceType, ValidationError } from "../domain/types.js";

type NormalizationResult = {
  transactions: NewTransaction[];
  validationErrors: ValidationError[];
};

export const TRANSACTION_NORMALIZER_VERSION = "transaction-normalizer-v1";

const moneyPattern = /^\(?\$?\s*-?\d{1,3}(?:,\d{3})*(?:\.\d{2})?\)?$/;
export const MAX_CSV_ROWS = 10_000;
const referencePattern = /^\d{5,9}$/;
const stockPattern = /\bM\d{4,6}\b/i;
const stockFullPattern = /^M\d+$/i;
const vinPattern = /\b(?=[A-Z0-9]{17}\b)(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\d)[A-Z0-9]{17}\b/i;
const vinFullPattern = /^(?=[A-Z0-9]{17}$)(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\d)[A-Z0-9]{17}$/i;

const columnAliases: Record<
  keyof Omit<NewTransaction, "source_file_id" | "source_type" | "raw_data">,
  string[]
> = {
  transaction_date: ["transaction_date", "transaction date", "date", "trans date"],
  post_date: ["post_date", "post date", "posted date", "posting date"],
  amount_cents: [
    "amount",
    "transaction amount",
    "payment amount",
    "deposit amount",
    "original amount",
    "beginning balance",
    "ending balance",
  ],
  reference_number: [
    "reference_number",
    "reference number",
    "reference",
    "ref",
    "check number",
    "check #",
    "deposit number",
  ],
  description: ["description", "memo", "details", "transaction description"],
  account: ["account", "gl account", "account number"],
  account_type: ["account_type", "account type", "category", "account category"],
  account_identifier: [
    "account_identifier",
    "account identifier",
    "account_id",
    "account id",
    "gl account",
    "account number",
    "account",
  ],
  stock_number: ["stock_number", "stock number", "stock #", "stock", "stock/lease no"],
  vin: ["vin", "vehicle identification number", "serial no/vin"],
};

export class CsvNormalizationError extends Error {
  constructor(
    message: string,
    readonly statusCode = 422,
  ) {
    super(message);
  }
}

const dateFormats = [
  /^(\d{4})-(\d{2})-(\d{2})$/,
  /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
  /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/,
  /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/,
];

export function normalizeTransactionsFromCsv(
  content: Buffer | string,
  sourceType: SourceType,
): NormalizationResult {
  const text = Buffer.isBuffer(content) ? content.toString("utf8").replace(/^\uFEFF/, "") : content;

  if (sourceType === "boa") {
    return normalizeBoaTransactionsFromCsv(text, sourceType);
  }

  if (sourceType === "dealertrack") {
    return normalizeDealertrackTransactionsFromCsv(text, sourceType);
  }

  return normalizeHeaderTransactionsFromCsv(text, sourceType);
}

function normalizeHeaderTransactionsFromCsv(
  text: string,
  sourceType: SourceType,
): NormalizationResult {
  const rows = parseCsv(text);
  if (rows.length === 0) {
    return {
      transactions: [],
      validationErrors: [{ row: null, field: "file", message: "CSV file is empty or missing a header row." }],
    };
  }

  const header = rows[0];
  const headerLookup = new Map(header.map((name, index) => [normalizeHeader(name), index]));
  const transactions: NewTransaction[] = [];
  const validationErrors: ValidationError[] = [];

  rows.slice(1).forEach((row, index) => {
    const rowNumber = index + 2;
    const normalized = normalizeHeaderRow(row, rowNumber, headerLookup, sourceType, header);
    validationErrors.push(...normalized.validationErrors);
    if (normalized.transaction) {
      transactions.push(normalized.transaction);
    }
  });

  return { transactions, validationErrors };
}

function normalizeBoaTransactionsFromCsv(text: string, sourceType: SourceType): NormalizationResult {
  const rows = parseCsv(text);
  if (rows.length === 0) {
    return {
      transactions: [],
      validationErrors: [{ row: null, field: "file", message: "CSV file is empty." }],
    };
  }

  const header = looksLikeHeader(rows[0]) ? rows[0] : null;
  const transactions: NewTransaction[] = [];
  const validationErrors: ValidationError[] = [];
  let rowsScanned = 0;
  let rowsAccepted = 0;
  let rowsSkipped = 0;
  const sampleAcceptedRows: string[][] = [];

  rows.forEach((row, index) => {
    rowsScanned += 1;
    const rowNumber = index + 1;
    if (header && rowNumber === 1) {
      rowsSkipped += 1;
      return;
    }

    const cleanedRow = row.map(cleanCell);
    if (!isBoaTransactionRow(cleanedRow, header)) {
      rowsSkipped += 1;
      return;
    }

    rowsAccepted += 1;
    if (sampleAcceptedRows.length < 3) {
      sampleAcceptedRows.push(cleanedRow);
    }

    const normalized = normalizeBoaRow(cleanedRow, rowNumber, sourceType, header);
    validationErrors.push(...normalized.validationErrors);
    if (normalized.transaction) {
      transactions.push(normalized.transaction);
    }
  });

  printParserDebug("BOA", rowsScanned, rowsAccepted, rowsSkipped, sampleAcceptedRows);
  return { transactions, validationErrors };
}

function normalizeDealertrackTransactionsFromCsv(
  text: string,
  sourceType: SourceType,
): NormalizationResult {
  const rows = parseCsv(text);
  const header = looksLikeDealertrackHeader(rows[0] ?? []) ? rows[0] : null;
  const transactions: NewTransaction[] = [];
  let rowsScanned = 0;
  let rowsAccepted = 0;
  let rowsSkipped = 0;
  const sampleAcceptedRows: string[][] = [];

  rows.forEach((row, index) => {
    rowsScanned += 1;
    if (header && index === 0) {
      rowsSkipped += 1;
      return;
    }

    const cleanedRow = row.map(cleanCell);
    const normalized = header
      ? normalizeDealertrackHeaderRow(cleanedRow, header, sourceType)
      : normalizeDealertrackPositionalRow(cleanedRow, sourceType);
    if (!normalized) {
      rowsSkipped += 1;
      return;
    }

    rowsAccepted += 1;
    if (sampleAcceptedRows.length < 3) {
      sampleAcceptedRows.push(cleanedRow);
    }

    transactions.push(normalized);
  });

  printParserDebug("Dealertrack", rowsScanned, rowsAccepted, rowsSkipped, sampleAcceptedRows);
  return { transactions, validationErrors: [] };
}

function normalizeDealertrackPositionalRow(
  row: string[],
  sourceType: SourceType,
): NewTransaction | null {
  if (!isDealertrackTransactionRow(row)) {
    return null;
  }

  return buildDealertrackTransaction({
    sourceType,
    amountCents: parseAmountToCents(row[2]) as number,
    stockNumber: row[0],
    description: row[1],
    vin: null,
    rawData: buildRawData(row, null),
  });
}

function normalizeDealertrackHeaderRow(
  row: string[],
  header: string[],
  sourceType: SourceType,
): NewTransaction | null {
  const headerLookup = new Map(header.map((name, index) => [normalizeHeader(name), index]));
  const control = cleanCell(row[headerLookup.get("control") ?? -1]);
  if (!control || !stockFullPattern.test(control)) {
    return null;
  }

  const amountCents = findDealertrackAccountAmountCents(row, header);
  if (amountCents === null || amountCents === 0) {
    return null;
  }

  const description = cleanCell(row[headerLookup.get("description") ?? -1]);
  const vin = description.match(vinFullPattern) ? description.toUpperCase() : null;

  return buildDealertrackTransaction({
    sourceType,
    amountCents,
    stockNumber: control,
    description,
    vin,
    rawData: buildRawData(row, header),
  });
}

function buildDealertrackTransaction({
  sourceType,
  amountCents,
  stockNumber,
  description,
  vin,
  rawData,
}: {
  sourceType: SourceType;
  amountCents: number;
  stockNumber: string;
  description: string;
  vin: string | null;
  rawData: Record<string, string>;
}): NewTransaction {
  return {
    source_file_id: null,
    source_type: sourceType,
    transaction_date: null,
    post_date: null,
    amount_cents: amountCents,
    reference_number: null,
    description: description || null,
    account: null,
    account_type: defaultAccountType(sourceType),
    account_identifier: defaultAccountIdentifier(sourceType),
    stock_number: stockNumber.toUpperCase(),
    vin,
    raw_data: rawData,
  };
}

function normalizeHeaderRow(
  row: string[],
  rowNumber: number,
  headerLookup: Map<string, number>,
  sourceType: SourceType,
  header: string[],
): { transaction: NewTransaction | null; validationErrors: ValidationError[] } {
  const transactionDate = parseDate(getValue(row, headerLookup, "transaction_date"));
  const amountCents = parseAmountToCents(getValue(row, headerLookup, "amount_cents"));
  const validationErrors: ValidationError[] = [];

  if (!transactionDate) {
    validationErrors.push({
      row: rowNumber,
      field: "transaction_date",
      message: "Transaction date is required and must be a valid date.",
    });
  }
  if (amountCents === null) {
    validationErrors.push({
      row: rowNumber,
      field: "amount",
      message: "Amount is required and must be a valid number.",
    });
  }
  if (amountCents === 0) {
    validationErrors.push({
      row: rowNumber,
      field: "amount",
      message: "Amount must be non-zero.",
    });
  }
  if (validationErrors.length > 0) {
    return { transaction: null, validationErrors };
  }

  return {
    transaction: {
      source_file_id: null,
      source_type: sourceType,
      transaction_date: transactionDate,
      post_date: parseDate(getValue(row, headerLookup, "post_date")),
      amount_cents: amountCents as number,
      reference_number: getValue(row, headerLookup, "reference_number"),
      description: getValue(row, headerLookup, "description"),
      account: getValue(row, headerLookup, "account"),
      account_type: getValue(row, headerLookup, "account_type") ?? defaultAccountType(sourceType),
      account_identifier:
        getValue(row, headerLookup, "account_identifier") ??
        getValue(row, headerLookup, "account") ??
        defaultAccountIdentifier(sourceType),
      stock_number: getValue(row, headerLookup, "stock_number"),
      vin: getValue(row, headerLookup, "vin"),
      raw_data: buildRawData(row, header),
    },
    validationErrors: [],
  };
}

function normalizeBoaRow(
  row: string[],
  rowNumber: number,
  sourceType: SourceType,
  header: string[] | null,
): { transaction: NewTransaction | null; validationErrors: ValidationError[] } {
  const transactionDate = findFirstDate(row);
  const postDate = findPostDate(row, transactionDate);
  const amountCents = findBoaAmountCents(row, header);
  const referenceNumber = findBoaReferenceNumber(row, header);
  const stockNumber = findPatternValue(row, stockPattern);
  const vin = findPatternValue(row, vinPattern);
  const validationErrors: ValidationError[] = [];

  if (amountCents === null) {
    validationErrors.push({
      row: rowNumber,
      field: "amount",
      message: "BOA amount is missing or invalid.",
    });
  }
  if (amountCents === 0) {
    validationErrors.push({
      row: rowNumber,
      field: "amount",
      message: "BOA amount must be non-zero.",
    });
  }
  if (validationErrors.length > 0) {
    return { transaction: null, validationErrors };
  }

  return {
    transaction: {
      source_file_id: null,
      source_type: sourceType,
      transaction_date: transactionDate,
      post_date: postDate,
      amount_cents: amountCents as number,
      reference_number: referenceNumber,
      description: buildBoaDescription(row),
      account: null,
      account_type: defaultAccountType(sourceType),
      account_identifier: defaultAccountIdentifier(sourceType),
      stock_number: stockNumber,
      vin,
      raw_data: buildRawData(row, header),
    },
    validationErrors: [],
  };
}

function parseCsv(text: string): string[][] {
  const lineCount = text.length === 0 ? 0 : text.split(/\r\n|\r|\n/).length;
  if (lineCount > MAX_CSV_ROWS) {
    throw new CsvNormalizationError(`CSV row limit exceeded. Maximum rows: ${MAX_CSV_ROWS}.`, 413);
  }

  try {
    return parse(text, {
      relax_column_count: true,
      relax_quotes: true,
      skip_empty_lines: false,
      ltrim: true,
      trim: false,
    }) as string[][];
  } catch {
    throw new CsvNormalizationError("Malformed CSV file.");
  }
}

function getValue(
  row: string[],
  headerLookup: Map<string, number>,
  field: keyof typeof columnAliases,
): string | null {
  for (const alias of columnAliases[field]) {
    const index = headerLookup.get(normalizeHeader(alias));
    if (index === undefined) {
      continue;
    }
    const value = cleanCell(row[index]);
    return value || null;
  }
  return null;
}

function isBoaTransactionRow(values: string[], header: string[] | null): boolean {
  if (!values.some(Boolean)) {
    return false;
  }

  const rowText = values.join(" ").toLowerCase();
  if (rowText.includes("subtotal") || rowText.includes("total")) {
    return false;
  }
  if (!values.some((value) => /\d/.test(value))) {
    return false;
  }

  const hasVin = findPatternValue(values, vinPattern) !== null;
  const stockNumber = findPatternValue(values, stockPattern);
  const amountCents = header ? findBoaAmountCents(values, header) : findCurrencyAmountCents(values);

  if (amountCents === null) {
    return false;
  }
  if (amountCents === 0) {
    return false;
  }
  return hasVin || stockNumber !== null;
}

function isDealertrackTransactionRow(values: string[]): boolean {
  if (values.length < 3) {
    return false;
  }
  const amountCents = parseAmountToCents(values[2]);
  return Boolean(
    values[0] && stockFullPattern.test(values[0]) && amountCents !== null && amountCents !== 0,
  );
}

function looksLikeDealertrackHeader(row: string[]): boolean {
  const normalizedValues = row.map(normalizeHeader);
  return (
    normalizedValues.includes("control") &&
    normalizedValues.includes("description") &&
    normalizedValues.some((value) => /^\d{4}$/.test(value))
  );
}

function findDealertrackAccountAmountCents(values: string[], header: string[]): number | null {
  const accountColumnIndexes = header
    .map((name, index) => ({ name: normalizeHeader(name), index }))
    .filter(({ name }) => /^\d{4}$/.test(name))
    .map(({ index }) => index);

  for (const index of accountColumnIndexes) {
    const amountCents = parseAmountToCents(values[index]);
    if (amountCents !== null && amountCents !== 0) {
      return amountCents;
    }
  }

  return null;
}

function findPostDate(values: string[], transactionDate: string | null): string | null {
  for (const value of values) {
    const parsedDate = parseDate(value);
    if (parsedDate && parsedDate !== transactionDate) {
      return parsedDate;
    }
  }
  return null;
}

function findFirstDate(values: string[]): string | null {
  for (const value of values) {
    const parsedDate = parseDate(value);
    if (parsedDate) {
      return parsedDate;
    }
  }
  return null;
}

function findBoaAmountCents(values: string[], header: string[] | null): number | null {
  if (header) {
    const headerLookup = new Map(header.map((name, index) => [normalizeHeader(name), index]));
    for (const alias of columnAliases.amount_cents) {
      const index = headerLookup.get(normalizeHeader(alias));
      if (index !== undefined) {
        const amountCents = parseAmountToCents(values[index]);
        if (amountCents !== null) {
          return amountCents;
        }
      }
    }
  }

  return findCurrencyAmountCents(values);
}

function findCurrencyAmountCents(values: string[]): number | null {
  for (const value of values) {
    if (looksLikeMoney(value)) {
      return parseAmountToCents(value);
    }
  }
  return null;
}

function findBoaReferenceNumber(values: string[], header: string[] | null): string | null {
  if (header) {
    const headerLookup = new Map(header.map((name, index) => [normalizeHeader(name), index]));
    for (const alias of columnAliases.reference_number) {
      const index = headerLookup.get(normalizeHeader(alias));
      if (index !== undefined) {
        return cleanCell(values[index]) || null;
      }
    }
  }

  return values.find((value) => referencePattern.test(value)) ?? null;
}

function findPatternValue(values: string[], pattern: RegExp): string | null {
  for (const value of values) {
    const match = value.match(pattern);
    if (match) {
      return match[0].toUpperCase();
    }
  }
  return null;
}

function buildBoaDescription(values: string[]): string | null {
  const meaningfulValues = values.filter(
    (value) => value && !parseDate(value) && !looksLikeMoney(value) && !vinPattern.test(value),
  );
  return meaningfulValues.slice(0, 6).join(" | ") || null;
}

function buildRawData(values: string[], header: string[] | null): Record<string, string> {
  const rawData: Record<string, string> = {};
  values.forEach((value, index) => {
    const key = header?.[index]?.trim() || `column_${index}`;
    rawData[key] = value;
  });
  return rawData;
}

function looksLikeHeader(row: string[]): boolean {
  const normalizedValues = new Set(row.filter(Boolean).map(normalizeHeader));
  const knownHeaders = Object.values(columnAliases).flat().map(normalizeHeader);
  return knownHeaders.some((header) => normalizedValues.has(header));
}

function looksLikeMoney(value: string): boolean {
  return Boolean(
    value &&
      (value.includes("$") || value.includes(",")) &&
      moneyPattern.test(value) &&
      parseAmountToCents(value) !== null,
  );
}

function cleanCell(value: string | undefined): string {
  return (value ?? "").trim().replace(/^"|"$/g, "").trim();
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function defaultAccountType(sourceType: SourceType): string {
  if (sourceType === "boa" || sourceType === "dealertrack") {
    return "floorplan";
  }
  return sourceType;
}

function defaultAccountIdentifier(sourceType: SourceType): string {
  if (sourceType === "boa" || sourceType === "dealertrack") {
    return "floorplan";
  }
  return "unassigned";
}

function parseDate(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const cleaned = cleanCell(value);

  for (const format of dateFormats) {
    const match = cleaned.match(format);
    if (!match) {
      continue;
    }

    if (format === dateFormats[0]) {
      return `${match[1]}-${match[2]}-${match[3]}`;
    }
    if (format === dateFormats[3]) {
      return `${match[1]}-${pad(match[2])}-${pad(match[3])}`;
    }

    const year = match[3].length === 2 ? `20${match[3]}` : match[3];
    return `${year}-${pad(match[1])}-${pad(match[2])}`;
  }

  return null;
}

function isParserDebugEnabled(): boolean {
  if (process.env.NODE_ENV === "production") {
    return false;
  }
  const flag = process.env.PARSER_DEBUG;
  if (!flag) {
    return false;
  }
  return /^(1|true|yes|on)$/i.test(flag.trim());
}

function printParserDebug(
  sourceName: string,
  rowsScanned: number,
  rowsAccepted: number,
  rowsSkipped: number,
  sampleAcceptedRows: string[][],
): void {
  if (!isParserDebugEnabled()) {
    return;
  }
  console.error(
    `${sourceName} parser debug: rows_scanned=${rowsScanned} rows_accepted=${rowsAccepted} rows_skipped=${rowsSkipped} sample_accepted_rows=${JSON.stringify(
      sampleAcceptedRows.slice(0, 3),
    )}`,
  );
}

function pad(value: string): string {
  return value.padStart(2, "0");
}
