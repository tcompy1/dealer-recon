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
            transaction_date: "2026-04-28",
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
    // Sign convention: statement-not-on-GL is positive; schedule-not-on-statement is negative.
    expect(workbook.statement_not_on_gl.total_amount_cents).toBe(1_234_567);
    expect(workbook.schedule_not_on_statement.total_amount_cents).toBe(-500_000);
  });

  test("applies accounting sign convention: schedule negative, statement positive", () => {
    const detail = buildDetail({
      exceptions: [
        exception({
          exception_id: 10,
          exception_type: "missing_in_boa",
          exception_category: "missing_in_boa",
          source_type: "dealertrack",
          transaction: {
            id: 10,
            dealership_id: 1,
            source_type: "dealertrack",
            transaction_date: "2026-05-01",
            post_date: null,
            amount: "1000.00",
            amount_cents: 100_000,
            reference_number: null,
            description: "DT row",
            account: null,
            stock_number: "M1",
            vin: null,
          },
        }),
        exception({
          exception_id: 11,
          exception_type: "missing_in_dealertrack",
          exception_category: "missing_in_dealertrack",
          source_type: "boa",
        }),
      ],
    });

    const workbook = buildHurstFpRecWorkbook(detail);

    expect(workbook.schedule_not_on_statement.rows[0].amount_cents).toBeLessThan(0);
    expect(workbook.statement_not_on_gl.rows[0].amount_cents).toBeGreaterThan(0);
  });

  test("renders accepted summary structure rows in workbook order", () => {
    const detail = buildDetail({ exceptions: [exception({})] });
    const workbook = buildHurstFpRecWorkbook(detail);
    const html = toHurstFpRecXlsHtml(workbook);

    const outstandingIdx = html.indexOf("Outstanding per stmt");
    const glBalancesIdx = html.indexOf("GL Balances");
    const twentyOneIdx = html.indexOf(">2100<");
    const totalGlIdx = html.indexOf("Total GL");
    const differenceIdx = html.indexOf(">Difference<");

    expect(outstandingIdx).toBeGreaterThan(0);
    expect(glBalancesIdx).toBeGreaterThan(outstandingIdx);
    expect(twentyOneIdx).toBeGreaterThan(glBalancesIdx);
    expect(totalGlIdx).toBeGreaterThan(twentyOneIdx);
    expect(differenceIdx).toBeGreaterThan(totalGlIdx);
  });

  test("Difference equals signed Outstanding + signed Total GL", () => {
    const detail = buildDetail({
      exceptions: [
        exception({
          exception_id: 30,
          exception_type: "missing_in_boa",
          exception_category: "missing_in_boa",
          source_type: "dealertrack",
          transaction: {
            id: 30,
            dealership_id: 1,
            source_type: "dealertrack",
            transaction_date: "2026-05-01",
            post_date: null,
            amount: "200.00",
            amount_cents: 20_000,
            reference_number: null,
            description: "DT only",
            account: null,
            stock_number: "M30",
            vin: null,
          },
        }),
        exception({
          exception_id: 31,
          exception_type: "missing_in_dealertrack",
          exception_category: "missing_in_dealertrack",
          source_type: "boa",
        }),
      ],
    });

    const workbook = buildHurstFpRecWorkbook(detail);
    expect(workbook.summary.difference_amount_cents).toBe(
      workbook.summary.outstanding_per_stmt_amount_cents +
        workbook.summary.total_gl_amount_cents,
    );
    // Total GL mirrors 2100 in Phase 1.
    expect(workbook.summary.total_gl_amount_cents).toBe(workbook.summary.gl_2100_amount_cents);
  });

  test("Net adjustments equals schedule subtotal + statement subtotal; Final Variance = Net adjustments - Difference", () => {
    const detail = buildDetail({
      exceptions: [
        exception({
          exception_id: 40,
          exception_type: "missing_in_boa",
          exception_category: "missing_in_boa",
          source_type: "dealertrack",
          transaction: {
            id: 40,
            dealership_id: 1,
            source_type: "dealertrack",
            transaction_date: "2026-05-01",
            post_date: null,
            amount: "500.00",
            amount_cents: 50_000,
            reference_number: null,
            description: "DT only",
            account: null,
            stock_number: "M40",
            vin: null,
          },
        }),
        exception({
          exception_id: 41,
          exception_type: "missing_in_dealertrack",
          exception_category: "missing_in_dealertrack",
          source_type: "boa",
        }),
      ],
    });

    const workbook = buildHurstFpRecWorkbook(detail);
    const scheduleSub = workbook.schedule_not_on_statement.total_amount_cents;
    const statementSub = workbook.statement_not_on_gl.total_amount_cents;
    expect(workbook.net_adjustments_amount_cents).toBe(scheduleSub + statementSub);
    expect(workbook.final_variance_amount_cents).toBe(
      workbook.net_adjustments_amount_cents - workbook.summary.difference_amount_cents,
    );
  });

  test("emits exact accepted section headings", () => {
    const detail = buildDetail({ exceptions: [exception({})] });
    const html = toHurstFpRecXlsHtml(buildHurstFpRecWorkbook(detail));
    expect(html).toContain("On schedule-not on statement");
    expect(html).toContain("On statement-not on GL");
  });

  test("renders per-row GL Floored and BOA Floored columns with mm-dd-yy dates", () => {
    const detail = buildDetail({
      exceptions: [
        exception({
          exception_id: 50,
          source_type: "boa",
          transaction: {
            id: 50,
            dealership_id: 1,
            source_type: "boa",
            transaction_date: "2026-02-15",
            post_date: null,
            amount: "1000.00",
            amount_cents: 100_000,
            reference_number: null,
            description: "BOA row",
            account: null,
            stock_number: "M50",
            vin: "1HGCM82633A123456",
          },
        }),
        exception({
          exception_id: 51,
          exception_type: "missing_in_boa",
          exception_category: "missing_in_boa",
          source_type: "dealertrack",
          transaction: {
            id: 51,
            dealership_id: 1,
            source_type: "dealertrack",
            transaction_date: "2026-02-10",
            post_date: null,
            amount: "2000.00",
            amount_cents: 200_000,
            reference_number: null,
            description: "DT row",
            account: null,
            stock_number: "M51",
            vin: null,
          },
        }),
      ],
    });
    const workbook = buildHurstFpRecWorkbook(detail);
    const statementRow = workbook.statement_not_on_gl.rows[0];
    expect(statementRow.boa_floored_date).toBe("02-15-26");
    expect(statementRow.gl_floored_date).toBe("");
    const scheduleRow = workbook.schedule_not_on_statement.rows[0];
    expect(scheduleRow.gl_floored_date).toBe("02-10-26");
    expect(scheduleRow.boa_floored_date).toBe("");

    const html = toHurstFpRecXlsHtml(workbook);
    expect(html).toContain("GL Floored");
    expect(html).toContain("BOA Floored");
    expect(html).toContain("02-15-26");
    expect(html).toContain("02-10-26");
  });

  test("renders period anchor date derived from latest transaction date", () => {
    const detail = buildDetail({
      exceptions: [
        exception({
          transaction: {
            id: 60,
            dealership_id: 1,
            source_type: "boa",
            transaction_date: "2026-03-31",
            post_date: null,
            amount: "100.00",
            amount_cents: 10_000,
            reference_number: null,
            description: "BOA row",
            account: null,
            stock_number: "M60",
            vin: null,
          },
        }),
      ],
    });
    const workbook = buildHurstFpRecWorkbook(detail);
    expect(workbook.period_anchor_date).toBe("03-31-26");
  });

  test("falls back to detail.created_at when no transaction dates are available", () => {
    const detail = buildDetail({
      created_at: "2026-05-22T00:00:00.000Z",
      exceptions: [
        exception({
          transaction: {
            id: 70,
            dealership_id: 1,
            source_type: "boa",
            transaction_date: null,
            post_date: null,
            amount: "100.00",
            amount_cents: 10_000,
            reference_number: null,
            description: "BOA row",
            account: null,
            stock_number: "M70",
            vin: null,
          },
        }),
      ],
    });
    const workbook = buildHurstFpRecWorkbook(detail);
    expect(workbook.period_anchor_date).toBe("05-22-26");
  });

  test("includes section subtotal labels", () => {
    const detail = buildDetail({ exceptions: [exception({})] });
    const html = toHurstFpRecXlsHtml(buildHurstFpRecWorkbook(detail));
    expect(html).toContain("Statement subtotal");
  });

  test("renders Net adjustments, Variance, and sign-off placeholder block", () => {
    const detail = buildDetail({ exceptions: [exception({})] });
    const html = toHurstFpRecXlsHtml(buildHurstFpRecWorkbook(detail));
    expect(html).toContain("Net adjustments");
    expect(html).toContain("Variance");
    expect(html).toContain("Sign-off");
    expect(html).toContain("Prepared by");
    expect(html).toContain("Reviewed by");
  });

  test("Difference and Net adjustments rows carry yellow fill; Variance does not", () => {
    const detail = buildDetail({ exceptions: [exception({})] });
    const html = toHurstFpRecXlsHtml(buildHurstFpRecWorkbook(detail));
    expect(html).toContain('class="summary-row yellow"');
    expect(html).toContain('class="adjustments-row"');
    expect(html).toContain('class="variance-row"');
    expect(html).toContain("FFFF00");
    expect(html).toMatch(/tr\.summary-row\.yellow td, tr\.adjustments-row td \{ background-color: #FFFF00/);
    expect(html).toMatch(/tr\.variance-row td \{ background-color: #ffffff/);
  });

  test("renders accounting parentheses for negative amounts", () => {
    const detail = buildDetail({
      exceptions: [
        exception({
          exception_id: 80,
          exception_type: "missing_in_boa",
          exception_category: "missing_in_boa",
          source_type: "dealertrack",
          transaction: {
            id: 80,
            dealership_id: 1,
            source_type: "dealertrack",
            transaction_date: "2026-02-01",
            post_date: null,
            amount: "1234.56",
            amount_cents: 123_456,
            reference_number: null,
            description: "DT row",
            account: null,
            stock_number: "M80",
            vin: null,
          },
        }),
      ],
    });
    const html = toHurstFpRecXlsHtml(buildHurstFpRecWorkbook(detail));
    // Schedule row should now be negative and displayed in parentheses with comma.
    expect(html).toContain("(1,234.56)");
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

  test("preserves Needs Review section in addition to accepted-layout sections", () => {
    const detail = buildDetail({
      exceptions: [
        exception({
          exception_id: 90,
          exception_category: "amount_mismatch",
        }),
      ],
    });
    const html = toHurstFpRecXlsHtml(buildHurstFpRecWorkbook(detail));
    expect(html).toContain("Needs Review");
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
    expect(html).toContain("On schedule-not on statement");
    expect(html).toContain("On statement-not on GL");
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

  test("preserves review_status column in rendered HTML", () => {
    const detail = buildDetail({
      exceptions: [
        exception({
          review_status: "investigating",
        }),
      ],
    });
    const html = toHurstFpRecXlsHtml(buildHurstFpRecWorkbook(detail));
    expect(html).toContain("Review Status");
    expect(html).toContain("investigating");
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
    // Summary table still shows the carry-forward count.
    expect(html).toContain("Carried forward from prior runs");
    // Carry-fwd / First Seen / Prior Notes columns are no longer rendered in
    // the exception section tables per Hiley feedback (2026-06-05). The data
    // model fields are preserved so they remain accessible programmatically.
    expect(html).not.toContain("Prior Notes");
    expect(html).not.toContain("Carry-fwd");
  });
});
