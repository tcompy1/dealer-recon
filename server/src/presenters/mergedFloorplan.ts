import { formatCents } from "../domain/money.js";
import { computeVin6, extractVin6FromDescription } from "../domain/vin6.js";
import type { ReconciliationRunDetail, SourceType, TransactionSummary } from "../domain/types.js";
import type { StoreWorkflowConfig } from "../config/storeWorkflowConfig.js";
import { neutralizeSpreadsheetText } from "../spreadsheetText.js";

export type MergedFloorplanRowClassification = "matched" | "boa_only" | "dealertrack_only";

export type MergedFloorplanRow = {
  store_description: string;
  serial_no_vin: string;
  boa_vin6: string;
  ending_balance_cents: number | null;
  dealertrack_account_amount_cents: number | null;
  dealertrack_vin6: string;
  dealertrack_description: string;
  dealertrack_control: string;
  classification: MergedFloorplanRowClassification;
};

export type MergedFloorplanWorkbook = {
  store_config: StoreWorkflowConfig;
  store_name: string;
  period_date: string | null;
  headers: string[];
  rows: MergedFloorplanRow[];
  boa_total_amount: string;
  boa_total_amount_cents: number;
  dealertrack_total_amount: string;
  dealertrack_total_amount_cents: number;
  variance_amount: string;
  variance_amount_cents: number;
};

export type BuildMergedFloorplanWorkbookInput = {
  storeConfig: StoreWorkflowConfig;
  boaRecords: TransactionSummary[];
  dealertrackRecords: TransactionSummary[];
  storeName?: string | null;
  periodDate?: string | null;
};

type DetailException = ReconciliationRunDetail["exceptions"][number];
type DetailMatchGroup = ReconciliationRunDetail["match_groups"][number];

export function buildMergedFloorplanWorkbook(
  input: BuildMergedFloorplanWorkbookInput,
): MergedFloorplanWorkbook {
  const dealertrackRecords = filterDealertrackRecordsByConfiguredAccount(
    input.dealertrackRecords,
    input.storeConfig,
  );

  return buildWorkbookFromRows({
    storeConfig: input.storeConfig,
    rows: sortMergedRows(
      buildRowsFromCleanedRecords(input.boaRecords, dealertrackRecords),
      input.storeConfig,
    ),
    storeName: input.storeName ?? input.storeConfig.displayName,
    periodDate: input.periodDate ?? resolvePeriodAnchorDateFromTransactions([
      ...input.boaRecords,
      ...dealertrackRecords,
    ]),
  });
}

export function buildMergedFloorplanWorkbookFromReconciliationDetail(
  detail: ReconciliationRunDetail,
  storeConfig: StoreWorkflowConfig,
): MergedFloorplanWorkbook {
  const rows = sortMergedRows([
    ...detail.match_groups.flatMap(buildRowsFromMatchGroup),
    ...detail.exceptions.flatMap(buildRowsFromException),
  ], storeConfig);

  return buildWorkbookFromRows({
    storeConfig,
    rows,
    storeName: detail.store_name ?? storeConfig.displayName,
    periodDate: resolvePeriodAnchorDate(detail),
  });
}

