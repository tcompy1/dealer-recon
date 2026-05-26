import { describe, expect, test } from "vitest";

import type {
  ReconciliationExceptionCategory,
  ReconciliationRunDetail,
  SourceType,
  TransactionSummary,
} from "../domain/types.js";
import { buildRunMetrics, compareReconciliationRuns } from "./runComparisonAnalytics.js";

describe("compareReconciliationRuns", () => {
  test("detects resolved, newly introduced, and recurring exceptions by stable VIN category", () => {
    const previous = runDetail({
      reconciliation_run_id: 1,
      exceptions: [
        exception({ exception_id: 11, vin: "1FTFW1E80PFA11111", category: "missing_in_boa" }),
        exception({ exception_id: 12, vin: "JM1NDAM72T0702171", category: "amount_mismatch" }),
      ],
    });
    const current = runDetail({
      reconciliation_run_id: 2,
      exceptions: [
        exception({ exception_id: 21, vin: "JM1NDAM72T0702171", category: "amount_mismatch" }),
        exception({ exception_id: 22, vin: "7MMVABCYXTN476280", category: "missing_in_boa" }),
      ],
    });

    const comparison = compareReconciliationRuns(current, previous);

    expect(comparison.previous_run_id).toBe(1);
    expect(comparison.newly_resolved_exception_ids).toEqual([11]);
    expect(comparison.newly_created_exception_ids).toEqual([22]);
    expect(comparison.recurring_exception_ids).toEqual([21]);
    expect(comparison.run_comparison_summary).toMatchObject({
      newly_resolved_count: 1,
      newly_created_count: 1,
      recurring_count: 1,
    });
  });

  test("tracks category deltas across historical runs", () => {
    const previous = runDetail({
      reconciliation_run_id: 1,
      exceptions: [
        exception({ exception_id: 11, category: "missing_in_boa", vin: "VIN00000000000001" }),
        exception({ exception_id: 12, category: "amount_mismatch", vin: "VIN00000000000002" }),
      ],
    });
    const current = runDetail({
      reconciliation_run_id: 2,
      exceptions: [
        exception({ exception_id: 21, category: "missing_in_boa", vin: "VIN00000000000001" }),
        exception({ exception_id: 22, category: "missing_in_boa", vin: "VIN00000000000003" }),
      ],
    });

    const comparison = compareReconciliationRuns(current, previous);

    expect(comparison.category_delta_summary).toEqual(
      expect.arrayContaining([
        {
          exception_category: "missing_in_boa",
          current_count: 2,
          previous_count: 1,
          delta: 1,
        },
        {
          exception_category: "amount_mismatch",
          current_count: 0,
          previous_count: 1,
          delta: -1,
        },
      ]),
    );
  });

  test("summarizes reviewer workload trends", () => {
    const previous = runDetail({
      reconciliation_run_id: 1,
      exceptions: [
        exception({ exception_id: 11, assigned_to: "Maria" }),
        exception({ exception_id: 12, assigned_to: "Lee" }),
      ],
    });
    const current = runDetail({
      reconciliation_run_id: 2,
      exceptions: [
        exception({ exception_id: 21, assigned_to: "Maria" }),
        exception({ exception_id: 22, assigned_to: "Maria" }),
      ],
    });

    const comparison = compareReconciliationRuns(current, previous);

    expect(comparison.reviewer_workload_trends).toEqual(
      expect.arrayContaining([
        { reviewer: "Maria", current_count: 2, previous_count: 1, delta: 1 },
        { reviewer: "Lee", current_count: 0, previous_count: 1, delta: -1 },
      ]),
    );
  });
});

describe("buildRunMetrics", () => {
  test("calculates match rate, unresolved count, category distribution, and average resolution time", () => {
    const run = runDetail({
      matched_count: 8,
      exception_count: 2,
      exceptions: [
        exception({
          exception_id: 1,
          category: "missing_in_boa",
          created_at: "2026-05-01T12:00:00.000Z",
          review_status: "resolved",
          status: "resolved",
          reviewed_at: "2026-05-01T18:00:00.000Z",
        }),
        exception({
          exception_id: 2,
          category: "amount_mismatch",
          review_status: "investigating",
          status: "unresolved",
        }),
      ],
    });

    expect(buildRunMetrics(run)).toEqual({
      total_matched_transactions: 8,
      total_exception_count: 2,
      unresolved_count: 1,
      match_rate_percent: 80,
      category_distribution: {
        missing_in_boa: 1,
        amount_mismatch: 1,
      },
      average_time_to_resolution_hours: 6,
    });
  });
});

function runDetail(overrides: Partial<ReconciliationRunDetail> = {}): ReconciliationRunDetail {
  return {
    reconciliation_run_id: 1,
    dealership_id: 1,
    dealership_store_id: 1,
    store_name: "Hiley Mazda of Hurst",
    dealer_group_id: 1,
    dealer_group_name: "Hiley Mazda Group",
    boa_source_file_id: 1,
    dealertrack_source_file_id: 2,
    boa_filename: "boa.csv",
    dealertrack_filename: "dealertrack.csv",
    matched_count: 1,
    exception_count: overrides.exceptions?.length ?? 0,
    duplicate_count: 0,
    status: "completed",
    created_at: "2026-05-01T00:00:00.000Z",
    boa_source_file: sourceFile(1, "boa"),
    dealertrack_source_file: sourceFile(2, "dealertrack"),
    match_groups: [],
    exceptions: [],
    ...overrides,
  };
}

function exception({
  exception_id,
  category = "missing_in_boa",
  source_type = "dealertrack",
  vin = "1FTFW1E80PFA11111",
  reference_number = "REF-1",
  assigned_to = null,
  created_at = "2026-05-01T00:00:00.000Z",
  status = "unresolved",
  review_status = "unreviewed",
  reviewed_at = null,
}: {
  exception_id: number;
  category?: ReconciliationExceptionCategory;
  source_type?: SourceType;
  vin?: string | null;
  reference_number?: string | null;
  assigned_to?: string | null;
  created_at?: string;
  status?: ReconciliationRunDetail["exceptions"][number]["status"];
  review_status?: ReconciliationRunDetail["exceptions"][number]["review_status"];
  reviewed_at?: string | null;
}): ReconciliationRunDetail["exceptions"][number] {
  return {
    exception_id,
    dealership_id: 1,
    exception_type: category === "missing_in_dealertrack" ? "missing_in_dealertrack" : "missing_in_boa",
    exception_category: category,
    status,
    note: "",
    review_status,
    assigned_to,
    review_notes: "",
    boa_notes: "",
    gl_notes: "",
    reviewed_at,
    reviewed_by: null,
    source_type,
    reason: category,
    created_at,
    transaction: transaction({
      id: exception_id,
      source_type,
      vin,
      reference_number,
    }),
  };
}

function transaction(overrides: Partial<TransactionSummary> = {}): TransactionSummary {
  return {
    id: 1,
    dealership_id: 1,
    source_type: "dealertrack",
    transaction_date: "2026-05-01",
    post_date: null,
    amount: "-100.00",
    amount_cents: -10_000,
    reference_number: "REF-1",
    description: "Test transaction",
    account: null,
    account_type: "floorplan",
    account_identifier: "floorplan",
    stock_number: "M10001",
    vin: "1FTFW1E80PFA11111",
    ...overrides,
  };
}

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
    created_at: "2026-05-01T00:00:00.000Z",
  };
}
