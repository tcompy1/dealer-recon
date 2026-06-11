import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "csv-parse/sync";
import { describe, expect, test } from "vitest";

import { STORE_WORKFLOW_CONFIGS } from "../config/storeWorkflowConfig.js";
import { parseAmountToCents } from "../domain/money.js";
import type { NewTransaction, TransactionSummary } from "../domain/types.js";
import { parseCsvToTable } from "../services/parsers/csvTableParser.js";
import { preprocessBoa } from "../services/preprocessing/boaPreprocessor.js";
import { preprocessDealertrack } from "../services/preprocessing/dealertrackPreprocessor.js";
import {
  buildMergedFloorplanWorkbook,
  toMergedFloorplanFilename,
  toMergedFloorplanXlsHtml,
  type MergedFloorplanWorkbook,
} from "./mergedFloorplan.js";

const HURST_HEADERS = [
  "HURST",
  "Serial No/VIN",
  "VIN6",
  "Ending Balance",
  "2100",
  "VIN6",
  "Description",
  "Control",
];

const ACURA_HEADERS = [
  "ACURA",
  "Serial No/VIN",
  "VIN6",
  "Ending Balance",
  "324",
  "VIN6",
  "Description",
  "Control",
];

const FW_HEADERS = [
  "FW",
  "Serial No/VIN",
  "VIN6",
  "Ending Balance",
  "2100",
  "VIN6",
  "Description",
  "Control",
];

const presenterDir = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(presenterDir, "__fixtures__", "acura");
const fwFixtureDir = join(presenterDir, "__fixtures__", "fw");

type AcuraMergedFixtureCase = {
  month: "FEB" | "MARCH" | "APRIL";
  mergedFilename: string;
  rawBoaFilename: string;
  rawDealertrackFilename: string;
  expected: {
    detailRows: number;
    matched: number;
    boaOnly: number;
    dealertrackOnly: number;
    amountMismatchSplitRows: number;
    boaTotalCents: number;
    dealertrackTotalCents: number;
  };
};

type AcuraMergedFixtureRow = {
  storeDescription: string;
  serialNoVin: string;
  boaVin6: string;
  endingBalanceCents: number | null;
  dealertrackAccountAmountCents: number | null;
  dealertrackVin6: string;
  dealertrackDescription: string;
  dealertrackControl: string;
};

type AcuraMergedFixture = {
  headers: string[];
  rows: AcuraMergedFixtureRow[];
  counts: {
    matched: number;
    boaOnly: number;
    dealertrackOnly: number;
    amountMismatchSplitRows: number;
  };
  totals: {
    boaTotalCents: number;
    dealertrackTotalCents: number;
  };
};

const ACURA_MERGED_FIXTURE_CASES: AcuraMergedFixtureCase[] = [
  {
    month: "FEB",
    mergedFilename: "ACURA FEB MERGED(BillingStatementFebruary2026).csv",
    rawBoaFilename: "ACURA BOA FEB(in).csv",
    rawDealertrackFilename: "ACURA DT FEB(in).csv",
    expected: {
      detailRows: 129,
      matched: 114,
      boaOnly: 0,
      dealertrackOnly: 15,
      amountMismatchSplitRows: 0,
      boaTotalCents: 546_981_440,
      dealertrackTotalCents: -618_816_030,
    },
  },
  {
    month: "MARCH",
    mergedFilename: "ACURA MARCH MERGED(BillingStatementMarch2026).csv",
    rawBoaFilename: "ACURA BOA MARCH(in).csv",
    rawDealertrackFilename: "ACURA DT MARCH(in).csv",
    expected: {
      detailRows: 213,
      matched: 204,
      boaOnly: 0,
      dealertrackOnly: 9,
      amountMismatchSplitRows: 0,
      boaTotalCents: 980_937_310,
      dealertrackTotalCents: -1_027_649_870,
    },
  },
  {
    month: "APRIL",
    mergedFilename: "ACURA APRIL MERGED(BillingStatementApril2026).csv",
    rawBoaFilename: "ACURA BOA APRIL(in).csv",
    rawDealertrackFilename: "ACURA DT APRIL(in).csv",
    expected: {
      detailRows: 208,
      matched: 199,
      boaOnly: 0,
      dealertrackOnly: 9,
      amountMismatchSplitRows: 0,
      boaTotalCents: 1_005_665_140,
      dealertrackTotalCents: -1_039_411_200,
    },
  },
];

