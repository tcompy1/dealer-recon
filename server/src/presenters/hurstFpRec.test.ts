import { describe, expect, test } from "vitest";

import type { ReconciliationRunDetail } from "../domain/types.js";
import { buildHurstFpRecWorkbook, toHurstFpRecXlsHtml } from "./hurstFpRec.js";

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
    matched_count: 1,
    exception_count: 0,
    duplicate_count: 0,
    status: "completed",
    created_at: "2026-05-22T00:00:00.000Z",
    boa_source_file: {
      source_file_id: 1,
      dealership_id: 1,
      dealership_store_id: 1,
      store_name: "Hiley Hurst",
      source_type: "boa",
      filename: "boa.csv",
      row_count: 0,
      validation_error_count: 0,
      created_at: "2026-05-22T00:00:00.000Z",
    },
    dealertrack_source_file: {
      source_file_id: 2,
      dealership_id: 1,
      dealership_store_id: 1,
      store_name: "Hiley Hurst",
      source_type: "dealertrack",
      filename: "dealertrack.csv",
      row_count: 0,
      validation_error_count: 0,
      created_at: "2026-05-22T00:00:00.000Z",
    },
    match_groups: [],
    exceptions: [],
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
    transaction: {
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
      stock_number: "M12345",
      vin: "1FTFW1E80PFA11111",
    },
    ...partial,
  };
}

describe("buildHurstFpRecWorkbook", () => {
  test("partitions exceptions into Schedule Not on Statement and Statement Not on GL", () => {
    const detail = buildDetail({
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
          transaction: {
            id: 2,
            dealership_id: 1,
            source_type: "dealertrack",
            transaction_date: null,
            post_date: null,
            amount: "5000.00",
            amount_cents: 500_000,
            reference_number: null,
            description: "BOA FLOORPLAN",
            account: null,
            stock_number: "M99999",
            vin: null,
          },
        }),
      ],
    });

    const workbook = buildHurstFpRecWorkbook(detail);

    expect(workbook.statement_not_on_gl.rows).toHaveLength(1);
    expect(workbook.statement_not_on_gl.rows[0].vin6).toBe("A11111");
    expect(workbook.schedule_not_on_statement.rows).toHaveLength(1);
    expect(workbook.schedule_not_on_statement.rows[0].stock_number).toBe("M99999");
    expect(workbook.statement_not_on_gl.total_amount_cents).toBe(1_234_567);
    expect(workbook.schedule_not_on_statement.total_amount_cents).toBe(500_000);
  });

  test("routes amount/VIN conflict categories into Needs Review", () => {
    const detail = buildDetail({
      exceptions: [
        exception({
          exception_id: 3,
          exception_category: "amount_mismatch",
        }),
      ],
    });

    const workbook = buildHurstFpRecWorkbook(detail);

    expect(workbook.needs_review.rows).toHaveLength(1);
    expect(workbook.statement_not_on_gl.rows).toHaveLength(0);
  });

  test("includes BOA-side notes in BOA Notes column and dealertrack-side notes in GL Notes", () => {
    const detail = buildDetail({
      exceptions: [
        exception({
          source_type: "boa",
          review_notes: "Paid by check 1234",
        }),
        exception({
          exception_id: 99,
          exception_type: "missing_in_boa",
          exception_category: "missing_in_boa",
          source_type: "dealertrack",
          review_notes: "Stocked in next month",
          transaction: {
            id: 99,
            dealership_id: 1,
            source_type: "dealertrack",
            transaction_date: null,
            post_date: null,
            amount: "1000.00",
            amount_cents: 100_000,
            reference_number: null,
            description: "DT row",
            account: null,
            stock_number: "M55555",
            vin: null,
          },
        }),
      ],
    });

    const workbook = buildHurstFpRecWorkbook(detail);

    expect(workbook.statement_not_on_gl.rows[0].boa_notes).toBe("Paid by check 1234");
    expect(workbook.statement_not_on_gl.rows[0].gl_notes).toBe("");
    expect(workbook.schedule_not_on_statement.rows[0].gl_notes).toBe("Stocked in next month");
    expect(workbook.schedule_not_on_statement.rows[0].boa_notes).toBe("");
  });

  test("renders an Excel-compatible HTML workbook", () => {
    const detail = buildDetail({ exceptions: [exception({})] });
    const html = toHurstFpRecXlsHtml(buildHurstFpRecWorkbook(detail));

    expect(html).toContain("Hurst FP Rec");
    expect(html).toContain("Schedule Not on Statement");
    expect(html).toContain("Statement Not on GL");
    expect(html).toContain("A11111");
    expect(html).toContain("M12345");
  });

  test("prefers explicit boa_notes/gl_notes over legacy review_notes", () => {
    const detail = buildDetail({
      exceptions: [
        exception({
          source_type: "boa",
          review_notes: "legacy combined note",
          boa_notes: "BOA-specific note",
        }),
      ],
    });
    const workbook = buildHurstFpRecWorkbook(detail);
    expect(workbook.statement_not_on_gl.rows[0].boa_notes).toBe("BOA-specific note");
    expect(workbook.statement_not_on_gl.rows[0].gl_notes).toBe("");
  });

  test("surfaces carry-forward fields on rows when present", () => {
    const detail = buildDetail({
      exceptions: [
        exception({
          carry_forward: {
            carried_forward: true,
            previous_run_id: 7,
            previous_exception_id: 21,
            first_seen_run_id: 5,
            first_seen_at: "2026-04-01T00:00:00.000Z",
            last_seen_run_id: 7,
            last_seen_at: "2026-05-01T00:00:00.000Z",
            occurrence_count: 3,
            prior_boa_notes: "April note | May note",
            prior_gl_notes: "",
          },
        }),
      ],
    });
    const workbook = buildHurstFpRecWorkbook(detail);
    const row = workbook.statement_not_on_gl.rows[0];
    expect(row.carried_forward).toBe(true);
    expect(row.first_seen_run_id).toBe(5);
    expect(row.occurrence_count).toBe(3);
    expect(row.prior_boa_notes).toContain("April note");
    expect(workbook.carried_forward_count).toBe(1);

    const html = toHurstFpRecXlsHtml(workbook);
    expect(html).toContain("Carried forward from prior runs");
    expect(html).toContain("Yes (3x)");
    expect(html).toContain("Prior Notes");
    expect(html).toContain("April note");
  });
});