export function toMergedFloorplanXlsHtml(workbook: MergedFloorplanWorkbook): string {
  const accountingFormat = '\\\\\\(\\#\\,\\#\\#0\\.00\\\\\\)\\;\\#\\,\\#\\#0\\.00';
  const styles = `
    body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; color: #111827; }
    table { border-collapse: collapse; width: 1260px; }
    th, td { border: 1px solid #9ca3af; padding: 4px 8px; text-align: left; vertical-align: top; }
    th { background-color: #d9e2f3; color: #111827; font-weight: bold; }
    tr.title-row td { border: 0; font-size: 14pt; font-weight: bold; padding: 0 0 8px 0; }
    tr.period-row td { border: 0; padding: 0 0 8px 0; }
    tr.total-row td { background-color: #f3f4f6; font-weight: bold; }
    tr.variance-row td { background-color: #fff2cc; font-weight: bold; }
    td.amount { text-align: right; font-family: Consolas, Menlo, monospace; mso-number-format: '${accountingFormat}'; }
    td.amount-negative { color: #b91c1c; }
  `;
  const colWidths = [210, 160, 80, 120, 120, 80, 360, 130];
  const colgroup = `<colgroup>${colWidths.map((width) => `<col style="width:${width}px"/>`).join("")}</colgroup>`;

  return [
    "<!DOCTYPE html>",
    '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">',
    "<head>",
    '<meta charset="utf-8">',
    `<title>Merged Floorplan - ${escapeHtml(workbook.store_name)}</title>`,
    `<style>${styles}</style>`,
    "</head>",
    "<body>",
    `<table>${colgroup}`,
    "<thead>",
    `<tr class="title-row"><td colspan="8">Merged Floorplan - ${spreadsheetTextCell(workbook.store_name)}</td></tr>`,
    `<tr class="period-row"><td colspan="8">Period date ${spreadsheetTextCell(workbook.period_date ?? "")}</td></tr>`,
    `<tr>${workbook.headers.map((header) => `<th>${spreadsheetTextCell(header)}</th>`).join("")}</tr>`,
    "</thead>",
    `<tbody>${workbook.rows.map(rowHtml).join("")}</tbody>`,
    "<tfoot>",
    totalRowHtml(workbook),
    varianceRowHtml(workbook),
    "</tfoot>",
    "</table>",
    "</body>",
    "</html>",
  ].join("\n");
}

export function toMergedFloorplanFilename(workbook: MergedFloorplanWorkbook): string {
  const period = workbook.period_date?.replace(/[^0-9]/g, "-").replace(/^-|-$/g, "") || "period";
  return `${workbook.store_config.outputFilenamePrefix}-merged-floorplan-${period}.xls`;
}

function buildWorkbookFromRows(input: {
  storeConfig: StoreWorkflowConfig;
  rows: MergedFloorplanRow[];
  storeName: string;
  periodDate: string | null;
}): MergedFloorplanWorkbook {
  const boaTotalCents = input.rows.reduce(
    (total, row) => total + (row.ending_balance_cents ?? 0),
    0,
  );
  const dealertrackTotalCents = input.rows.reduce(
    (total, row) => total + (row.dealertrack_account_amount_cents ?? 0),
    0,
  );
  const varianceCents = boaTotalCents + dealertrackTotalCents;

  return {
    store_config: input.storeConfig,
    store_name: input.storeName,
    period_date: input.periodDate,
    headers: [
      input.storeConfig.mergedSheetLabel,
      "Serial No/VIN",
      "VIN6",
      "Ending Balance",
      input.storeConfig.dealertrackAccountLabel,
      "VIN6",
      "Description",
      "Control",
    ],
    rows: input.rows,
    boa_total_amount: formatCents(boaTotalCents),
    boa_total_amount_cents: boaTotalCents,
    dealertrack_total_amount: formatCents(dealertrackTotalCents),
    dealertrack_total_amount_cents: dealertrackTotalCents,
    variance_amount: formatCents(varianceCents),
    variance_amount_cents: varianceCents,
  };
}

function buildRowsFromCleanedRecords(
  boaRecords: TransactionSummary[],
  dealertrackRecords: TransactionSummary[],
): MergedFloorplanRow[] {
  const matchedDealertrackIds = new Set<number>();
  const rows: MergedFloorplanRow[] = [];

  for (const boa of boaRecords) {
    const boaVin6Value = boaVin6(boa);
    const matchedDealertrack = dealertrackRecords.find(
      (dealertrack) =>
        !matchedDealertrackIds.has(dealertrack.id) &&
        cleanedRecordAmountsMatch(boa, dealertrack) &&
        cleanedRecordIdentifiersMatch(boa, dealertrack, boaVin6Value),
    );

    if (matchedDealertrack) {
      matchedDealertrackIds.add(matchedDealertrack.id);
      rows.push(buildMatchedRow(boa, matchedDealertrack));
    } else {
      rows.push(buildBoaOnlyRow(boa));
    }
  }

  for (const dealertrack of dealertrackRecords) {
    if (!matchedDealertrackIds.has(dealertrack.id)) {
      rows.push(buildDealertrackOnlyRow(dealertrack));
    }
  }

  return rows;
}

