import {
  accountingMonthEndDate,
  type AccountingMonth,
  parseAccountingMonth,
} from "../domain/accountingMonth.js";
import type { ParsedTable } from "./parsers/types.js";

export type SourcePeriodEvidence = {
  source: "boa" | "dealertrack";
  selectedMonth: AccountingMonth;
  explicitMonths: AccountingMonth[];
  observedDateRange: { min: string; max: string } | null;
  filenameHint: AccountingMonth | null;
  status: "confirmed" | "compatible_incomplete" | "contradictory";
  safeEvidence: Record<string, string | number | boolean | null>;
};

export type SourcePeriodValidation =
  | { ok: true; evidence: SourcePeriodEvidence; warnings: string[] }
  | {
      ok: false;
      code: "SOURCE_PERIOD_MISMATCH" | "SOURCE_PERIOD_CONTRADICTORY";
      evidence: SourcePeriodEvidence;
      recovery: string;
    };

const ENGLISH_MONTHS: Record<string, string> = {
  jan: "01",
  january: "01",
  feb: "02",
  february: "02",
  mar: "03",
  march: "03",
  apr: "04",
  april: "04",
  may: "05",
  jun: "06",
  june: "06",
  jul: "07",
  july: "07",
  aug: "08",
  august: "08",
  sep: "09",
  sept: "09",
  september: "09",
  oct: "10",
  october: "10",
  nov: "11",
  november: "11",
  dec: "12",
  december: "12",
};

const MONTH_NAME_PATTERN =
  /\b(january|february|march|april|may|june|july|august|september|sept|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)[\s_-]+(\d{4})\b/gi;
