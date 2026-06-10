import { describe, expect, test } from "vitest";

import type { ReconciliationRunDetail, SourceType, TransactionSummary } from "../domain/types.js";
import { buildHurstFpRecWorkbook, toHurstFpRecFilename, toHurstFpRecXlsHtml } from "./hurstFpRec.js";

function buildDetail(overrides: Partial<ReconciliationRunDetail> = {}): ReconciliationRunDetail {
  return {
    reconciliation_run_id: 42,
    dealership_id: 1,
    dealership_store_id: 1,
    store_name: "Hiley Hurst",
    dealer_group_id: null,
    dealer_group_name: null,
    boa_source_file_id: 1,
    dealertrack_source_file_id: 2,
    boa_filename: "boa.csv",
    dealertrack_filename: "dealertrack.csv",
    matched_count: 0,
    exception_count: 0,
    duplicate_count: 0,
    status: "completed",
    created_at: "2026-05-22T00:00:00.000Z",
    boa_source_file: sourceFile(1, "boa"),
    dealertrack_source_file: sourceFile(2, "dealertrack"),
    match_groups: [],
    exceptions: [],
    ...overrides,
  };
}

function sourceFile(source_file_id: number, source_type: SourceType) {
  return {
    source_file_id,
    dealership_id: 1,
    dealership_store_id: 1,
    store_name: "Hiley Hurst",
    source_type,
    filename: `${source_type}.csv`,
    row_count: 0,
    validation_error_count: 0,
    created_at: "2026-05-22T00:00:00.000Z",
  };
}

function transaction(overrides: Partial<TransactionSummary> = {}): TransactionSummary {
  return {
    id: 1,
    dealership_id: 1,
    source_type: "boa",
    transaction_date: "2026-05-01",
    post_date: null,
    amount: "12345.67",
    amount_cents: 1_234_567,
    reference_number: null,
    description: "2024 Ford F150 1FTFW1E80PFA11111",
    account: null,
    account_type: "floorplan",
    account_identifier: "floorplan",
    stock_number: "M12345",
    vin: "1FTFW1E80PFA11111",
    ...overrides,
  };
}

function exception(
  partial: Partial<ReconciliationRunDetail["exceptions"][number]>,
): ReconciliationRunDetail["exceptions"][number] {
  return {
    exception_id: 1,
    dealership_id: 1,
    exception_type: "missing_in_dealertrack",
    exception_category: "missing_in_dealertrack",
    status: "unresolved",
    note: "",
    review_status: "unreviewed",
    assigned_to: null,
    review_notes: "",
    boa_notes: "",
    gl_notes: "",
    reviewed_at: null,
    reviewed_by: null,
    source_type: "boa",
    reason: "BOA-only transaction.",
    created_at: "2026-05-22T00:00:00.000Z",
    transaction: transaction(),
    ...partial,
  };
}

function matchGroup(boaCents: number, dealertrackCents: number): ReconciliationRunDetail["match_groups"][number] {
  return {
    match_group_id: 1,
    match_type: "vin_amount",
    confidence: 1,
    reason: "Matched by VIN and amount.",
    created_at: "2026-05-22T00:00:00.000Z",
    transactions: [
      {
        side: "boa",
        source_type: "boa",
        transaction: transaction({
          id: 101,
          source_type: "boa",
          amount: String(boaCents / 100),
          amount_cents: boaCents,
          stock_number: "M10000",
          vin: "1FTFW1E80PFA10000",
        }),
      },
      {
        side: "dealertrack",
        source_type: "dealertrack",
        transaction: transaction({
          id: 102,
          source_type: "dealertrack",
          amount: String(-Math.abs(dealertrackCents) / 100),
          amount_cents: -Math.abs(dealertrackCents),
          stock_number: "M10000",
          vin: "1FTFW1E80PFA10000",
        }),
      },
    ],
  };
}