function buildRowsFromMatchGroup(group: DetailMatchGroup): MergedFloorplanRow[] {
  const boa = group.transactions.find((linked) => isBoaSource(linked.source_type))?.transaction;
  const dealertrack = group.transactions.find((linked) =>
    isDealertrackSource(linked.source_type),
  )?.transaction;

  if (boa && dealertrack) {
    return [buildMatchedRow(boa, dealertrack)];
  }
  if (boa) {
    return [buildBoaOnlyRow(boa)];
  }
  if (dealertrack) {
    return [buildDealertrackOnlyRow(dealertrack)];
  }
  return [];
}

function buildRowsFromException(exception: DetailException): MergedFloorplanRow[] {
  if (isBoaSource(exception.source_type)) {
    return [buildBoaOnlyRow(exception.transaction)];
  }
  if (isDealertrackSource(exception.source_type)) {
    return [buildDealertrackOnlyRow(exception.transaction)];
  }
  return [];
}

function buildMatchedRow(
  boa: TransactionSummary,
  dealertrack: TransactionSummary,
): MergedFloorplanRow {
  const resolvedDealertrackVin6 = dealertrackVin6(dealertrack) || boaVin6(boa);
  return {
    ...emptyMergedRow("matched"),
    store_description: boa.description ?? "",
    serial_no_vin: boaVin(boa),
    boa_vin6: boaVin6(boa),
    ending_balance_cents: Math.abs(boa.amount_cents),
    dealertrack_account_amount_cents: dealertrackAccountCents(dealertrack),
    dealertrack_vin6: resolvedDealertrackVin6,
    dealertrack_description: dealertrack.description ?? "",
    dealertrack_control: dealertrackControl(dealertrack),
  };
}

function buildBoaOnlyRow(boa: TransactionSummary): MergedFloorplanRow {
  return {
    ...emptyMergedRow("boa_only"),
    store_description: boa.description ?? "",
    serial_no_vin: boaVin(boa),
    boa_vin6: boaVin6(boa),
    ending_balance_cents: Math.abs(boa.amount_cents),
  };
}

function buildDealertrackOnlyRow(dealertrack: TransactionSummary): MergedFloorplanRow {
  return {
    ...emptyMergedRow("dealertrack_only"),
    dealertrack_account_amount_cents: dealertrackAccountCents(dealertrack),
    dealertrack_vin6: dealertrackVin6(dealertrack),
    dealertrack_description: dealertrack.description ?? "",
    dealertrack_control: dealertrackControl(dealertrack),
  };
}

function emptyMergedRow(classification: MergedFloorplanRowClassification): MergedFloorplanRow {
  return {
    store_description: "",
    serial_no_vin: "",
    boa_vin6: "",
    ending_balance_cents: null,
    dealertrack_account_amount_cents: null,
    dealertrack_vin6: "",
    dealertrack_description: "",
    dealertrack_control: "",
    classification,
  };
}

function sortMergedRows(
  rows: MergedFloorplanRow[],
  storeConfig: StoreWorkflowConfig,
): MergedFloorplanRow[] {
  return [...rows].sort((left, right) => {
    const leftSortAmount = sortableAmount(left, storeConfig);
    const rightSortAmount = sortableAmount(right, storeConfig);
    const amountDelta = leftSortAmount - rightSortAmount;
    if (amountDelta !== 0) {
      return amountDelta;
    }
    return compareTieBreakers(left, right);
  });
}

function sortableAmount(row: MergedFloorplanRow, storeConfig: StoreWorkflowConfig): number {
  if (row.ending_balance_cents !== null) {
    return row.ending_balance_cents;
  }
  if (storeConfig.dtOnlyPlacementRule === "interleave_by_amount") {
    return Math.abs(row.dealertrack_account_amount_cents ?? 0);
  }
  return Number.MAX_SAFE_INTEGER;
}

function compareTieBreakers(left: MergedFloorplanRow, right: MergedFloorplanRow): number {
  return (
    left.boa_vin6.localeCompare(right.boa_vin6) ||
    left.dealertrack_vin6.localeCompare(right.dealertrack_vin6) ||
    left.dealertrack_control.localeCompare(right.dealertrack_control)
  );
}

function cleanedRecordAmountsMatch(
  boa: TransactionSummary,
  dealertrack: TransactionSummary,
): boolean {
  return Math.abs(boa.amount_cents) === Math.abs(dealertrack.amount_cents);
}