const MONTH_WORD_PATTERN =
  /\b(january|february|march|april|may|june|july|august|september|sept|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\b/i;
const CANONICAL_MONTH_PATTERN = /\b(\d{4}-(?:0[1-9]|1[0-2]))\b(?!-\d{2})/g;
const ISO_DATE_PATTERN = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
const US_DATE_PATTERN = /\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/g;
const BOA_HEADER_TOKENS = ["vin", "serial", "stock", "original amount", "ending balance"];

export function deriveBoaPeriodEvidence(
  parsed: ParsedTable,
  filename: string | null,
  selectedMonth: AccountingMonth,
): SourcePeriodValidation {
  const bannerRows = parsed.preambleRows ?? (parsed.header ? [] : rowsBeforeBoaHeader(parsed.rows));
  const bannerMonths = bannerRows.flatMap((row) => extractMonthHints(row.join(" ")));
  const explicitMonths = uniqueSortedMonths(bannerMonths);
  const filenameHint = extractFilenameHint(filename, selectedMonth);
  const evidence: SourcePeriodEvidence = {
    source: "boa",
    selectedMonth,
    explicitMonths,
    observedDateRange: null,
    filenameHint,
    status: "compatible_incomplete",
    safeEvidence: {
      banner_rows_examined: bannerRows.length,
      banner_month_mentions: bannerMonths.length,
      distinct_banner_months: explicitMonths.length,
      filename_hint_present: filenameHint !== null,
    },
  };

  if (explicitMonths.length > 1) {
    evidence.status = "contradictory";
    return {
      ok: false,
      code: "SOURCE_PERIOD_CONTRADICTORY",
      evidence,
      recovery: "Export one BOA statement for a single accounting month and upload it again.",
    };
  }

  const bannerMonth = explicitMonths[0];
  if (bannerMonth && bannerMonth !== selectedMonth) {
    evidence.status = "contradictory";
    return {
      ok: false,
      code: "SOURCE_PERIOD_MISMATCH",
      evidence,
      recovery: `Select ${bannerMonth} or upload the BOA statement for ${selectedMonth}.`,
    };
  }

  if (!bannerMonth) {
    return {
      ok: true,
      evidence,
      warnings: [
        "BOA statement banner did not contain a usable accounting month; the filename is only a hint.",
      ],
    };
  }

  evidence.status = "confirmed";
  const warnings =
    filenameHint && filenameHint !== bannerMonth
      ? [
          `Filename month hint ${filenameHint} does not match BOA banner month ${bannerMonth}; the banner is authoritative.`,
        ]
      : [];
  return { ok: true, evidence, warnings };
}

export function deriveDealertrackPeriodEvidence(
  parsed: ParsedTable,
  filename: string | null,
  selectedMonth: AccountingMonth,
): SourcePeriodValidation {
  const observedDates = uniqueSortedDates(
    parsed.rows.flatMap((row) => row.flatMap((cell) => extractDates(cell))),
  );
  const explicitMonths = uniqueSortedMonths(
    observedDates.map((date) => date.slice(0, 7) as AccountingMonth),
  );
  const filenameHint = extractFilenameHint(filename, selectedMonth);
  const observedDateRange = observedDates.length > 0
    ? { min: observedDates[0], max: observedDates[observedDates.length - 1] }
    : null;
  const laterDates = observedDates.filter((date) => date > accountingMonthEndDate(selectedMonth));
  const evidence: SourcePeriodEvidence = {
    source: "dealertrack",
    selectedMonth,
    explicitMonths,
    observedDateRange,
    filenameHint,
    status: laterDates.length > 0 ? "contradictory" : "compatible_incomplete",
    safeEvidence: {
      usable_date_count: observedDates.length,
      later_date_count: laterDates.length,
      filename_hint_present: filenameHint !== null,
    },
  };

  if (laterDates.length > 0) {
    return {
      ok: false,
      code: "SOURCE_PERIOD_CONTRADICTORY",
      evidence,
      recovery: `Remove Dealertrack rows dated after ${accountingMonthEndDate(selectedMonth)} or select the correct accounting month.`,
    };
  }

  const warnings = observedDates.length > 0
    ? [
        `Dealertrack dates do not prove a complete accounting period; all observed dates are no later than ${selectedMonth}.`,
      ]
    : ["Dealertrack export did not contain a usable date; the filename is only a hint."];
  if (filenameHint && filenameHint !== selectedMonth) {
    warnings.push(
      `Filename month hint ${filenameHint} does not match selected month ${selectedMonth}; the filename is not authoritative.`,
    );
  }
  return { ok: true, evidence, warnings };
}

function rowsBeforeBoaHeader(rows: string[][]): string[][] {
  const headerIndex = rows.findIndex((row) => {
    const normalizedCells = row.map((cell) => cell.trim().toLowerCase());
    const hits = BOA_HEADER_TOKENS.filter((token) =>
      normalizedCells.some((cell) => cell.includes(token)),
    ).length;
    return hits >= 3;
  });
  return headerIndex < 0 ? rows.slice(0, 25) : rows.slice(0, headerIndex);
}

function extractMonthHints(value: string): AccountingMonth[] {
  const months: AccountingMonth[] = [];
  for (const match of value.matchAll(CANONICAL_MONTH_PATTERN)) {
    const month = parseAccountingMonth(match[1]);
    if (month) {
      months.push(month);
    }
  }
  for (const match of value.matchAll(MONTH_NAME_PATTERN)) {
    const monthNumber = ENGLISH_MONTHS[match[1].toLowerCase()];
    const month = parseAccountingMonth(`${match[2]}-${monthNumber}`);
    if (month) {
      months.push(month);
    }
  }
  return months;
}

function extractFilenameHint(
  filename: string | null,
  selectedMonth: AccountingMonth,
): AccountingMonth | null {
  if (!filename) {
    return null;
  }
  const explicitHint = extractMonthHints(filename)[0];
  if (explicitHint) {
    return explicitHint;
  }
  const monthWord = MONTH_WORD_PATTERN.exec(filename);
  if (!monthWord) {
    return null;
  }
  return parseAccountingMonth(
    `${selectedMonth.slice(0, 4)}-${ENGLISH_MONTHS[monthWord[1].toLowerCase()]}`,
  );
}

function extractDates(value: string): string[] {
  const dates: string[] = [];
  for (const match of value.matchAll(ISO_DATE_PATTERN)) {
    const normalized = normalizeDate(Number(match[1]), Number(match[2]), Number(match[3]));
    if (normalized) {
      dates.push(normalized);
    }
  }
  for (const match of value.matchAll(US_DATE_PATTERN)) {
    const rawYear = Number(match[3]);
    const year = match[3].length === 2 ? 2000 + rawYear : rawYear;
    const normalized = normalizeDate(year, Number(match[1]), Number(match[2]));
    if (normalized) {
      dates.push(normalized);
    }
  }
  return dates;
}

function normalizeDate(year: number, month: number, day: number): string | null {
  const accountingMonth = parseAccountingMonth(
    `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`,
  );
  if (!accountingMonth) {
    return null;
  }
  const lastDay = Number(accountingMonthEndDate(accountingMonth).slice(-2));
  if (day < 1 || day > lastDay) {
    return null;
  }
  return `${accountingMonth}-${String(day).padStart(2, "0")}`;
}

function uniqueSortedMonths(months: AccountingMonth[]): AccountingMonth[] {
  return [...new Set(months)].sort();
}

function uniqueSortedDates(dates: string[]): string[] {
  return [...new Set(dates)].sort();
}