const FW_MERGED_FIXTURE_CASES: AcuraMergedFixtureCase[] = [
  {
    month: "FEB",
    mergedFilename: "FW FEB MERGED.csv",
    rawBoaFilename: "FW BOA FEB.csv",
    rawDealertrackFilename: "FW DT FEB.csv",
    expected: {
      detailRows: 688,
      matched: 620,
      boaOnly: 53,
      dealertrackOnly: 15,
      amountMismatchSplitRows: 0,
      boaTotalCents: 3_449_894_154,
      dealertrackTotalCents: -3_275_177_349,
    },
  },
  {
    month: "MARCH",
    mergedFilename: "FW MARCH MERGED.csv",
    rawBoaFilename: "FW BOA MARCH.csv",
    rawDealertrackFilename: "FW DT MARCH.csv",
    expected: {
      detailRows: 825,
      matched: 749,
      boaOnly: 63,
      dealertrackOnly: 13,
      amountMismatchSplitRows: 22,
      boaTotalCents: 4_113_446_598,
      dealertrackTotalCents: -3_776_546_994,
    },
  },
  {
    month: "APRIL",
    mergedFilename: "FW APRIL MERGED.csv",
    rawBoaFilename: "FW BOA APRIL.csv",
    rawDealertrackFilename: "FW DT APRIL.csv",
    expected: {
      detailRows: 832,
      matched: 687,
      boaOnly: 107,
      dealertrackOnly: 38,
      amountMismatchSplitRows: 24,
      boaTotalCents: 4_034_820_196,
      dealertrackTotalCents: -3_599_702_841,
    },
  },
];

function transaction(overrides: Partial<TransactionSummary> = {}): TransactionSummary {
  return {
    id: 1,
    dealership_id: 1,
    source_type: "boa",
    transaction_date: "2026-04-30",
    post_date: null,
    amount: "29855.00",
    amount_cents: 2_985_500,
    reference_number: null,
    description: "2025 Mazda CX5",
    account: null,
    account_type: "floorplan",
    account_identifier: "floorplan",
    stock_number: null,
    vin: "JM3KFBAL0S0764873",
    ...overrides,
  };
}

function boa(
  id: number,
  amountCents: number,
  vin: string,
  description: string,
): TransactionSummary {
  return transaction({
    id,
    source_type: "boa",
    amount: (amountCents / 100).toFixed(2),
    amount_cents: amountCents,
    description,
    vin,
    reference_number: null,
    stock_number: null,
    account: null,
    account_identifier: "floorplan",
  });
}

function dealertrack(
  id: number,
  amountCents: number,
  vin: string,
  description: string,
  control: string,
  accountIdentifier: string,
): TransactionSummary {
  return transaction({
    id,
    source_type: "dealertrack",
    amount: (-Math.abs(amountCents) / 100).toFixed(2),
    amount_cents: -Math.abs(amountCents),
    reference_number: control,
    stock_number: control,
    description: `${description}   4/30/26  ${vin}`,
    account: accountIdentifier,
    account_identifier: accountIdentifier,
    vin,
  });
}

function contractWorkbook(
  storeConfig = STORE_WORKFLOW_CONFIGS.hurst,
): MergedFloorplanWorkbook {
  return buildMergedFloorplanWorkbook({
    storeConfig,
    storeName: storeConfig.displayName,
    periodDate: "04-30-26",
    boaRecords: [
      boa(101, 2_985_500, "JM3KFBAL0S0764873", "MATCHED BOA CX5"),
      boa(102, 3_599_900, "JM3KMCHA6T0126368", "BOA ONLY CX5"),
      boa(103, 3_228_300, "JM1BPBLL0T1870612", "AMOUNT MISMATCH BOA"),
    ],
    dealertrackRecords: [
      dealertrack(
        201,
        2_985_500,
        "JM3KFBAL0S0764873",
        "MATCHED DT CX5",
        "M21276",
        storeConfig.dealertrackAccountColumn,
      ),
      dealertrack(
        202,
        2_625_100,
        "JM1BPABL0T1867950",
        "DT ONLY TRANSFER",
        "M21317",
        storeConfig.dealertrackAccountColumn,
      ),
      dealertrack(
        203,
        3_177_100,
        "JM1BPBLL0T1870612",
        "AMOUNT MISMATCH DT",
        "M21472",
        storeConfig.dealertrackAccountColumn,
      ),
    ],
  });
}

function findRow(
  workbook: MergedFloorplanWorkbook,
  predicate: (row: MergedFloorplanWorkbook["rows"][number]) => boolean,
) {
  return workbook.rows.find(predicate);
}