function cleanedRecordIdentifiersMatch(
  boa: TransactionSummary,
  dealertrack: TransactionSummary,
  boaVin6Value: string,
): boolean {
  const dealertrackVin6Value = dealertrackVin6(dealertrack);
  if (boaVin6Value.length > 0 && dealertrackVin6Value === boaVin6Value) {
    return true;
  }
  if (dealertrackVin6Value.length > 0) {
    return false;
  }

  return stockOrControlMatches(boa, dealertrack) || dealertrackVinPrefixMatches(boa, dealertrack);
}

function stockOrControlMatches(boa: TransactionSummary, dealertrack: TransactionSummary): boolean {
  const boaIdentifiers = [boa.stock_number, boa.reference_number]
    .map(normalizeIdentifier)
    .filter(Boolean);
  const dealertrackIdentifiers = [dealertrackControl(dealertrack)]
    .map(normalizeIdentifier)
    .filter(Boolean);
  return boaIdentifiers.some((identifier) => dealertrackIdentifiers.includes(identifier));
}

function dealertrackVinPrefixMatches(
  boa: TransactionSummary,
  dealertrack: TransactionSummary,
): boolean {
  const boaVinValue = boaVin(boa);
  const vinPrefix = dealertrackVinPrefix(dealertrack.description);
  return vinPrefix.length >= 8 && boaVinValue.startsWith(vinPrefix);
}

function rowHtml(row: MergedFloorplanRow): string {
  return `<tr>
    <td>${spreadsheetTextCell(row.store_description)}</td>
    <td>${spreadsheetTextCell(row.serial_no_vin)}</td>
    <td>${spreadsheetTextCell(row.boa_vin6)}</td>
    <td class="amount">${formatOptionalAccountingCents(row.ending_balance_cents)}</td>
    <td class="amount${(row.dealertrack_account_amount_cents ?? 0) < 0 ? " amount-negative" : ""}">${formatOptionalAccountingCents(row.dealertrack_account_amount_cents)}</td>
    <td>${spreadsheetTextCell(row.dealertrack_vin6)}</td>
    <td>${spreadsheetTextCell(row.dealertrack_description)}</td>
    <td>${spreadsheetTextCell(row.dealertrack_control)}</td>
  </tr>`;
}

function totalRowHtml(workbook: MergedFloorplanWorkbook): string {
  return `<tr class="total-row">
    <td>${spreadsheetTextCell(workbook.store_config.totalsRowLabels.boaTotalLabel)}</td>
    <td></td>
    <td></td>
    <td class="amount">${escapeHtml(formatAccountingCents(workbook.boa_total_amount_cents))}</td>
    <td class="amount${workbook.dealertrack_total_amount_cents < 0 ? " amount-negative" : ""}">${escapeHtml(formatAccountingCents(workbook.dealertrack_total_amount_cents))}</td>
    <td></td>
    <td>${spreadsheetTextCell(workbook.store_config.totalsRowLabels.dealertrackTotalLabel)}</td>
    <td></td>
  </tr>`;
}

function varianceRowHtml(workbook: MergedFloorplanWorkbook): string {
  return `<tr class="variance-row">
    <td>${spreadsheetTextCell(workbook.store_config.totalsRowLabels.varianceLabel)}</td>
    <td></td>
    <td></td>
    <td class="amount${workbook.variance_amount_cents < 0 ? " amount-negative" : ""}">${escapeHtml(formatAccountingCents(workbook.variance_amount_cents))}</td>
    <td></td>
    <td></td>
    <td></td>
    <td></td>
  </tr>`;
}

function spreadsheetTextCell(value: string | null | undefined): string {
  return escapeHtml(neutralizeSpreadsheetText(value ?? ""));
}

function filterDealertrackRecordsByConfiguredAccount(
  dealertrackRecords: TransactionSummary[],
  storeConfig: StoreWorkflowConfig,
): TransactionSummary[] {
  const configuredAccountValues = new Set([
    storeConfig.dealertrackAccountLabel,
    storeConfig.dealertrackAccountColumn,
    ...storeConfig.dealertrackAmountColumns,
  ]);

  return dealertrackRecords.filter((record) => {
    const account = record.account?.trim();
    if (account) {
      return configuredAccountValues.has(account);
    }

    const accountIdentifier = record.account_identifier?.trim();
    if (!accountIdentifier || accountIdentifier === "floorplan") {
      return true;
    }

    return configuredAccountValues.has(accountIdentifier);
  });
}

