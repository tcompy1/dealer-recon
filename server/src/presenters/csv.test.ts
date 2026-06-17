import { describe, expect, test } from "vitest";

import type { MonthEndReport, ReconciliationRunDetail, SourceType, TransactionSummary } from "../domain/types.js";
import { toExceptionsCsv, toMonthEndReportCsv } from "./csv.js";

function sourceFile(source_file_id: number, source_type: SourceType) {
  return {
    source_file_id,
    dealership_id: 1,
    dealership_store_id: 1,
    store_name: "Hiley Mazda of Hurst",
    source_type,
    filename: `${source_type}.csv`,
    row_count: 1,
    validation_error_count: 0,
    created_at: "2026-06-15T00:00:00.000Z",
  };
}

function transaction(overrides: Partial<TransactionSummary> = {}): TransactionSummary {
  return {
    id: 101,
    dealership_id: 1,
    source_type: "dealertrack",
    transaction_date: "2026-06-01",
    post_date: null,
    amount: "-123.45",
    amount_cents: -12_345,
    reference_number: "=SUM(1+1)",
    description: "	Tabbed description",
    account: "2100",
    account_type: "floorplan",
    account_identifier: "floorplan",
    stock_number: "+M123",
    vin: "@VIN",
    ...overrides,
  };
}

function detail(): ReconciliationRunDetail {
  return {
    reconciliation_run_id: 77,
    dealership_id: 1,
    dealership_store_id: 1,
    store_name: "Hiley Mazda of Hurst",
    dealer_group_id: null,
    dealer_group_name: null,
    boa_source_file_id: 1,
    dealertrack_source_file_id: 2,
    boa_filename: "boa.csv",
    dealertrack_filename: "dealertrack.csv",
    matched_count: 0,
    exception_count: 1,
    duplicate_count: 0,
    status: "completed",
    created_at: "2026-06-15T00:00:00.000Z",
    boa_source_file: sourceFile(1, "boa"),
    dealertrack_source_file: sourceFile(2, "dealertrack"),
    match_groups: [],
    exceptions: [
      {
        exception_id: 88,
        dealership_id: 1,
        exception_type: "missing_in_boa",
        exception_category: "missing_in_boa",
        status: "unresolved",
        note: "=source note",
        review_status: "unreviewed",
        assigned_to: "+analyst",
        review_notes: "@review",
        boa_notes: "",
        gl_notes: "",
        reviewed_at: null,
        reviewed_by: null,
        source_type: "dealertrack",
        reason: "Dealertrack-only transaction.",
        created_at: "2026-06-15T00:00:00.000Z",
        transaction: transaction(),
      },
    ],
  };
}

describe("CSV presenters", () => {
  test("neutralizes formula-leading exception text while preserving amount fields", () => {
    const csv = toExceptionsCsv(detail());

    expect(csv).toContain(",'=source note,unreviewed,'+analyst,'@review");
    expect(csv).toContain(",-123.45,-12345,'=SUM(1+1),'+M123,'@VIN,'	Tabbed description,");
    expect(csv).not.toContain(",'-123.45,-12345,");
  });

  test("neutralizes formula-leading report labels while preserving numeric totals", () => {
    const report: MonthEndReport = {
      reporting_period: {
        start_date: "2026-06-01",
        end_date: "2026-06-30",
      },
      generated_at: "2026-06-15T00:00:00.000Z",
      account_summaries: [
        {
          account_identifier: "@floorplan",
          account_type: "=asset",
          source_totals: [
            { source_type: "boa", amount_cents: 10_000, amount: "100.00", transaction_count: 1 },
            { source_type: "dealertrack", amount_cents: -2_550, amount: "-25.50", transaction_count: 1 },
          ],
          net_difference_amount_cents: 7_450,
          net_difference_amount: "74.50",
          unresolved_exception_count: 1,
          resolved_exception_count: 2,
          ignored_exception_count: 3,
        },
      ],
      reconciliation_runs_included: [],
    };

    expect(toMonthEndReportCsv(report)).toContain("'@floorplan,'=asset,100.00,-25.50,74.50,1,2,3");
  });
});