function extractTableRows(html: string): string[][] {
  return [...html.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map(([rowHtml]) =>
    [...rowHtml.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(([, cellHtml]) =>
      normalizeCellText(cellHtml),
    ),
  );
}

function normalizeCellText(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

describe("merged floorplan presenter", () => {
  test("uses Hurst merged headers from store config", () => {
    const workbook = contractWorkbook(STORE_WORKFLOW_CONFIGS.hurst);
    const html = toMergedFloorplanXlsHtml(workbook);

    expect(workbook.headers).toEqual(HURST_HEADERS);
    expect(html).toContain("<th>HURST</th>");
    expect(html).toContain("<th>2100</th>");
    expect(toMergedFloorplanFilename(workbook)).toBe("hurst-merged-floorplan-04-30-26.xls");
  });

  test("uses Acura merged headers from store config without hardcoded Hurst account labels", () => {
    const workbook = contractWorkbook(STORE_WORKFLOW_CONFIGS.acura);
    const html = toMergedFloorplanXlsHtml(workbook);

    expect(workbook.headers).toEqual(ACURA_HEADERS);
    expect(html).toContain("<th>ACURA</th>");
    expect(html).toContain("<th>324</th>");
    expect(html).not.toContain("<th>HURST</th>");
    expect(html).not.toContain("<th>2100</th>");
    expect(html).not.toContain("2100 total");
  });

  test("uses FW merged headers and display account label from store config", () => {
    const workbook = contractWorkbook(STORE_WORKFLOW_CONFIGS.fw);
    const html = toMergedFloorplanXlsHtml(workbook);

    expect(workbook.headers).toEqual(FW_HEADERS);
    expect(html).toContain("<th>FW</th>");
    expect(html).toContain("<th>2100</th>");
    expect(workbook.store_config.dealertrackAmountColumns).toEqual(["2100", "2101", "2101S"]);
    expect(workbook.store_config.dealertrackExcludedAccountColumns).toEqual(["2110"]);
    expect(workbook.store_config.mergedSheetLabelAliases).toEqual(["FW", "FORT WORTH"]);
  });

  test("builds matched, BOA-only, Dealertrack-only, and amount-mismatch split rows", () => {
    const workbook = contractWorkbook();

    expect(workbook.rows.map((row) => row.classification).sort()).toEqual([
      "boa_only",
      "boa_only",
      "dealertrack_only",
      "dealertrack_only",
      "matched",
    ]);

    const matched = findRow(workbook, (row) => row.classification === "matched");
    expect(matched).toMatchObject({
      store_description: "MATCHED BOA CX5",
      serial_no_vin: "JM3KFBAL0S0764873",
      boa_vin6: "764873",
      ending_balance_cents: 2_985_500,
      dealertrack_account_amount_cents: -2_985_500,
      dealertrack_vin6: "764873",
      dealertrack_control: "M21276",
    });

    const boaOnly = findRow(workbook, (row) => row.store_description === "BOA ONLY CX5");
    expect(boaOnly).toMatchObject({
      classification: "boa_only",
      dealertrack_account_amount_cents: null,
      dealertrack_vin6: "",
      dealertrack_description: "",
      dealertrack_control: "",
    });

    const dealertrackOnly = findRow(workbook, (row) =>
      row.dealertrack_description.startsWith("DT ONLY TRANSFER"),
    );
    expect(dealertrackOnly).toMatchObject({
      classification: "dealertrack_only",
      store_description: "",
      serial_no_vin: "",
      boa_vin6: "",
      ending_balance_cents: null,
      dealertrack_account_amount_cents: -2_625_100,
      dealertrack_vin6: "867950",
      dealertrack_control: "M21317",
    });

    const boaMismatch = findRow(
      workbook,
      (row) => row.store_description === "AMOUNT MISMATCH BOA",
    );
    const dealertrackMismatch = findRow(workbook, (row) =>
      row.dealertrack_description.startsWith("AMOUNT MISMATCH DT"),
    );
    const mergedMismatchRows = workbook.rows.filter(
      (row) =>
        row.boa_vin6 === "870612" &&
        row.dealertrack_vin6 === "870612" &&
        row.ending_balance_cents !== null &&
        row.dealertrack_account_amount_cents !== null,
    );

    expect(boaMismatch).toMatchObject({
      classification: "boa_only",
      ending_balance_cents: 3_228_300,
      dealertrack_account_amount_cents: null,
    });
    expect(dealertrackMismatch).toMatchObject({
      classification: "dealertrack_only",
      ending_balance_cents: null,
      dealertrack_account_amount_cents: -3_177_100,
      dealertrack_vin6: "870612",
    });
    expect(mergedMismatchRows).toHaveLength(0);
  });

  test("renders one totals row using the configured Dealertrack account label", () => {
    const workbook = contractWorkbook(STORE_WORKFLOW_CONFIGS.acura);
    const rows = extractTableRows(toMergedFloorplanXlsHtml(workbook));
    const totalsRow = rows.find((row) => row[0] === "BOA total");

    expect(totalsRow).toBeDefined();
    expect(totalsRow?.[3]).toBe("98,137.00");
    expect(totalsRow?.[4]).toBe("(87,877.00)");
    expect(totalsRow?.[6]).toBe("324 total");
  });

  test("filters Dealertrack rows by the configured account column", () => {
    const workbook = buildMergedFloorplanWorkbook({
      storeConfig: STORE_WORKFLOW_CONFIGS.acura,
      storeName: "Acura",
      periodDate: "04-30-26",
      boaRecords: [boa(101, 2_985_500, "JM3KFBAL0S0764873", "ACURA MATCH")],
      dealertrackRecords: [
        dealertrack(201, 2_985_500, "JM3KFBAL0S0764873", "WRONG ACCOUNT", "A1000", "2100"),
        dealertrack(202, 2_985_500, "JM3KFBAL0S0764873", "RIGHT ACCOUNT", "A1001", "324"),
      ],
    });

    expect(workbook.rows).toHaveLength(1);
    expect(workbook.rows[0]).toMatchObject({
      classification: "matched",
      dealertrack_description: "RIGHT ACCOUNT   4/30/26  JM3KFBAL0S0764873",
      dealertrack_control: "A1001",
    });
  });
});

describe("Acura merged floorplan golden fixtures", () => {
  test.each(ACURA_MERGED_FIXTURE_CASES)(
    "parses Tara's $month merged CSV structure, counts, and totals",
    (fixtureCase) => {
      const fixture = parseAcuraMergedFixture(fixtureCase.mergedFilename);

      expect(readFixture(fixtureCase.rawBoaFilename).length).toBeGreaterThan(0);
      expect(readFixture(fixtureCase.rawDealertrackFilename).length).toBeGreaterThan(0);
      expect(fixture.headers).toEqual(ACURA_HEADERS);
      expect(fixture.rows).toHaveLength(fixtureCase.expected.detailRows);
      expect(fixture.counts).toEqual({
        matched: fixtureCase.expected.matched,
        boaOnly: fixtureCase.expected.boaOnly,
        dealertrackOnly: fixtureCase.expected.dealertrackOnly,
        amountMismatchSplitRows: fixtureCase.expected.amountMismatchSplitRows,
      });
      expect(fixture.totals).toEqual({
        boaTotalCents: fixtureCase.expected.boaTotalCents,
        dealertrackTotalCents: fixtureCase.expected.dealertrackTotalCents,
      });
    },
  );

  test.each(ACURA_MERGED_FIXTURE_CASES)(
    "generates Acura merged presenter output matching $month fixture-derived expectations",
    (fixtureCase) => {
      const fixture = parseAcuraMergedFixture(fixtureCase.mergedFilename);
      const { boaRecords, dealertrackRecords } = fixtureRowsToCleanedRecords(fixture.rows);

      const workbook = buildMergedFloorplanWorkbook({
        storeConfig: STORE_WORKFLOW_CONFIGS.acura,
        storeName: "Acura",
        periodDate: fixtureCase.month,
        boaRecords,
        dealertrackRecords,
      });
      const htmlRows = extractTableRows(toMergedFloorplanXlsHtml(workbook));
      const headerRow = htmlRows.find((row) => row.join("|") === ACURA_HEADERS.join("|"));
      const totalsRow = htmlRows.find((row) => row[0] === "BOA total");

      expect(workbook.headers).toEqual(ACURA_HEADERS);
      expect(headerRow).toEqual(ACURA_HEADERS);
      expect(countWorkbookRows(workbook)).toEqual({
        matched: fixtureCase.expected.matched,
        boaOnly: fixtureCase.expected.boaOnly,
        dealertrackOnly: fixtureCase.expected.dealertrackOnly,
      });
      expect(countAmountMismatchSplitRows(workbook.rows)).toBe(
        fixtureCase.expected.amountMismatchSplitRows,
      );
      expect(workbook.boa_total_amount_cents).toBe(fixtureCase.expected.boaTotalCents);
      expect(workbook.dealertrack_total_amount_cents).toBe(
        fixtureCase.expected.dealertrackTotalCents,
      );
      expect(totalsRow?.[3]).toBe(formatAccountingCents(fixtureCase.expected.boaTotalCents));
      expect(totalsRow?.[4]).toBe(
        formatAccountingCents(fixtureCase.expected.dealertrackTotalCents),
      );
      expect(totalsRow?.[6]).toBe("324 total");
    },
  );
});

describe("Acura raw preprocessing to merged floorplan", () => {
  test.each(ACURA_MERGED_FIXTURE_CASES)(
    "preprocesses raw Acura $month BOA/DT files into presenter inputs matching Tara's merged CSV",
    (fixtureCase) => {
      const expectedFixture = parseAcuraMergedFixture(fixtureCase.mergedFilename);
      const { boaResult, dealertrackResult, boaRecords, dealertrackRecords } =
        preprocessRawAcuraFixtures(fixtureCase);

      expect(boaResult.validationErrors).toEqual([]);
      expect(dealertrackResult.validationErrors).toEqual([]);
      expect(boaResult.transactions).toHaveLength(
        fixtureCase.expected.matched + fixtureCase.expected.boaOnly,
      );
      expect(dealertrackResult.transactions).toHaveLength(
        fixtureCase.expected.matched + fixtureCase.expected.dealertrackOnly,
      );

      const workbook = buildMergedFloorplanWorkbook({
        storeConfig: STORE_WORKFLOW_CONFIGS.acura,
        storeName: "Acura",
        periodDate: fixtureCase.month,
        boaRecords,
        dealertrackRecords,
      });

      expect(workbook.headers).toEqual(ACURA_HEADERS);
      expect(countWorkbookRows(workbook)).toEqual({
        matched: expectedFixture.counts.matched,
        boaOnly: expectedFixture.counts.boaOnly,
        dealertrackOnly: expectedFixture.counts.dealertrackOnly,
      });
      expect(workbook.boa_total_amount_cents).toBe(expectedFixture.totals.boaTotalCents);
      expect(workbook.dealertrack_total_amount_cents).toBe(
        expectedFixture.totals.dealertrackTotalCents,
      );
    },
  );
});

describe("FW merged floorplan golden fixtures", () => {
  test.each(FW_MERGED_FIXTURE_CASES)(
    "parses Tara's $month FW merged CSV structure, counts, and totals",
    (fixtureCase) => {
      const fixture = parseFwMergedFixture(fixtureCase.mergedFilename);

      expect(readFwFixture("raw", fixtureCase.rawBoaFilename).length).toBeGreaterThan(0);
      expect(readFwFixture("raw", fixtureCase.rawDealertrackFilename).length).toBeGreaterThan(0);
      expect(STORE_WORKFLOW_CONFIGS.fw.mergedSheetLabelAliases).toContain(fixture.headers[0]);
      expect(fixture.headers.slice(1)).toEqual(FW_HEADERS.slice(1));
      expect(fixture.rows).toHaveLength(fixtureCase.expected.detailRows);
      expect(fixture.counts).toEqual({
        matched: fixtureCase.expected.matched,
        boaOnly: fixtureCase.expected.boaOnly,
        dealertrackOnly: fixtureCase.expected.dealertrackOnly,
        amountMismatchSplitRows: fixtureCase.expected.amountMismatchSplitRows,
      });
      expect(fixture.totals).toEqual({
        boaTotalCents: fixtureCase.expected.boaTotalCents,
        dealertrackTotalCents: fixtureCase.expected.dealertrackTotalCents,
      });
    },
  );
});

describe("FW raw preprocessing to merged floorplan", () => {
  test.each(FW_MERGED_FIXTURE_CASES)(
    "preprocesses raw FW $month BOA/DT files into presenter inputs matching Tara's merged CSV",
    (fixtureCase) => {
      const expectedFixture = parseFwMergedFixture(fixtureCase.mergedFilename);
      const { boaResult, dealertrackResult, boaRecords, dealertrackRecords } =
        preprocessRawFwFixtures(fixtureCase);

      expect(boaResult.validationErrors).toEqual([]);
      expect(dealertrackResult.validationErrors).toEqual([]);
      expect(boaResult.transactions).toHaveLength(
        fixtureCase.expected.matched + fixtureCase.expected.boaOnly,
      );
      expect(dealertrackResult.transactions).toHaveLength(
        fixtureCase.expected.matched + fixtureCase.expected.dealertrackOnly,
      );
      expect(
        dealertrackResult.transactions.every(
          (transaction) =>
            transaction.account === "2100" &&
            transaction.account_identifier === "floorplan",
        ),
      ).toBe(true);

      const workbook = buildMergedFloorplanWorkbook({
        storeConfig: STORE_WORKFLOW_CONFIGS.fw,
        storeName: "Hiley Cars Fort Worth",
        periodDate: fixtureCase.month,
        boaRecords,
        dealertrackRecords,
      });

      expect(workbook.headers).toEqual(FW_HEADERS);
      expect(countWorkbookRows(workbook)).toEqual({
        matched: expectedFixture.counts.matched,
        boaOnly: expectedFixture.counts.boaOnly,
        dealertrackOnly: expectedFixture.counts.dealertrackOnly,
      });
      expect(workbook.boa_total_amount_cents).toBe(expectedFixture.totals.boaTotalCents);
      expect(workbook.dealertrack_total_amount_cents).toBe(
        expectedFixture.totals.dealertrackTotalCents,
      );
    },
  );
});

// The accepted merged worksheet tests derive cleaned presenter inputs from
// Tara's clerk workbook. The raw preprocessing tests above prove Acura CSV
// preprocessors can now produce the same input counts and totals; remaining
// wiring work is choosing the store config from upload/run context.
function parseAcuraMergedFixture(filename: string): AcuraMergedFixture {
  const records = parse(readFixture(filename), {
    relax_column_count: true,
    skip_empty_lines: false,
  }) as string[][];
  const [headerRow, ...dataRows] = records;
  const nonEmptyRows = dataRows.filter((row) => row.some(hasText));
  const totalRowIndex = nonEmptyRows.findIndex((row) => text(row[6]) === "Final Totals:");
  if (totalRowIndex === -1) {
    throw new Error(`${filename} is missing the Acura Final Totals row`);
  }

  const totalRow = nonEmptyRows[totalRowIndex];
  const detailRows = nonEmptyRows
    .filter((_, index) => index !== totalRowIndex)
    .map(toAcuraMergedFixtureRow);

  return {
    headers: normalizeAcuraHeaders(headerRow),
    rows: detailRows,
    counts: countFixtureRows(detailRows),
    totals: {
      boaTotalCents: requireParsedAmount(totalRow[3], filename, "BOA total"),
      dealertrackTotalCents: requireParsedAmount(totalRow[4], filename, "Dealertrack total"),
    },
  };
}

function preprocessRawAcuraFixtures(fixtureCase: AcuraMergedFixtureCase): {
  boaResult: ReturnType<typeof preprocessBoa>;
  dealertrackResult: ReturnType<typeof preprocessDealertrack>;
  boaRecords: TransactionSummary[];
  dealertrackRecords: TransactionSummary[];
} {
  const boaParsed = parseCsvToTable(readFixture(fixtureCase.rawBoaFilename), "no_header");
  const dealertrackParsed = parseCsvToTable(readFixture(fixtureCase.rawDealertrackFilename), "with_header");
  const boaResult = preprocessBoa(boaParsed);
  const dealertrackResult = preprocessDealertrack(dealertrackParsed, {
    amountColumns: STORE_WORKFLOW_CONFIGS.acura.dealertrackAmountColumns,
    accountColumn: STORE_WORKFLOW_CONFIGS.acura.dealertrackAccountColumn,
    accountLabel: STORE_WORKFLOW_CONFIGS.acura.dealertrackAccountLabel,
    excludedAccountColumns: STORE_WORKFLOW_CONFIGS.acura.dealertrackExcludedAccountColumns,
  });

  return {
    boaResult,
    dealertrackResult,
    boaRecords: boaResult.transactions.map((record, index) =>
      toTransactionSummary(record, index + 1),
    ),
    dealertrackRecords: dealertrackResult.transactions.map((record, index) =>
      toTransactionSummary(record, 10_000 + index),
    ),
  };
}

function parseFwMergedFixture(filename: string): AcuraMergedFixture {
  const records = parse(readFwFixture("merged", filename), {
    relax_column_count: true,
    skip_empty_lines: false,
  }) as string[][];
  const [headerRow, ...dataRows] = records;
  const nonEmptyRows = dataRows.filter((row) => row.some(hasText));
  const totalRowIndex = nonEmptyRows.findIndex((row) => text(row[6]) === "Final Totals:");
  if (totalRowIndex === -1) {
    throw new Error(`${filename} is missing the FW Final Totals row`);
  }

  const totalRow = nonEmptyRows[totalRowIndex];
  const detailRows = nonEmptyRows
    .filter((_, index) => index !== totalRowIndex)
    .map(toAcuraMergedFixtureRow);

  return {
    headers: normalizeFwHeaders(headerRow),
    rows: detailRows,
    counts: countFixtureRows(detailRows),
    totals: {
      boaTotalCents: requireParsedAmount(totalRow[3], filename, "BOA total"),
      dealertrackTotalCents: requireParsedAmount(totalRow[4], filename, "Dealertrack total"),
    },
  };
}

function preprocessRawFwFixtures(fixtureCase: AcuraMergedFixtureCase): {
  boaResult: ReturnType<typeof preprocessBoa>;
  dealertrackResult: ReturnType<typeof preprocessDealertrack>;
  boaRecords: TransactionSummary[];
  dealertrackRecords: TransactionSummary[];
} {
  const boaParsed = parseCsvToTable(readFwFixture("raw", fixtureCase.rawBoaFilename), "no_header");
  const dealertrackParsed = parseCsvToTable(
    readFwFixture("raw", fixtureCase.rawDealertrackFilename),
    "with_header",
  );
  const boaResult = preprocessBoa(boaParsed);
  const dealertrackResult = preprocessDealertrack(dealertrackParsed, {
    amountColumns: STORE_WORKFLOW_CONFIGS.fw.dealertrackAmountColumns,
    accountColumn: STORE_WORKFLOW_CONFIGS.fw.dealertrackAccountColumn,
    accountLabel: STORE_WORKFLOW_CONFIGS.fw.dealertrackAccountLabel,
    excludedAccountColumns: STORE_WORKFLOW_CONFIGS.fw.dealertrackExcludedAccountColumns,
  });

  return {
    boaResult,
    dealertrackResult,
    boaRecords: boaResult.transactions.map((record, index) =>
      toTransactionSummary(record, index + 1),
    ),
    dealertrackRecords: dealertrackResult.transactions.map((record, index) =>
      toTransactionSummary(record, 10_000 + index),
    ),
  };
}

function toAcuraMergedFixtureRow(row: string[]): AcuraMergedFixtureRow {
  return {
    storeDescription: text(row[0]),
    serialNoVin: text(row[1]),
    boaVin6: text(row[2]),
    endingBalanceCents: parseAmountToCents(row[3]),
    dealertrackAccountAmountCents: parseAmountToCents(row[4]),
    dealertrackVin6: text(row[5]),
    dealertrackDescription: text(row[6]),
    dealertrackControl: text(row[7]),
  };
}

function fixtureRowsToCleanedRecords(rows: AcuraMergedFixtureRow[]): {
  boaRecords: TransactionSummary[];
  dealertrackRecords: TransactionSummary[];
} {
  const boaRecords: TransactionSummary[] = [];
  const dealertrackRecords: TransactionSummary[] = [];
  let id = 1;

  for (const row of rows) {
    if (hasBoaSide(row)) {
      boaRecords.push(
        transaction({
          id: id++,
          source_type: "boa",
          transaction_date: null,
          amount: String((row.endingBalanceCents ?? 0) / 100),
          amount_cents: row.endingBalanceCents ?? 0,
          description: row.storeDescription,
          account: null,
          account_identifier: "floorplan",
          reference_number: null,
          stock_number: null,
          vin: row.serialNoVin,
        }),
      );
    }

    if (hasDealertrackSide(row)) {
      dealertrackRecords.push(
        transaction({
          id: id++,
          source_type: "dealertrack",
          transaction_date: null,
          amount: String((row.dealertrackAccountAmountCents ?? 0) / 100),
          amount_cents: row.dealertrackAccountAmountCents ?? 0,
          description: row.dealertrackDescription,
          account: "324",
          account_identifier: "324",
          reference_number: row.dealertrackControl || null,
          stock_number: row.dealertrackControl || null,
          vin: finalVinToken(row.dealertrackDescription),
        }),
      );
    }
  }

  return { boaRecords, dealertrackRecords };
}

function toTransactionSummary(
  transaction: NewTransaction,
  id: number,
): TransactionSummary {
  return {
    id,
    dealership_id: 1,
    source_type: transaction.source_type,
    transaction_date: transaction.transaction_date,
    post_date: transaction.post_date,
    amount: String(transaction.amount_cents / 100),
    amount_cents: transaction.amount_cents,
    reference_number: transaction.reference_number,
    description: transaction.description,
    account: transaction.account,
    account_type: transaction.account_type,
    account_identifier: transaction.account_identifier,
    stock_number: transaction.stock_number,
    vin: transaction.vin,
  };
}

function countFixtureRows(rows: AcuraMergedFixtureRow[]): AcuraMergedFixture["counts"] {
  const boaOnlyRows = rows.filter((row) => hasBoaSide(row) && !hasDealertrackSide(row));
  const dealertrackOnlyRows = rows.filter((row) => !hasBoaSide(row) && hasDealertrackSide(row));
  return {
    matched: rows.filter((row) => hasBoaSide(row) && hasDealertrackSide(row)).length,
    boaOnly: boaOnlyRows.length,
    dealertrackOnly: dealertrackOnlyRows.length,
    amountMismatchSplitRows: countAmountMismatchSplitRows([
      ...boaOnlyRows.map((row) => ({ boa_vin6: row.boaVin6, dealertrack_vin6: "" })),
      ...dealertrackOnlyRows.map((row) => ({ boa_vin6: "", dealertrack_vin6: row.dealertrackVin6 })),
    ]),
  };
}

function countWorkbookRows(workbook: MergedFloorplanWorkbook): {
  matched: number;
  boaOnly: number;
  dealertrackOnly: number;
} {
  return {
    matched: workbook.rows.filter((row) => row.classification === "matched").length,
    boaOnly: workbook.rows.filter((row) => row.classification === "boa_only").length,
    dealertrackOnly: workbook.rows.filter((row) => row.classification === "dealertrack_only").length,
  };
}

function countAmountMismatchSplitRows(
  rows: Array<{
    boa_vin6: string;
    dealertrack_vin6: string;
    classification?: "matched" | "boa_only" | "dealertrack_only";
  }>,
): number {
  const sideSpecificRows = rows.filter((row) => row.classification !== "matched");
  const boaOnlyVin6 = new Set(sideSpecificRows.map((row) => row.boa_vin6).filter(Boolean));
  const dealertrackOnlyVin6 = new Set(
    sideSpecificRows.map((row) => row.dealertrack_vin6).filter(Boolean),
  );
  let splitRows = 0;
  for (const vin6 of boaOnlyVin6) {
    if (dealertrackOnlyVin6.has(vin6)) {
      splitRows += sideSpecificRows.filter((row) => row.boa_vin6 === vin6).length;
      splitRows += sideSpecificRows.filter((row) => row.dealertrack_vin6 === vin6).length;
    }
  }
  return splitRows;
}

function normalizeAcuraHeaders(row: string[]): string[] {
  return row.map((cell) => {
    const value = text(cell);
    return value.toLowerCase() === "vin6" ? "VIN6" : value;
  });
}

function normalizeFwHeaders(row: string[]): string[] {
  return row.map((cell) => {
    const value = text(cell);
    return value.toLowerCase() === "vin6" ? "VIN6" : value;
  });
}

function hasBoaSide(row: AcuraMergedFixtureRow): boolean {
  return [row.storeDescription, row.serialNoVin, row.boaVin6].some(hasText) ||
    row.endingBalanceCents !== null;
}

function hasDealertrackSide(row: AcuraMergedFixtureRow): boolean {
  return [row.dealertrackVin6, row.dealertrackDescription, row.dealertrackControl].some(hasText) ||
    row.dealertrackAccountAmountCents !== null;
}

function readFixture(filename: string): string {
  return readFileSync(join(fixtureDir, filename), "utf8");
}

function readFwFixture(_kind: "raw" | "merged", filename: string): string {
  return readFileSync(join(fwFixtureDir, filename), "utf8");
}

function requireParsedAmount(
  value: string | null | undefined,
  filename: string,
  label: string,
): number {
  const cents = parseAmountToCents(value);
  if (cents === null) {
    throw new Error(`${filename} has an invalid ${label}: ${String(value)}`);
  }
  return cents;
}

function text(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

function hasText(value: string | null | undefined): boolean {
  return text(value).length > 0;
}

function finalVinToken(description: string | null | undefined): string | null {
  const tokens = text(description).toUpperCase().split(/\s+/);
  const lastToken = tokens[tokens.length - 1];
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(lastToken ?? "") ? lastToken : null;
}

function formatAccountingCents(amountCents: number): string {
  const absCents = Math.abs(amountCents);
  const dollars = Math.floor(absCents / 100);
  const cents = String(absCents % 100).padStart(2, "0");
  const dollarsWithCommas = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return amountCents < 0 ? `(${dollarsWithCommas}.${cents})` : `${dollarsWithCommas}.${cents}`;
}