describe("buildHurstFpRecWorkbook", () => {
  test("partitions worksheet rows into Hiley sections and applies accounting sign convention", () => {
    const workbook = buildHurstFpRecWorkbook(
      buildDetail({
        exceptions: [
          exception({
            exception_id: 1,
            exception_type: "missing_in_dealertrack",
            exception_category: "missing_in_dealertrack",
            source_type: "boa",
          }),
          exception({
            exception_id: 2,
            exception_type: "missing_in_boa",
            exception_category: "missing_in_boa",
            source_type: "dealertrack",
            transaction: transaction({
              id: 2,
              source_type: "dealertrack",
              amount: "-5000.00",
              amount_cents: -500_000,
              description: "BOA FLOORPLAN",
              stock_number: "M99999",
              vin: null,
            }),
          }),
          exception({
            exception_id: 3,
            exception_type: "duplicate_transaction",
            exception_category: "amount_mismatch",
            source_type: "dealertrack",
            transaction: transaction({
              id: 3,
              source_type: "dealertrack",
              amount: "-2500.00",
              amount_cents: -250_000,
              stock_number: "M77777",
              vin: null,
            }),
          }),
        ],
      }),
    );

    expect(workbook.statement_not_on_gl.rows).toHaveLength(1);
    expect(workbook.schedule_not_on_statement.rows).toHaveLength(2);
    expect(workbook.statement_not_on_gl.total_amount_cents).toBe(1_234_567);
    expect(workbook.schedule_not_on_statement.total_amount_cents).toBe(-750_000);
    expect(workbook.schedule_not_on_statement.rows[0].gl_floored_note).toContain("Floored");
    expect(workbook.schedule_not_on_statement.rows[0].boa_floored_note).toBe("");
    expect(workbook.statement_not_on_gl.rows[0].boa_floored_note).toContain("Floored");
    expect(workbook.statement_not_on_gl.rows[0].gl_floored_note).toBe("");
    expect("needs_review" in workbook).toBe(false);
  });

  test("builds unit references from stock and VIN6 without exporting full VIN", () => {
    const workbook = buildHurstFpRecWorkbook(buildDetail({ exceptions: [exception({})] }));
    const row = workbook.statement_not_on_gl.rows[0];

    expect(row.unit_reference).toBe("M12345 / A11111");

    const html = toHurstFpRecXlsHtml(workbook);
    expect(html).toContain("M12345 / A11111");
    expect(html).not.toContain("1FTFW1E80PFA11111");
  });

  test("renders rows 1-7 as the compact accounting worksheet header", () => {
    const workbook = buildHurstFpRecWorkbook(buildDetail({ exceptions: [exception({})] }));
    const html = toHurstFpRecXlsHtml(workbook);

    const titleIdx = html.indexOf("Floorplan Reconciliation - Hiley Hurst");
    const periodIdx = html.indexOf("Period date");
    const outstandingIdx = html.indexOf("Outstanding per stmt");
    const glBalancesIdx = html.indexOf("GL Balances");
    const twentyOneIdx = html.indexOf(">2100<");
    const totalGlIdx = html.indexOf("Total GL");
    const differenceIdx = html.indexOf(">Difference<");

    expect(titleIdx).toBeGreaterThan(0);
    expect(periodIdx).toBeGreaterThan(titleIdx);
    expect(outstandingIdx).toBeGreaterThan(periodIdx);
    expect(glBalancesIdx).toBeGreaterThan(outstandingIdx);
    expect(twentyOneIdx).toBeGreaterThan(glBalancesIdx);
    expect(totalGlIdx).toBeGreaterThan(twentyOneIdx);
    expect(differenceIdx).toBeGreaterThan(totalGlIdx);
  });

  test("renders only the manual workbook section columns in the requested order", () => {
    const html = toHurstFpRecXlsHtml(
      buildHurstFpRecWorkbook(
        buildDetail({
          exceptions: [
            exception({
              exception_id: 1,
              exception_type: "missing_in_boa",
              exception_category: "missing_in_boa",
              source_type: "dealertrack",
              gl_notes: "GL floor pending",
              transaction: transaction({
                id: 1,
                source_type: "dealertrack",
                amount: "-1000.00",
                amount_cents: -100_000,
                stock_number: "M1",
                vin: null,
              }),
            }),
            exception({
              exception_id: 2,
              source_type: "boa",
              boa_notes: "BOA payoff pending",
            }),
          ],
        }),
      ),
    );

    expect(html).toMatch(/On schedule-not on statement[\s\S]*Unit \/ stock \/ VIN6 reference[\s\S]*Amount[\s\S]*GL Floored note[\s\S]*BOA Floored note/);
    expect(html).toMatch(/On statement-not on GL[\s\S]*Unit \/ stock \/ VIN6 reference[\s\S]*Amount[\s\S]*BOA Floored note[\s\S]*GL Floored note/);
    expect(html).not.toContain(">Descriptor<");
    expect(html).not.toContain(">VIN<");
    expect(html).not.toContain("Review Status");
    expect(html).not.toContain("GL Notes");
    expect(html).not.toContain("BOA Notes");
    expect(html).not.toContain("GL floor pending");
    expect(html).not.toContain("BOA payoff pending");
  });

  test("Difference follows source totals, section subtotals feed Net adjustments, and Variance resolves to zero", () => {
    const workbook = buildHurstFpRecWorkbook(
      buildDetail({
        match_groups: [matchGroup(1_000_000, 1_000_000)],
        exceptions: [
          exception({
            exception_id: 1,
            exception_type: "missing_in_boa",
            exception_category: "missing_in_boa",
            source_type: "dealertrack",
            transaction: transaction({
              id: 1,
              source_type: "dealertrack",
              amount: "-100.00",
              amount_cents: -10_000,
              stock_number: "M1",
              vin: null,
            }),
          }),
          exception({
            exception_id: 2,
            exception_type: "missing_in_dealertrack",
            exception_category: "missing_in_dealertrack",
            source_type: "boa",
            transaction: transaction({
              id: 2,
              source_type: "boa",
              amount: "250.00",
              amount_cents: 25_000,
              stock_number: "M2",
              vin: "1FTFW1E80PFA22222",
            }),
          }),
        ],
      }),
    );

    expect(workbook.summary.outstanding_per_stmt_amount_cents).toBe(1_025_000);
    expect(workbook.summary.total_gl_amount_cents).toBe(-1_010_000);
    expect(workbook.summary.gl_2100_amount_cents).toBe(-1_010_000);
    expect(workbook.summary.difference_amount_cents).toBe(15_000);
    expect(workbook.net_adjustments_amount_cents).toBe(
      workbook.statement_not_on_gl.total_amount_cents +
        workbook.schedule_not_on_statement.total_amount_cents,
    );
    expect(workbook.net_adjustments_amount_cents).toBe(15_000);
    expect(workbook.variance_amount_cents).toBe(0);
  });

  test("renders debit/credit accounting presentation and bottom rows", () => {
    const html = toHurstFpRecXlsHtml(
      buildHurstFpRecWorkbook(
        buildDetail({
          match_groups: [matchGroup(1_000_000, 1_000_000)],
          exceptions: [
            exception({
              exception_type: "missing_in_boa",
              exception_category: "missing_in_boa",
              source_type: "dealertrack",
              transaction: transaction({
                source_type: "dealertrack",
                amount_cents: -10_000,
                amount: "-100.00",
                stock_number: "M1",
                vin: null,
              }),
            }),
          ],
        }),
      ),
    );

    expect(html).toContain("Outstanding per stmt");
    expect(html).toContain("(10,100.00)");
    expect(html).toContain("Net adjustments");
    expect(html).toContain("Variance");
  });

  test("removes report metadata, source filenames, needs review, and sign-off from the export", () => {
    const workbook = buildHurstFpRecWorkbook(buildDetail({ exceptions: [exception({})] }));
    const html = toHurstFpRecXlsHtml(workbook);

    expect(html).not.toContain("Run #");
    expect(html).not.toContain("generated");
    expect(html).not.toContain("boa.csv");
    expect(html).not.toContain("dealertrack.csv");
    expect(html).not.toContain("Needs Review");
    expect(html).not.toContain("Sign-off");
    expect(html).not.toContain("Prepared by");
    expect(html).not.toContain("Reviewed by");
  });

  test("uses a store and period filename without run id", () => {
    const workbook = buildHurstFpRecWorkbook(buildDetail({ exceptions: [exception({})] }));
    expect(toHurstFpRecFilename(workbook)).toBe("floorplan-reconciliation-hiley-hurst-05-01-26.xls");
  });
});