function isBoaSource(sourceType: SourceType): boolean {
  return sourceType === "boa";
}

function isDealertrackSource(sourceType: SourceType): boolean {
  return sourceType === "dealertrack" || sourceType === "dms" || sourceType === "gl";
}

function boaVin(transaction: TransactionSummary): string {
  return cleanVin(transaction.vin) || finalVinToken(transaction.description) || "";
}

function boaVin6(transaction: TransactionSummary): string {
  return computeVin6(boaVin(transaction)) ?? "";
}

function dealertrackVin6(transaction: TransactionSummary): string {
  return extractVin6FromDescription(transaction.description) ?? computeVin6(transaction.vin) ?? "";
}

function dealertrackVinPrefix(description: string | null | undefined): string {
  if (!description) {
    return "";
  }
  const candidates = description.toUpperCase().match(/\b(?=[A-HJ-NPR-Z0-9]{8,16}\b)(?=[A-HJ-NPR-Z0-9]*[A-Z])(?=[A-HJ-NPR-Z0-9]*\d)[A-HJ-NPR-Z0-9]{8,16}\b/g);
  return candidates?.at(-1) ?? "";
}

function finalVinToken(description: string | null | undefined): string {
  if (!description) {
    return "";
  }
  const tokens = description.toUpperCase().trim().split(/\s+/);
  const lastToken = tokens[tokens.length - 1];
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(lastToken ?? "") ? lastToken : "";
}

function cleanVin(vin: string | null | undefined): string {
  return vin?.toUpperCase().trim() ?? "";
}

function dealertrackAccountCents(transaction: TransactionSummary): number {
  return -Math.abs(transaction.amount_cents);
}

function dealertrackControl(transaction: TransactionSummary): string {
  return transaction.reference_number?.trim() || transaction.stock_number?.trim() || "";
}

function normalizeIdentifier(value: string | null | undefined): string {
  return value?.trim().toUpperCase() ?? "";
}

function resolvePeriodAnchorDateFromTransactions(transactions: TransactionSummary[]): string | null {
  let latestIso: string | null = null;
  for (const transaction of transactions) {
    latestIso = newerIsoDate(latestIso, transaction.transaction_date);
    latestIso = newerIsoDate(latestIso, transaction.post_date);
  }
  return formatDateMmDdYy(latestIso);
}

function resolvePeriodAnchorDate(detail: ReconciliationRunDetail): string | null {
  let latestIso: string | null = null;
  for (const exception of detail.exceptions) {
    latestIso = newerIsoDate(latestIso, exception.transaction.transaction_date);
    latestIso = newerIsoDate(latestIso, exception.transaction.post_date);
  }
  for (const group of detail.match_groups) {
    for (const linked of group.transactions) {
      latestIso = newerIsoDate(latestIso, linked.transaction.transaction_date);
      latestIso = newerIsoDate(latestIso, linked.transaction.post_date);
    }
  }
  return formatDateMmDdYy(latestIso ?? detail.created_at);
}

function newerIsoDate(current: string | null, value: string | null | undefined): string | null {
  if (!value) {
    return current;
  }
  const iso = value.length >= 10 ? value.slice(0, 10) : value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    return current;
  }
  return current === null || iso > current ? iso : current;
}

function formatDateMmDdYy(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (isoMatch) {
    const [, yyyy, mm, dd] = isoMatch;
    return `${mm}-${dd}-${yyyy.slice(2)}`;
  }
  const usMatch = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(trimmed);
  if (usMatch) {
    const [, mm, dd, yyRaw] = usMatch;
    const yy = yyRaw.length === 4 ? yyRaw.slice(2) : yyRaw.padStart(2, "0");
    return `${mm.padStart(2, "0")}-${dd.padStart(2, "0")}-${yy}`;
  }
  return trimmed;
}

function formatOptionalAccountingCents(amountCents: number | null): string {
  return amountCents === null ? "" : escapeHtml(formatAccountingCents(amountCents));
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

function escapeHtml(value: string | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
